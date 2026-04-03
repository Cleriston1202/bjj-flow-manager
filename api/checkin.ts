import { createClient } from '@supabase/supabase-js'

const MAX_CAPACITY = parseInt(process.env.CLASS_CAPACITY || '20', 10)

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

export function computePaymentStatus(payment: any, today = new Date()) {
  if (!payment) return 'pending'
  
  const due = payment.end_date ? new Date(payment.end_date) : null
  if (!due) return payment.status === 'paid' ? 'paid' : 'pending'
  
  // Se já foi pago, mantém como pago (historético)
  if (payment.status === 'paid') return 'paid'
  
  const diffDays = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24))
  
  // Verificar vencimento para não-pagos
  if (diffDays < 0) return 'pending'  // Ainda tem tempo
  if (diffDays <= 5) return 'late'     // Venceu há até 5 dias
  return 'delinquent'                  // Venceu há mais de 5 dias
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { studentId, qrToken, sessionId } = req.body || {}
  if (!studentId && !qrToken) {
    res.status(400).json({ error: 'studentId or qrToken required' })
    return
  }

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      res.status(500).json({ error: 'Supabase keys not configured on server' })
      return
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // If qrToken flow is used, you would validate token -> studentId mapping here.
    const sid = studentId || null
    if (!sid) {
      res.status(400).json({ error: 'Unable to resolve student id from qrToken (not implemented)' })
      return
    }

    // buscar aluno
    const { data: student, error: studentError } = await supabase
      .from('students')
      .select('*')
      .eq('id', sid)
      .maybeSingle()

    if (studentError) {
      res.status(500).json({ error: studentError.message })
      return
    }
    if (!student || student.active === false) {
      res.status(400).json({ error: 'Aluno não encontrado ou inativo' })
      return
    }

    // controle de capacidade por sessão (tatame)
    if (sessionId) {
      const { count, error: capError } = await supabase
        .from('attendances')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', sessionId)

      if (!capError && typeof count === 'number' && count >= MAX_CAPACITY) {
        res.status(403).json({ error: 'Capacidade máxima do tatame atingida para este horário.', code: 'capacity_reached' })
        return
      }
    }

    // validar status financeiro com base na mensalidade do mês atual
    const { start, end } = getCurrentMonthRange()
    let { data: payments, error: payError } = await supabase
      .from('payments')
      .select('*')
      .eq('student_id', sid)
      .lte('start_date', end)    // Payment começou até o final do mês
      .gte('end_date', start)    // Payment termina a partir do início do mês
      .order('start_date', { ascending: false })  // Pagamentos mais recentes primeiro

    if (payError) {
      res.status(500).json({ error: payError.message })
      return
    }

    // Se não há pagamento para este mês, criar automaticamente
    if (!payments || payments.length === 0) {
      const monthStart = start
      const lastDay = new Date(new Date(end).getFullYear(), new Date(end).getMonth() + 1, 0).getDate()
      const monthEnd = `${start.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`
      
      const { error: createErr } = await supabase
        .from('payments')
        .insert([{
          organization_id: student.organization_id,
          student_id: sid,
          status: 'pending',
          amount: 100,
          start_date: monthStart,
          end_date: monthEnd,
        }])

      if (createErr) {
        console.error('[CHECKIN] Erro ao criar pagamento automaticamente:', createErr.message)
      } else {
        // Buscar novamente após criar
        const { data: newPayments } = await supabase
          .from('payments')
          .select('*')
          .eq('student_id', sid)
          .lte('start_date', end)
          .gte('end_date', start)
          .order('start_date', { ascending: false })  // Pagamentos mais recentes primeiro
        payments = newPayments || []
      }
    }

    // Priorizar pagamento pago do mês atual; entre múltiplos, paid > outros
    const currentMonthStr = start.slice(0, 7)
    const currentMonthPayments = (payments || []).filter((p: any) =>
      (p.start_date || '').slice(0, 7) === currentMonthStr
    )
    let payment: any = null
    if (currentMonthPayments.length > 0) {
      payment = currentMonthPayments.find((p: any) => p.status === 'paid') || currentMonthPayments[0]
    } else if (payments && payments.length > 0) {
      payment = payments[0]
    }
    const status = computePaymentStatus(payment)

    console.log(`[CHECKIN] Status computado: ${status}`)
    if (payment) {
      console.log(`[CHECKIN] Pagamento:`, {
        id: payment.id,
        status: payment.status,
        start_date: payment.start_date,
        end_date: payment.end_date,
      })
    }

    // Bloqueio APENAS se delinquent (NÃO bloqueiar por 'late' ou 'pending')
    if (status === 'delinquent') {
      console.log(`[CHECKIN] ❌ BLOQUEANDO - Status delinquent`)
      res.status(403).json({
        error: 'Acesso bloqueado. Favor passar na recepção.',
        code: 'blocked',
        status,
      })
      return
    }

    console.log(`[CHECKIN] ✅ Autorizado - Status: ${status}`)

    // registrar presença
    const row: any = { student_id: sid }
    if (sessionId) row.session_id = sessionId

    const { data: attendanceData, error: attendanceError } = await supabase
      .from('attendances')
      .insert([row])
      .select()

    if (attendanceError) {
      res.status(500).json({ error: attendanceError.message })
      return
    }

    // incrementar contador de aulas do aluno
    const currentTotal = student.total_classes ?? 0
    const { error: updateError } = await supabase
      .from('students')
      .update({ total_classes: currentTotal + 1 })
      .eq('id', sid)

    if (updateError) {
      // não bloqueia o check-in, apenas registra erro de atualização do contador
      console.error('Erro ao atualizar total_classes:', updateError.message)
    }

    res.status(200).json({
      success: true,
      attendance: attendanceData,
      status,
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
