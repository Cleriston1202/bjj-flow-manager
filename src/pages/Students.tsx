import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, Trash2 } from 'lucide-react'
import { supabase, handleSupabaseAuthError } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import StudentForm, { Student } from '../components/StudentForm'

export default function Students() {
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Student | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const { tenant } = useAuth()

  const PAGE_SIZE = 20

  async function fetchStudents(pageToLoad = 1) {
    if (!tenant) return
    setLoading(true)
    const from = (pageToLoad - 1) * PAGE_SIZE
    const to = from + PAGE_SIZE - 1
    const { data, error, count } = await supabase
      .from('students')
      .select('*', { count: 'exact', head: false })
      .eq('organization_id', tenant.organizationId)
      .order('full_name')
      .range(from, to)
    if (error) {
      if (!handleSupabaseAuthError(error)) {
        console.error(error)
      }
    } else {
      setStudents((data || []) as Student[])
      if (typeof count === 'number') setTotalCount(count)
    }
    setLoading(false)
  }

  useEffect(()=>{ if (tenant) fetchStudents(page) }, [tenant, page])

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
    if (error) {
      if (!handleSupabaseAuthError(error)) {
        alert('Erro: ' + error.message)
      }
      return
    }
    fetchStudents(page)
  }

  function handleSaved(saved: Student) {
    // refresh list simply
    setShowForm(false)
    fetchStudents(page)
  }

  const filtered = students.filter(s => s.full_name.toLowerCase().includes(query.toLowerCase()))
  const totalPages = totalCount > 0 ? Math.ceil(totalCount / PAGE_SIZE) : 1

  return (
    <div className="max-w-4xl mx-auto text-slate-50">
      <h2 className="text-2xl font-bold mb-4">Gestão de Alunos</h2>
      <div className="mb-4 flex justify-between gap-2">
        <input
          value={query}
          onChange={(e)=>setQuery(e.target.value)}
          className="border border-slate-700 bg-slate-950 text-slate-50 placeholder:text-slate-500 rounded p-2 w-64"
          placeholder="Buscar aluno por nome"
        />
        <button onClick={handleNew} className="bg-primary text-white px-4 py-2 rounded shadow-sm">Novo Aluno</button>
      </div>

      {showForm && (
        <div className="mb-4">
          <StudentForm initial={editing || undefined} onSaved={handleSaved} onCancel={()=>setShowForm(false)} />
        </div>
      )}

      {loading && <div className="text-sm text-slate-400">Carregando...</div>}

      <div className="space-y-2">
        {filtered.map(s => (
          <div key={s.id} className="p-3 border border-slate-800 bg-slate-900/70 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 bg-slate-800 rounded-full overflow-hidden flex-shrink-0">
                {s.photo_url ? (
                  <img src={s.photo_url} alt={s.full_name} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-slate-500">—</div>
                )}
              </div>
              <div>
                <div className="font-semibold">
                  <Link to={`/students/${s.id}`} className="hover:underline text-slate-50">{s.full_name}</Link>
                </div>
                <div className="text-sm text-slate-400">Faixa: {s.current_belt || 'Branca'} • Grau: {s.current_degree ?? 0}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={()=>handleEdit(s)}
                className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-blue-100 text-blue-600 hover:bg-blue-600 hover:text-white transition-colors"
                aria-label="Editar aluno"
              >
                <Pencil size={16} />
              </button>
              <button
                onClick={()=>handleDelete(s.id)}
                className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-red-100 text-red-600 hover:bg-red-600 hover:text-white transition-colors"
                aria-label="Remover aluno"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}

        {!loading && filtered.length === 0 && (
          <div className="p-3 border border-slate-800 rounded-xl bg-slate-900/70 text-sm text-slate-400">
            Nenhum aluno encontrado.
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-slate-300">
        <div>
          Página {page} de {totalPages}
        </div>
        <div className="space-x-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            className="px-3 py-1 border border-slate-700 rounded bg-slate-900 disabled:opacity-50"
          >
            Anterior
          </button>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            className="px-3 py-1 border border-slate-700 rounded bg-slate-900 disabled:opacity-50"
          >
            Próxima
          </button>
        </div>
      </div>
    </div>
  )
}
