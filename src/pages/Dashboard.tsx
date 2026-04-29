import React, { useCallback, useEffect, useState } from 'react'
import { supabase, handleSupabaseAuthError } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import { DEFAULT_CLUB_CONFIG, evaluateBeltProgress } from '../lib/beltLogic'
import { Users, AlertCircle, Award, Wallet } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

function isStudentActive(student: any) {
  const status = String(student?.contact?.status || '')
  return student?.active !== false && status !== 'Cancelado'
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

export default function Dashboard() {
  const [activeCount, setActiveCount] = useState<number | null>(null)
  const [lateCount, setLateCount] = useState<number | null>(null)
  const [pendingCount, setPendingCount] = useState<number | null>(null)
  const [readyCount, setReadyCount] = useState<number | null>(null)
  const [alertCount, setAlertCount] = useState<number | null>(null)
  const [revenueMonth, setRevenueMonth] = useState<number | null>(null)
  const [attendanceLast7Days, setAttendanceLast7Days] = useState<{ day: string; count: number }[]>([])
  const [readyStudents, setReadyStudents] = useState<any[]>([])
  const [promotingId, setPromotingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const { tenant } = useAuth()

  function beltBadgeVariant(belt: string | null | undefined): 'default' | 'secondary' | 'destructive' | 'outline' {
    const b = (belt || 'Branca').toLowerCase()
    if (b.includes('preta')) return 'default'
    return 'outline'
  }

  function beltBadgeClass(belt: string | null | undefined) {
    const b = (belt || 'Branca').toLowerCase()
    if (b.includes('azul')) return 'border-blue-400 text-blue-300'
    if (b.includes('roxa')) return 'border-purple-400 text-purple-300'
    if (b.includes('marrom')) return 'border-amber-500 text-amber-300'
    if (b.includes('preta')) return 'bg-black text-white border-gray-700'
    return 'border-slate-400 text-slate-300'
  }

  const load = useCallback(async () => {
    setLoading(true)
    if (!tenant) {
      setLoading(false)
      return
    }
    const [
      { data: students, error: studentsError },
      { data: attendances, error: attendancesError },
      { data: payments, error: paymentsError },
    ] = await Promise.all([
      supabase
        .from('students')
        .select('id, full_name, active, contact, current_belt, current_degree, belt_since, created_at')
        .eq('organization_id', tenant.organizationId),
      supabase
        .from('attendances')
        .select('student_id, attended_at')
        .eq('organization_id', tenant.organizationId),
      supabase
        .from('payments')
        .select('student_id, status, amount, start_date, end_date, paid_at, created_at')
        .eq('organization_id', tenant.organizationId),
    ])
    if (studentsError) {
      if (!handleSupabaseAuthError(studentsError)) {
        console.error('Erro ao carregar alunos para o dashboard', studentsError)
      }
      setLoading(false)
      return
    }
    if (attendancesError) {
      if (!handleSupabaseAuthError(attendancesError)) {
        console.error('Erro ao carregar presenças para o dashboard', attendancesError)
      }
      setLoading(false)
      return
    }
    if (paymentsError) {
      if (!handleSupabaseAuthError(paymentsError)) {
        console.error('Erro ao carregar pagamentos para o dashboard', paymentsError)
      }
      setLoading(false)
      return
    }

    const studentsList = students || []
    const attendList = attendances || []

    setActiveCount(studentsList.filter((s: any) => isStudentActive(s)).length)
    const payList = payments || []
    const paymentsByStudent: Record<string, any[]> = {}
    for (const p of payList) {
      if (!p.student_id) continue
      paymentsByStudent[p.student_id] = paymentsByStudent[p.student_id] || []
      paymentsByStudent[p.student_id].push(p)
    }

    const nowDate = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const currentMonth = `${nowDate.getFullYear()}-${pad(nowDate.getMonth() + 1)}`

    function getPaymentStatus(payment: any, today = new Date()) {
      if (!payment) return 'pending'
      const due = payment.end_date ? new Date(payment.end_date) : null
      if (!due) return payment.status === 'paid' ? 'paid' : 'pending'
      if (payment.status === 'paid') return 'paid'
      const diffDays = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24))
      if (diffDays < 0) return 'pending'
      if (diffDays <= 5) return 'late'
      return 'delinquent'
    }

    const delinquentStudentIds = new Set<string>()
    const pendingStudentIds = new Set<string>()
    const currentStatusMap = new Map<string, string>()
    for (const s of studentsList) {
      if (!isStudentActive(s)) continue
      const sPayments = paymentsByStudent[s.id] || []
      const payment = getMonthPayment(sPayments, currentMonth)
      const status = getPaymentStatus(payment, nowDate)
      currentStatusMap.set(s.id, status)
      if (status === 'pending' || status === 'late') {
        pendingStudentIds.add(s.id)
      }
      if (status === 'delinquent') {
        delinquentStudentIds.add(s.id)
      }
    }

    const monthStart = `${currentMonth}-01`
    const delinqCutoff = new Date(nowDate.getTime() - 5 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10)
    const { data: prevDelinqData } = await supabase
      .from('payments')
      .select('student_id')
      .eq('organization_id', tenant.organizationId)
      .lt('start_date', monthStart)
      .neq('status', 'paid')
      .lte('end_date', delinqCutoff)
    for (const p of prevDelinqData || []) {
      if (!p.student_id) continue
      const cs = currentStatusMap.get(p.student_id)
      if (cs === 'late' || cs === 'delinquent') {
        delinquentStudentIds.add(p.student_id)
        pendingStudentIds.delete(p.student_id)
      }
    }

    setLateCount(delinquentStudentIds.size)
    setPendingCount(pendingStudentIds.size)

    const receivedMonth = studentsList.reduce((sum: number, s: any) => {
      if (!isStudentActive(s)) return sum
      const sPayments = paymentsByStudent[s.id] || []
      const monthPayment = getMonthPayment(sPayments, currentMonth)
      if (!monthPayment || monthPayment.status !== 'paid') return sum
      return sum + Number(monthPayment.amount ?? s.contact?.monthly_fee ?? 0)
    }, 0)
    setRevenueMonth(receivedMonth)

    const dayFormatter = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit' })
    const toDayKey = (dateValue: string | Date) => {
      const d = new Date(dateValue)
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${y}-${m}-${day}`
    }
    const attendancesByDay = new Map<string, number>()
    for (const a of attendList) {
      if (!a?.attended_at) continue
      const key = toDayKey(a.attended_at)
      attendancesByDay.set(key, (attendancesByDay.get(key) || 0) + 1)
    }
    const last7: { day: string; count: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      d.setDate(d.getDate() - i)
      const count = attendancesByDay.get(toDayKey(d)) || 0
      last7.push({ day: dayFormatter.format(d), count })
    }
    setAttendanceLast7Days(last7)

    const attendMap: Record<string, any[]> = {}
    attendList.forEach((a: any) => {
      if (!a.student_id) return
      attendMap[a.student_id] = attendMap[a.student_id] || []
      attendMap[a.student_id].push({ attended_at: a.attended_at })
    })

    let ready = 0
    let alert = 0
    const readyList: any[] = []
    for (const s of studentsList) {
      const since = s.belt_since || s.created_at || new Date(0).toISOString()
      const studentAttendances = (attendMap[s.id] || []).filter((a: any) => new Date(a.attended_at).getTime() >= new Date(since).getTime())
      const progress = evaluateBeltProgress({ id: s.id, current_belt: s.current_belt || 'Branca', current_degree: s.current_degree || 0, belt_since: since }, studentAttendances, DEFAULT_CLUB_CONFIG)
      if (progress.readyForDegree || progress.readyForBeltPromotion) {
        ready++
        readyList.push({ student: s, progress })
      }
      if (progress.alert) alert++
    }

    setReadyCount(ready)
    setAlertCount(alert)
    setReadyStudents(readyList)
    setLoading(false)
  }, [tenant])

  useEffect(() => {
    if (tenant) load()
  }, [load, tenant])

  async function handlePromote(studentId: string, studentName: string) {
    if (!window.confirm(`Confirmar próxima graduação para ${studentName}?`)) return
    try {
      setPromotingId(studentId)
      const res = await fetch('/api/awardBelt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        const msg = (json && (json.error || json.message)) || 'Erro ao promover aluno.'
        alert(msg)
      } else {
        await load()
      }
    } catch (e: any) {
      alert(e?.message || 'Erro ao promover aluno.')
    } finally {
      setPromotingId(null)
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-8">
        <h2 className="text-2xl sm:text-3xl font-bold">Dashboard</h2>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? 'Atualizando...' : 'Atualizar'}
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-8">
        <Card className="bg-gradient-to-br from-blue-600 to-blue-400 border-0 text-white">
          <CardContent className="flex flex-col items-center pt-6">
            <Users size={36} className="mb-2" />
            <span className="text-lg">Alunos ativos</span>
            <span className="text-3xl font-bold mt-1">{activeCount ?? (loading ? '...' : 0)}</span>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-red-500 to-pink-400 border-0 text-white">
          <CardContent className="flex flex-col items-center pt-6">
            <AlertCircle size={36} className="mb-2" />
            <span className="text-lg">Inadimplentes</span>
            <span className="text-3xl font-bold mt-1">{lateCount ?? (loading ? '...' : 0)}</span>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-amber-500 to-yellow-400 border-0 text-white">
          <CardContent className="flex flex-col items-center pt-6">
            <AlertCircle size={36} className="mb-2" />
            <span className="text-lg">Pendentes</span>
            <span className="text-3xl font-bold mt-1">{pendingCount ?? (loading ? '...' : 0)}</span>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-emerald-600 to-green-500 border-0 text-white">
          <CardContent className="flex flex-col items-center pt-6">
            <Wallet size={36} className="mb-2" />
            <span className="text-lg">Receita do mês</span>
            <span className="text-3xl font-bold mt-1">R$ {Number(revenueMonth ?? 0).toFixed(2)}</span>
          </CardContent>
        </Card>
      </div>

      {/* Frequency chart */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Frequência dos últimos 7 dias</CardTitle>
          <CardDescription>Evolução diária de presenças da semana.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <div className="grid grid-cols-7 gap-3 items-end h-48 min-w-[520px]">
              {(() => {
                const max = Math.max(1, ...attendanceLast7Days.map((d) => d.count))
                return attendanceLast7Days.map((p) => {
                  const height = Math.max(8, Math.round((p.count / max) * 100))
                  return (
                    <div key={p.day} className="flex flex-col items-center justify-end bg-muted rounded-lg p-2 h-full">
                      <div className="text-sm font-semibold mb-2">{p.count}</div>
                      <div className="w-10 bg-gradient-to-t from-red-500 to-red-400 rounded-t-md" style={{ height: `${height}%` }} />
                      <div className="text-xs sm:text-sm font-medium text-muted-foreground mt-2 text-center">{p.day}</div>
                    </div>
                  )
                })
              })()}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick links */}
      <section className="mt-8">
        <h3 className="text-xl font-semibold mb-4">Atalhos rápidos</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <a href="/students">
            <Card className="flex items-center gap-3 p-4 hover:bg-accent transition cursor-pointer">
              <Users size={24} className="text-primary" />
              <span className="font-medium">Ver todos os alunos</span>
            </Card>
          </a>
          <a href="/attendance">
            <Card className="flex items-center gap-3 p-4 hover:bg-accent transition cursor-pointer">
              <Award size={24} className="text-emerald-400" />
              <span className="font-medium">Ver presenças</span>
            </Card>
          </a>
        </div>
      </section>

      {/* Graduation radar */}
      <section className="mt-10">
        <h3 className="text-xl font-semibold mb-1">Radar de Graduação</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Alunos que já atingiram a meta de aulas para o próximo grau ou estão prontos para trocar de faixa.
        </p>

        {readyStudents.length === 0 && (
          <Card>
            <CardContent className="pt-4 text-sm text-muted-foreground">
              Nenhum aluno atingiu ainda 100% da meta para o próximo grau.
            </CardContent>
          </Card>
        )}

        {readyStudents.length > 0 && (
          <div className="space-y-3">
            {readyStudents.map(({ student, progress }) => {
              const percent = Math.min(
                100,
                Math.round(
                  (progress.attendedSinceBelt / Math.max(1, progress.requiredForNextDegree)) * 100,
                ),
              )
              return (
                <Card key={student.id}>
                  <CardContent className="pt-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className={beltBadgeClass(student.current_belt)}>
                        {student.current_belt || 'Branca'} • Grau {student.current_degree ?? 0}
                      </Badge>
                      <div>
                        <div className="font-semibold text-sm">{student.full_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {progress.readyForBeltPromotion
                            ? 'Pronto para trocar de faixa.'
                            : 'Pronto para o próximo grau.'}
                        </div>
                      </div>
                    </div>
                    <div className="flex-1 md:max-w-sm">
                      <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>
                          Aulas desde a faixa atual: {progress.attendedSinceBelt}/{progress.requiredForNextDegree}
                        </span>
                        <span className="font-semibold">{percent}%</span>
                      </div>
                      <div className="h-2 w-full bg-muted rounded-full overflow-hidden mb-2">
                        <div className="h-full bg-emerald-500" style={{ width: `${percent}%` }} />
                      </div>
                    </div>
                    <div className="flex items-center justify-end md:justify-center min-w-[140px]">
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => handlePromote(student.id, student.full_name)}
                        disabled={promotingId === student.id}
                      >
                        {promotingId === student.id ? 'Promovendo...' : 'Promover'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
