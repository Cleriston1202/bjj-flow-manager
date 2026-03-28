import React, { useCallback, useEffect, useState, useRef } from 'react'
import { supabase, handleSupabaseAuthError } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from '@radix-ui/react-dialog'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@radix-ui/react-dropdown-menu'
import { BadgeDollarSign, Loader2, User, CreditCard, Banknote, AlertCircle, FileText, FileSpreadsheet, Bell, ChevronDown, ChevronUp, Clock, Send, RefreshCw } from 'lucide-react'

// Utilitário para obter o mês atual em yyyy-mm
function getCurrentMonth() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

// Status helpers
function getPaymentStatus(payment: any, today = new Date()) {
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

function getStatusLabel(status: string) {
  switch (status) {
    case 'paid': return 'Pago'
    case 'late': return 'Em Atraso'
    case 'delinquent': return 'Inadimplente'
    default: return 'Pendente'
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case 'paid': return 'bg-green-100 text-green-700'
    case 'late': return 'bg-orange-100 text-orange-700'
    case 'delinquent': return 'bg-red-100 text-red-700'
    default: return 'bg-gray-100 text-gray-700'
  }
}

function isStudentActive(student: any) {
  const status = String(student?.contact?.status || '')
  return student?.active !== false && status !== 'Cancelado'
}

function getEnrollmentDueDay(student: any) {
  // 1. Dia configurado manualmente tem prioridade
  const configuredDueDay = Number(student?.contact?.due_day)
  if (configuredDueDay >= 1 && configuredDueDay <= 31) return configuredDueDay

  // 2. Dia do cadastro
  const createdAt = student?.created_at
  console.log('[dueDay]', student?.full_name, '| created_at:', createdAt)
  if (createdAt) {
    const d = new Date(createdAt)
    if (!Number.isNaN(d.getTime())) {
      const day = d.getDate()
      console.log('[dueDay] → dia calculado:', day)
      if (day >= 1 && day <= 31) return day
    }
  }

  console.warn('[dueDay] created_at ausente ou inválido para:', student?.full_name, '— usando fallback 10')
  return 10
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

// ── Automação de Cobrança ──────────────────────────────────────────────────

function daysUntilDue(payment: any): number | null {
  if (!payment?.end_date) return null
  const due = new Date(payment.end_date + 'T00:00:00')
  return Math.floor((due.getTime() - new Date().setHours(0,0,0,0)) / (1000 * 60 * 60 * 24))
}

function daysSinceLastReminder(studentId: string, month: string): number {
  const key = `reminder_${studentId}_${month}`
  const last = localStorage.getItem(key)
  if (!last) return Infinity
  return Math.floor((Date.now() - new Date(last).getTime()) / (1000 * 60 * 60 * 24))
}

function markReminderSent(studentId: string, month: string) {
  localStorage.setItem(`reminder_${studentId}_${month}`, new Date().toISOString())
}

function buildWhatsAppUrl(phone: string, text: string) {
  const digits = phone.replace(/\D+/g, '')
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
}

const paymentMethods = [
  { label: 'Pix', icon: <CreditCard size={16} className="inline mr-1" /> },
  { label: 'Dinheiro', icon: <Banknote size={16} className="inline mr-1" /> },
  { label: 'Cartão', icon: <CreditCard size={16} className="inline mr-1" /> },
]

export default function Finance() {
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth())
  const [students, setStudents] = useState<Record<string, any>>({})
  const [payments, setPayments] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [onlyActive, setOnlyActive] = useState(true)
  const [onlyDelinquent, setOnlyDelinquent] = useState(false)
  const [modal, setModal] = useState<{ open: boolean, payment?: any, student?: any }>({ open: false })
  const [settleMethod, setSettleMethod] = useState('Pix')
  const [settleDate, setSettleDate] = useState('')
  const [settleAmount, setSettleAmount] = useState('')
  const [settleLoading, setSettleLoading] = useState(false)
  const [historyOpenFor, setHistoryOpenFor] = useState<string | null>(null)
  const [historyData, setHistoryData] = useState<Record<string, any[]>>({})
  const [historyLoading, setHistoryLoading] = useState<string | null>(null)
  const [sendingReminder, setSendingReminder] = useState(false)
  const [automationOpen, setAutomationOpen] = useState(false)
  const [daysBefore, setDaysBefore] = useState(3)
  const [recurringDays, setRecurringDays] = useState(7)
  const [reminderSending, setReminderSending] = useState<string | null>(null)
  const { tenant, role } = useAuth()

  if (role !== 'admin') {
    return (
      <div className="max-w-3xl mx-auto text-slate-50">
        <h2 className="text-2xl font-bold mb-2">Financeiro</h2>
        <div className="border border-slate-800 rounded p-4 bg-slate-900/70 text-sm text-slate-300">
          Acesso restrito ao perfil Administrador.
        </div>
      </div>
    )
  }

  // Carregar alunos e pagamentos
  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (!tenant) return
      const { data: sdata, error: sErr } = await supabase
        .from('students')
        .select('*')
        .eq('organization_id', tenant.organizationId)
      if (sErr) {
        if (!handleSupabaseAuthError(sErr)) {
          console.error('Erro ao carregar alunos para financeiro', sErr)
        }
        return
      }
      const sArr = Array.isArray(sdata) ? sdata : []
      const studentsMap: Record<string, any> = {}
      sArr.forEach((s: any) => { studentsMap[s.id] = s })
      setStudents(studentsMap)

      const [y, m] = selectedMonth.split('-').map((v) => Number(v))
      const lastDay = new Date(y, m, 0).getDate()
      const monthStart = `${selectedMonth}-01`
      const monthEnd = `${selectedMonth}-${String(lastDay).padStart(2, '0')}`

      const { data: pdata, error: pErr } = await supabase
        .from('payments')
        .select('*')
        .eq('organization_id', tenant.organizationId)
        .lte('start_date', monthEnd)    // Payment começou até o final do mês
        .gte('end_date', monthStart)    // Payment termina a partir do início do mês
      if (pErr) {
        if (!handleSupabaseAuthError(pErr)) {
          console.error('Erro ao carregar pagamentos', pErr)
        }
        return
      }
      setPayments(Array.isArray(pdata) ? pdata : [])
    } catch (e) {
      console.error('Erro ao carregar dados financeiros', e)
    } finally {
      setLoading(false)
    }
  }, [selectedMonth, tenant])

  useEffect(() => { if (tenant) load() }, [load, tenant])

  async function loadHistory(studentId: string) {
    if (historyData[studentId]) return
    setHistoryLoading(studentId)
    try {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('student_id', studentId)
        .order('start_date', { ascending: false })
      if (!error && data) {
        setHistoryData(prev => ({ ...prev, [studentId]: data }))
      }
    } finally {
      setHistoryLoading(null)
    }
  }

  // Efeito 1: cria mensalidades ausentes (protegido por ref para não duplicar)
  const ensuredMonthsRef = useRef<Record<string, boolean>>({})
  useEffect(() => {
    async function ensureMonthlyPayments() {
      if (!tenant) return
      if (loading) return
      if (!Object.keys(students).length) return
      if (ensuredMonthsRef.current[selectedMonth]) return
      const [yy, mm] = selectedMonth.split('-').map((v) => Number(v))
      const last = new Date(yy, mm, 0).getDate()
      const monthStart = `${selectedMonth}-01`
      const toInsert: any[] = []
      for (const s of Object.values(students)) {
        if (!isStudentActive(s)) continue
        const hasPayment = payments.some((p: any) => p.student_id === s.id)
        if (!hasPayment) {
          const dueDay = Math.max(1, Math.min(31, getEnrollmentDueDay(s)))
          const safeDue = Math.min(dueDay, last)
          toInsert.push({
            organization_id: tenant?.organizationId,
            student_id: s.id,
            status: 'pending',
            amount: s.contact?.monthly_fee ?? s.monthly_fee ?? 100,
            start_date: monthStart,
            end_date: `${selectedMonth}-${String(safeDue).padStart(2, '0')}`,
          })
        }
      }
      if (toInsert.length) {
        const { error: insertErr } = await supabase.from('payments').insert(toInsert)
        if (insertErr) {
          if (!handleSupabaseAuthError(insertErr)) console.error('Erro ao criar mensalidades', insertErr)
        } else {
          await load()
        }
      }
      ensuredMonthsRef.current[selectedMonth] = true
    }
    ensureMonthlyPayments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth, students, payments, loading, tenant])

  // Efeito 2: corrige end_date de pagamentos pending com vencimento errado
  // Roda toda vez que payments ou students mudam — sem ref, sem cache
  const fixingRef = useRef(false)
  useEffect(() => {
    async function fixDueDates() {
      if (!tenant || loading || fixingRef.current) return
      if (!payments.length || !Object.keys(students).length) return
      const [yy, mm] = selectedMonth.split('-').map((v) => Number(v))
      const last = new Date(yy, mm, 0).getDate()
      const toUpdate: { id: string; end_date: string }[] = []

      for (const p of payments) {
        if (p.status !== 'pending') continue
        const s = students[p.student_id]
        if (!s || !isStudentActive(s)) continue
        const dueDay = Math.max(1, Math.min(31, getEnrollmentDueDay(s)))
        const safeDue = Math.min(dueDay, last)
        const expected = `${selectedMonth}-${String(safeDue).padStart(2, '0')}`
        if (p.end_date !== expected) {
          toUpdate.push({ id: p.id, end_date: expected })
        }
      }

      if (!toUpdate.length) return
      console.log('[fixDueDates] Corrigindo', toUpdate.length, 'vencimento(s):', toUpdate)
      fixingRef.current = true
      await Promise.all(
        toUpdate.map((u) => supabase.from('payments').update({ end_date: u.end_date }).eq('id', u.id))
      )
      fixingRef.current = false
      await load()
    }
    fixDueDates()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payments, students, selectedMonth, tenant, loading])

  // Agrupar pagamentos por aluno
  const paymentsByStudent: Record<string, any[]> = {}
  for (const p of payments) {
    paymentsByStudent[p.student_id] = paymentsByStudent[p.student_id] || []
    paymentsByStudent[p.student_id].push(p)
  }

  // Gerar linhas para exibição
  const allStudents = Object.values(students)
  const studentsList = allStudents
    .filter((s: any) => (onlyActive ? isStudentActive(s) : true))
    .filter((s: any) => ((s.full_name || '').toLowerCase().includes(query.toLowerCase())))
  const rows = studentsList.map((s: any) => {
    const allPayments = paymentsByStudent[s.id] || []
    // Pega o pagamento mais recente do mês selecionado
    const payment = getMonthPayment(allPayments, selectedMonth)
    // Conta quantos meses anteriores estão em aberto
    const olderUnpaid = allPayments.filter((p: any) => getPaymentStatus(p) !== 'paid' && (p.start_date || '').slice(0,7) < selectedMonth).length
    const status = getPaymentStatus(payment)
    const amountBase = Number(payment?.amount ?? s.contact?.monthly_fee ?? s.monthly_fee ?? 0)
    return { student: s, payment, status, olderUnpaid, amountBase }
  })
  const rowsSorted = [...rows].sort((a, b) => {
    const order = (st: string) => st === 'delinquent' ? 0 : st === 'late' ? 1 : st === 'pending' ? 2 : 3
    const oa = order(a.status)
    const ob = order(b.status)
    if (oa !== ob) return oa - ob
    const an = (a.student.full_name || '').toLowerCase()
    const bn = (b.student.full_name || '').toLowerCase()
    return an.localeCompare(bn)
  })
  const rowsToDisplay = onlyDelinquent ? rowsSorted.filter(r => r.status === 'delinquent') : rowsSorted
  const totalInadimplentes = rows.filter(r => r.status === 'delinquent').reduce((sum, r) => sum + r.amountBase, 0)
  const totalRecebidoMes = rows.reduce((sum, r) => (r.status === 'paid' ? sum + r.amountBase : sum), 0)
  const totalAbertoMes = rows.reduce((sum, r) => (r.status !== 'paid' ? sum + r.amountBase : sum), 0)
  const totalAtivos = allStudents.filter((s: any) => isStudentActive(s)).length
  const totalInadimplentesQtd = rows.filter((r) => r.status === 'delinquent').length

  // Baixa manual
  async function handleManualPayment(payment: any) {
    setSettleLoading(true)
    try {
      const amountToSave = settleAmount ? Number(settleAmount) : Number(payment.amount ?? 0)
      const { data, error } = await supabase
        .from('payments')
        .update({
          status: 'paid',
          amount: amountToSave,
          payment_method: settleMethod,
          paid_at: settleDate || new Date().toISOString().slice(0, 10),
        } as any)
        .eq('id', payment.id)
        .select()
        .single()
      if (error) {
        if (String(error?.message || '').toLowerCase().includes('column')) {
          const { data: fallbackData, error: fallbackError } = await supabase
            .from('payments')
            .update({ status: 'paid', amount: amountToSave })
            .eq('id', payment.id)
            .select()
            .single()
          if (fallbackError) {
            if (!handleSupabaseAuthError(fallbackError)) {
              console.error('Erro ao atualizar pagamento (fallback):', fallbackError)
              alert('Falha ao registrar baixa: ' + (fallbackError.message || ''))
            }
          } else {
            setPayments(prev => prev.map(p => p.id === fallbackData.id ? { ...p, ...fallbackData } : p))
          }
        } else if (!handleSupabaseAuthError(error)) {
          console.error('Erro ao atualizar pagamento:', error)
          alert('Falha ao registrar baixa: ' + (error.message || ''))
        }
      } else {
        setPayments(prev => prev.map(p => p.id === data.id ? { ...p, ...data } : p))
      }
    } finally {
      setSettleLoading(false)
      setModal({ open: false })
      load()
    }
  }

  function exportExcelLikeCsv() {
    const header = ['Aluno', 'Status', 'Valor', 'Vencimento', 'Pendências Anteriores']
    const lines = rowsToDisplay.map((r) => [
      r.student.full_name,
      getStatusLabel(r.status),
      Number(r.payment?.amount ?? 0).toFixed(2),
      r.payment?.end_date || '',
      String(r.olderUnpaid),
    ])
    const csv = [header, ...lines]
      .map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(';'))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `financeiro-${selectedMonth}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function exportPdf() {
    window.print()
  }

  // Aviso antes do vencimento
  async function sendPreDueReminders() {
    setReminderSending('pre')
    try {
      const targets = rowsSorted.filter(r => {
        if (r.status !== 'pending') return false
        const d = daysUntilDue(r.payment)
        return d !== null && d >= 0 && d <= daysBefore
      })
      let opened = 0
      for (const row of targets) {
        const phone = String(row.student?.contact?.whatsapp || row.student?.contact?.phone || '')
        if (!phone.replace(/\D+/g, '')) continue
        const d = daysUntilDue(row.payment)
        const dueStr = row.payment?.end_date
          ? new Date(row.payment.end_date + 'T00:00:00').toLocaleDateString('pt-BR')
          : ''
        const text = `Olá ${row.student.full_name}! Lembramos que sua mensalidade de ${selectedMonth} vence em ${d === 0 ? 'hoje' : `${d} dia(s)`} (${dueStr}). Valor: R$ ${Number(row.payment?.amount ?? 0).toFixed(2)}. Qualquer dúvida, estamos à disposição!`
        const popup = window.open(buildWhatsAppUrl(phone, text), '_blank', 'noopener,noreferrer')
        if (popup) { opened++; markReminderSent(row.student.id, selectedMonth) }
      }
      alert(targets.length === 0
        ? `Nenhum aluno com vencimento nos próximos ${daysBefore} dia(s).`
        : `Avisos de pré-vencimento abertos: ${opened}/${targets.length}.`)
    } finally {
      setReminderSending(null)
    }
  }

  // Aviso após atraso
  async function sendLateReminders() {
    setReminderSending('late')
    try {
      const targets = rowsSorted.filter(r => r.status === 'late')
      let opened = 0
      for (const row of targets) {
        const phone = String(row.student?.contact?.whatsapp || row.student?.contact?.phone || '')
        if (!phone.replace(/\D+/g, '')) continue
        const dueStr = row.payment?.end_date
          ? new Date(row.payment.end_date + 'T00:00:00').toLocaleDateString('pt-BR')
          : ''
        const text = `Olá ${row.student.full_name}, sua mensalidade de ${selectedMonth} venceu em ${dueStr} e ainda está em aberto (R$ ${Number(row.payment?.amount ?? 0).toFixed(2)}). Regularize em até 5 dias para evitar bloqueio de acesso. Obrigado!`
        const popup = window.open(buildWhatsAppUrl(phone, text), '_blank', 'noopener,noreferrer')
        if (popup) { opened++; markReminderSent(row.student.id, selectedMonth) }
      }
      alert(targets.length === 0
        ? 'Nenhum aluno em atraso (dentro da carência).'
        : `Avisos de atraso abertos: ${opened}/${targets.length}.`)
    } finally {
      setReminderSending(null)
    }
  }

  // Lembrete recorrente (inadimplentes)
  async function sendRecurringReminders() {
    setReminderSending('recurring')
    try {
      const targets = rowsSorted.filter(r =>
        r.status === 'delinquent' && daysSinceLastReminder(r.student.id, selectedMonth) >= recurringDays
      )
      let opened = 0
      for (const row of targets) {
        const phone = String(row.student?.contact?.whatsapp || row.student?.contact?.phone || '')
        if (!phone.replace(/\D+/g, '')) continue
        const text = `Olá ${row.student.full_name}, notamos que sua mensalidade de ${selectedMonth} ainda está em aberto (R$ ${Number(row.payment?.amount ?? 0).toFixed(2)}). Por favor, regularize sua situação para continuar treinando. Estamos à disposição para combinar a melhor forma de pagamento!`
        const popup = window.open(buildWhatsAppUrl(phone, text), '_blank', 'noopener,noreferrer')
        if (popup) { opened++; markReminderSent(row.student.id, selectedMonth) }
      }
      alert(targets.length === 0
        ? `Nenhum inadimplente elegível para lembrete (intervalo: ${recurringDays} dias).`
        : `Lembretes recorrentes abertos: ${opened}/${targets.length}.`)
    } finally {
      setReminderSending(null)
    }
  }

  async function sendDueReminders() {
    try {
      setSendingReminder(true)
      const delinquentRows = rowsToDisplay.filter((r) => r.status === 'delinquent' || r.status === 'late')
      let opened = 0
      for (const row of delinquentRows) {
        const phone = String(row.student?.contact?.whatsapp || row.student?.contact?.phone || '').replace(/\D+/g, '')
        if (!phone) continue
        const text = `Olá ${row.student.full_name}, sua mensalidade de ${selectedMonth} está ${getStatusLabel(row.status).toLowerCase()}. Favor regularizar. Obrigado!`
        const popup = window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer')
        if (popup) opened++
      }
      if (delinquentRows.length === 0) {
        alert('Não há alunos em atraso para enviar avisos.')
      } else {
        alert(`Avisos abertos no WhatsApp: ${opened}/${delinquentRows.length}.`)
      }
    } finally {
      setSendingReminder(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto text-slate-50">
      <h2 className="text-2xl font-bold mb-4 flex items-center gap-2"><BadgeDollarSign className="text-emerald-400" /> Fluxo de Caixa Mensal</h2>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="month"
          value={selectedMonth}
          onChange={e=>setSelectedMonth(e.target.value)}
          className="border border-slate-700 bg-slate-950 text-slate-50 placeholder:text-slate-500 p-2 rounded"
        />
        <input
          value={query}
          onChange={e=>setQuery(e.target.value)}
          placeholder="Buscar por nome"
          className="border border-slate-700 bg-slate-950 text-slate-50 placeholder:text-slate-500 p-2 rounded w-full sm:flex-1"
        />
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={onlyActive} onChange={e=>setOnlyActive(e.target.checked)} /> Somente ativos
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={onlyDelinquent} onChange={e=>setOnlyDelinquent(e.target.checked)} /> Somente inadimplentes
        </label>
        <button onClick={exportPdf} className="px-3 py-2 rounded border border-slate-700 text-sm inline-flex items-center gap-2"><FileText size={14} /> PDF</button>
        <button onClick={exportExcelLikeCsv} className="px-3 py-2 rounded border border-slate-700 text-sm inline-flex items-center gap-2"><FileSpreadsheet size={14} /> Excel</button>
        <button onClick={sendDueReminders} disabled={sendingReminder} className="px-3 py-2 rounded border border-slate-700 text-sm inline-flex items-center gap-2 disabled:opacity-60"><Bell size={14} /> {sendingReminder ? 'Enviando...' : 'Avisar vencimentos'}</button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div className="p-3 rounded border border-slate-800 bg-slate-900/70">
          <div className="text-xs text-slate-400">Total recebido no mês</div>
          <div className="text-xl font-bold text-emerald-300">R$ {totalRecebidoMes.toFixed(2)}</div>
        </div>
        <div className="p-3 rounded border border-slate-800 bg-slate-900/70">
          <div className="text-xs text-slate-400">Total em aberto</div>
          <div className="text-xl font-bold text-amber-300">R$ {totalAbertoMes.toFixed(2)}</div>
        </div>
        <div className="p-3 rounded border border-slate-800 bg-slate-900/70">
          <div className="text-xs text-slate-400">Alunos ativos</div>
          <div className="text-xl font-bold text-blue-300">{totalAtivos}</div>
        </div>
        <div className="p-3 rounded border border-slate-800 bg-slate-900/70">
          <div className="text-xs text-slate-400">Alunos inadimplentes</div>
          <div className="text-xl font-bold text-red-300">{totalInadimplentesQtd}</div>
        </div>
      </div>
      <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-700">
        Total a receber dos inadimplentes: R$ {totalInadimplentes.toFixed(2)}
      </div>
      {/* ── Automação de Cobrança ─────────────────────────────────────── */}
      {(() => {
        const preDueCount = rowsSorted.filter(r => {
          if (r.status !== 'pending') return false
          const d = daysUntilDue(r.payment)
          return d !== null && d >= 0 && d <= daysBefore
        }).length
        const lateCount = rowsSorted.filter(r => r.status === 'late').length
        const recurringCount = rowsSorted.filter(r =>
          r.status === 'delinquent' && daysSinceLastReminder(r.student.id, selectedMonth) >= recurringDays
        ).length
        return (
          <div className="mb-4 border border-slate-700 rounded-xl bg-slate-900/60">
            <button
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-slate-800/50 rounded-xl"
              onClick={() => setAutomationOpen(v => !v)}
            >
              <span className="flex items-center gap-2">
                <Bell size={16} className="text-amber-400" />
                Automação de Cobrança
                {(preDueCount + lateCount + recurringCount) > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-xs font-bold">
                    {preDueCount + lateCount + recurringCount}
                  </span>
                )}
              </span>
              {automationOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {automationOpen && (
              <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-800 pt-4">

                {/* Aviso antes do vencimento */}
                <div className="flex flex-col gap-3 p-3 rounded-lg border border-slate-700 bg-slate-950/50">
                  <div className="flex items-center gap-2 font-semibold text-amber-300 text-sm">
                    <Clock size={15} /> Aviso antes do vencimento
                  </div>
                  <p className="text-xs text-slate-400">Envia aviso aos alunos com vencimento próximo que ainda não pagaram.</p>
                  <div className="flex items-center gap-2 text-sm">
                    <label className="text-slate-400 whitespace-nowrap">Antecedência:</label>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={daysBefore}
                      onChange={e => setDaysBefore(Math.max(1, Number(e.target.value)))}
                      className="w-16 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-sm"
                    />
                    <span className="text-slate-400">dias</span>
                  </div>
                  <div className="text-xs text-slate-500">{preDueCount} aluno(s) elegíveis</div>
                  <button
                    onClick={sendPreDueReminders}
                    disabled={reminderSending === 'pre' || preDueCount === 0}
                    className="mt-auto flex items-center justify-center gap-2 px-3 py-2 rounded bg-amber-600 hover:bg-amber-700 text-white text-sm disabled:opacity-50"
                  >
                    {reminderSending === 'pre' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    Enviar aviso
                  </button>
                </div>

                {/* Aviso após atraso */}
                <div className="flex flex-col gap-3 p-3 rounded-lg border border-slate-700 bg-slate-950/50">
                  <div className="flex items-center gap-2 font-semibold text-orange-300 text-sm">
                    <AlertCircle size={15} /> Aviso após atraso
                  </div>
                  <p className="text-xs text-slate-400">Envia cobrança aos alunos em atraso (vencimento há até 5 dias) com link de pagamento.</p>
                  <div className="text-xs text-slate-500 mt-auto">{lateCount} aluno(s) em atraso</div>
                  <button
                    onClick={sendLateReminders}
                    disabled={reminderSending === 'late' || lateCount === 0}
                    className="flex items-center justify-center gap-2 px-3 py-2 rounded bg-orange-600 hover:bg-orange-700 text-white text-sm disabled:opacity-50"
                  >
                    {reminderSending === 'late' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    Enviar aviso de atraso
                  </button>
                </div>

                {/* Lembrete recorrente */}
                <div className="flex flex-col gap-3 p-3 rounded-lg border border-slate-700 bg-slate-950/50">
                  <div className="flex items-center gap-2 font-semibold text-red-300 text-sm">
                    <RefreshCw size={15} /> Lembrete recorrente
                  </div>
                  <p className="text-xs text-slate-400">Reenvia cobrança a inadimplentes respeitando um intervalo mínimo entre envios.</p>
                  <div className="flex items-center gap-2 text-sm">
                    <label className="text-slate-400 whitespace-nowrap">Intervalo:</label>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={recurringDays}
                      onChange={e => setRecurringDays(Math.max(1, Number(e.target.value)))}
                      className="w-16 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-sm"
                    />
                    <span className="text-slate-400">dias</span>
                  </div>
                  <div className="text-xs text-slate-500">{recurringCount} inadimplente(s) prontos para lembrete</div>
                  <button
                    onClick={sendRecurringReminders}
                    disabled={reminderSending === 'recurring' || recurringCount === 0}
                    className="mt-auto flex items-center justify-center gap-2 px-3 py-2 rounded bg-red-700 hover:bg-red-800 text-white text-sm disabled:opacity-50"
                  >
                    {reminderSending === 'recurring' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    Enviar lembretes
                  </button>
                </div>

              </div>
            )}
          </div>
        )
      })()}

      {loading && <div className="flex items-center gap-2 text-slate-400"><Loader2 className="animate-spin" /> Carregando...</div>}
      <div className="border border-slate-800 rounded divide-y divide-slate-800 bg-slate-900/60">
        {rowsToDisplay.map(({ student: s, payment, status, olderUnpaid }) => (
          <div key={s.id} className="flex flex-col">
            <div className="p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold flex items-center gap-2 flex-wrap">
                  <User size={18} className="inline text-blue-600" /> {s.full_name}
                  {olderUnpaid > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-200 text-red-800 text-xs">
                      <AlertCircle size={14} /> {olderUnpaid} pendência(s)
                    </span>
                  )}
                  {(() => {
                    const d = daysSinceLastReminder(s.id, selectedMonth)
                    if (d === Infinity) return null
                    return (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-700 text-slate-300 text-xs">
                        <Bell size={11} /> Avisado há {d === 0 ? 'hoje' : `${d}d`}
                      </span>
                    )
                  })()}
                </div>
                <div className="text-sm text-slate-300 flex flex-wrap items-center gap-2 mt-1">
                  <span className={`inline-block px-2 py-0.5 rounded ${getStatusColor(status)}`}>{getStatusLabel(status)}</span>
                  {payment && (
                    <>
                      <span>• R$ {Number(payment.amount ?? 0).toFixed(2)}</span>
                      <span>• Venc: {payment.end_date ? new Date(payment.end_date + 'T00:00:00').toLocaleDateString('pt-BR') : '-'}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 md:justify-end">
                {status !== 'paid' && payment && (
                  <Dialog open={modal.open && modal.payment?.id === payment.id} onOpenChange={open => setModal(open ? { open, payment, student: s } : { open: false })}>
                    <DialogTrigger asChild>
                      <button
                        className="px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-sm"
                        onClick={() => {
                          setSettleAmount(payment?.amount != null ? String(payment.amount) : '')
                          setSettleDate(new Date().toISOString().slice(0, 10))
                          setModal({ open: true, payment, student: s })
                        }}
                      >Baixa manual</button>
                    </DialogTrigger>
                    <DialogContent className="max-w-md w-full bg-white text-slate-900 p-6 rounded shadow-lg">
                      <DialogTitle className="text-lg font-bold mb-2">Baixa manual de pagamento</DialogTitle>
                      <DialogDescription className="mb-4">Confirme os dados do recebimento para <span className="font-semibold">{s.full_name}</span> referente a <span className="font-semibold">{selectedMonth}</span>.</DialogDescription>
                      <div className="mb-3">
                        <label className="block text-sm mb-1 text-slate-700">Valor recebido (R$)</label>
                        <input
                          type="number"
                          step="0.01"
                          className="border border-slate-300 bg-white text-slate-900 px-3 py-2 rounded w-full"
                          value={settleAmount}
                          onChange={e => setSettleAmount(e.target.value)}
                        />
                      </div>
                      <div className="mb-3">
                        <label className="block text-sm mb-1 text-slate-700">Forma de Pagamento</label>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="border border-slate-300 bg-white text-slate-900 px-3 py-2 rounded w-full flex items-center gap-2">
                              {paymentMethods.find(m=>m.label===settleMethod)?.icon}
                              {settleMethod}
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="bg-white border rounded shadow text-slate-900">
                            {paymentMethods.map(m => (
                              <DropdownMenuItem
                                key={m.label}
                                onSelect={()=>setSettleMethod(m.label)}
                                className="flex items-center gap-2 cursor-pointer px-2 py-1 hover:bg-slate-100"
                              >
                                {m.icon} {m.label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <div className="mb-3">
                        <label className="block text-sm mb-1 text-slate-700">Data do Recebimento</label>
                        <input
                          type="date"
                          className="border border-slate-300 bg-white text-slate-900 px-3 py-2 rounded w-full"
                          value={settleDate}
                          onChange={e=>setSettleDate(e.target.value)}
                        />
                      </div>
                      <div className="flex justify-end gap-2 mt-4">
                        <button className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 text-slate-900" onClick={()=>setModal({ open: false })}>Cancelar</button>
                        <button
                          className="px-4 py-2 rounded bg-green-600 hover:bg-green-700 text-white"
                          disabled={settleLoading}
                          onClick={()=>handleManualPayment(payment)}
                        >{settleLoading ? <Loader2 className="animate-spin inline" /> : 'Confirmar'}</button>
                      </div>
                    </DialogContent>
                  </Dialog>
                )}
                <button
                  className={`px-3 py-1 rounded border text-sm ${historyOpenFor === s.id ? 'border-indigo-500 text-indigo-300 bg-slate-800' : 'border-slate-700 text-slate-300'}`}
                  onClick={() => {
                    const next = historyOpenFor === s.id ? null : s.id
                    setHistoryOpenFor(next)
                    if (next) loadHistory(next)
                  }}
                >
                  Histórico
                </button>
              </div>
            </div>

            {historyOpenFor === s.id && (
              <div className="px-4 pb-4 border-t border-slate-800 bg-slate-900/40">
                <div className="pt-3 pb-1 text-xs font-semibold text-slate-400 uppercase tracking-wide">Histórico completo de pagamentos</div>
                {historyLoading === s.id ? (
                  <div className="flex items-center gap-2 text-slate-400 text-sm py-2"><Loader2 size={14} className="animate-spin" /> Carregando...</div>
                ) : (historyData[s.id] || []).length === 0 ? (
                  <div className="text-sm text-slate-500 py-2">Nenhum pagamento encontrado.</div>
                ) : (
                  <div className="divide-y divide-slate-800">
                    {(historyData[s.id] || []).map((p: any) => (
                      <div key={p.id} className="py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-sm">
                        <span className="text-slate-300">
                          {String(p.start_date || '').slice(0, 7)}
                          <span className="text-slate-500 ml-2">Venc: {p.end_date ? new Date(p.end_date + 'T00:00:00').toLocaleDateString('pt-BR') : '-'}</span>
                          {p.paid_at && <span className="text-slate-500 ml-2">Pago: {new Date(p.paid_at).toLocaleDateString('pt-BR')}</span>}
                          {p.payment_method && <span className="text-slate-500 ml-2">• {p.payment_method}</span>}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-xs ${getStatusColor(getPaymentStatus(p))}`}>
                            {getStatusLabel(getPaymentStatus(p))}
                          </span>
                          <span className="font-medium text-slate-200">R$ {Number(p.amount ?? 0).toFixed(2)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
