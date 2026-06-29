
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS score_evidence jsonb,
  ADD COLUMN IF NOT EXISTS retake_allowed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retake_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS audit_log jsonb NOT NULL DEFAULT '[]'::jsonb;
