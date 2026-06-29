
-- Audit trail
CREATE TABLE public.role_audit (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  email text,
  role app_role NOT NULL,
  source text NOT NULL DEFAULT 'signup',
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.role_audit TO authenticated;
GRANT ALL ON public.role_audit TO service_role;
ALTER TABLE public.role_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Recruiters can view audit trail"
ON public.role_audit FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'recruiter'));

CREATE INDEX role_audit_created_at_idx ON public.role_audit (created_at DESC);

-- Rate-limit tracking for recruiter assignment (server-only)
CREATE TABLE public.recruiter_signup_attempts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ip text NOT NULL,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.recruiter_signup_attempts TO service_role;
ALTER TABLE public.recruiter_signup_attempts ENABLE ROW LEVEL SECURITY;
-- No policies = no client access; only service role (which bypasses RLS) can read/write.

CREATE INDEX recruiter_signup_attempts_ip_idx
  ON public.recruiter_signup_attempts (ip, created_at DESC);
