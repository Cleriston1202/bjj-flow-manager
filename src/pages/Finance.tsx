import React, { useCallback, useEffect, useState, useRef } from 'react'
import { supabase, handleSupabaseAuthError } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from '@radix-ui/react-dialog'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@radix-ui/react-dropdown-menu'
import { BadgeCheck, BadgeAlert, BadgeX, BadgeDollarSign, Loader2, User, CreditCard, Banknote, AlertCircle, FileText, FileSpreadsheet, Bell } from 'lucide-react'

// Utilitário para obter o mês atual em yyyy-mm
function getCurrentMonth() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

// Status helpers
function getPaymentStatus(payment: any, today = new Date()) {
  if (!payment) return 'pending'
  if (payment.status === 'paid') return 'paid'
  const due = payment.end_date ? new Date(payment.end_date) : null
  if (!due) return 'pending'
  const diffDays = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays < 0) return 'pending'
  if (diffDays <= 5) return 'late'
  return 'delinquent'
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

function getMonthPayment(payments: any[], month: string) {
  const sameMonth = (payments || []).filter((p: any) => (p.start_date || '').slice(0, 7) === month)
  if (sameMonth.length === 0) return null
  const ordered = [...sameMonth].sort((a: any, b: any) => {
    const ta = new Date(a.created_at || 0).getTime()
    const tb = new Date(b.created_at || 0).getTime()
    return tb - ta
  })
  return ordered[0]
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
  const [sendingReminder, setSendingReminder] = useState(false)
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
        .gte('start_date', monthStart)
        .lte('end_date', monthEnd)
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

  // Geração automática de mensalidades pendentes para cada aluno ativo
  const ensuredMonthsRef = useRef<Record<string, boolean>>({})
  useEffect(() => {
    async function ensureMonthlyPayments() {
      if (!Object.keys(students).length) return
      if (ensuredMonthsRef.current[selectedMonth]) return
      const [yy, mm] = selectedMonth.split('-').map((v)=>Number(v))
      const last = new Date(yy, mm, 0).getDate()
      const monthStart = `${selectedMonth}-01`
      const monthEnd = `${selectedMonth}-${String(last).padStart(2,'0')}`
      const { data: pdata, error: pErr } = await supabase.from('payments').select('*').gte('start_date', monthStart).lte('end_date', monthEnd)
      if (pErr) {
        if (!handleSupabaseAuthError(pErr)) {
          console.error('Erro ao garantir mensalidades do mês', pErr)
        }
        return
      }
      const paymentsForMonth = Array.isArray(pdata) ? pdata : []
      const toInsert: any[] = []
      for (const s of Object.values(students)) {
        if (!isStudentActive(s)) continue
        const hasPayment = paymentsForMonth.some((p: any) => p.student_id === s.id)
        if (!hasPayment) {
          const dueDay = Math.max(1, Math.min(31, Number(s.contact?.due_day ?? 10)))
          const safeDue = Math.min(dueDay, last)
          toInsert.push({
            organization_id: tenant?.organizationId,
            student_id: s.id,
            status: 'pending',
            amount: s.contact?.monthly_fee ?? s.monthly_fee ?? 100,
            start_date: monthStart,
            end_date: `${selectedMonth}-${String(safeDue).padStart(2,'0')}`,
          })
        }
      }
      if (toInsert.length) {
        const { error: insertErr } = await supabase.from('payments').insert(toInsert)
        if (insertErr) {
          if (!handleSupabaseAuthError(insertErr)) {
            console.error('Erro ao criar mensalidades pendentes', insertErr)
          }
        } else {
          await load()
        }
      }
      ensuredMonthsRef.current[selectedMonth] = true
    }
    ensureMonthlyPayments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth, students])

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
      {loading && <div className="flex items-center gap-2 text-slate-400"><Loader2 className="animate-spin" /> Carregando...</div>}
      <div className="border border-slate-800 rounded divide-y divide-slate-800 bg-slate-900/60">
        {rowsToDisplay.map(({ student: s, payment, status, olderUnpaid }) => (
          <div key={s.id} className="p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold flex items-center gap-2">
                <User size={18} className="inline text-blue-600" /> {s.full_name}
                {olderUnpaid > 0 && (
                  <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-200 text-red-800 text-xs">
                    <AlertCircle size={14} /> {olderUnpaid} pendência(s)
                  </span>
                )}
              </div>
              <div className="text-sm text-slate-300 flex flex-wrap items-center gap-2 mt-1">
                <span className={`inline-block px-2 py-0.5 rounded ${getStatusColor(status)}`}>{getStatusLabel(status)}</span>
                {payment && (
                  <>
                    <span>• R$ {Number(payment.amount ?? 0).toFixed(2)}</span>
                    <span>• Venc: {payment.end_date ? new Date(payment.end_date).toLocaleDateString() : '-'}</span>
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
                        // preenche automaticamente com a data de hoje no formato yyyy-mm-dd
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
                className="px-3 py-1 rounded border border-slate-700 text-sm"
                onClick={() => setHistoryOpenFor(historyOpenFor === s.id ? null : s.id)}
              >
                Histórico
              </button>
            </div>
          </div>
        ))}
      </div>
      {historyOpenFor && (
        <div className="mt-4 border border-slate-800 rounded p-3 bg-slate-900/70">
          <h3 className="font-semibold mb-2">Histórico de pagamentos</h3>
          <div className="space-y-1 text-sm">
            {(paymentsByStudent[historyOpenFor] || [])
              .sort((a: any, b: any) => String(b.start_date).localeCompare(String(a.start_date)))
              .map((p: any) => (
                <div key={p.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 border-b border-slate-800 pb-1">
                  <span>{String(p.start_date || '').slice(0,7)} • Venc: {p.end_date || '-'}</span>
                  <span>{getStatusLabel(getPaymentStatus(p))} • R$ {Number(p.amount ?? 0).toFixed(2)}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
