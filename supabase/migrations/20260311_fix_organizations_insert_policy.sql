-- Fix permissive INSERT policy on public.organizations
-- Date: 2026-03-11
-- Safe to run multiple times (idempotent)

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

  -- Remove permissive variants
  DROP POLICY IF EXISTS organizations_insert_authenticated ON public.organizations;
  DROP POLICY IF EXISTS org_anyone_can_create ON public.organizations;

  -- Require authenticated user with an existing profile not linked to an organization yet
  CREATE POLICY organizations_insert_authenticated
  ON public.organizations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.organization_id IS NULL
    )
  );
END
$$;

COMMIT;
