-- Table rights for the attribute tables of 030. The hosted project no longer hands new tables to `authenticated` and
-- `service_role` by default (local Docker still does), so 030's tables could not be read by the app. Row rules (RLS) still
-- decide which rows; an attribute's key stays unchangeable and attributes are archived, not deleted (030).
GRANT SELECT, INSERT ON public.shop_attributes TO authenticated;
GRANT UPDATE (label, sort, sku_position, is_archived) ON public.shop_attributes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shop_attribute_values TO authenticated;
GRANT ALL ON public.shop_attributes, public.shop_attribute_values TO service_role;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.shop_attributes, public.shop_attribute_values FROM authenticated;
