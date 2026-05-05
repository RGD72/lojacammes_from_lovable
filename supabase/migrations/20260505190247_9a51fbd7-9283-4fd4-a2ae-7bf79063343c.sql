ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}'::text[];

-- Backfill image_urls from image_url where empty
UPDATE public.products SET image_urls = ARRAY[image_url] WHERE (image_urls IS NULL OR array_length(image_urls,1) IS NULL) AND image_url IS NOT NULL;