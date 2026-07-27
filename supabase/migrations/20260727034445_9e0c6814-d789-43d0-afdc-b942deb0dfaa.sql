CREATE POLICY "scan-labels owner read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'scan-labels' AND owner = auth.uid());

CREATE POLICY "scan-labels owner insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'scan-labels' AND owner = auth.uid()
    AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "scan-labels owner delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'scan-labels' AND owner = auth.uid());
