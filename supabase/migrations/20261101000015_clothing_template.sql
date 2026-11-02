-- One "Clothing rental" business type instead of two identical ones (bridal and groom differed only in name and
-- the measurement list). Shops keep their categories (Bridal wear, Groom wear...); the categories now point at the new type.
-- Colour and size suggestions live in the type's attribute list, so they can change without code.
INSERT INTO public.business_templates
  (key, name, kind, labels, variation_fields, unit_fields, checks, rate_types, turnaround, features, default_add_ons, sort, measurement_fields)
SELECT 'clothing', 'Clothing rental', kind, labels,
  '[{"key": "color", "label": "Colour", "type": "text",
     "suggestions": ["Black", "White", "Royal Blue", "Maroon", "Wine", "Off White", "Beige", "Navy Blue", "Gold", "Silver"]},
    {"key": "size", "label": "Size", "type": "text",
     "suggestions": ["XS", "S", "M", "L", "XL", "XXL", "3XL", "28", "30", "32", "34", "36", "38", "40", "42"]}]'::jsonb,
  unit_fields, checks, rate_types, turnaround, features, default_add_ons, 1,
  '["Bust", "Waist", "Hip", "Shoulder", "Sleeve length", "Arm hole", "Blouse length", "Full length", "Neck (front)", "Neck (back)",
    "Chest", "Neck", "Top length", "Inseam", "Trouser length", "Shoe size"]'::jsonb
FROM public.business_templates WHERE key = 'bridal'
ON CONFLICT (key) DO NOTHING;

UPDATE public.categories SET template_key = 'clothing' WHERE template_key IN ('bridal', 'groom');

UPDATE public.shops SET business_types = ARRAY(
  SELECT DISTINCT CASE WHEN t IN ('bridal', 'groom') THEN 'clothing' ELSE t END FROM unnest(business_types) t)
WHERE business_types && ARRAY['bridal', 'groom'];

UPDATE public.add_ons SET template_keys = ARRAY(
  SELECT DISTINCT CASE WHEN t IN ('bridal', 'groom') THEN 'clothing' ELSE t END FROM unnest(template_keys) t)
WHERE template_keys && ARRAY['bridal', 'groom'];

DELETE FROM public.business_templates WHERE key IN ('bridal', 'groom');
UPDATE public.business_templates SET sort = sort + 1 WHERE key <> 'clothing';
