-- Photo buckets accept only pictures up to a size limit, so a bucket cannot be used to store arbitrary files.
-- The app already shrinks photos in the browser (browser-image-compression); these are the server-side limits.
UPDATE storage.buckets SET file_size_limit = 5 * 1024 * 1024, allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'product_images';
UPDATE storage.buckets SET file_size_limit = 10 * 1024 * 1024, allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'rental_photos';
