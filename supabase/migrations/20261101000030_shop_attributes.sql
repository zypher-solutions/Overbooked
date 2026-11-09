-- Each shop's own attributes (Colour, Size, Length, Material ...) and their preferred values (Admin pages).
-- Before, the attributes and their suggestions were fixed per business type (business_templates.variation_fields) and no shop
-- could change them. Now the business type only gives a new shop its starting list; the shop adds, renames, reorders and
-- archives its own.
--
--   shop_attributes         one row per attribute; key is what product_variations.attributes uses ("color", "length")
--                           and never changes, label is the shown name and can be renamed.
--                           sku_position: where the value goes in a system-made variation SKU (1 = first after BR-001);
--                           NULL = left out of the SKU. Category + number always come first and the piece number last.
--   shop_attribute_values   the preferred values, offered as suggestions on the product form and in bulk add.
--                           A value typed on a product that is not in the list is added to it when the product is saved.
-- An attribute is archived, never deleted: products that use it keep their values.

CREATE TABLE public.shop_attributes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       uuid NOT NULL REFERENCES public.shops(id),
  key           text NOT NULL CHECK (key ~ '^[a-z0-9_]{1,40}$'),
  label         text NOT NULL CHECK (btrim(label) <> '' AND length(label) <= 40),
  sort          integer NOT NULL DEFAULT 0,
  sku_position  integer CHECK (sku_position > 0),
  is_archived   boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_attributes_shop_id_id_key UNIQUE (shop_id, id)
);
CREATE UNIQUE INDEX shop_attributes_shop_key ON public.shop_attributes (shop_id, key);
CREATE UNIQUE INDEX shop_attributes_shop_label ON public.shop_attributes (shop_id, lower(label));

CREATE TABLE public.shop_attribute_values (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       uuid NOT NULL REFERENCES public.shops(id),
  attribute_id  uuid NOT NULL,
  value         text NOT NULL CHECK (btrim(value) <> '' AND length(value) <= 40),
  sort          integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_attribute_values_attribute_fkey FOREIGN KEY (shop_id, attribute_id)
    REFERENCES public.shop_attributes (shop_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX shop_attribute_values_unique ON public.shop_attribute_values (attribute_id, lower(value));

-- the same rules as the catalog: everyone in the shop reads, owners and managers write
ALTER TABLE public.shop_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_attribute_values ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['shop_attributes', 'shop_attribute_values'] LOOP
    EXECUTE format('CREATE POLICY shop_isolation ON public.%I AS RESTRICTIVE FOR ALL
                    USING (shop_id = (SELECT public.current_shop_id())) WITH CHECK (shop_id = (SELECT public.current_shop_id()))', t);
    EXECUTE format('CREATE POLICY rpc_all ON public.%I FOR ALL TO app_rpc USING (true) WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY catalog_read ON public.%I FOR SELECT USING ((SELECT public.get_my_role()) IS NOT NULL)', t);
    EXECUTE format('CREATE POLICY catalog_write ON public.%I FOR ALL
                    USING ((SELECT public.get_my_role()) IN (''super_admin'', ''owner'', ''manager''))
                    WITH CHECK ((SELECT public.get_my_role()) IN (''super_admin'', ''owner'', ''manager''))', t);
  END LOOP;
END $$;

-- an attribute's key is what products store, so the app may change everything but the key, and archives instead of deleting
REVOKE ALL ON public.shop_attributes, public.shop_attribute_values FROM anon;
REVOKE UPDATE, DELETE ON public.shop_attributes FROM authenticated;
GRANT UPDATE (label, sort, sku_position, is_archived) ON public.shop_attributes TO authenticated;

-- ------------------------------------------------------------------------------
-- a shop's starting attributes and values, from its business types; an attribute the shop already has is left as it is
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._seed_shop_attributes(p_shop uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_start integer;
BEGIN
  SELECT COALESCE(max(sort), 0) INTO v_start FROM public.shop_attributes WHERE shop_id = p_shop;
  WITH f AS (
    SELECT DISTINCT ON (x.f ->> 'key') x.f ->> 'key' AS key, x.f ->> 'label' AS label, x.f -> 'suggestions' AS suggestions,
           t.sort AS tsort, x.ord
    FROM public.shops s
    JOIN public.business_templates t ON t.key = ANY (s.business_types)
    CROSS JOIN LATERAL jsonb_array_elements(t.variation_fields) WITH ORDINALITY x(f, ord)
    WHERE s.id = p_shop AND x.f ->> 'key' ~ '^[a-z0-9_]{1,40}$'
    ORDER BY x.f ->> 'key', t.sort, x.ord
  ), added AS (
    INSERT INTO public.shop_attributes (shop_id, key, label, sort, sku_position)
    SELECT p_shop, key, label, v_start + n, v_start + n
    FROM (SELECT *, row_number() OVER (ORDER BY tsort, ord)::integer AS n FROM f) numbered
    ON CONFLICT DO NOTHING
    RETURNING id, key
  )
  -- only the attributes made just now get the suggestions, so values a shop removed do not come back
  INSERT INTO public.shop_attribute_values (shop_id, attribute_id, value, sort)
  SELECT p_shop, a.id, btrim(v.value), v.ord
  FROM added a JOIN f ON f.key = a.key
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(f.suggestions, '[]')) WITH ORDINALITY v(value, ord)
  WHERE btrim(v.value) <> ''
  ON CONFLICT DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public._seed_shop_attributes_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  PERFORM public._seed_shop_attributes(NEW.id);
  RETURN NEW;
END $$;

CREATE TRIGGER trg_seed_shop_attributes AFTER INSERT OR UPDATE OF business_types ON public.shops
  FOR EACH ROW EXECUTE FUNCTION public._seed_shop_attributes_trigger();

-- ------------------------------------------------------------------------------
-- a value typed on a product joins its attribute's list (product form, bulk add & edit, Excel import all save variations)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._remember_attribute_values()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF jsonb_typeof(NEW.attributes) IS DISTINCT FROM 'object' THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.shop_attribute_values (shop_id, attribute_id, value, sort)
  SELECT a.shop_id, a.id, btrim(e.value),
         COALESCE((SELECT max(sort) FROM public.shop_attribute_values x WHERE x.attribute_id = a.id), 0) + 1
  FROM jsonb_each_text(NEW.attributes) e
  JOIN public.shop_attributes a ON a.shop_id = NEW.shop_id AND a.key = e.key
  WHERE btrim(e.value) <> '' AND length(btrim(e.value)) <= 40
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_remember_attribute_values AFTER INSERT OR UPDATE OF attributes ON public.product_variations
  FOR EACH ROW EXECUTE FUNCTION public._remember_attribute_values();

REVOKE EXECUTE ON FUNCTION public._seed_shop_attributes(uuid), public._seed_shop_attributes_trigger(),
  public._remember_attribute_values() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- shops that exist now: their business types' attributes, plus every value their products already use
-- ------------------------------------------------------------------------------
SELECT public._seed_shop_attributes(id) FROM public.shops;

INSERT INTO public.shop_attribute_values (shop_id, attribute_id, value, sort)
SELECT a.shop_id, a.id, min(btrim(e.value)), 1000
FROM public.product_variations v
CROSS JOIN LATERAL jsonb_each_text(CASE WHEN jsonb_typeof(v.attributes) = 'object' THEN v.attributes ELSE '{}' END) e
JOIN public.shop_attributes a ON a.shop_id = v.shop_id AND a.key = e.key
WHERE btrim(e.value) <> '' AND length(btrim(e.value)) <= 40
GROUP BY a.shop_id, a.id, lower(btrim(e.value))
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
