-- Harden and normalize RLS policies for multi-tenant isolation
-- Date: 2026-03-11
-- Safe to run multiple times (idempotent)

BEGIN;

-- 1) Enable RLS on known tables only if they exist
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations','profiles','students','attendances','classes',
    'belt_history','plans','payments','settings','logs_promocoes'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END
$$;

-- 2) Remove legacy/known policy names to avoid duplicates and conflicts
DO $$
BEGIN
  IF to_regclass('public.organizations') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS org_anyone_can_create ON public.organizations';
    EXECUTE 'DROP POLICY IF EXISTS org_members_can_read_own_org ON public.organizations';
    EXECUTE 'DROP POLICY IF EXISTS organizations_insert_authenticated ON public.organizations';
    EXECUTE 'DROP POLICY IF EXISTS organizations_select_member ON public.organizations';
    EXECUTE 'DROP POLICY IF EXISTS organizations_update_member ON public.organizations';
  END IF;

  IF to_regclass('public.profiles') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS profiles_anyone_can_insert ON public.profiles';
    EXECUTE 'DROP POLICY IF EXISTS org_members_manage_own_profile ON public.profiles';
    EXECUTE 'DROP POLICY IF EXISTS profiles_insert_self ON public.profiles';
    EXECUTE 'DROP POLICY IF EXISTS profiles_select_self ON public.profiles';
    EXECUTE 'DROP POLICY IF EXISTS profiles_update_self ON public.profiles';
  END IF;

  IF to_regclass('public.students') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS students_isolated_by_org ON public.students';
  END IF;

  IF to_regclass('public.attendances') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS attendances_isolated_by_org ON public.attendances';
  END IF;

  IF to_regclass('public.classes') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS classes_isolated_by_org ON public.classes';
  END IF;

  IF to_regclass('public.belt_history') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS belt_history_isolated_by_org ON public.belt_history';
  END IF;

  IF to_regclass('public.plans') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS plans_isolated_by_org ON public.plans';
  END IF;

  IF to_regclass('public.payments') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS payments_isolated_by_org ON public.payments';
  END IF;

  IF to_regclass('public.settings') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS settings_isolated_by_org ON public.settings';
  END IF;

  IF to_regclass('public.logs_promocoes') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS logs_promocoes_isolated_by_org ON public.logs_promocoes';
  END IF;
END
$$;

-- 3) Helper function used by tenant policies
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

-- 4) organizations policies (organizations uses id, not organization_id)
DO $$
BEGIN
  IF to_regclass('public.organizations') IS NOT NULL THEN
    EXECUTE $sql$
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
      )
    $sql$;

    EXECUTE $sql$
      CREATE POLICY organizations_select_member
      ON public.organizations
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.profiles p
          WHERE p.id = auth.uid()
            AND p.organization_id = organizations.id
        )
      )
    $sql$;

    EXECUTE $sql$
      CREATE POLICY organizations_update_member
      ON public.organizations
      FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.profiles p
          WHERE p.id = auth.uid()
            AND p.organization_id = organizations.id
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.profiles p
          WHERE p.id = auth.uid()
            AND p.organization_id = organizations.id
        )
      )
    $sql$;
  END IF;
END
$$;

-- 5) profiles policies (user can only manage own profile)
DO $$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    EXECUTE $sql$
      CREATE POLICY profiles_insert_self
      ON public.profiles
      FOR INSERT
      TO authenticated
      WITH CHECK (id = auth.uid())
    $sql$;

    EXECUTE $sql$
      CREATE POLICY profiles_select_self
      ON public.profiles
      FOR SELECT
      TO authenticated
      USING (id = auth.uid())
    $sql$;

    EXECUTE $sql$
      CREATE POLICY profiles_update_self
      ON public.profiles
      FOR UPDATE
      TO authenticated
      USING (id = auth.uid())
      WITH CHECK (id = auth.uid())
    $sql$;
  END IF;
END
$$;

-- 6) Tenant policies: only create where organization_id exists
DO $$
DECLARE t text;
DECLARE policy_name text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'students','attendances','classes','belt_history',
    'plans','payments','settings','logs_promocoes'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM information_schema.columns c
         WHERE c.table_schema = 'public'
           AND c.table_name = t
           AND c.column_name = 'organization_id'
       )
    THEN
      policy_name := t || '_isolated_by_org';

      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, t);

      EXECUTE format($sql$
        CREATE POLICY %I
        ON public.%I
        FOR ALL
        TO authenticated
        USING (public.is_same_org(organization_id))
        WITH CHECK (public.is_same_org(organization_id))
      $sql$, policy_name, t);
    END IF;
  END LOOP;
END
$$;

COMMIT;
