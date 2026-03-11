-- Fix function search_path for public.is_same_org
-- Date: 2026-03-11
-- Safe to run multiple times (idempotent)

BEGIN;

CREATE OR REPLACE FUNCTION public.is_same_org(row_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.organization_id = row_org_id
  );
$fn$;

COMMIT;
