-- inspections: detail columns
ALTER TABLE public.inspections ADD COLUMN IF NOT EXISTS mcmis_inspection_id text;
ALTER TABLE public.inspections ADD COLUMN IF NOT EXISTS start_time text;
ALTER TABLE public.inspections ADD COLUMN IF NOT EXISTS end_time text;
ALTER TABLE public.inspections ADD COLUMN IF NOT EXISTS location_text text;
ALTER TABLE public.inspections ADD COLUMN IF NOT EXISTS post_accident_indicator text;
CREATE UNIQUE INDEX IF NOT EXISTS inspections_mcmis_uidx
  ON public.inspections (mcmis_inspection_id) WHERE mcmis_inspection_id IS NOT NULL;

-- violations: citation result + stop forcing convicted
ALTER TABLE public.violations ADD COLUMN IF NOT EXISTS citation_result text;
ALTER TABLE public.violations ALTER COLUMN convicted DROP NOT NULL;

-- new child table for per-unit vehicles (incl. VIN)
CREATE TABLE IF NOT EXISTS public.inspection_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES public.inspections(id) ON DELETE CASCADE,
  client_id uuid,
  unit_number int,
  unit_type text,
  make text,
  vin text,
  license_plate text,
  license_state text,
  iep_dot text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inspection_vehicles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'inspection_vehicles'
      AND policyname = 'iv_staff'
  ) THEN
    CREATE POLICY iv_staff ON public.inspection_vehicles
      FOR ALL TO public
      USING (is_geia_staff());
  END IF;
END $$;
