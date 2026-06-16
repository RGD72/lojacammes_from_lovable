
-- 1. Create table
CREATE TABLE public.product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  url text NOT NULL,
  bbox jsonb NOT NULL DEFAULT '[0,0,1,1]'::jsonb,
  page_number integer,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_images_unique_url UNIQUE (product_id, url)
);

CREATE INDEX idx_product_images_product_pos ON public.product_images (product_id, position);

-- 2. GRANTs
GRANT SELECT ON public.product_images TO authenticated;
GRANT ALL ON public.product_images TO service_role;

-- 3. RLS
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;

-- 4. Policies (mirror products)
CREATE POLICY "product_images_admin_all"
  ON public.product_images
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "product_images_clients_read"
  ON public.product_images
  FOR SELECT
  TO authenticated
  USING (
    public.is_active_client(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.products p
      JOIN public.brands b ON b.id = p.brand_id
      WHERE p.id = product_images.product_id
        AND b.status = 'published'::brand_status
    )
  );

-- 5. Backfill from existing parallel arrays.
-- Case A: image_urls has at least one entry — zip with image_bboxes by index.
INSERT INTO public.product_images (product_id, url, bbox, page_number, position)
SELECT
  p.id,
  u.url,
  COALESCE(
    (p.image_bboxes -> (u.ord - 1)::int),
    '[0,0,1,1]'::jsonb
  ) AS bbox,
  p.page_number,
  (u.ord - 1)::int AS position
FROM public.products p
CROSS JOIN LATERAL unnest(p.image_urls) WITH ORDINALITY AS u(url, ord)
WHERE p.image_urls IS NOT NULL
  AND array_length(p.image_urls, 1) > 0
  AND u.url IS NOT NULL
  AND length(u.url) > 0
ON CONFLICT (product_id, url) DO NOTHING;

-- Case B: image_urls is empty but legacy image_url is set.
INSERT INTO public.product_images (product_id, url, bbox, page_number, position)
SELECT p.id, p.image_url, '[0,0,1,1]'::jsonb, p.page_number, 0
FROM public.products p
WHERE (p.image_urls IS NULL OR array_length(p.image_urls, 1) IS NULL)
  AND p.image_url IS NOT NULL
  AND length(p.image_url) > 0
ON CONFLICT (product_id, url) DO NOTHING;
