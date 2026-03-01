import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, handleSupabaseAuthError } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import { getBaseUrl } from '../lib/baseUrl'
import { QrReader } from 'react-qr-reader'
import { DEFAULT_CLUB_CONFIG, evaluateBeltProgress } from '../lib/beltLogic'
import { useParams } from 'react-router-dom'

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

const MIN_CHECKINS_30D = 8

async function loadClassSchedulesForTenant(tenantOrganizationId: string) {
  const { data, error } = await supabase
    .from('classes')
    .select('id, name, modality, professor_name, weekday, start_time, end_time, active')
    .eq('organization_id', tenantOrganizationId)

  if (!error) {
    return (data || []).map((row: any) => ({
      id: row.id,
      name: row.name,
      modality: row.modality,
      professor: row.professor_name,
      weekday: row.weekday,
      startTime: row.start_time,
      endTime: row.end_time,
      active: row.active !== false,
    }))
  }

  const classErr = String(error?.message || '').toLowerCase()
  if (!classErr.includes('classes')) return []

  const tryColumns = ['organization_id', 'org_id']
  for (const orgCol of tryColumns) {
    const { data: classSettings, error: settingsErr } = await supabase
      .from('settings')
      .select('value')
      .eq(orgCol as any, tenantOrganizationId)
      .eq('key', 'class_schedules')
      .maybeSingle()

    if (!settingsErr) {
      const classes = Array.isArray(classSettings?.value) ? classSettings?.value : []
      return classes
    }

    const settingsMsg = String(settingsErr?.message || '').toLowerCase()
    if (!(settingsMsg.includes('column') || settingsMsg.includes('schema cache'))) {
      return []
    }
  }

  return []
}

function playBeep(kind: 'success' | 'error') {
  if (typeof window === 'undefined') return
  const AnyWindow = window as any
  const AudioCtx = AnyWindow.AudioContext || AnyWindow.webkitAudioContext
  if (!AudioCtx) return
  try {
    const ctx = new AudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.value = kind === 'success' ? 880 : 440
    const now = ctx.currentTime
    gain.gain.setValueAtTime(0.001, now)
    gain.gain.exponentialRampToValueAtTime(0.2, now + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2)
    osc.start()
    osc.stop(now + 0.25)
  } catch {
    // silenciosamente ignora falhas de áudio
  }
}

