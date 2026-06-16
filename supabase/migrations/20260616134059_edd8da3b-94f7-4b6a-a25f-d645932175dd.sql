
-- Drop old public read policy if it exists
DROP POLICY IF EXISTS "catalogs_public_read" ON storage.objects;
DROP POLICY IF EXISTS "catalogs_admin_all" ON storage.objects;
DROP POLICY IF EXISTS "catalogs_clients_read_published" ON storage.objects;

-- Admins: full access to the three catalog buckets
CREATE POLICY "catalogs_admin_all" ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id IN ('catalogs', 'catalog-pages', 'product-images')
    AND public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    bucket_id IN ('catalogs', 'catalog-pages', 'product-images')
    AND public.has_role(auth.uid(), 'admin')
  );

-- Active clients: read-only access to files belonging to a published brand.
-- Path convention used by the app is "<brand_id>/...", so we match the first
-- path segment to a published brand.
CREATE POLICY "catalogs_clients_read_published" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id IN ('catalogs', 'catalog-pages', 'product-images')
    AND public.is_active_client(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.brands b
      WHERE b.status = 'published'
        AND b.id::text = split_part(storage.objects.name, '/', 1)
    )
  );
