import React, { useCallback, useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from '@radix-ui/react-dialog'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@radix-ui/react-dropdown-menu'
import { BadgeCheck, BadgeAlert, BadgeX, BadgeDollarSign, Loader2, Calendar, User, CreditCard, Banknote, AlertCircle } from 'lucide-react'

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
  const { tenant } = useAuth()

  // Carregar alunos e pagamentos
  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (!tenant) return
      const { data: sdata } = await supabase
        .from('students')
        .select('*')
        .eq('organization_id', tenant.organizationId)
      const sArr = Array.isArray(sdata) ? sdata : []
      const studentsMap: Record<string, any> = {}
      sArr.forEach((s: any) => { studentsMap[s.id] = s })
      setStudents(studentsMap)

      const [y, m] = selectedMonth.split('-').map((v) => Number(v))
      const lastDay = new Date(y, m, 0).getDate()
      const monthStart = `${selectedMonth}-01`
      const monthEnd = `${selectedMonth}-${String(lastDay).padStart(2, '0')}`

      const { data: pdata } = await supabase
        .from('payments')
        .select('*')
        .eq('organization_id', tenant.organizationId)
        .gte('start_date', monthStart)
        .lte('end_date', monthEnd)
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
      const { data: pdata } = await supabase.from('payments').select('*').gte('start_date', monthStart).lte('end_date', monthEnd)
      const paymentsForMonth = Array.isArray(pdata) ? pdata : []
      const toInsert: any[] = []
      for (const s of Object.values(students)) {
        if (!s.active) continue
        const hasPayment = paymentsForMonth.some((p: any) => p.student_id === s.id)
        if (!hasPayment) {
          toInsert.push({
            organization_id: tenant?.organizationId,
            student_id: s.id,
            status: 'pending',
            amount: s.monthly_fee ?? 100,
            start_date: monthStart,
            end_date: `${selectedMonth}-10`,
          })
        }
      }
      if (toInsert.length) {
        await supabase.from('payments').insert(toInsert)
        await load()
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
  const studentsList = Object.values(students).filter((s: any) => (onlyActive ? s.active !== false : true)).filter((s: any) => ((s.full_name || '').toLowerCase().includes(query.toLowerCase())))
  const rows = studentsList.map((s: any) => {
    const allPayments = paymentsByStudent[s.id] || []
    // Pega o pagamento do mês selecionado
    const payment = allPayments.find((p: any) => (p.start_date || '').startsWith(selectedMonth))
    // Conta quantos meses anteriores estão em aberto
    const olderUnpaid = allPayments.filter((p: any) => getPaymentStatus(p) !== 'paid' && (p.start_date || '').slice(0,7) < selectedMonth).length
    const status = getPaymentStatus(payment)
    return { student: s, payment, status, olderUnpaid }
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
  const totalInadimplentes = rows.filter(r => r.status === 'delinquent').reduce((sum, r) => sum + Number(r.payment?.amount ?? 0), 0)

  // Baixa manual
  async function handleManualPayment(payment: any) {
    setSettleLoading(true)
    try {
      const amountToSave = settleAmount ? Number(settleAmount) : Number(payment.amount ?? 0)
      const { data, error } = await supabase
        .from('payments')
        .update({ status: 'paid', amount: amountToSave })
        .eq('id', payment.id)
        .select()
        .single()
      if (error) {
        console.error('Erro ao atualizar pagamento:', error)
        alert('Falha ao registrar baixa: ' + (error.message || ''))
      } else {
        setPayments(prev => prev.map(p => p.id === data.id ? { ...p, ...data } : p))
      }
    } finally {
      setSettleLoading(false)
      setModal({ open: false })
      load()
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <h2 className="text-2xl font-bold mb-4 flex items-center gap-2"><BadgeDollarSign className="text-green-600" /> Fluxo de Caixa Mensal</h2>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input type="month" value={selectedMonth} onChange={e=>setSelectedMonth(e.target.value)} className="border p-2 rounded" />
        <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar por nome" className="border p-2 rounded flex-1" />
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={onlyActive} onChange={e=>setOnlyActive(e.target.checked)} /> Somente ativos
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={onlyDelinquent} onChange={e=>setOnlyDelinquent(e.target.checked)} /> Somente inadimplentes
        </label>
      </div>
      <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-700">
        Total a receber dos inadimplentes: R$ {totalInadimplentes.toFixed(2)}
      </div>
      {loading && <div className="flex items-center gap-2 text-gray-500"><Loader2 className="animate-spin" /> Carregando...</div>}
      <div className="border rounded divide-y">
        {rowsToDisplay.map(({ student: s, payment, status, olderUnpaid }) => (
          <div key={s.id} className="p-3 flex items-center justify-between">
            <div>
              <div className="font-semibold flex items-center gap-2">
                <User size={18} className="inline text-blue-600" /> {s.full_name}
                {olderUnpaid > 0 && (
                  <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-200 text-red-800 text-xs">
                    <AlertCircle size={14} /> {olderUnpaid} pendência(s)
                  </span>
                )}
              </div>
              <div className="text-sm text-gray-600 flex items-center gap-2 mt-1">
                <span className={`inline-block px-2 py-0.5 rounded ${getStatusColor(status)}`}>{getStatusLabel(status)}</span>
                {payment && (
                  <>
                    <span>• R$ {Number(payment.amount ?? 0).toFixed(2)}</span>
                    <span>• Venc: {payment.end_date ? new Date(payment.end_date).toLocaleDateString() : '-'}</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
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
                  <DialogContent className="max-w-md w-full bg-white p-6 rounded shadow-lg">
                    <DialogTitle className="text-lg font-bold mb-2">Baixa manual de pagamento</DialogTitle>
                    <DialogDescription className="mb-4">Confirme os dados do recebimento para <span className="font-semibold">{s.full_name}</span> referente a <span className="font-semibold">{selectedMonth}</span>.</DialogDescription>
                    <div className="mb-3">
                      <label className="block text-sm mb-1">Valor recebido (R$)</label>
                      <input
                        type="number"
                        step="0.01"
                        className="border px-3 py-2 rounded w-full"
                        value={settleAmount}
                        onChange={e => setSettleAmount(e.target.value)}
                      />
                    </div>
                    <div className="mb-3">
                      <label className="block text-sm mb-1">Forma de Pagamento</label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="border px-3 py-2 rounded w-full flex items-center gap-2">
                            {paymentMethods.find(m=>m.label===settleMethod)?.icon}
                            {settleMethod}
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="bg-white border rounded shadow">
                          {paymentMethods.map(m => (
                            <DropdownMenuItem key={m.label} onSelect={()=>setSettleMethod(m.label)} className="flex items-center gap-2 cursor-pointer px-2 py-1">
                              {m.icon} {m.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="mb-3">
                      <label className="block text-sm mb-1">Data do Recebimento</label>
                      <input type="date" className="border px-3 py-2 rounded w-full" value={settleDate} onChange={e=>setSettleDate(e.target.value)} />
                    </div>
                    <div className="flex justify-end gap-2 mt-4">
                      <button className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300" onClick={()=>setModal({ open: false })}>Cancelar</button>
                      <button
                        className="px-4 py-2 rounded bg-green-600 hover:bg-green-700 text-white"
                        disabled={settleLoading}
                        onClick={()=>handleManualPayment(payment)}
                      >{settleLoading ? <Loader2 className="animate-spin inline" /> : 'Confirmar'}</button>
                    </div>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
