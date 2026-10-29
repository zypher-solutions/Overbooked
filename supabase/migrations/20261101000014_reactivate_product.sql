-- Reactivate a product that was switched off (by Delete on a product with rental history, or by hand):
-- the product and its variations can be booked again. Owners and managers, same as editing a product.
CREATE OR REPLACE FUNCTION public.reactivate_product(p_product_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  PERFORM public._require_role(ARRAY['super_admin', 'owner', 'manager']);
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN
    RAISE EXCEPTION 'Product not found';
  END IF;
  UPDATE public.products SET is_active = true WHERE id = p_product_id;
  UPDATE public.product_variations SET is_enabled = true WHERE product_id = p_product_id;
END $$;

ALTER FUNCTION public.reactivate_product(uuid) OWNER TO app_rpc;
REVOKE ALL ON FUNCTION public.reactivate_product(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reactivate_product(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
