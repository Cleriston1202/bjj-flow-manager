-- Fix RLS for public.payment_receipts
-- Date: 2026-03-11
-- Safe to run multiple times (idempotent)

BEGIN;

-- Ensure table exists (it may be created by the server bootstrap route)
CREATE TABLE IF NOT EXISTS public.payment_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid REFERENCES public.payments(id) ON DELETE CASCADE,
  amount numeric(10,2),
  method text,
  received_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.payment_receipts ENABLE ROW LEVEL SECURITY;

-- Drop previous variants if any
DROP POLICY IF EXISTS payment_receipts_isolated_by_org ON public.payment_receipts;
DROP POLICY IF EXISTS payment_receipts_select_by_org ON public.payment_receipts;
DROP POLICY IF EXISTS payment_receipts_insert_by_org ON public.payment_receipts;
DROP POLICY IF EXISTS payment_receipts_update_by_org ON public.payment_receipts;
DROP POLICY IF EXISTS payment_receipts_delete_by_org ON public.payment_receipts;

-- SELECT: only receipts whose payment belongs to current user's organization
CREATE POLICY payment_receipts_select_by_org
ON public.payment_receipts
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.payments p
    WHERE p.id = payment_receipts.payment_id
      AND public.is_same_org(p.organization_id)
  )
);

-- INSERT: only allow inserting receipt for payment in current user's organization
CREATE POLICY payment_receipts_insert_by_org
ON public.payment_receipts
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.payments p
    WHERE p.id = payment_receipts.payment_id
      AND public.is_same_org(p.organization_id)
  )
);

-- UPDATE: only rows in org and keep updates inside org scope
CREATE POLICY payment_receipts_update_by_org
ON public.payment_receipts
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.payments p
    WHERE p.id = payment_receipts.payment_id
      AND public.is_same_org(p.organization_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.payments p
    WHERE p.id = payment_receipts.payment_id
      AND public.is_same_org(p.organization_id)
  )
);

-- DELETE: only receipts from current org
CREATE POLICY payment_receipts_delete_by_org
ON public.payment_receipts
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.payments p
    WHERE p.id = payment_receipts.payment_id
      AND public.is_same_org(p.organization_id)
  )
);

COMMIT;
