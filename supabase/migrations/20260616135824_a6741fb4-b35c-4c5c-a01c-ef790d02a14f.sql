ALTER TABLE public.orders
  ADD COLUMN client_idempotency_key uuid;

CREATE UNIQUE INDEX orders_user_idempotency_key_uidx
  ON public.orders (user_id, client_idempotency_key)
  WHERE client_idempotency_key IS NOT NULL;