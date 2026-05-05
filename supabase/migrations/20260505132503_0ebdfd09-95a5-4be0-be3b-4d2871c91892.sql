
-- Wipe data
DELETE FROM public.order_items;
DELETE FROM public.orders;
DELETE FROM public.products;
DELETE FROM public.brands;

-- Fix FK to cascade on brand delete
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_brand_id_fkey;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_brand_id_fkey
  FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

-- Ensure order_items cascade with orders
ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_order_id_fkey;
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_order_id_fkey
  FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;

-- Ensure products cascade with brands
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_brand_id_fkey;
ALTER TABLE public.products
  ADD CONSTRAINT products_brand_id_fkey
  FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;
