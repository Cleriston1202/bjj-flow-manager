import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import { QrReader } from 'react-qr-reader'

function beltBorderColor(belt: string | null | undefined) {
  const b = (belt || 'Branca').toLowerCase()
  if (b.includes('azul')) return 'border-blue-500'
  if (b.includes('roxa')) return 'border-purple-500'
  if (b.includes('marrom')) return 'border-amber-700'
  if (b.includes('preta')) return 'border-black'
  return 'border-gray-300'
}

function createSessionId() {
  if (typeof crypto !== 'undefined' && (crypto as any).randomUUID) return (crypto as any).randomUUID()
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

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

export default function Attendance() {
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [messageType, setMessageType] = useState<'success' | 'error' | 'warning' | null>(null)
  const [students, setStudents] = useState<any[]>([])
  const [checkedInIds, setCheckedInIds] = useState<string[]>([])
  const [sessionId, setSessionId] = useState(() => createSessionId())
  const [scanFeedback, setScanFeedback] = useState<{ status: 'ok' | 'warning' | 'blocked'; name: string } | null>(null)
  const [qrEnabled, setQrEnabled] = useState(false)
  const lastScanRef = useRef<{ id: string; ts: number } | null>(null)
  const { tenant } = useAuth()

  useEffect(() => {
    async function loadStudents() {
      if (!tenant) return
      const { data, error } = await supabase
        .from('students')
        .select('id, full_name, photo_url, current_belt, active')
        .eq('organization_id', tenant.organizationId)
        .order('full_name', { ascending: true })
      if (!error && data) setStudents(data)
    }
    loadStudents()
  }, [tenant])

  async function performCheckin(studentId: string, source: 'scan' | 'manual' = 'manual') {
    if (!studentId) return
    if (!tenant) {
      setMessage('Sessão sem tenant. Faça login novamente.')
      setMessageType('error')
      return
    }
    setLoading(true)
    setMessage(null)
    setMessageType(null)
    try {
      // buscar aluno
      const { data: student, error: studentError } = await supabase
        .from('students')
        .select('*')
        .eq('id', studentId)
        .maybeSingle()

      if (studentError || !student || student.active === false) {
        setMessage('Aluno não encontrado ou inativo.')
        setMessageType('error')
        if (source === 'scan') setScanFeedback({ status: 'blocked', name: studentId })
        return
      }

      // controle de capacidade por sessão
      const { count, error: capError } = await supabase
        .from('attendances')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', sessionId)

      const maxCapacity = 20
      if (!capError && typeof count === 'number' && count >= maxCapacity) {
        setMessage('Capacidade máxima do tatame atingida para esta aula.')
        setMessageType('error')
        if (source === 'scan') setScanFeedback({ status: 'blocked', name: student.full_name })
        return
      }

      // validar status financeiro com base na mensalidade do mês atual
      const { start, end } = getCurrentMonthRange()
      const { data: payments, error: payError } = await supabase
        .from('payments')
        .select('*')
        .eq('student_id', studentId)
        .gte('start_date', start)
        .lte('end_date', end)

      if (payError) {
        console.error('Erro ao buscar pagamentos para check-in:', payError.message)
      }

      const payment = (payments && payments[0]) || null
      const status = computePaymentStatus(payment)

      if (status === 'delinquent') {
        setMessage('Acesso bloqueado. Favor passar na recepção.')
        setMessageType('error')
        if (source === 'scan') setScanFeedback({ status: 'blocked', name: student.full_name })
        return
      }

      // registrar presença
      const attendanceRow: any = { student_id: studentId, organization_id: tenant.organizationId }
      if (sessionId) attendanceRow.session_id = sessionId

      const { error: attendanceError } = await supabase
        .from('attendances')
        .insert([attendanceRow])

      if (attendanceError) {
        setMessage(attendanceError.message || 'Erro ao registrar presença.')
        setMessageType('error')
        return
      }

      // incrementar contador de aulas do aluno
      const currentTotal = student.total_classes ?? 0
      const { error: updateError } = await supabase
        .from('students')
        .update({ total_classes: currentTotal + 1 })
        .eq('id', studentId)

      if (updateError) {
        console.error('Erro ao atualizar total_classes:', updateError.message)
      }

      if (status && status !== 'paid') {
        setMessage('Check-in realizado. Há pendências financeiras a regularizar.')
        setMessageType('warning')
        if (source === 'scan') setScanFeedback({ status: 'warning', name: student.full_name })
      } else {
        setMessage('Presença registrada com sucesso.')
        setMessageType('success')
        if (source === 'scan') setScanFeedback({ status: 'ok', name: student.full_name })
      }
      setCheckedInIds(prev => Array.from(new Set([...prev, studentId])))
    } catch (err: any) {
      console.error('Erro inesperado no check-in:', err)
      setMessage('Erro inesperado ao registrar presença.')
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  async function handleCheckinButton() {
    await performCheckin(search.trim(), 'manual')
  }

  function handleScan(data: string | null) {
    if (!data) return
    const id = data.trim()
    const now = Date.now()
    if (lastScanRef.current && lastScanRef.current.id === id && now - lastScanRef.current.ts < 3000) {
      return
    }
    lastScanRef.current = { id, ts: now }
    performCheckin(id, 'scan')
  }

  function handleScanError(err: any) {
    console.error('QR scan error', err)
  }

  const filteredStudents = useMemo(
    () => students.filter(s =>
      (s.full_name || '').toLowerCase().includes(search.toLowerCase()) ||
      (s.id || '').toLowerCase().includes(search.toLowerCase())
    ),
    [students, search]
  )

  const checkedInStudents = students.filter(s => checkedInIds.includes(s.id))

  const academyQrValue = typeof window !== 'undefined' ? `${window.location.origin}/attendance` : 'https://example.com/attendance'

  return (
    <div className="max-w-6xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">Central de Check-in &amp; Acesso</h2>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Totem / QR */}
        <div className="border rounded-lg p-4 flex flex-col gap-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold">Modo Totem (QR Code)</h3>
            <button
              type="button"
              onClick={() => setQrEnabled(v => !v)}
              className="text-xs px-3 py-1 rounded border border-gray-300 hover:bg-gray-50"
            >
              {qrEnabled ? 'Desligar câmera' : 'Ligar câmera'}
            </button>
          </div>
          <p className="text-xs text-gray-500 mb-2">O aluno aproxima o QR do cartão ou celular na câmera para registrar o check-in desta aula.</p>
          <div className="border rounded overflow-hidden bg-black/80 text-white flex items-center justify-center min-h-[220px]">
            {qrEnabled ? (
              <QrReader
                constraints={{ facingMode: 'environment' }}
                onResult={(result: any, error: any) => {
                  if (result) {
                    const text = (result?.getText?.() ?? result?.text ?? '').toString()
                    handleScan(text || null)
                  }
                  if (error) {
                    handleScanError(error)
                  }
                }}
              />
            ) : (
              <div className="text-xs text-gray-300 p-4 text-center">
                Clique em "Ligar câmera" para iniciar o leitor de QR Code.
              </div>
            )}
          </div>
          {scanFeedback && (
            <div className={`mt-3 p-3 rounded-lg text-center text-sm ${
              scanFeedback.status === 'ok' ? 'bg-emerald-600/80' :
              scanFeedback.status === 'warning' ? 'bg-amber-500/80' :
              'bg-red-600/80'
            }`}>
              {scanFeedback.status === 'ok' && (
                <>
                  <div className="font-semibold">Bom treino!</div>
                  <div className="text-xs opacity-90">{scanFeedback.name}</div>
                </>
              )}
              {scanFeedback.status === 'warning' && (
                <>
                  <div className="font-semibold">Check-in realizado com pendências.</div>
                  <div className="text-xs opacity-90">Procure a recepção para regularizar. ({scanFeedback.name})</div>
                </>
              )}
              {scanFeedback.status === 'blocked' && (
                <>
                  <div className="font-semibold">Acesso bloqueado.</div>
                  <div className="text-xs opacity-90">Favor passar na recepção. ({scanFeedback.name})</div>
                </>
              )}
            </div>
          )}
          <div className="mt-3 text-xs text-gray-500">
            URL do painel para abrir em outro dispositivo:<br />
            <span className="break-all text-blue-700">{academyQrValue}</span>
          </div>
        </div>

        {/* Lista para check-in manual */}
        <div className="border rounded-lg p-4 flex flex-col gap-3 col-span-1 lg:col-span-2">
          <h3 className="font-semibold mb-1">Check-in Manual (Professor)</h3>
          <div className="flex gap-2 mb-2">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="border p-2 rounded flex-1"
              placeholder="Buscar por nome ou ID ou ler QR"
            />
            <button
              onClick={handleCheckinButton}
              disabled={loading || !search.trim()}
              className="bg-primary disabled:opacity-60 text-white px-4 py-2 rounded"
            >
              {loading ? 'Registrando...' : 'Marcar'}
            </button>
          </div>

          {message && (
            <div className={`mb-2 p-3 rounded border text-sm ${
              messageType === 'success' ? 'border-green-300 bg-green-50 text-green-800' :
              messageType === 'warning' ? 'border-yellow-300 bg-yellow-50 text-yellow-800' :
              'border-red-300 bg-red-50 text-red-800'
            }`}>
              {message}
            </div>
          )}

          <div className="overflow-y-auto max-h-72 mt-1 border-t pt-2">
            {filteredStudents.map(s => (
              <div key={s.id} className="flex items-center justify-between py-1 border-b last:border-b-0">
                <div className="flex items-center gap-2">
                  <div className={`h-10 w-10 rounded-full overflow-hidden border-2 ${beltBorderColor(s.current_belt)}`}>
                    {s.photo_url ? (
                      <img src={s.photo_url} alt={s.full_name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full bg-gray-100" />
                    )}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{s.full_name}</div>
                    <div className="text-xs text-gray-500">{s.id}</div>
                  </div>
                </div>
                <button
                  onClick={() => performCheckin(s.id)}
                  className="text-xs px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  Check-in
                </button>
              </div>
            ))}
            {filteredStudents.length === 0 && (
              <div className="text-xs text-gray-500">Nenhum aluno encontrado.</div>
            )}
          </div>
        </div>
      </div>

      {/* Tatame em tempo real */}
      <section className="mt-6 border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-semibold">Tatame em tempo real</h3>
            <p className="text-xs text-gray-500">Alunos que já fizeram check-in nesta aula.</p>
          </div>
          <button
            onClick={() => {
              setCheckedInIds([])
              setSessionId(createSessionId())
              setMessage('Aula finalizada. Nova sessão iniciada para o próximo horário.')
              setMessageType('success')
            }}
            className="text-xs px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700"
          >
            Finalizar aula
          </button>
        </div>

        {checkedInStudents.length === 0 && (
          <div className="text-xs text-gray-500">Nenhum aluno em tatame nesta sessão ainda.</div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mt-2">
          {checkedInStudents.map(s => (
            <div key={s.id} className="flex flex-col items-center text-center">
              <div className={`h-16 w-16 rounded-full overflow-hidden border-4 ${beltBorderColor(s.current_belt)} mb-1`}>
                {s.photo_url ? (
                  <img src={s.photo_url} alt={s.full_name} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full bg-gray-100" />
                )}
              </div>
              <div className="text-xs font-medium truncate w-full">{s.full_name}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
