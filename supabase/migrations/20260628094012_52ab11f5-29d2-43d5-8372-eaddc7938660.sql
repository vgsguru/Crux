
CREATE OR REPLACE FUNCTION public.match_jobs_for_user(_user uuid, _limit int DEFAULT 20)
RETURNS TABLE (id uuid, title text, company_id uuid, similarity double precision, is_saved boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (
    SELECT embedding FROM public.profiles
    WHERE id = _user AND _user = auth.uid()
  )
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
