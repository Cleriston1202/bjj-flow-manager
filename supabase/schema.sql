-- Supabase schema for BJJ Flow Manager
-- Tables: students, attendances, belt_history, plans, payments, settings

-- Enum for payments
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
        CREATE TYPE payment_status AS ENUM ('paid','pending','late');
    END IF;
END$$;

-- Organizations (academias / tenants)
CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE,
  logo_url text,
  plan text NOT NULL DEFAULT 'free', -- free | pro
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Relationship between Supabase auth users and organizations
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  full_name text,
  role text DEFAULT 'admin', -- admin, staff, etc.
  created_at timestamptz DEFAULT now()
);

-- Students (scoped by organization)
CREATE TABLE IF NOT EXISTS students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  photo_url text,
  dob date,
  contact jsonb,
  active boolean DEFAULT true,
  current_belt text DEFAULT 'Branca',
  current_degree int DEFAULT 0,
  belt_since timestamptz DEFAULT now(),
  total_classes int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Attendances (check-ins) scoped by organization
CREATE TABLE IF NOT EXISTS attendances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id uuid REFERENCES students(id) ON DELETE CASCADE,
  session_id uuid,
  attended_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS belt_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id uuid REFERENCES students(id) ON DELETE CASCADE,
  belt text NOT NULL,
  degree int DEFAULT 0,
  awarded_at timestamptz DEFAULT now(),
  notes text
);

CREATE TABLE IF NOT EXISTS plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  duration_months int NOT NULL,
  price numeric(10,2) NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id uuid REFERENCES students(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES plans(id) ON DELETE SET NULL,
  status payment_status DEFAULT 'pending',
  amount numeric(10,2),
  start_date date,
  end_date date,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (organization_id, key)
);
-- Example default settings can be inserted per-organization after creation

CREATE INDEX IF NOT EXISTS idx_attendances_student ON attendances (organization_id, student_id, attended_at);
CREATE INDEX IF NOT EXISTS idx_payments_student ON payments (organization_id, student_id);

-- ---------------------------------------------------------------------------
-- Row Level Security (RLS) for multi-tenant isolation
-- NOTE: After applying this schema in Supabase, run the equivalent commands
-- in the SQL editor to enable RLS and policies.
-- ---------------------------------------------------------------------------

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendances ENABLE ROW LEVEL SECURITY;
ALTER TABLE belt_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Helper: profile for current user
CREATE OR REPLACE VIEW current_profile AS
  SELECT p.*
  FROM profiles p
  WHERE p.id = auth.uid();

-- Policies: each table only visible by users of same organization

-- Organizations: qualquer usuário pode criar uma organization (signup),
-- mas só membros podem lê-la depois.

CREATE POLICY "org_anyone_can_create" ON organizations
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "org_members_can_read_own_org" ON organizations
  FOR SELECT USING (
    id IN (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

-- Profiles: permitir que o sistema crie perfis no signup, e depois
-- o próprio usuário pode ler/atualizar o seu perfil.

CREATE POLICY "profiles_anyone_can_insert" ON profiles
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "org_members_manage_own_profile" ON profiles
  USING (id = auth.uid());

CREATE POLICY "students_isolated_by_org" ON students
  USING (organization_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "attendances_isolated_by_org" ON attendances
  USING (organization_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "belt_history_isolated_by_org" ON belt_history
  USING (organization_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "plans_isolated_by_org" ON plans
  USING (organization_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "payments_isolated_by_org" ON payments
  USING (organization_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "settings_isolated_by_org" ON settings
  USING (organization_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid()));
