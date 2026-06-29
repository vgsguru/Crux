
-- Revoke public execute on SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

-- Storage policies: user files are stored as {user_id}/{filename}
-- Resumes
CREATE POLICY "Users upload own resumes" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users read own resumes" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Recruiters read applicant resumes" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'resumes' AND EXISTS (
    SELECT 1 FROM public.applications a
    JOIN public.jobs j ON j.id = a.job_id
    JOIN public.companies c ON c.id = j.company_id
    WHERE c.owner_id = auth.uid() AND a.resume_url LIKE '%' || storage.objects.name
  ));

-- Intro videos
CREATE POLICY "Users upload own intro videos" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'intro-videos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users read own intro videos" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'intro-videos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Recruiters read intro videos" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'intro-videos' AND EXISTS (
    SELECT 1 FROM public.applications a
    JOIN public.jobs j ON j.id = a.job_id
    JOIN public.companies c ON c.id = j.company_id
    WHERE c.owner_id = auth.uid() AND a.intro_video_url LIKE '%' || storage.objects.name
  ));

-- Interview videos
CREATE POLICY "Users upload own interview videos" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'interview-videos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users read own interview videos" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'interview-videos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Recruiters read interview videos" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'interview-videos' AND EXISTS (
    SELECT 1 FROM public.interviews i
    JOIN public.applications a ON a.id = i.application_id
    JOIN public.jobs j ON j.id = a.job_id
    JOIN public.companies c ON c.id = j.company_id
    WHERE c.owner_id = auth.uid() AND i.video_url LIKE '%' || storage.objects.name
  ));

-- Company logos (private, owner manages)
CREATE POLICY "Owners upload company logos" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'company-logos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Anyone read company logos" ON storage.objects FOR SELECT TO authenticated, anon
  USING (bucket_id = 'company-logos');
CREATE POLICY "Owners update company logos" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'company-logos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Owners delete company logos" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'company-logos' AND (storage.foldername(name))[1] = auth.uid()::text);
