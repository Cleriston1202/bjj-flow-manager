import { describe, it, expect } from 'vitest'
import { computePaymentStatus } from '../checkin'

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Retorna uma data deslocada N dias a partir de `base` */
function daysFrom(base: Date, days: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d
}

function makePayment(status: string, endDate: string | null = null) {
  return { status, end_date: endDate }
}

// ─── sem pagamento ────────────────────────────────────────────────────────────

describe('computePaymentStatus — sem pagamento', () => {
  it('retorna "pending" quando payment é null', () => {
    expect(computePaymentStatus(null)).toBe('pending')
  })

  it('retorna "pending" quando payment é undefined', () => {
    expect(computePaymentStatus(undefined)).toBe('pending')
  })
})

// ─── pagamento pago ───────────────────────────────────────────────────────────

describe('computePaymentStatus — status "paid"', () => {
  it('retorna "paid" quando status=paid (sem end_date)', () => {
    expect(computePaymentStatus(makePayment('paid'))).toBe('paid')
  })

  it('retorna "paid" mesmo com end_date vencida há muito tempo', () => {
    const oldDate = new Date('2020-01-01').toISOString()
    expect(computePaymentStatus(makePayment('paid', oldDate))).toBe('paid')
  })

  it('retorna "paid" com end_date no futuro', () => {
    const future = daysFrom(new Date(), 10).toISOString()
    expect(computePaymentStatus(makePayment('paid', future))).toBe('paid')
  })
})

// ─── pagamento sem end_date ───────────────────────────────────────────────────

describe('computePaymentStatus — sem end_date', () => {
  it('retorna "pending" quando status=pending e end_date é null', () => {
    expect(computePaymentStatus(makePayment('pending'))).toBe('pending')
  })

  it('retorna "pending" quando status=late e end_date é null', () => {
    expect(computePaymentStatus(makePayment('late'))).toBe('pending')
  })
})

// ─── dentro do prazo ─────────────────────────────────────────────────────────

describe('computePaymentStatus — dentro do prazo (pending)', () => {
  it('retorna "pending" quando vencimento é amanhã', () => {
    const tomorrow = daysFrom(new Date(), 1).toISOString()
    expect(computePaymentStatus(makePayment('pending', tomorrow))).toBe('pending')
  })
})

// ─── vencido dentro da janela de tolerância ───────────────────────────────────

describe('computePaymentStatus — vencido (late)', () => {
  it('retorna "late" quando vencimento é exatamente hoje (diffDays=0)', () => {
    const today = new Date().toISOString()
    expect(computePaymentStatus(makePayment('pending', today))).toBe('late')
  })

  it('retorna "late" quando venceu há exatamente 1 dia', () => {
    const yesterday = daysFrom(new Date(), -1).toISOString()
    expect(computePaymentStatus(makePayment('pending', yesterday))).toBe('late')
  })

  it('retorna "late" quando venceu há 5 dias (limite da tolerância)', () => {
    const fiveDaysAgo = daysFrom(new Date(), -5).toISOString()
    expect(computePaymentStatus(makePayment('pending', fiveDaysAgo))).toBe('late')
  })

  it('retorna "late" com today explícito — vencimento 3 dias antes', () => {
    const base = new Date('2024-06-10T12:00:00Z')
    const due = new Date('2024-06-07T12:00:00Z').toISOString()
    expect(computePaymentStatus(makePayment('pending', due), base)).toBe('late')
  })
})

// ─── inadimplente ─────────────────────────────────────────────────────────────

describe('computePaymentStatus — inadimplente (delinquent)', () => {
  it('retorna "delinquent" quando venceu há 6 dias', () => {
    const sixDaysAgo = daysFrom(new Date(), -6).toISOString()
    expect(computePaymentStatus(makePayment('pending', sixDaysAgo))).toBe('delinquent')
  })

  it('retorna "delinquent" quando venceu há 30 dias', () => {
    const thirtyDaysAgo = daysFrom(new Date(), -30).toISOString()
    expect(computePaymentStatus(makePayment('pending', thirtyDaysAgo))).toBe('delinquent')
  })

  it('retorna "delinquent" com today explícito — vencimento 10 dias antes', () => {
    const base = new Date('2024-06-20T00:00:00Z')
    const due = new Date('2024-06-10T00:00:00Z').toISOString()
    expect(computePaymentStatus(makePayment('pending', due), base)).toBe('delinquent')
  })
})

// ─── fronteiras exatas (boundary) ────────────────────────────────────────────

describe('computePaymentStatus — fronteiras', () => {
  it('exatamente no vencimento (diffDays=0) → late', () => {
    const now = new Date('2024-08-01T12:00:00Z')
    const due = new Date('2024-08-01T12:00:00Z').toISOString()
    expect(computePaymentStatus(makePayment('pending', due), now)).toBe('late')
  })

  it('diffDays=5 → late (último dia da tolerância)', () => {
    const today = new Date('2024-08-06T12:00:00Z')
    const due = new Date('2024-08-01T12:00:00Z').toISOString()
    expect(computePaymentStatus(makePayment('pending', due), today)).toBe('late')
  })

  it('diffDays=6 → delinquent (primeiro dia sem tolerância)', () => {
    const today = new Date('2024-08-07T12:00:00Z')
    const due = new Date('2024-08-01T12:00:00Z').toISOString()
    expect(computePaymentStatus(makePayment('pending', due), today)).toBe('delinquent')
  })
})
