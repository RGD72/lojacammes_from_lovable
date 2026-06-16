
CREATE TABLE public.ai_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  function text NOT NULL,
  provider text NOT NULL DEFAULT 'lovable-gateway',
  model text NOT NULL,
  brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  page_number integer,
  status integer,
  attempts integer NOT NULL DEFAULT 1,
  duration_ms integer,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  error_message text,
  run_id text
);

CREATE INDEX idx_ai_usage_log_brand_created ON public.ai_usage_log (brand_id, created_at DESC);
CREATE INDEX idx_ai_usage_log_created ON public.ai_usage_log (created_at DESC);

GRANT SELECT ON public.ai_usage_log TO authenticated;
GRANT ALL ON public.ai_usage_log TO service_role;

ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_usage_log_admin_read"
  ON public.ai_usage_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
