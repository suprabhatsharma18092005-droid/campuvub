CREATE POLICY "Anyone can view catalog media" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'catalog-media');