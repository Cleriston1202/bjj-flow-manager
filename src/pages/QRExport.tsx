import React, { useEffect, useState } from 'react'
import { supabase, handleSupabaseAuthError } from '../lib/supabaseClient'
import { getBaseUrl } from '../lib/baseUrl'
import { useAuth } from '../lib/AuthContext'
import QRCode from 'react-qr-code'
import { Loader2, MessageCircle } from 'lucide-react'

function normalizePhoneBR(raw?: string) {
  const onlyDigits = String(raw || '').replace(/\D+/g, '')
  if (!onlyDigits) return ''
  const withoutLeadingZeros = onlyDigits.replace(/^0+/, '')
  if (!withoutLeadingZeros) return ''
  const normalized = withoutLeadingZeros.startsWith('55') ? withoutLeadingZeros : `55${withoutLeadingZeros}`
  if (normalized.length < 12 || normalized.length > 13) return ''
  return normalized
}

function buildCheckinUrl(studentId: string) {
  const appBase = getBaseUrl()
  return `${appBase}/checkin/${studentId}`
}

async function buildStudentQrUrl(studentId: string, student?: any) {
  const appBase = getBaseUrl()
  try {
    const response = await fetch('/api/qr/createPublicLink', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId,
        expiresInDays: 180,
        studentSnapshot: {
          full_name: String(student?.full_name || ''),
          current_belt: String(student?.current_belt || 'Branca'),
          current_degree: Number(student?.current_degree || 0),
          photo_url: student?.photo_url || null,
        },
      }),
    })
    if (response.ok) {
      const json = await response.json().catch(() => null)
      const publicUrl = String(json?.publicUrl || '')
      if (publicUrl) return publicUrl
    }
  } catch {
    // fallback para manter compatibilidade
  }
  return `${appBase}/meu-qr/${studentId}`
}

export default function QRExport() {
  const [students, setStudents] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [onlyActive, setOnlyActive] = useState(true)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const { tenant } = useAuth()

  async function load() {
    setLoading(true)
    if (!tenant) {
      setLoading(false)
      return
    }
    let q = supabase
      .from('students')
      .select('id, full_name, current_belt, current_degree, photo_url, active, contact')
      .eq('organization_id', tenant.organizationId)
      .order('full_name', { ascending: true })
    if (onlyActive) q = q.eq('active', true)
    const { data, error } = await q
    if (error) {
      if (!handleSupabaseAuthError(error)) {
        console.error('Erro ao carregar alunos para exportação de QR', error)
      }
      setStudents([])
    } else {
      setStudents(data || [])
    }
    setLoading(false)
  }

  useEffect(() => { if (tenant) load() }, [onlyActive, tenant])

  useEffect(() => {
    if (!toastMessage) return
    const timeout = window.setTimeout(() => setToastMessage(null), 3000)
    return () => window.clearTimeout(timeout)
  }, [toastMessage])

  const filtered = students.filter(s => s.full_name.toLowerCase().includes(query.toLowerCase()))

  return (
    <div className="max-w-5xl mx-auto text-slate-50">
      <h2 className="text-2xl font-bold mb-4">QRs de Alunos</h2>
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-2">
        <input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Buscar por nome" className="border border-slate-700 bg-slate-950 p-2 rounded w-full sm:flex-1" />
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={onlyActive} onChange={(e)=>setOnlyActive(e.target.checked)} />
          Somente ativos
        </label>
        <button onClick={()=>window.print()} className="px-4 py-2 border border-slate-700 rounded hover:bg-slate-800 w-full sm:w-auto">Imprimir</button>
      </div>

      {loading && <div>Carregando...</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {filtered.map(s => (
          <div key={s.id} className="p-4 border border-slate-800 rounded-xl flex flex-col items-center gap-3 bg-slate-900/70 shadow-sm">
            <div className="h-12 w-12 rounded-full bg-slate-800 overflow-hidden">
              {s.photo_url ? <img src={s.photo_url} alt={s.full_name} className="h-full w-full object-cover" /> : null}
            </div>
            <div className="text-center">
              <div className="font-semibold text-sm truncate max-w-[140px]">{s.full_name}</div>
              <div className="text-[11px] text-slate-500 break-all">{s.id}</div>
            </div>
            <div className="bg-white p-2 rounded-lg border">
              <QRCode value={s.id} size={128} />
            </div>
            <div className="flex flex-col sm:flex-row items-stretch gap-2 w-full mt-1">
              <button
                disabled={sendingId === s.id}
                onClick={async ()=>{
                  try {
                    setSendingId(s.id)
                    const normalizedPhone = normalizePhoneBR(s.contact?.phone)
                    if (!normalizedPhone) {
                      setToastMessage('Erro: Aluno sem telefone cadastrado')
                      return
                    }

                    const checkinUrl = buildCheckinUrl(s.id)
                    const studentQrUrl = await buildStudentQrUrl(s.id, s)
                    const qrcodeImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=512x512&data=${encodeURIComponent(studentQrUrl)}`
                    const msg = `Olá ${s.full_name}, aqui está seu link do QR Code de acesso à academia: ${studentQrUrl}\nLink de check-in: ${checkinUrl}`

                    try {
                      const integrated = await fetch('/api/whatsapp/send-qrcode', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          studentId: s.id,
                          studentName: s.full_name,
                          phone: normalizedPhone,
                          message: msg,
                          checkinUrl,
                          studentQrUrl,
                          qrcodeImageUrl,
                        }),
                      })
                      if (integrated.ok) {
                        setToastMessage('Mensagem enviada via integração de WhatsApp')
                        return
                      }
                    } catch {
                      // fallback para link direto
                    }

                    const waUrl = `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(msg)}`
                    const popup = window.open(waUrl, '_blank', 'noopener,noreferrer')
                    if (!popup) {
                      setToastMessage('Não foi possível abrir o WhatsApp. Verifique bloqueio de pop-up.')
                      return
                    }
                    setToastMessage('Conversa aberta no WhatsApp. Confirme o envio da mensagem.')
                  } finally {
                    setSendingId(null)
                  }
                }}
                className="inline-flex flex-1 items-center justify-center gap-2 px-3 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 text-xs sm:text-sm"
              >
                {sendingId === s.id ? <Loader2 size={16} className="animate-spin" /> : <MessageCircle size={16} />}
                {sendingId === s.id ? 'Carregando...' : 'Enviar WhatsApp'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {toastMessage && (
        <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 z-50 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-100 shadow-lg">
          {toastMessage}
        </div>
      )}
    </div>
  )
}
