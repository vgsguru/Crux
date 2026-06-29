
-- Storage: allow owners to update/delete their own files in private buckets
CREATE POLICY "Users can update own resumes"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'resumes' AND auth.uid()::text = (storage.foldername(name))[1])
WITH CHECK (bucket_id = 'resumes' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete own resumes"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'resumes' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update own intro videos"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'intro-videos' AND auth.uid()::text = (storage.foldername(name))[1])
WITH CHECK (bucket_id = 'intro-videos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete own intro videos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'intro-videos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update own interview videos"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'interview-videos' AND auth.uid()::text = (storage.foldername(name))[1])
WITH CHECK (bucket_id = 'interview-videos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete own interview videos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'interview-videos' AND auth.uid()::text = (storage.foldername(name))[1]);

-- user_roles: prevent privilege escalation
-- Drop existing permissive self-insert policy
DROP POLICY IF EXISTS "Users can insert own role at signup" ON public.user_roles;

-- Only allow self-insert of the 'applicant' role, and only if the user has no existing role.
-- Recruiter accounts must be provisioned via a privileged server function (service role).
CREATE POLICY "Users can self-assign applicant role once"
ON public.user_roles FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND role = 'applicant'::app_role
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
  )
);

-- Defense-in-depth: trigger blocks duplicates/escalation even if a future policy is too permissive
CREATE OR REPLACE FUNCTION public.prevent_role_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.user_id AND role = NEW.role) THEN
    RAISE EXCEPTION 'Role already assigned';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_role_escalation_trg ON public.user_roles;
CREATE TRIGGER prevent_role_escalation_trg
BEFORE INSERT ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.prevent_role_escalation();
