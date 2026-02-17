import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase, handleSupabaseAuthError } from '../lib/supabaseClient'
import { DEFAULT_CLUB_CONFIG, evaluateBeltProgress, type AttendanceRecord, type StudentRecord } from '../lib/beltLogic'
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [student, setStudent] = useState<any | null>(null)
  const [classesThisMonth, setClassesThisMonth] = useState(0)
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'late' | 'delinquent' | 'pending'>('pending')
  const [nextDueDate, setNextDueDate] = useState<string | null>(null)
  const [progressPercent, setProgressPercent] = useState(0)

  useEffect(() => {
    if (!studentId) {
      setError('Aluno não identificado. Acesse pelo link enviado pela academia.')
      return
    }
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { data: s, error: sErr } = await supabase
          .from('students')
          .select('*')
          .eq('id', studentId)
          .maybeSingle()
        if (sErr) {
          if (handleSupabaseAuthError(sErr)) {
            return
          }
        }
        if (sErr || !s) {
          setError('Aluno não encontrado.')
          return
        }
        setStudent(s)

        const { start, end } = getCurrentMonthRange()

        // aulas no mês
        const { data: att, error: attErr } = await supabase
          .from('attendances')
          .select('attended_at')
          .eq('student_id', studentId)
          .gte('attended_at', `${start}T00:00:00`)
          .lte('attended_at', `${end}T23:59:59`)
        if (attErr) {
          if (handleSupabaseAuthError(attErr)) {
            return
          }
        }
        if (!attErr && att) {
          setClassesThisMonth(att.length)
        }

        // pagamentos do mês atual
        const { data: pays, error: payErr } = await supabase
          .from('payments')
          .select('*')
          .eq('student_id', studentId)
          .gte('start_date', start)
          .lte('end_date', end)
        if (payErr) {
          if (handleSupabaseAuthError(payErr)) {
            return
          }
        }
        if (!payErr && pays && pays.length > 0) {
          const p = pays[0]
          const st = computePaymentStatus(p)
          setPaymentStatus(st as any)
          setNextDueDate(p.end_date || null)
        } else {
          setPaymentStatus('pending')
          setNextDueDate(null)
        }

        // progresso para próxima graduação
        const { data: attAll, error: attAllErr } = await supabase
          .from('attendances')
          .select('attended_at')
          .eq('student_id', studentId)
        if (attAllErr) {
          if (handleSupabaseAuthError(attAllErr)) {
            return
          }
        }
        if (!attAllErr && attAll) {
          const attendancesSinceBelt: AttendanceRecord[] = (attAll as any[]).map((a: any) => ({ attended_at: a.attended_at }))
          const studentRecord: StudentRecord = {
            id: s.id,
            current_belt: (s.current_belt || 'Branca') as any,
            current_degree: s.current_degree || 0,
            belt_since: s.belt_since || s.created_at || new Date().toISOString(),
          }
          const progress = evaluateBeltProgress(studentRecord, attendancesSinceBelt, DEFAULT_CLUB_CONFIG)
          const percent = Math.min(100, Math.round((progress.attendedSinceBelt / Math.max(1, progress.requiredForNextDegree)) * 100))
          setProgressPercent(percent)
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [studentId])

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
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
        <div className="text-sm opacity-80">{loading ? 'Carregando dados do aluno...' : 'Carregando...'}</div>
      </div>
    )
  }

  const statusText = statusLabel(paymentStatus)
  const statusClass = statusColor(paymentStatus)

  const { start } = getCurrentMonthRange()
  const monthLabel = new Date(start).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

  return (
    <div className="min-h-screen bg-slate-900 text-white flex justify-center px-4 py-6">
      <div className="w-full max-w-sm bg-slate-950 rounded-3xl shadow-2xl border border-slate-800 flex flex-col overflow-hidden">
        <div className="px-5 pt-5 pb-4 bg-gradient-to-br from-indigo-500 via-purple-500 to-slate-900">
          <div className="text-xs uppercase tracking-wide text-slate-100/80 mb-1">Carteira do aluno</div>
          <div className="text-lg font-semibold leading-tight">{student.full_name}</div>
          <div className="text-xs text-slate-100/80 mt-1">Faixa atual: <span className="font-medium">{student.current_belt || 'Branca'}</span></div>
        </div>

        <div className="flex-1 px-5 pt-4 pb-5 flex flex-col items-center gap-3">
          <div className="bg-white p-3 rounded-2xl shadow-inner">
            <QRCode value={student.id} size={180} />
          </div>
          <div className={`text-xs px-3 py-1 rounded-full ${statusClass}`}>
            Status financeiro: {statusText}
          </div>

          <div className="w-full mt-2 text-xs text-slate-200/90">
            <div className="flex justify-between mb-1">
              <span>Aulas em {monthLabel}</span>
              <span className="font-semibold">{classesThisMonth}</span>
            </div>
            <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden mb-2">
              <div className="h-full bg-emerald-500" style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="text-[11px] text-slate-400">
              Progresso para a próxima graduação: <span className="font-medium text-emerald-300">{progressPercent}%</span>
            </div>
          </div>

          <div className="w-full mt-3 text-xs text-slate-300 flex items-center justify-between">
            <div>
              <div className="text-slate-400 text-[11px]">Próximo vencimento</div>
              <div className="font-medium">{nextDueDate ? new Date(nextDueDate).toLocaleDateString('pt-BR') : '—'}</div>
            </div>
            <div className="text-[11px] text-slate-500 max-w-[55%] text-right">
              Apresente este QR no totem ou na recepção para registrar sua presença.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
