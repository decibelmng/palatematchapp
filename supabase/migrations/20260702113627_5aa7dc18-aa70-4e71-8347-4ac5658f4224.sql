
CREATE POLICY "Users read own scan images"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'scan-images' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users upload own scan images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'scan-images' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users delete own scan images"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'scan-images' AND auth.uid()::text = (storage.foldername(name))[1]);
