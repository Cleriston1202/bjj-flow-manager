import React, { useEffect, useState } from 'react'
import { supabase, handleSupabaseAuthError } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import QRCode from 'react-qr-code'
import QRCodeLib from 'qrcode'
import { MessageCircle, CheckCircle } from 'lucide-react'

export default function QRExport() {
  const [students, setStudents] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [onlyActive, setOnlyActive] = useState(true)
  const [sent, setSent] = useState<string[]>([])
  const [sendingId, setSendingId] = useState<string | null>(null)
  const { tenant } = useAuth()

  async function load() {
    setLoading(true)
    if (!tenant) {
      setLoading(false)
      return
    }
    let q = supabase
      .from('students')
      .select('id, full_name, photo_url, active')
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
    fetch('/api/qr/sent').then(r=>r.json()).then(j=>setSent(j.sent || [])).catch(()=>setSent([]))
  }, [])

  const filtered = students.filter(s => s.full_name.toLowerCase().includes(query.toLowerCase()))

  return (
    <div className="max-w-5xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">QRs de Alunos</h2>
      <div className="mb-4 flex items-center gap-2">
        <input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Buscar por nome" className="border p-2 rounded flex-1" />
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={onlyActive} onChange={(e)=>setOnlyActive(e.target.checked)} />
          Somente ativos
        </label>
        <button onClick={()=>window.print()} className="px-4 py-2 border rounded hover:bg-gray-50">Imprimir</button>
      </div>

      {loading && <div>Carregando...</div>}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {filtered.map(s => (
          <div key={s.id} className="p-4 border rounded-xl flex flex-col items-center gap-3 bg-white shadow-sm">
            <div className="h-12 w-12 rounded-full bg-gray-100 overflow-hidden">
              {s.photo_url ? <img src={s.photo_url} alt={s.full_name} className="h-full w-full object-cover" /> : null}
            </div>
            <div className="text-center">
              <div className="font-semibold text-sm truncate max-w-[140px]">{s.full_name}</div>
              <div className="text-[11px] text-gray-500 break-all">{s.id}</div>
            </div>
            <div className="bg-white p-2 rounded-lg border">
              <QRCode value={s.id} size={128} />
            </div>
            <div className="flex flex-col sm:flex-row items-stretch gap-2 w-full mt-1">
              {(() => {
                const appBase = typeof window !== 'undefined' ? window.location.origin : ''
                const qrPageUrl = `${appBase}/meu-qr/${s.id}`
                const digits = String((s.contact?.phone)||'').replace(/\D+/g,'')
                const msg = `Seu link do QR para check-in: ${qrPageUrl}`
                return (
              <a
                href={`https://wa.me/55${digits}?text=${encodeURIComponent(msg)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex flex-1 items-center justify-center gap-2 px-3 py-2 rounded-md bg-green-600 text-white hover:bg-green-700 text-xs sm:text-sm"
              >
                <MessageCircle size={16} /> WhatsApp
              </a>
                )
              })()}
              <button
                disabled={sendingId === s.id}
                onClick={async ()=>{
                  try {
                    setSendingId(s.id)
                    const dataUrl = await QRCodeLib.toDataURL(s.id, { width: 512 })
                    const r = await fetch(dataUrl)
                    const blob = await r.blob()
                    const file = new File([blob], `${s.id}.png`, { type: 'image/png' })
                    const path = `public/qrcodes/${s.id}.png`
                    const { error: uploadErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
                    if (uploadErr) {
                      if (!handleSupabaseAuthError(uploadErr)) {
                        console.error('Erro ao enviar QR para storage', uploadErr)
                      }
                      return
                    }
                    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
                    const qurl = urlData.publicUrl
                    const ok = await fetch('/api/qr/markSent', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ studentId: s.id, qrcodeUrl: qurl, message: 'QR enviado via painel' })
                    })
                    if (ok.status === 200) {
                      setSent(prev => Array.from(new Set([...prev, s.id])))
                      const appBase = typeof window !== 'undefined' ? window.location.origin : ''
                      const qrPageUrl = `${appBase}/meu-qr/${s.id}`
                      const digits2 = String((s.contact?.phone)||'').replace(/\D+/g,'')
                      const msg2 = `Seu link do QR para check-in: ${qrPageUrl}`
                      window.open(`https://wa.me/55${digits2}?text=${encodeURIComponent(msg2)}`, '_blank')
                    }
                  } finally {
                    setSendingId(null)
                  }
                }}
                className="inline-flex flex-1 items-center justify-center gap-2 px-3 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 text-xs sm:text-sm"
              >
                <CheckCircle size={16} /> Enviar e marcar
              </button>
            </div>
            {sent.includes(s.id) && <div className="text-[11px] text-green-700 mt-1">Enviado</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
