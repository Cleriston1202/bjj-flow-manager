-- Fix RLS for public.qr_notifications
-- Date: 2026-03-11
-- Safe to run multiple times (idempotent)

BEGIN;

DO $$
DECLARE
  has_org_id boolean;
  has_student_id boolean;
  has_profile_id boolean;
  has_user_id boolean;
  expr text;
BEGIN
  -- If table does not exist in this environment, do nothing.
  IF to_regclass('public.qr_notifications') IS NULL THEN
    RETURN;
  END IF;

  -- Always enable RLS to satisfy Security Advisor.
  EXECUTE 'ALTER TABLE public.qr_notifications ENABLE ROW LEVEL SECURITY';

  -- Clean known policy names.
  EXECUTE 'DROP POLICY IF EXISTS qr_notifications_access_scoped ON public.qr_notifications';
  EXECUTE 'DROP POLICY IF EXISTS qr_notifications_isolated_by_org ON public.qr_notifications';

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'qr_notifications'
      AND column_name = 'organization_id'
  ) INTO has_org_id;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'qr_notifications'
      AND column_name = 'student_id'
  ) INTO has_student_id;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'qr_notifications'
      AND column_name = 'profile_id'
  ) INTO has_profile_id;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'qr_notifications'
      AND column_name = 'user_id'
  ) INTO has_user_id;

  -- Pick the strongest available ownership expression.
  IF has_org_id THEN
    expr := 'EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.organization_id = qr_notifications.organization_id)';
  ELSIF has_student_id THEN
    expr := 'EXISTS (
      SELECT 1
      FROM public.students s
      JOIN public.profiles p ON p.organization_id = s.organization_id
      WHERE p.id = auth.uid()
        AND s.id = qr_notifications.student_id
    )';
  ELSIF has_profile_id THEN
    expr := 'qr_notifications.profile_id = auth.uid()';
  ELSIF has_user_id THEN
    expr := 'qr_notifications.user_id = auth.uid()';
  ELSE
    -- No recognizable ownership column: authenticated users get no row access.
    expr := 'false';
  END IF;

  EXECUTE format(
    'CREATE POLICY qr_notifications_access_scoped
     ON public.qr_notifications
     FOR ALL
     TO authenticated
     USING (%s)
     WITH CHECK (%s)',
    expr,
    expr
  );
END
$$;

COMMIT;
