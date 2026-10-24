-- Columns that exist in the live TRENDZ database but were missing from the rebuilt baseline,
-- so TRENDZ (and shops like it) can later be copied into Overbooked column for column.
-- All optional: nothing in the app requires them yet, and existing rows stay valid.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS replacement_value numeric(14,2) DEFAULT 0 CHECK (replacement_value >= 0);

ALTER TABLE public.product_variations
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS size text;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text;

NOTIFY pgrst, 'reload schema';
