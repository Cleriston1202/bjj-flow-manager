import React, { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import QRCode from 'react-qr-code'

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

function statusLabel(status: string) {
  switch (status) {
    case 'paid': return 'Em dia'
    case 'late': return 'Em atraso (dentro da carência)'
    case 'delinquent': return 'Inadimplente'
    default: return 'Pendente'
  }
}

function statusColor(status: string) {
  switch (status) {
    case 'paid': return 'bg-emerald-100 text-emerald-800'
    case 'late': return 'bg-amber-100 text-amber-800'
    case 'delinquent': return 'bg-red-100 text-red-800'
    default: return 'bg-gray-100 text-gray-700'
  }
}

export default function StudentQR() {
  const { studentId } = useParams<{ studentId: string }>()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('t') || ''
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [student, setStudent] = useState<any | null>(null)
  const [classesThisMonth, setClassesThisMonth] = useState(0)
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'late' | 'delinquent' | 'pending'>('pending')
  const [nextDueDate, setNextDueDate] = useState<string | null>(null)
  const [progressPercent, setProgressPercent] = useState(0)

  useEffect(() => {
    if (!token && !studentId) {
      setError('Link inválido. Acesse pelo link enviado pela academia.')
      return
    }
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const query = token
          ? `t=${encodeURIComponent(token)}`
          : `legacyStudentId=${encodeURIComponent(String(studentId || ''))}`
        const response = await fetch(`/api/qr/publicStudent?${query}`)
        const json = await response.json().catch(() => null)

        if (!response.ok || !json?.student) {
          setError(json?.error || 'Não foi possível carregar os dados do aluno.')
          return
        }
        setStudent(json.student)
        setClassesThisMonth(Number(json.classesThisMonth || 0))
        setPaymentStatus((json.paymentStatus || 'pending') as any)
        setNextDueDate(json.nextDueDate || null)
        setProgressPercent(Number(json.progressPercent || 0))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [studentId, token])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white px-4">
        <div className="max-w-sm w-full text-center">
          <div className="text-lg font-semibold mb-2">Portal do Aluno</div>
          <div className="text-sm text-red-200">{error}</div>
        </div>
      </div>
    )
  }

  if (!student) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white px-4 py-6">
        <div className="w-full max-w-sm bg-slate-950 rounded-3xl shadow-2xl border border-slate-800 p-5 animate-pulse">
          <div className="h-4 w-32 bg-slate-800 rounded mb-2" />
          <div className="h-6 w-48 bg-slate-800 rounded mb-4" />
          <div className="h-40 w-full bg-slate-900 rounded-2xl mb-4" />
          <div className="h-3 w-40 bg-slate-800 rounded mb-2" />
          <div className="h-2 w-full bg-slate-900 rounded-full mb-2" />
          <div className="h-2 w-3/4 bg-slate-900 rounded-full" />
          <div className="mt-4 h-3 w-1/2 bg-slate-800 rounded" />
        </div>
      </div>
    )
  }

  const statusText = statusLabel(paymentStatus)
  const statusClass = statusColor(paymentStatus)

  const { start } = getCurrentMonthRange()
  const monthLabel = new Date(start).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white flex justify-center px-4 py-8">
      <div className="w-full max-w-md bg-slate-950/90 rounded-3xl shadow-2xl border border-slate-800 flex flex-col overflow-hidden">
        <div className="px-6 pt-6 pb-5 bg-gradient-to-br from-indigo-500 via-violet-500 to-slate-900">
          <div className="text-xs uppercase tracking-wide text-slate-100/80 mb-1">Carteira digital do aluno</div>
          <div className="text-2xl font-bold leading-tight">{student.full_name}</div>
          <div className="text-sm text-slate-100/90 mt-1">
            Faixa atual: <span className="font-semibold">{student.current_belt || 'Branca'}</span> • Grau {student.current_degree || 0}
          </div>
        </div>

        <div className="flex-1 px-6 pt-5 pb-6 flex flex-col items-center gap-4">
          <div className="bg-white p-4 rounded-2xl shadow-inner border border-slate-200">
            <QRCode value={student.id} size={190} />
          </div>
          <div className={`text-sm px-3 py-1.5 rounded-full font-medium ${statusClass}`}>
            Status financeiro: {statusText}
          </div>

          <div className="w-full mt-1 text-sm text-slate-200/90 bg-slate-900/70 border border-slate-800 rounded-xl p-3">
            <div className="flex justify-between mb-2">
              <span>Aulas em {monthLabel}</span>
              <span className="font-bold text-emerald-300">{classesThisMonth}</span>
            </div>
            <div className="h-2.5 w-full bg-slate-800 rounded-full overflow-hidden mb-2">
              <div className="h-full bg-emerald-500" style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="text-xs text-slate-400">
              Progresso para a próxima graduação: <span className="font-medium text-emerald-300">{progressPercent}%</span>
            </div>
          </div>

          <div className="w-full mt-1 text-sm text-slate-300 flex items-center justify-between gap-3">
            <div>
              <div className="text-slate-400 text-xs">Próximo vencimento</div>
              <div className="font-medium">{nextDueDate ? new Date(nextDueDate).toLocaleDateString('pt-BR') : '—'}</div>
            </div>
            <div className="text-xs text-slate-500 max-w-[60%] text-right">
              Apresente este QR no totem ou na recepção para registrar sua presença.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
