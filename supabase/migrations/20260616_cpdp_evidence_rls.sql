ALTER TABLE public.cpdp_evidence ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cpdp_evidence'
      AND policyname = 'cpdpev_staff'
  ) THEN
    CREATE POLICY cpdpev_staff ON public.cpdp_evidence
      FOR ALL TO public
      USING (is_geia_staff());
  END IF;
END$$;
