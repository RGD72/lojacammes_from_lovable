-- Force order creation through the submit-order edge function (server-side price recalc).
DROP POLICY IF EXISTS orders_clients_insert_own ON public.orders;
DROP POLICY IF EXISTS order_items_clients_insert_own ON public.order_items;