-- Fix missing optional columns in attendances (idempotent)
-- Date: 2026-03-01

BEGIN;

ALTER TABLE IF EXISTS attendances
  ADD COLUMN IF NOT EXISTS technical_note int,
  ADD COLUMN IF NOT EXISTS technical_observation text,
  ADD COLUMN IF NOT EXISTS belt_at_time text,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS valid boolean DEFAULT true;

COMMIT;
