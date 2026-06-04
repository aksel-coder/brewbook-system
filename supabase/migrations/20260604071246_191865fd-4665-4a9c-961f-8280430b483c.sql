
CREATE POLICY "Authenticated can view product images" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'product-images');
CREATE POLICY "Authenticated can upload product images" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'product-images');
CREATE POLICY "Authenticated can update product images" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'product-images');
CREATE POLICY "Authenticated can delete product images" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'product-images');
