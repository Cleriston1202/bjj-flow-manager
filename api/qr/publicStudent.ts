import { createClient } from '@supabase/supabase-js'
import { createHmac } from 'crypto'
import { DEFAULT_CLUB_CONFIG, evaluateBeltProgress, type AttendanceRecord, type StudentRecord } from '../../src/lib/beltLogic'

function getCurrentMonthRange() {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const pad = (n: number) => String(n).padStart(2, '0')
  const lastDay = new Date(year, month, 0).getDate()
  const start = `${year}-${pad(month)}-01`
  const end = `${year}-${pad(month)}-${pad(lastDay)}`
  return { start, end }
}

function computePaymentStatus(payment: any, today = new Date()) {
  if (!payment) return 'pending'
  if (payment.status === 'paid') return 'paid'
  const due = payment.end_date ? new Date(payment.end_date) : null
  if (!due) return 'pending'
  const diffDays = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays < 0) return 'pending'
  if (diffDays <= 5) return 'late'
  return 'delinquent'
}

function getMonthPayment(payments: any[], month: string) {
  const sameMonth = (payments || []).filter((p: any) => (p.start_date || '').slice(0, 7) === month)
  if (sameMonth.length === 0) return null
  const ordered = [...sameMonth].sort((a: any, b: any) => {
    const paidA = a?.status === 'paid' ? 1 : 0
    const paidB = b?.status === 'paid' ? 1 : 0
    if (paidA !== paidB) return paidB - paidA
    const ta = new Date(a.paid_at || a.created_at || 0).getTime()
    const tb = new Date(b.paid_at || b.created_at || 0).getTime()
    return tb - ta
  })
  return ordered[0]
}

function getConfig() {
  const SUPABASE_URL =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL
  const SUPABASE_SERVER_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY
  const QR_PUBLIC_TOKEN_SECRET = process.env.QR_PUBLIC_TOKEN_SECRET || SUPABASE_SERVER_KEY

  if (!SUPABASE_URL || !SUPABASE_SERVER_KEY || !QR_PUBLIC_TOKEN_SECRET) {
    throw new Error('Configuração ausente para consulta pública de QR')
  }

  return { SUPABASE_URL, SUPABASE_SERVER_KEY, QR_PUBLIC_TOKEN_SECRET }
}

function verifyPayload(token: string, secret: string): any | null {
  const [body, signature] = String(token || '').split('.')
  if (!body || !signature) return null
  const expected = createHmac('sha256', secret).update(body).digest('base64url')
  if (expected !== signature) return null
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const token = String(req.query?.t || '')
    const legacyStudentId = String(req.query?.legacyStudentId || '')

    const { SUPABASE_URL, SUPABASE_SERVER_KEY, QR_PUBLIC_TOKEN_SECRET } = getConfig()
    let studentId = ''

    if (token) {
      const payload = verifyPayload(token, QR_PUBLIC_TOKEN_SECRET)

      if (!payload?.sid || !payload?.exp || Date.now() > Number(payload.exp)) {
        res.status(401).json({ error: 'Link inválido ou expirado.' })
        return
      }

      studentId = String(payload.sid)
    } else if (legacyStudentId) {
      studentId = legacyStudentId
    } else {
      res.status(400).json({ error: 'Token do QR é obrigatório.' })
      return
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVER_KEY)

    const { data: student, error: sErr } = await supabase
      .from('students')
      .select('id, full_name, current_belt, current_degree, belt_since, created_at, photo_url, active')
      .eq('id', studentId)
      .maybeSingle()

    if (sErr || !student || student.active === false) {
      res.status(404).json({ error: 'Aluno não encontrado.' })
      return
    }

    const { start, end } = getCurrentMonthRange()

    const { data: monthAtt, error: attErr } = await supabase
      .from('attendances')
      .select('attended_at')
      .eq('student_id', studentId)
      .gte('attended_at', `${start}T00:00:00`)
      .lte('attended_at', `${end}T23:59:59`)

    if (attErr) {
      res.status(500).json({ error: 'Erro ao carregar frequência.' })
      return
    }

    const { data: pays, error: payErr } = await supabase
      .from('payments')
      .select('*')
      .eq('student_id', studentId)
      .gte('start_date', start)
      .lte('end_date', end)

    if (payErr) {
      res.status(500).json({ error: 'Erro ao carregar status financeiro.' })
      return
    }

    const monthPayment = getMonthPayment(pays || [], start.slice(0, 7))
    const paymentStatus = computePaymentStatus(monthPayment)
    const nextDueDate = monthPayment?.end_date || null

    const { data: attAll, error: attAllErr } = await supabase
      .from('attendances')
      .select('attended_at')
      .eq('student_id', studentId)

    if (attAllErr) {
      res.status(500).json({ error: 'Erro ao calcular progresso.' })
      return
    }

    const attendancesSinceBelt: AttendanceRecord[] = (attAll || []).map((a: any) => ({ attended_at: a.attended_at }))
    const studentRecord: StudentRecord = {
      id: student.id,
      current_belt: (student.current_belt || 'Branca') as any,
      current_degree: student.current_degree || 0,
      belt_since: student.belt_since || student.created_at || new Date().toISOString(),
    }
    const progress = evaluateBeltProgress(studentRecord, attendancesSinceBelt, DEFAULT_CLUB_CONFIG)
    const progressPercent = Math.min(100, Math.round((progress.attendedSinceBelt / Math.max(1, progress.requiredForNextDegree)) * 100))

    res.status(200).json({
      success: true,
      student: {
        id: student.id,
        full_name: student.full_name,
        current_belt: student.current_belt || 'Branca',
        current_degree: student.current_degree || 0,
        photo_url: student.photo_url || null,
      },
      classesThisMonth: (monthAtt || []).length,
      paymentStatus,
      nextDueDate,
      progressPercent,
      monthStart: start,
    })
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Erro ao carregar dados do QR público.' })
  }
}
