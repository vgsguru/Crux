
CREATE POLICY "og-images service writes"
  ON storage.objects FOR INSERT TO service_role
  WITH CHECK (bucket_id = 'og-images');
CREATE POLICY "og-images service reads"
  ON storage.objects FOR SELECT TO service_role
  USING (bucket_id = 'og-images');
CREATE POLICY "og-images service updates"
  ON storage.objects FOR UPDATE TO service_role
  USING (bucket_id = 'og-images');
