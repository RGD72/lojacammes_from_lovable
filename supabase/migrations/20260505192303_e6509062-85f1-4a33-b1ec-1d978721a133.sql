ALTER TABLE public.order_items ADD COLUMN status order_status NOT NULL DEFAULT 'new';
UPDATE public.order_items i SET status = o.status FROM public.orders o WHERE i.order_id = o.id;