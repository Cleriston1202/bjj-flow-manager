import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export default function StudentProfile() {
  const { id } = useParams()
  const [student, setStudent] = useState<any>(null)
  const [history, setHistory] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function fetchData() {
    if (!id) return
    setLoading(true)
    const { data: s } = await supabase.from('students').select('*').eq('id', id).single()
    const { data: h } = await supabase.from('belt_history').select('*').eq('student_id', id).order('awarded_at', { ascending: false })
    setStudent(s)
    setHistory(h || [])
    setLoading(false)
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

  if (!id) return <div>Aluno não informado.</div>

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">Perfil do Aluno</h2>
      {loading && <div>Carregando...</div>}
      {msg && <div className="mb-4 p-2 border rounded">{msg}</div>}
      {student && (
        <div className="p-4 border rounded">
          <div className="flex items-center gap-4">
            <div className="h-24 w-24 bg-gray-100 overflow-hidden rounded">
              {student.photo_url ? <img src={student.photo_url} className="h-full w-full object-cover" /> : <div className="h-full w-full flex items-center justify-center text-gray-400">—</div>}
            </div>
            <div>
              <div className="text-xl font-semibold">{student.full_name}</div>
              <div className="text-sm text-gray-600">Faixa: {student.current_belt} • Grau: {student.current_degree}</div>
              <div className="text-sm text-gray-500">Total de aulas: {student.total_classes}</div>
            </div>
          </div>

          <div className="mt-4">
            <button onClick={handleAward} className="bg-primary text-white px-4 py-2 rounded">Premiar Grau/Faixa</button>
          </div>
        </div>
      )}

      <section className="mt-6">
        <h3 className="text-lg font-semibold mb-2">Histórico de Faixas</h3>
        <div className="space-y-2">
          {history.map(h => (
            <div key={h.id} className="p-3 border rounded">
              <div className="font-semibold">{h.belt} • Grau: {h.degree}</div>
              <div className="text-sm text-gray-600">{new Date(h.awarded_at).toLocaleString()} {h.notes ? `— ${h.notes}` : ''}</div>
            </div>
          ))}
          {history.length === 0 && <div className="p-3 border rounded">Nenhum registro.</div>}
        </div>
      </section>
    </div>
  )
}
