
-- 1. Tabela
CREATE TABLE public.client_brand_access (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (user_id, brand_id)
);

CREATE INDEX client_brand_access_brand_idx ON public.client_brand_access(brand_id);

GRANT SELECT, INSERT, DELETE ON public.client_brand_access TO authenticated;
GRANT ALL ON public.client_brand_access TO service_role;

ALTER TABLE public.client_brand_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_brand_access_admin_all"
  ON public.client_brand_access FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "client_brand_access_self_read"
  ON public.client_brand_access FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- 2. Backfill (preserva comportamento atual)
INSERT INTO public.client_brand_access (user_id, brand_id, created_by)
SELECT p.id, b.id, NULL
FROM public.profiles p
JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'client'
CROSS JOIN public.brands b
WHERE p.active = true
ON CONFLICT DO NOTHING;

-- 3. Função has_brand_access (admin sempre, ou linha existente)
CREATE OR REPLACE FUNCTION public.has_brand_access(_user_id uuid, _brand_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.client_brand_access
      WHERE user_id = _user_id AND brand_id = _brand_id
    )
$$;

-- 4. Atualiza policies de leitura para exigir acesso por marca
DROP POLICY IF EXISTS "brands_clients_read_published" ON public.brands;
CREATE POLICY "brands_clients_read_published"
  ON public.brands FOR SELECT
  TO authenticated
  USING (
    status = 'published'
    AND public.is_active_client(auth.uid())
    AND NOT public.has_role(auth.uid(), 'admin')
    AND public.has_brand_access(auth.uid(), id)
  );

DROP POLICY IF EXISTS "products_clients_read" ON public.products;
CREATE POLICY "products_clients_read"
  ON public.products FOR SELECT
  TO authenticated
  USING (
    public.is_active_client(auth.uid())
    AND public.has_brand_access(auth.uid(), brand_id)
    AND EXISTS (
      SELECT 1 FROM public.brands b
      WHERE b.id = products.brand_id AND b.status = 'published'
    )
  );

DROP POLICY IF EXISTS "product_images_clients_read" ON public.product_images;
CREATE POLICY "product_images_clients_read"
  ON public.product_images FOR SELECT
  TO authenticated
  USING (
    public.is_active_client(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.products p
      JOIN public.brands b ON b.id = p.brand_id
      WHERE p.id = product_images.product_id
        AND b.status = 'published'
        AND public.has_brand_access(auth.uid(), b.id)
    )
  );

-- 5. Storage: limita leitura a marcas autorizadas
DROP POLICY IF EXISTS "catalogs_clients_read_published" ON storage.objects;
CREATE POLICY "catalogs_clients_read_published"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = ANY (ARRAY['catalogs','catalog-pages','product-images'])
    AND public.is_active_client(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.brands b
      WHERE b.status = 'published'
        AND b.id::text = split_part(storage.objects.name, '/', 1)
        AND public.has_brand_access(auth.uid(), b.id)
    )
  );
