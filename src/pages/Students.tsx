import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, UserX } from 'lucide-react'
import { supabase, handleSupabaseAuthError } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import StudentForm, { Student } from '../components/StudentForm'

export default function Students() {
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'Todos' | 'Ativo' | 'Inadimplente' | 'Cancelado'>('Todos')
  const [modalityFilter, setModalityFilter] = useState('')
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

  async function handleInactivate(student?: Student) {
    const id = student?.id
    if (!id) return
    if (!confirm('Inativar aluno?')) return
    const nextContact = {
      ...(student?.contact || {}),
      status: 'Cancelado',
    }
    const { error } = await supabase
      .from('students')
      .update({ active: false, contact: nextContact })
      .eq('id', id)
    if (error) {
      if (!handleSupabaseAuthError(error)) {
        alert('Erro ao inativar: ' + error.message)
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

  const filtered = students.filter(s => {
    const byName = s.full_name.toLowerCase().includes(query.toLowerCase())
    const status = s.contact?.status || (s.active === false ? 'Cancelado' : 'Ativo')
    const modality = String(s.contact?.modality || '')
    const byStatus = statusFilter === 'Todos' ? true : status === statusFilter
    const byModality = modalityFilter ? modality.toLowerCase().includes(modalityFilter.toLowerCase()) : true
    return byName && byStatus && byModality
  })
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
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="border border-slate-700 bg-slate-950 text-slate-50 rounded p-2"
        >
          <option value="Todos">Status: Todos</option>
          <option value="Ativo">Ativo</option>
          <option value="Inadimplente">Inadimplente</option>
          <option value="Cancelado">Cancelado</option>
        </select>
        <input
          value={modalityFilter}
          onChange={(e) => setModalityFilter(e.target.value)}
          className="border border-slate-700 bg-slate-950 text-slate-50 placeholder:text-slate-500 rounded p-2 w-52"
          placeholder="Filtrar modalidade"
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
                <div className="text-xs text-slate-500">
                  {s.contact?.modality || 'Sem modalidade'} • Plano: {s.contact?.plan || 'Mensal'} • R$ {Number(s.contact?.monthly_fee ?? 0).toFixed(2)}
                </div>
                <div className="text-xs text-slate-500">
                  Status: {s.contact?.status || (s.active === false ? 'Cancelado' : 'Ativo')} • Vencimento: dia {s.contact?.due_day ?? 10}
                </div>
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
                onClick={()=>handleInactivate(s)}
                className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-red-100 text-red-600 hover:bg-red-600 hover:text-white transition-colors"
                aria-label="Inativar aluno"
              >
                <UserX size={16} />
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
