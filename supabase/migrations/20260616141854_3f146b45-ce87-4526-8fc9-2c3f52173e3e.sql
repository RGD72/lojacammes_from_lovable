
-- Singleton lock table: at most one row, key 'singleton'
CREATE TABLE public.admin_bootstrap_lock (
  id text PRIMARY KEY CHECK (id = 'singleton'),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  claimed_by_user_id uuid
);

GRANT ALL ON public.admin_bootstrap_lock TO service_role;
ALTER TABLE public.admin_bootstrap_lock ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role (bypasses RLS) can access.

-- Atomic claim: returns true only for the caller that won the race.
CREATE OR REPLACE FUNCTION public.try_claim_admin_bootstrap()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted boolean := false;
BEGIN
  -- Hard gate: if any admin already exists, never allow bootstrap.
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    RETURN false;
  END IF;

  INSERT INTO public.admin_bootstrap_lock (id)
  VALUES ('singleton')
  ON CONFLICT (id) DO NOTHING
  RETURNING true INTO inserted;

  RETURN COALESCE(inserted, false);
END;
$$;

-- Release the lock (only used when subsequent steps fail).
CREATE OR REPLACE FUNCTION public.release_admin_bootstrap()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.admin_bootstrap_lock WHERE id = 'singleton';
$$;

REVOKE ALL ON FUNCTION public.try_claim_admin_bootstrap() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_admin_bootstrap() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_claim_admin_bootstrap() TO service_role;
GRANT EXECUTE ON FUNCTION public.release_admin_bootstrap() TO service_role;

-- Backfill: if an admin already exists, mark the lock as claimed.
INSERT INTO public.admin_bootstrap_lock (id, claimed_by_user_id)
SELECT 'singleton', (SELECT user_id FROM public.user_roles WHERE role = 'admin' ORDER BY 1 LIMIT 1)
WHERE EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin')
ON CONFLICT (id) DO NOTHING;
