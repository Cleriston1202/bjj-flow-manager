import { describe, it, expect } from 'vitest'
import {
  evaluateBeltProgress,
  filterAttendancesSince,
  DEFAULT_CLUB_CONFIG,
  type StudentRecord,
  type AttendanceRecord,
  type ClubConfig,
} from '../beltLogic'

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Generates N attendance records starting from `baseDate` (one per day) */
function makeAttendances(count: number, baseDate = '2024-01-01'): AttendanceRecord[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(baseDate)
    d.setDate(d.getDate() + i)
    return { attended_at: d.toISOString() }
  })
}

/** Returns an ISO date string N months before today */
function monthsAgo(n: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d.toISOString()
}

function makeStudent(
  belt: StudentRecord['current_belt'],
  degree: number,
  beltSince: string = monthsAgo(1)
): StudentRecord {
  return { id: 'stu-1', current_belt: belt, current_degree: degree, belt_since: beltSince }
}

// ─── filterAttendancesSince ───────────────────────────────────────────────────

describe('filterAttendancesSince', () => {
  it('retorna apenas presenças a partir da data informada', () => {
    const attendances: AttendanceRecord[] = [
      { attended_at: '2024-01-01T00:00:00Z' },
      { attended_at: '2024-03-15T00:00:00Z' },
      { attended_at: '2024-06-20T00:00:00Z' },
    ]
    const result = filterAttendancesSince('2024-03-01T00:00:00Z', attendances)
    expect(result).toHaveLength(2)
    expect(result[0].attended_at).toBe('2024-03-15T00:00:00Z')
    expect(result[1].attended_at).toBe('2024-06-20T00:00:00Z')
  })

  it('inclui presença exatamente na data de corte', () => {
    const cutoff = '2024-05-10T00:00:00Z'
    const attendances: AttendanceRecord[] = [{ attended_at: cutoff }]
    expect(filterAttendancesSince(cutoff, attendances)).toHaveLength(1)
  })

  it('retorna array vazio quando todas as presenças são anteriores', () => {
    const attendances: AttendanceRecord[] = [{ attended_at: '2023-01-01T00:00:00Z' }]
    expect(filterAttendancesSince('2024-01-01T00:00:00Z', attendances)).toHaveLength(0)
  })

  it('retorna array vazio quando não há presenças', () => {
    expect(filterAttendancesSince('2024-01-01T00:00:00Z', [])).toHaveLength(0)
  })
})

// ─── evaluateBeltProgress ─────────────────────────────────────────────────────