export default function Attendance() {
  type ClassSchedule = {
    id: string
    name: string
    modality: string
    professor: string
    weekday: string
    startTime: string
    endTime: string
    active: boolean
  }
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
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [torchOn, setTorchOn] = useState(false)
  const torchStreamRef = useRef<MediaStream | null>(null)
  const [scanLoading, setScanLoading] = useState(false)
  const [lastScanProgress, setLastScanProgress] = useState<{
    percent: number
    prepared: boolean
    studentName: string
    belt: string
    degree: number
  } | null>(null)
  const [classSchedules, setClassSchedules] = useState<ClassSchedule[]>([])
  const [selectedClassId, setSelectedClassId] = useState<string>('')
  const [inactiveStudents15d, setInactiveStudents15d] = useState<any[]>([])
  const { tenant } = useAuth()
  const { organizationId } = useParams<{ organizationId?: string }>()
  const isKiosk = Boolean(organizationId)

  useEffect(() => {
    async function loadStudents() {
      if (!tenant) return
      const { data, error } = await supabase
        .from('students')
        .select('id, full_name, photo_url, current_belt, active')
        .eq('organization_id', tenant.organizationId)
        .order('full_name', { ascending: true })
      if (error) {
        if (!handleSupabaseAuthError(error)) {
          console.error('Erro ao carregar alunos para presença', error)
        }
        return
      }
      if (data) setStudents(data)

      const classes = await loadClassSchedulesForTenant(tenant.organizationId)
      setClassSchedules(classes as ClassSchedule[])
      const firstActive = (classes as ClassSchedule[]).find((c) => c.active)
      if (firstActive && !selectedClassId) {
        setSelectedClassId(firstActive.id)
      }

      const { data: allAttendances } = await supabase
        .from('attendances')
        .select('student_id, attended_at')
        .eq('organization_id', tenant.organizationId)

      const byStudent = new Map<string, number>()
      for (const row of allAttendances || []) {
        if (!row.student_id) continue
        const t = new Date(row.attended_at).getTime()
        const prev = byStudent.get(row.student_id) || 0
        if (t > prev) byStudent.set(row.student_id, t)
      }
      const cutoff = Date.now() - 15 * 24 * 60 * 60 * 1000
      const stale = (data || [])
        .filter((s: any) => {
          const last = byStudent.get(s.id) || 0
          return !last || last < cutoff
        })
        .slice(0, 20)
      setInactiveStudents15d(stale)
    }
    loadStudents()
  }, [tenant, selectedClassId])

  useEffect(() => {
    if (!selectedClassId) return
    const today = new Date().toISOString().slice(0, 10)
    const key = `attendance_session_${selectedClassId}_${today}`
    const existing = window.localStorage.getItem(key)
    if (existing) {
      setSessionId(existing)
      return
    }
    const created = createSessionId()
    window.localStorage.setItem(key, created)
    setSessionId(created)
  }, [selectedClassId])

  useEffect(() => {
    if (!qrEnabled) return
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return
    let cancelled = false
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        if (cancelled) return
        const videos = devices.filter((d) => d.kind === 'videoinput')
        setVideoDevices(videos)
        if (!selectedDeviceId && videos.length > 0) {
          setSelectedDeviceId(videos[0].deviceId || null)
        }
      })
      .catch((err) => {
        console.error('Erro ao listar câmeras', err)
      })
    return () => {
      cancelled = true
    }
  }, [qrEnabled, selectedDeviceId])

  useEffect(() => {
    return () => {
      if (torchStreamRef.current) {
        torchStreamRef.current.getTracks().forEach((t) => t.stop())
        torchStreamRef.current = null
      }
    }
  }, [])

  async function performCheckin(studentId: string, source: 'scan' | 'manual' = 'manual') {
    if (!studentId) return
    if (!tenant) {
      setMessage('Sessão sem tenant. Faça login novamente.')
      setMessageType('error')
      return
    }
    setLoading(true)
    if (source === 'scan') {
      setScanLoading(true)
      setScanFeedback(null)
    }
    setMessage(null)
    setMessageType(null)
    try {
      // buscar aluno
      const { data: student, error: studentError } = await supabase
        .from('students')
        .select('*')
        .eq('id', studentId)
        .maybeSingle()

      if (studentError) {
        if (handleSupabaseAuthError(studentError)) {
          return
        }
      }

      if (studentError || !student || student.active === false) {
        setMessage('Aluno não encontrado ou inativo.')
        setMessageType('error')
        if (source === 'scan') {
          setScanFeedback({ status: 'blocked', name: studentId })
          playBeep('error')
        }
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
        if (source === 'scan') {
          setScanFeedback({ status: 'blocked', name: student.full_name })
          playBeep('error')
        }
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
        if (!handleSupabaseAuthError(payError)) {
          console.error('Erro ao buscar pagamentos para check-in:', payError.message)
        }
      }

      const payment = (payments && payments[0]) || null
      const status = computePaymentStatus(payment)

      if (status === 'delinquent') {
        setMessage('Acesso bloqueado. Favor passar na recepção.')
        setMessageType('error')
        if (source === 'scan') {
          setScanFeedback({ status: 'blocked', name: student.full_name })
          playBeep('error')
        }
        return
      }

      // evitar contar mais de um crédito de aula em janela de 2h
      const now = new Date()
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000)
      const { data: lastAtt, error: lastErr } = await supabase
        .from('attendances')
        .select('attended_at')
        .eq('student_id', studentId)
        .eq('organization_id', tenant.organizationId)
        .eq('valid', true)
        .gte('attended_at', twoHoursAgo.toISOString())
        .order('attended_at', { ascending: false })
        .limit(1)

      if (lastErr) {
        if (handleSupabaseAuthError(lastErr)) {
          return
        }
      }

      if (!lastErr && lastAtt && lastAtt.length > 0) {
        setMessage('Já existe um check-in recente para este aluno nas últimas 2 horas. Não será contado crédito extra de aula.')
        setMessageType('warning')
        if (source === 'scan') setScanFeedback({ status: 'warning', name: student.full_name })
        return
      }

      // registrar presença
      const attendanceRow: any = {
        student_id: studentId,
        organization_id: tenant.organizationId,
        belt_at_time: student.current_belt || 'Branca',
        source: source === 'scan' ? 'qr' : 'manual',
      }
      if (sessionId) attendanceRow.session_id = sessionId
      if (selectedClassId) attendanceRow.technical_observation = `class_id:${selectedClassId}`

      let { error: attendanceError } = await supabase
        .from('attendances')
        .insert([attendanceRow])

      if (attendanceError) {
        const errorMessage = String(attendanceError.message || '')
        const missingColumnMatch = errorMessage.match(/'([^']+)' column/) || errorMessage.match(/column\s+['"]?([a-zA-Z0-9_]+)['"]?/i)
        const missingColumn = missingColumnMatch?.[1]

        if (missingColumn && Object.prototype.hasOwnProperty.call(attendanceRow, missingColumn)) {
          const fallbackRow = { ...attendanceRow }
          delete fallbackRow[missingColumn]

          const retry = await supabase
            .from('attendances')
            .insert([fallbackRow])

          attendanceError = retry.error
        }
      }

      if (attendanceError) {
        if (handleSupabaseAuthError(attendanceError)) {
          return
        }
        setMessage(attendanceError.message || 'Erro ao registrar presença.')
        setMessageType('error')
        return
      }

      // recarregar presenças para calcular progresso de graduação
      const sinceIso = student.belt_since || student.created_at || new Date(0).toISOString()
      const { data: attAll, error: attErr } = await supabase
        .from('attendances')
        .select('attended_at')
        .eq('student_id', studentId)
        .eq('organization_id', tenant.organizationId)
        .eq('valid', true)
        .gte('attended_at', sinceIso)

      let progressMessage = ''
      let prepared = false
      let percent = 0
      if (attErr) {
        if (handleSupabaseAuthError(attErr)) {
          return
        }
      }

      if (!attErr && attAll) {
        const attendancesSinceBelt = (attAll as any[]).map((a: any) => ({ attended_at: a.attended_at }))
        const progress = evaluateBeltProgress(
          {
            id: student.id,
            current_belt: (student.current_belt || 'Branca') as any,
            current_degree: student.current_degree || 0,
            belt_since: sinceIso,
          },
          attendancesSinceBelt,
          DEFAULT_CLUB_CONFIG,
        )

        percent = Math.min(
          100,
          Math.round(
            (progress.attendedSinceBelt / Math.max(1, progress.requiredForNextDegree)) * 100,
          ),
        )

        // frequência dos últimos 30 dias
        const now = new Date()
        const last30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        const recentCount = attendancesSinceBelt.filter((a) => new Date(a.attended_at).getTime() >= last30.getTime()).length
        prepared = (progress.readyForDegree || progress.readyForBeltPromotion) && recentCount >= MIN_CHECKINS_30D

        const nextDegreeLabel = progress.readyForBeltPromotion
          ? 'próxima faixa'
          : `${(student.current_degree || 0) + 1}º grau`

        progressMessage = `Aula ${progress.attendedSinceBelt}/${progress.requiredForNextDegree} para o ${nextDegreeLabel} (${percent}%).`

        if (source === 'scan') {
          setLastScanProgress({
            percent,
            prepared,
            studentName: student.full_name,
            belt: student.current_belt || 'Branca',
            degree: student.current_degree || 0,
          })
        }

        // atualizar contadores de progresso no registro do aluno
        const currentTotal = student.total_classes ?? 0
        const { error: updateError } = await supabase
          .from('students')
          .update({
            total_classes: currentTotal + 1,
            current_belt_lessons: progress.attendedSinceBelt,
          })
          .eq('id', studentId)

        if (updateError) {
          if (!handleSupabaseAuthError(updateError)) {
            console.error('Erro ao atualizar progresso do aluno:', updateError.message)
          }
        }
      }

      if (status && status !== 'paid') {
        setMessage(
          (prepared ? '🎯 Meta atingida! Aluno pronto para avaliação. ' : '') +
          'Check-in realizado. Há pendências financeiras a regularizar.' +
          (progressMessage ? ` ${progressMessage}` : ''),
        )
        setMessageType('warning')
        if (source === 'scan') {
          setScanFeedback({ status: 'warning', name: student.full_name })
          playBeep('success')
        }
      } else if (prepared) {
        setMessage(
          `🎯 Meta atingida! Aluno pronto para avaliação. ${progressMessage || ''}`,
        )
        setMessageType('success')
        if (source === 'scan') {
          setScanFeedback({ status: 'ok', name: student.full_name })
          playBeep('success')
        }
      } else {
        setMessage(
          `Presença registrada com sucesso.${progressMessage ? ` ${progressMessage}` : ''}`,
        )
        setMessageType('success')
        if (source === 'scan') {
          setScanFeedback({ status: 'ok', name: student.full_name })
          playBeep('success')
        }
      }
      setCheckedInIds(prev => Array.from(new Set([...prev, studentId])))
    } catch (err: any) {
      console.error('Erro inesperado no check-in:', err)
      setMessage('Erro inesperado ao registrar presença.')
      setMessageType('error')
    } finally {
      setLoading(false)
      if (source === 'scan') {
        setScanLoading(false)
      }
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

  const academyQrValue = `${getBaseUrl()}/attendance`

  const videoConstraints: MediaTrackConstraints | undefined = selectedDeviceId
    ? { deviceId: { exact: selectedDeviceId } as any, frameRate: { ideal: 10 } }
    : { facingMode: 'environment', frameRate: { ideal: 10 } } as any

  async function handleToggleTorch() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return
    try {
      if (torchOn) {
        if (torchStreamRef.current) {
          torchStreamRef.current.getTracks().forEach((t) => t.stop())
          torchStreamRef.current = null
        }
        setTorchOn(false)
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
          advanced: [{ torch: true }],
        } as any,
      })
      const [track] = stream.getVideoTracks()
      if (track && (track as any).applyConstraints) {
        try {
          await (track as any).applyConstraints({ advanced: [{ torch: true }] })
        } catch (e) {
          console.error('Torch constraints não suportados', e)
        }
      }
      torchStreamRef.current = stream
      setTorchOn(true)
    } catch (e) {
      console.error('Torch não suportado para este dispositivo', e)
    }
  }

  function handleSwitchCamera() {
    if (videoDevices.length <= 1) return
    if (!selectedDeviceId) {
      setSelectedDeviceId(videoDevices[1].deviceId || null)
      return
    }
    const currentIndex = videoDevices.findIndex((d) => d.deviceId === selectedDeviceId)
    const nextIndex = (currentIndex + 1) % videoDevices.length
    setSelectedDeviceId(videoDevices[nextIndex].deviceId || null)
  }

  return (
    <div className={isKiosk ? 'min-h-screen bg-slate-950 text-slate-50 px-4 py-4' : 'max-w-6xl mx-auto'}>
      {!isKiosk && (
        <h2 className="text-2xl font-bold mb-4 text-slate-50">Central de Check-in &amp; Acesso</h2>
      )}

      <div className="mb-4 border border-slate-800 bg-slate-900/80 rounded-xl p-3 flex flex-col md:flex-row md:items-center gap-3">
        <label className="text-sm text-slate-300">Aula atual:</label>
        <select
          value={selectedClassId}
          onChange={(e) => setSelectedClassId(e.target.value)}
          className="border border-slate-700 bg-slate-950 text-slate-50 rounded p-2 min-w-[260px]"
        >
          <option value="">Selecione um horário</option>
          {classSchedules.filter((c) => c.active).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} • {c.modality} • {c.weekday} {c.startTime}-{c.endTime} • Prof. {c.professor}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">A lista de presença desta sessão fica vinculada à aula selecionada.</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Totem / QR */}
        <div className="border border-slate-800 bg-slate-900/80 rounded-2xl p-4 flex flex-col gap-4 shadow-sm">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold text-slate-50">Modo Totem (QR Code)</h3>
            <button
              type="button"
              onClick={() => setQrEnabled(v => !v)}
              className="text-xs px-3 py-1 rounded border border-slate-600 text-slate-100 hover:bg-slate-800"
            >
              {qrEnabled ? 'Desligar câmera' : 'Ligar câmera'}
            </button>
          </div>
          <p className="text-xs text-slate-400 mb-2">O aluno aproxima o QR do cartão ou celular na câmera para registrar o check-in desta aula.</p>
          <div className="relative border border-slate-800 rounded-2xl overflow-hidden bg-black/80 text-white flex items-center justify-center min-h-[260px] md:min-h-[320px]">
            {qrEnabled ? (
              <>
                <QrReader
                  constraints={videoConstraints as any}
                  scanDelay={100}
                  onResult={(result: any, error: any) => {
                    if (result) {
                      const text = (result?.getText?.() ?? result?.text ?? '').toString()
                      handleScan(text || null)
                    }
                    if (error) {
                      handleScanError(error)
                    }
                  }}
                  containerStyle={{ width: '100%', height: '100%' }}
                  videoStyle={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div
                    className={`relative w-60 h-60 md:w-72 md:h-72 rounded-2xl border-2 transition-colors duration-300 ${
                      scanFeedback?.status === 'ok'
                        ? 'border-emerald-400 shadow-[0_0_0_2px_rgba(16,185,129,0.7)] animate-pulse'
                        : scanFeedback?.status === 'blocked'
                        ? 'border-red-500 shadow-[0_0_0_2px_rgba(239,68,68,0.7)] animate-pulse'
                        : 'border-slate-300/80 shadow-[0_0_0_1px_rgba(148,163,184,0.6)]'
                    } bg-transparent`}
                  >
                    <div className="absolute -top-1 -left-1 h-6 w-6 border-t-4 border-l-4 border-emerald-400" />
                    <div className="absolute -top-1 -right-1 h-6 w-6 border-t-4 border-r-4 border-emerald-400" />
                    <div className="absolute -bottom-1 -left-1 h-6 w-6 border-b-4 border-l-4 border-emerald-400" />
                    <div className="absolute -bottom-1 -right-1 h-6 w-6 border-b-4 border-r-4 border-emerald-400" />
                  </div>
                </div>
              </>
            ) : (
              <div className="text-xs text-slate-300 p-4 text-center">
                Clique em "Ligar câmera" para iniciar o leitor de QR Code.
              </div>
            )}
          </div>
          {qrEnabled && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-300">
              {videoDevices.length > 1 && (
                <button
                  type="button"
                  onClick={handleSwitchCamera}
                  className="px-3 py-1 rounded-full border border-slate-600 bg-slate-900/80 hover:bg-slate-800"
                >
                  Trocar câmera
                </button>
              )}
              <button
                type="button"
                onClick={handleToggleTorch}
                className="px-3 py-1 rounded-full border border-slate-600 bg-slate-900/80 hover:bg-slate-800"
              >
                Flash: {torchOn ? 'Ligado' : 'Desligado'}
              </button>
              <span className="text-[11px] text-slate-500">
                Dica: mantenha o QR no quadrado central para leitura mais rápida.
              </span>
            </div>
          )}

          <div className="mt-4">
            {scanLoading && (
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 animate-pulse">
                <div className="h-3 w-32 bg-slate-700 rounded mb-2" />
                <div className="h-2 w-full bg-slate-800 rounded mb-2" />
                <div className="h-2 w-3/4 bg-slate-800 rounded" />
              </div>
            )}
            {!scanLoading && lastScanProgress && (
              <div className="rounded-xl border border-slate-800 bg-gradient-to-r from-slate-950 to-slate-900 p-4">
                <div className="flex items-center justify-between text-xs text-slate-300 mb-1">
                  <span>Progresso de graduação</span>
                  <span className="font-semibold text-emerald-400">{lastScanProgress.percent}%</span>
                </div>
                <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden mb-2">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${lastScanProgress.percent}%` }}
                  />
                </div>
                <div className="text-[11px] text-slate-400">
                  {lastScanProgress.prepared
                    ? `🎯 ${lastScanProgress.studentName} está pronto para avaliação da próxima graduação.`
                    : `${lastScanProgress.studentName} em ${lastScanProgress.belt} (${lastScanProgress.degree}º grau). Continue treinando para alcançar a próxima graduação!`}
                </div>
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
          <div className="mt-3 text-xs text-slate-500">
            URL do painel para abrir em outro dispositivo:<br />
            <span className="break-all text-blue-400">{academyQrValue}</span>
          </div>
        </div>

        {/* Lista para check-in manual */}
        <div className="border border-slate-800 bg-slate-900/80 rounded-2xl p-4 flex flex-col gap-3 col-span-1 lg:col-span-2">
          <h3 className="font-semibold mb-1 text-slate-50">Check-in Manual (Professor)</h3>
          <div className="flex gap-2 mb-2">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="border border-slate-700 bg-slate-950 text-slate-50 placeholder:text-slate-500 p-2 rounded flex-1"
              placeholder="Buscar por nome ou ID ou ler QR"
            />
            <button
              onClick={handleCheckinButton}
              disabled={loading || !search.trim()}
              className="bg-primary disabled:opacity-60 text-white px-4 py-2 rounded shadow-sm"
            >
              {loading ? 'Registrando...' : 'Marcar'}
            </button>
          </div>

          {message && (
            <div className={`mb-2 p-3 rounded border text-sm ${
              messageType === 'success' ? 'border-emerald-500/60 bg-emerald-900/40 text-emerald-100' :
              messageType === 'warning' ? 'border-amber-400/60 bg-amber-900/40 text-amber-100' :
              'border-red-500/60 bg-red-900/40 text-red-100'
            }`}>
              {message}
            </div>
          )}

          <div className="overflow-y-auto max-h-72 mt-1 border-t pt-2">
            {filteredStudents.map(s => (
              <div key={s.id} className="flex items-center justify-between py-1 border-b border-slate-800 last:border-b-0">
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
              <div className="text-xs text-slate-500">Nenhum aluno encontrado.</div>
            )}
          </div>
        </div>
      </div>

      {/* Tatame em tempo real */}
      <section className="mt-6 border border-slate-800 rounded-2xl p-4 bg-slate-900/80">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-semibold text-slate-50">Tatame em tempo real</h3>
            <p className="text-xs text-slate-400">Alunos que já fizeram check-in nesta aula.</p>
          </div>
          <button
            onClick={() => {
              setCheckedInIds([])
              if (selectedClassId) {
                const today = new Date().toISOString().slice(0, 10)
                const key = `attendance_session_${selectedClassId}_${today}`
                const created = createSessionId()
                window.localStorage.setItem(key, created)
                setSessionId(created)
              } else {
                setSessionId(createSessionId())
              }
              setMessage('Aula finalizada. Nova sessão iniciada para o próximo horário.')
              setMessageType('success')
            }}
            className="text-xs px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700"
          >
            Finalizar aula
          </button>
        </div>

        {checkedInStudents.length === 0 && (
          <div className="text-xs text-slate-500">Nenhum aluno em tatame nesta sessão ainda.</div>
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

      <section className="mt-6 border border-slate-800 rounded-2xl p-4 bg-slate-900/80">
        <h3 className="font-semibold text-slate-50 mb-1">Alunos sem treinar há 15 dias</h3>
        <p className="text-xs text-slate-400 mb-3">Lista para contato e recuperação de frequência.</p>
        <div className="space-y-2">
          {inactiveStudents15d.map((s) => (
            <div key={s.id} className="flex items-center justify-between border border-slate-800 rounded p-2">
              <div>
                <div className="text-sm font-medium">{s.full_name}</div>
                <div className="text-xs text-slate-500">{s.contact?.phone || s.contact?.whatsapp || 'Sem telefone'}</div>
              </div>
              <span className="text-xs px-2 py-1 rounded bg-red-900/50 text-red-200">Inativo 15+ dias</span>
            </div>
          ))}
          {inactiveStudents15d.length === 0 && (
            <div className="text-xs text-slate-500">Nenhum aluno inativo por mais de 15 dias.</div>
          )}
        </div>
      </section>
    </div>
  )
}
