-- APPLIED to test project gztmmlhuuqbnsnjjcohq on 2026-10-22. Deleting a category that still has products must fail instead of nulling products.category_id.
ALTER TABLE public.products DROP CONSTRAINT products_category_id_fkey;
ALTER TABLE public.products
  ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE RESTRICT;

NOTIFY pgrst, 'reload schema';
