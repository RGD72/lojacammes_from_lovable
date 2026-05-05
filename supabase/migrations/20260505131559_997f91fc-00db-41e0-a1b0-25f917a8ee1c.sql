ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS commission_pct numeric NOT NULL DEFAULT 30;
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'paid';