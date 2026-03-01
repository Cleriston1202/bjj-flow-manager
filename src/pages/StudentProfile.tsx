import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase, handleSupabaseAuthError } from '../lib/supabaseClient'

export default function StudentProfile() {
  const { id } = useParams()
  const [student, setStudent] = useState<any>(null)
  const [history, setHistory] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [showResetModal, setShowResetModal] = useState(false)
  const [temporaryPassword, setTemporaryPassword] = useState('')
  const [resetLoading, setResetLoading] = useState(false)

  async function fetchData() {
    if (!id) return
    setLoading(true)
    try {
      const { data: s, error: sErr } = await supabase.from('students').select('*').eq('id', id).single()
      if (sErr) {
        if (!handleSupabaseAuthError(sErr)) {
          console.error('Erro ao carregar aluno', sErr)
          setMsg(sErr.message || 'Erro ao carregar aluno.')
        }
        return
      }

      const { data: h, error: hErr } = await supabase
        .from('belt_history')
        .select('*')
        .eq('student_id', id)
        .order('awarded_at', { ascending: false })

      if (hErr) {
        if (!handleSupabaseAuthError(hErr)) {
          console.error('Erro ao carregar histórico de faixas', hErr)
        }
      }

      setStudent(s)
      setHistory(h || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(()=>{ fetchData() }, [id])

  async function handleAward() {
    if (!id) return
    setMsg(null)
    setLoading(true)
    try {
      const res = await fetch('/api/awardBelt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: id })
      })
      const json = await res.json()
      if (!res.ok) {
        setMsg(json.error || 'Erro ao premiar grau')
      } else {
        setMsg('Grau/faixa atualizado com sucesso')
        await fetchData()
      }
    } catch (err: any) {
      setMsg(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleManualResetPassword() {
    if (!id || !temporaryPassword) return
    setMsg(null)
    setResetLoading(true)
    try {
      const { data: sessionData } = await (supabase as any).auth.getSession()
      const accessToken = sessionData?.session?.access_token
      if (!accessToken) {
        setMsg('Sessão inválida. Faça login novamente.')
        return
      }

      const res = await fetch('/api/adminResetPassword', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ studentId: id, newPassword: temporaryPassword }),
      })

      const json = await res.json()
      if (!res.ok) {
        setMsg(json.error || 'Erro ao resetar senha.')
        return
      }

      setMsg('Senha temporária atualizada com sucesso.')
      setTemporaryPassword('')
      setShowResetModal(false)
    } catch (err: any) {
      setMsg(err?.message || 'Erro ao resetar senha.')
    } finally {
      setResetLoading(false)
    }
  }

  if (!id) return <div>Aluno não informado.</div>

  return (
    <div className="max-w-4xl mx-auto text-slate-50">
      <h2 className="text-2xl font-bold mb-4">Perfil do Aluno</h2>
      {loading && <div>Carregando...</div>}
      {msg && <div className="mb-4 p-2 border border-slate-700 rounded bg-slate-900/70">{msg}</div>}
      {student && (
        <div className="p-4 border border-slate-800 rounded bg-slate-900/70">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="h-24 w-24 bg-slate-800 overflow-hidden rounded">
              {student.photo_url ? <img src={student.photo_url} className="h-full w-full object-cover" /> : <div className="h-full w-full flex items-center justify-center text-gray-400">—</div>}
            </div>
            <div>
              <div className="text-xl font-semibold">{student.full_name}</div>
              <div className="text-sm text-slate-300">Faixa: {student.current_belt} • Grau: {student.current_degree}</div>
              <div className="text-sm text-slate-400">Total de aulas: {student.total_classes}</div>
            </div>
          </div>

          <div className="mt-4">
            <div className="flex flex-wrap gap-2">
              <button onClick={handleAward} className="bg-primary text-white px-4 py-2 rounded">Premiar Grau/Faixa</button>
              <button
                onClick={() => setShowResetModal(true)}
                className="px-4 py-2 rounded border border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800"
              >
                Resetar Senha
              </button>
            </div>
          </div>
        </div>
      )}

      {showResetModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-4">
            <h3 className="text-lg font-semibold mb-2">Resetar Senha do Aluno</h3>
            <p className="text-sm text-slate-300 mb-3">Defina uma senha temporária para o aluno.</p>
            <input
              type="password"
              value={temporaryPassword}
              onChange={(e) => setTemporaryPassword(e.target.value)}
              className="w-full border border-slate-700 bg-slate-950 text-slate-50 rounded p-2"
              placeholder="Nova senha temporária"
              minLength={6}
            />
            <div className="mt-4 flex flex-col-reverse sm:flex-row justify-end gap-2">
              <button
                onClick={() => {
                  if (resetLoading) return
                  setShowResetModal(false)
                  setTemporaryPassword('')
                }}
                className="px-4 py-2 rounded border border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800"
                disabled={resetLoading}
              >
                Cancelar
              </button>
              <button
                onClick={handleManualResetPassword}
                disabled={resetLoading || temporaryPassword.length < 6}
                className="px-4 py-2 rounded bg-primary text-white disabled:opacity-60"
              >
                {resetLoading ? 'Salvando...' : 'Confirmar Reset'}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="mt-6">
        <h3 className="text-lg font-semibold mb-2">Histórico de Faixas</h3>
        <div className="space-y-2">
          {history.map(h => (
            <div key={h.id} className="p-3 border border-slate-800 rounded bg-slate-900/70">
              <div className="font-semibold">{h.belt} • Grau: {h.degree}</div>
              <div className="text-sm text-slate-400">{new Date(h.awarded_at).toLocaleString()} {h.notes ? `— ${h.notes}` : ''}</div>
            </div>
          ))}
          {history.length === 0 && <div className="p-3 border border-slate-800 rounded bg-slate-900/70">Nenhum registro.</div>}
        </div>
      </section>
    </div>
  )
}
