import React, { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import { DEFAULT_CLUB_CONFIG, evaluateBeltProgress, filterAttendancesSince } from '../lib/beltLogic'
import { Users, AlertCircle, Award, UserCheck } from 'lucide-react'

export default function Dashboard() {
  const [activeCount, setActiveCount] = useState<number | null>(null)
  const [lateCount, setLateCount] = useState<number | null>(null)
  const [readyCount, setReadyCount] = useState<number | null>(null)
  const [alertCount, setAlertCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const { tenant } = useAuth()

  const load = useCallback(async () => {
      setLoading(true)
      if (!tenant) {
        setLoading(false)
        return
      }
      // fetch students, attendances and payments apenas da organização atual
      const { data: students } = await supabase
        .from('students')
        .select('*')
        .eq('organization_id', tenant.organizationId)
      const { data: attendances } = await supabase
        .from('attendances')
        .select('*')
        .eq('organization_id', tenant.organizationId)
      const { data: payments } = await supabase
        .from('payments')
        .select('*')
        .eq('organization_id', tenant.organizationId)

      const studentsList = students || []
      const attendList = attendances || []

      setActiveCount(studentsList.filter((s: any) => s.active).length)
      // calcular inadimplentes: alunos ativos cujo pagamento do mês atual está como "Inadimplente"
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
        if (payment.status === 'paid') return 'paid'
        const due = payment.end_date ? new Date(payment.end_date) : null
        if (!due) return 'pending'
        const diffDays = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24))
        if (diffDays < 0) return 'pending'
        if (diffDays <= 5) return 'late'
        return 'delinquent'
      }

      const openStudentIds = new Set<string>()
      for (const s of studentsList) {
        if (!s.active) continue
        const sPayments = paymentsByStudent[s.id] || []
        const payment = sPayments.find((p: any) => (p.start_date || '').slice(0, 7) === currentMonth)
        const status = getPaymentStatus(payment, nowDate)
        // Considera inadimplente no dashboard qualquer aluno com mensalidade do mês atual não paga
        if (status !== 'paid') {
          openStudentIds.add(s.id)
        }
      }
      setLateCount(openStudentIds.size)

      // map attendances by student
      const attendMap: Record<string, any[]> = {}
      attendList.forEach((a: any) => {
        if (!a.student_id) return
        attendMap[a.student_id] = attendMap[a.student_id] || []
        attendMap[a.student_id].push({ attended_at: a.attended_at })
      })

      let ready = 0
      let alert = 0
      for (const s of studentsList) {
        const since = s.belt_since || s.created_at || new Date(0).toISOString()
        const studentAttendances = (attendMap[s.id] || []).filter((a: any) => new Date(a.attended_at).getTime() >= new Date(since).getTime())
        const progress = evaluateBeltProgress({ id: s.id, current_belt: s.current_belt || 'Branca', current_degree: s.current_degree || 0, belt_since: since }, studentAttendances, DEFAULT_CLUB_CONFIG)
        if (progress.readyForDegree || progress.readyForBeltPromotion) ready++
        if (progress.alert) alert++
      }

      setReadyCount(ready)
      setAlertCount(alert)
      setLoading(false)
  }, [tenant])

  useEffect(() => {
    if (tenant) load()
  }, [load, tenant])

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-3xl font-bold text-center flex-1">Dashboard</h2>
        <button
          onClick={load}
          className="ml-4 text-sm px-3 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          {loading ? 'Atualizando...' : 'Atualizar'}
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-gradient-to-br from-blue-600 to-blue-400 text-white rounded-xl shadow-lg p-6 flex flex-col items-center">
          <Users size={36} className="mb-2" />
          <span className="text-lg">Alunos ativos</span>
          <span className="text-3xl font-bold mt-1">{activeCount ?? (loading? '...' : 0)}</span>
        </div>
        <div className="bg-gradient-to-br from-red-500 to-pink-400 text-white rounded-xl shadow-lg p-6 flex flex-col items-center">
          <AlertCircle size={36} className="mb-2" />
          <span className="text-lg">Inadimplentes</span>
          <span className="text-3xl font-bold mt-1">{lateCount ?? (loading? '...' : 0)}</span>
        </div>
        <div className="bg-gradient-to-br from-green-500 to-emerald-400 text-white rounded-xl shadow-lg p-6 flex flex-col items-center">
          <Award size={36} className="mb-2" />
          <span className="text-lg">Prontos para graduação</span>
          <span className="text-3xl font-bold mt-1">{readyCount ?? (loading? '...' : 0)}</span>
        </div>
        <div className="bg-gradient-to-br from-yellow-400 to-orange-400 text-white rounded-xl shadow-lg p-6 flex flex-col items-center">
          <UserCheck size={36} className="mb-2" />
          <span className="text-lg">Alunos com alerta</span>
          <span className="text-3xl font-bold mt-1">{alertCount ?? (loading? '...' : 0)}</span>
        </div>
      </div>

      <section className="mt-8">
        <h3 className="text-xl font-semibold mb-4 text-gray-800">Atalhos rápidos</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <a href="/students" className="flex items-center gap-3 p-4 bg-white border rounded-lg shadow hover:bg-blue-50 transition">
            <Users size={24} className="text-blue-600" />
            <span className="font-medium text-blue-900">Ver todos os alunos</span>
          </a>
          <a href="/attendance" className="flex items-center gap-3 p-4 bg-white border rounded-lg shadow hover:bg-green-50 transition">
            <Award size={24} className="text-green-600" />
            <span className="font-medium text-green-900">Ver presenças</span>
          </a>
        </div>
      </section>
    </div>
  )
}
