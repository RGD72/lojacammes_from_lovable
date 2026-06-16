
ALTER TABLE public.product_images ADD COLUMN IF NOT EXISTS page_image_path text;

UPDATE public.product_images pi
SET page_image_path = 'brand_' || p.brand_id || '/page_' || p.page_number || '.jpg'
FROM public.products p
WHERE pi.product_id = p.id AND pi.page_image_path IS NULL;
