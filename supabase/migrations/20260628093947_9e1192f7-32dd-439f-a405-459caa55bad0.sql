
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS embedding vector(1536),
  ADD COLUMN IF NOT EXISTS embedding_text text,
  ADD COLUMN IF NOT EXISTS embedding_updated_at timestamptz;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS resume_text text,
  ADD COLUMN IF NOT EXISTS embedding vector(1536),
  ADD COLUMN IF NOT EXISTS embedding_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS skills text[] DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS jobs_embedding_idx ON public.jobs USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS profiles_embedding_idx ON public.profiles USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS public.saved_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, job_id)
);
GRANT SELECT, INSERT, DELETE ON public.saved_jobs TO authenticated;
GRANT ALL ON public.saved_jobs TO service_role;
ALTER TABLE public.saved_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "saved_jobs owner read" ON public.saved_jobs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "saved_jobs owner insert" ON public.saved_jobs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "saved_jobs owner delete" ON public.saved_jobs FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS saved_jobs_user_idx ON public.saved_jobs(user_id, created_at DESC);

DO $$ BEGIN
  CREATE TYPE public.verification_status AS ENUM ('unverified','pending','verified','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS verification_status public.verification_status NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

CREATE TABLE IF NOT EXISTS public.company_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  domain text,
  evidence_url text,
  notes text,
  status public.verification_status NOT NULL DEFAULT 'pending',
  decided_by uuid REFERENCES auth.users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.company_verifications TO authenticated;
GRANT ALL ON public.company_verifications TO service_role;
ALTER TABLE public.company_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "verifications owner read" ON public.company_verifications FOR SELECT TO authenticated
  USING (auth.uid() = requested_by OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "verifications owner insert" ON public.company_verifications FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = requested_by
    AND EXISTS (SELECT 1 FROM public.companies c WHERE c.id = company_id AND c.owner_id = auth.uid()));
CREATE POLICY "verifications admin update" ON public.company_verifications FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.match_jobs_for_user(_user uuid, _limit int DEFAULT 20)
RETURNS TABLE (id uuid, title text, company_id uuid, similarity double precision, is_saved boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (SELECT embedding FROM public.profiles WHERE id = _user)
  SELECT j.id, j.title, j.company_id,
    (1 - (j.embedding <=> (SELECT embedding FROM me)))::double precision AS similarity,
    EXISTS(SELECT 1 FROM public.saved_jobs s WHERE s.user_id = _user AND s.job_id = j.id) AS is_saved
  FROM public.jobs j
  WHERE j.embedding IS NOT NULL
    AND (SELECT embedding FROM me) IS NOT NULL
    AND j.status = 'active'
  ORDER BY j.embedding <=> (SELECT embedding FROM me)
  LIMIT _limit
$$;
GRANT EXECUTE ON FUNCTION public.match_jobs_for_user(uuid,int) TO authenticated;

CREATE OR REPLACE FUNCTION public.bulk_update_pipeline(_application_ids uuid[], _new_status text)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE affected int;
BEGIN
  IF _new_status NOT IN ('applied','reviewing','interview','offer','hired','rejected') THEN
    RAISE EXCEPTION 'Invalid status %', _new_status;
  END IF;
  UPDATE public.applications a
  SET pipeline_status = _new_status,
      audit_log = COALESCE(a.audit_log,'[]'::jsonb) || jsonb_build_array(
        jsonb_build_object('at', now(), 'by', auth.uid(), 'action','bulk_status','to', _new_status))
  WHERE a.id = ANY(_application_ids)
    AND EXISTS (SELECT 1 FROM public.jobs j JOIN public.companies c ON c.id = j.company_id
                WHERE j.id = a.job_id AND c.owner_id = auth.uid());
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END; $$;
GRANT EXECUTE ON FUNCTION public.bulk_update_pipeline(uuid[],text) TO authenticated;