describe('evaluateBeltProgress', () => {
  const config = DEFAULT_CLUB_CONFIG // classesPerDegree = 30, alertThresholdPercent = 0.9

  describe('aluno não está pronto', () => {
    it('retorna readyForDegree=false quando aulas e meses insuficientes', () => {
      const student = makeStudent('Branca', 0, monthsAgo(2))
      const attendances = makeAttendances(10)
      const result = evaluateBeltProgress(student, attendances, config)

      expect(result.readyForDegree).toBe(false)
      expect(result.readyForBeltPromotion).toBe(false)
      expect(result.alert).toBe(false)
    })
  })

  describe('pronto por número de aulas', () => {
    it('readyForDegree=true ao atingir 30 aulas', () => {
      const student = makeStudent('Branca', 0, monthsAgo(1))
      const attendances = makeAttendances(30)
      const result = evaluateBeltProgress(student, attendances, config)

      expect(result.readyForDegree).toBe(true)
      expect(result.attendedSinceBelt).toBe(30)
    })

    it('readyForDegree=true com mais de 30 aulas', () => {
      const student = makeStudent('Azul', 2, monthsAgo(1))
      const attendances = makeAttendances(45)
      const result = evaluateBeltProgress(student, attendances, config)

      expect(result.readyForDegree).toBe(true)
    })
  })

  describe('pronto por tempo mínimo na faixa', () => {
    it('readyForDegree=true ao atingir monthsPerDegree para Branca (6 meses)', () => {
      const student = makeStudent('Branca', 0, monthsAgo(7)) // 7 meses atrás
      const attendances = makeAttendances(5) // poucas aulas
      const result = evaluateBeltProgress(student, attendances, config)

      expect(result.readyForDegree).toBe(true)
      expect(result.monthsAtBelt).toBeGreaterThanOrEqual(6)
    })
  })

  describe('progressão de grau', () => {
    it('nextDegreeIfAwarded incrementa quando degree < 4', () => {
      const student = makeStudent('Branca', 0, monthsAgo(1))
      const attendances = makeAttendances(30)
      const result = evaluateBeltProgress(student, attendances, config)

      expect(result.nextDegreeIfAwarded).toBe(1)
      expect(result.readyForBeltPromotion).toBe(false)
    })

    it('grau 3 → 4 sem promoção de faixa', () => {
      const student = makeStudent('Azul', 3, monthsAgo(1))
      const attendances = makeAttendances(30)
      const result = evaluateBeltProgress(student, attendances, config)

      expect(result.nextDegreeIfAwarded).toBe(4)
      expect(result.readyForBeltPromotion).toBe(false)
    })
  })

  describe('promoção de faixa (degree === maxDegree)', () => {
    it('readyForBeltPromotion=true quando degree=4 e requisitos atingidos', () => {
      const student = makeStudent('Branca', 4, monthsAgo(1))
      const attendances = makeAttendances(30)
      const result = evaluateBeltProgress(student, attendances, config)

      expect(result.readyForDegree).toBe(true)
      expect(result.readyForBeltPromotion).toBe(true)
      expect(result.nextBeltIfPromoted).toBe('Azul')
      expect(result.nextDegreeIfAwarded).toBe(0)
    })

    it('progressão Azul → Roxa', () => {
      const student = makeStudent('Azul', 4, monthsAgo(1))
      const attendances = makeAttendances(30)
      const result = evaluateBeltProgress(student, attendances, config)

      expect(result.nextBeltIfPromoted).toBe('Roxa')
    })

    it('progressão Marrom → Preta', () => {
      const student = makeStudent('Marrom', 4, monthsAgo(1))
      const attendances = makeAttendances(30)
      const result = evaluateBeltProgress(student, attendances, config)

      expect(result.nextBeltIfPromoted).toBe('Preta')
    })
  })

  describe('faixa máxima (Preta grau 4)', () => {
    it('readyForBeltPromotion=false para aluno na Preta grau 4', () => {
      const student = makeStudent('Preta', 4, monthsAgo(1))
      const attendances = makeAttendances(30)
      const result = evaluateBeltProgress(student, attendances, config)

      expect(result.readyForBeltPromotion).toBe(false)
      expect(result.nextBeltIfPromoted).toBeNull()
    })
  })

  describe('alerta de 90%', () => {
    it('alert=false abaixo de 90% das aulas', () => {
      const student = makeStudent('Branca', 0, monthsAgo(1))
      const attendances = makeAttendances(26) // 86% de 30
      const result = evaluateBeltProgress(student, attendances, config)

      expect(result.alert).toBe(false)
    })

    it('alert=true ao atingir 90% das aulas (27 de 30)', () => {
      const student = makeStudent('Branca', 0, monthsAgo(1))
      const attendances = makeAttendances(27) // 90% de 30
      const result = evaluateBeltProgress(student, attendances, config)

      expect(result.alert).toBe(true)
    })

    it('alert=true ao superar 90% das aulas', () => {
      const student = makeStudent('Branca', 0, monthsAgo(1))
      const attendances = makeAttendances(29)
      const result = evaluateBeltProgress(student, attendances, config)

      expect(result.alert).toBe(true)
    })
  })

  describe('config personalizada', () => {
    it('respeita classesPerDegree customizado', () => {
      const customConfig: ClubConfig = {
        ...DEFAULT_CLUB_CONFIG,
        classesPerDegree: { ...DEFAULT_CLUB_CONFIG.classesPerDegree, Branca: 10 },
      }
      const student = makeStudent('Branca', 0, monthsAgo(1))
      const attendances = makeAttendances(10)
      const result = evaluateBeltProgress(student, attendances, customConfig)

      expect(result.readyForDegree).toBe(true)
      expect(result.requiredForNextDegree).toBe(10)
    })
  })

  describe('campos retornados', () => {
    it('retorna studentId, currentBelt e currentDegree corretamente', () => {
      const student = makeStudent('Roxa', 2, monthsAgo(3))
      const attendances = makeAttendances(5)
      const result = evaluateBeltProgress(student, attendances, config)

      expect(result.studentId).toBe('stu-1')
      expect(result.currentBelt).toBe('Roxa')
      expect(result.currentDegree).toBe(2)
    })
  })
})
