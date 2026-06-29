
CREATE POLICY "showcase_read_auth" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'showcase-media');
CREATE POLICY "showcase_insert_own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'showcase-media' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "showcase_update_own" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'showcase-media' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "showcase_delete_own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'showcase-media' AND (storage.foldername(name))[1] = auth.uid()::text);
