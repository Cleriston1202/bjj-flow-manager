-- Incremental migration for new product features
-- Date: 2026-02-28
-- Safe to run multiple times (idempotent)

BEGIN;

-- 1) Attendances: link to class/session metadata
ALTER TABLE IF EXISTS attendances
  ADD COLUMN IF NOT EXISTS class_id uuid;

-- 2) Finance: manual settlement metadata
ALTER TABLE IF EXISTS payments
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS paid_at date;

-- 3) Class management table
CREATE TABLE IF NOT EXISTS classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  modality text NOT NULL,
  professor_name text NOT NULL,
  weekday text NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_classes_org_weekday
  ON classes (organization_id, weekday, start_time);

-- 4) RLS for classes (multi-tenant isolation)
ALTER TABLE IF EXISTS classes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'classes'
      AND policyname = 'classes_isolated_by_org'
  ) THEN
    CREATE POLICY classes_isolated_by_org
      ON classes
      USING (
        organization_id IN (
          SELECT organization_id
          FROM profiles
          WHERE id = auth.uid()
        )
      )
      WITH CHECK (
        organization_id IN (
          SELECT organization_id
          FROM profiles
          WHERE id = auth.uid()
        )
      );
  END IF;
END
$$;

COMMIT;
