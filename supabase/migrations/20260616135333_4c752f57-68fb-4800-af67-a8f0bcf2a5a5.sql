-- Per-page job tracking for catalog ingestion (idempotent, recoverable)
CREATE TABLE public.catalog_page_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  page_number integer NOT NULL CHECK (page_number >= 1),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','error')),
  error_message text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, page_number)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_page_jobs TO authenticated;
GRANT ALL ON public.catalog_page_jobs TO service_role;

ALTER TABLE public.catalog_page_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY catalog_page_jobs_admin_all
  ON public.catalog_page_jobs
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_catalog_page_jobs_updated_at
  BEFORE UPDATE ON public.catalog_page_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX catalog_page_jobs_brand_status_idx
  ON public.catalog_page_jobs (brand_id, status);

-- Atomic recount of brand progress. Returns the new processed_pages value.
CREATE OR REPLACE FUNCTION public.recount_brand_progress(_brand_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  done_count integer;
  total integer;
BEGIN
  SELECT count(*) INTO done_count
    FROM public.catalog_page_jobs
    WHERE brand_id = _brand_id AND status = 'done';

  SELECT total_pages INTO total
    FROM public.brands
    WHERE id = _brand_id;

  UPDATE public.brands
    SET processed_pages = done_count,
        status = CASE
          WHEN total IS NOT NULL AND total > 0 AND done_count >= total
            THEN COALESCE(NULLIF(status, 'processing'), 'unpublished')
          ELSE status
        END
    WHERE id = _brand_id;

  -- If we just crossed the threshold, ensure status moves out of 'processing'
  UPDATE public.brands
    SET status = 'unpublished'
    WHERE id = _brand_id
      AND status = 'processing'
      AND total IS NOT NULL AND total > 0
      AND done_count >= total;

  RETURN done_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recount_brand_progress(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recount_brand_progress(uuid) TO service_role;