import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import StudentForm, { Student } from '../components/StudentForm'

export default function Students() {
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Student | null>(null)
  const [showForm, setShowForm] = useState(false)
  const { tenant } = useAuth()

  async function fetchStudents() {
    if (!tenant) return
    setLoading(true)
    const { data, error } = await supabase
      .from('students')
      .select('*')
      .eq('organization_id', tenant.organizationId)
      .order('full_name')
    if (error) {
      console.error(error)
    } else {
      setStudents(data as Student[])
    }
    setLoading(false)
  }

  useEffect(()=>{ if (tenant) fetchStudents() }, [tenant])

  function handleNew() {
    setEditing(null)
    setShowForm(true)
  }

  function handleEdit(s: Student) {
    setEditing(s)
    setShowForm(true)
  }

  async function handleDelete(id?: string) {
    if (!id) return
    if (!confirm('Remover aluno?')) return
    const { error } = await supabase.from('students').delete().eq('id', id)
    if (error) return alert('Erro: ' + error.message)
    setStudents(students.filter(s => s.id !== id))
  }

  function handleSaved(saved: Student) {
    // refresh list simply
    setShowForm(false)
    fetchStudents()
  }

  const filtered = students.filter(s => s.full_name.toLowerCase().includes(query.toLowerCase()))

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">Gestão de Alunos</h2>
      <div className="mb-4 flex justify-between">
        <input value={query} onChange={(e)=>setQuery(e.target.value)} className="border p-2 rounded w-64" placeholder="Buscar aluno por nome" />
        <button onClick={handleNew} className="bg-primary text-white px-4 py-2 rounded">Novo Aluno</button>
      </div>

      {showForm && (
        <div className="mb-4">
          <StudentForm initial={editing || undefined} onSaved={handleSaved} onCancel={()=>setShowForm(false)} />
        </div>
      )}

      {loading && <div>Carregando...</div>}

      <div className="space-y-2">
        {filtered.map(s => (
          <div key={s.id} className="p-3 border rounded flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 bg-gray-100 rounded overflow-hidden flex-shrink-0">
                {s.photo_url ? <img src={s.photo_url} alt={s.full_name} className="h-full w-full object-cover" /> : <div className="h-full w-full flex items-center justify-center text-gray-400">—</div>}
              </div>
              <div>
                <div className="font-semibold"><Link to={`/students/${s.id}`} className="hover:underline">{s.full_name}</Link></div>
                <div className="text-sm text-gray-600">Faixa: {s.current_belt || 'Branca'} • Grau: {s.current_degree ?? 0}</div>
              </div>
            </div>
            <div className="space-x-2">
              <button onClick={()=>handleEdit(s)} className="text-primary">Editar</button>
              <button onClick={()=>handleDelete(s.id)} className="text-red-600">Remover</button>
            </div>
          </div>
        ))}

        {!loading && filtered.length === 0 && <div className="p-3 border rounded">Nenhum aluno encontrado.</div>}
      </div>
    </div>
  )
}
