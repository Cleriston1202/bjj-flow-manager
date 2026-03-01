import React, { useEffect, useMemo, useState } from 'react'
import { supabase, handleSupabaseAuthError } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'

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

const weekdayOptions = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo']

function createId() {
  if (typeof crypto !== 'undefined' && (crypto as any).randomUUID) return (crypto as any).randomUUID()
  return `class-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export default function ClassSchedules() {
  const { tenant, role } = useAuth()
  const canManage = role === 'admin'
  const [classes, setClasses] = useState<ClassSchedule[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [form, setForm] = useState<ClassSchedule>({
    id: '',
    name: '',
    modality: '',
    professor: '',
    weekday: 'Segunda',
    startTime: '19:00',
    endTime: '20:00',
    active: true,
  })

  async function load() {
    if (!tenant) return
    setLoading(true)
    setMessage(null)
    const { data, error } = await supabase
      .from('settings')
      .select('value')
      .eq('organization_id', tenant.organizationId)
      .eq('key', 'class_schedules')
      .maybeSingle()

    if (error) {
      if (!handleSupabaseAuthError(error)) {
        setMessage(error.message || 'Erro ao carregar horários de aula.')
      }
      setLoading(false)
      return
    }

    const value = data?.value
    const list = Array.isArray(value) ? value : []
    setClasses(list as ClassSchedule[])
    setLoading(false)
  }

  async function save(next: ClassSchedule[]) {
    if (!tenant) return
    const payload = {
      organization_id: tenant.organizationId,
      key: 'class_schedules',
      value: next,
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase.from('settings').upsert([payload], { onConflict: 'organization_id,key' })
    if (error) {
      if (!handleSupabaseAuthError(error)) {
        setMessage(error.message || 'Erro ao salvar horários de aula.')
      }
      return
    }

    setClasses(next)
    setMessage('Horários de aula atualizados.')
  }

  useEffect(() => { if (tenant) load() }, [tenant])

  const ordered = useMemo(() => {
    const order: Record<string, number> = {
      Segunda: 1,
      Terça: 2,
      Quarta: 3,
      Quinta: 4,
      Sexta: 5,
      Sábado: 6,
      Domingo: 7,
    }
    return [...classes].sort((a, b) => {
      const wa = order[a.weekday] ?? 99
      const wb = order[b.weekday] ?? 99
      if (wa !== wb) return wa - wb
      return a.startTime.localeCompare(b.startTime)
    })
  }, [classes])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canManage) return
    if (!form.name.trim() || !form.modality.trim() || !form.professor.trim()) {
      setMessage('Preencha nome da aula, modalidade e professor.')
      return
    }

    const item: ClassSchedule = {
      ...form,
      id: form.id || createId(),
      name: form.name.trim(),
      modality: form.modality.trim(),
      professor: form.professor.trim(),
    }

    const exists = classes.some((c) => c.id === item.id)
    const next = exists
      ? classes.map((c) => (c.id === item.id ? item : c))
      : [...classes, item]

    await save(next)
    setForm({
      id: '',
      name: '',
      modality: '',
      professor: '',
      weekday: 'Segunda',
      startTime: '19:00',
      endTime: '20:00',
      active: true,
    })
  }

  async function handleEdit(item: ClassSchedule) {
    setForm(item)
  }

  async function handleToggleActive(item: ClassSchedule) {
    if (!canManage) return
    const next = classes.map((c) => (c.id === item.id ? { ...c, active: !c.active } : c))
    await save(next)
  }

  async function handleDelete(item: ClassSchedule) {
    if (!canManage) return
    if (!window.confirm(`Remover a aula ${item.name}?`)) return
    const next = classes.filter((c) => c.id !== item.id)
    await save(next)
  }

  return (
    <div className="max-w-5xl mx-auto text-slate-50">
      <h2 className="text-2xl font-bold mb-4">Gestão de Aulas</h2>

      {message && (
        <div className="mb-4 border border-slate-700 bg-slate-900/70 rounded p-3 text-sm">
          {message}
        </div>
      )}

      <form onSubmit={handleSubmit} className="border border-slate-800 bg-slate-900/70 rounded-xl p-4 grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Nome da aula"
          className="border border-slate-700 bg-slate-950 rounded p-2"
          disabled={!canManage}
          required
        />
        <input
          value={form.modality}
          onChange={(e) => setForm({ ...form, modality: e.target.value })}
          placeholder="Modalidade"
          className="border border-slate-700 bg-slate-950 rounded p-2"
          disabled={!canManage}
          required
        />
        <input
          value={form.professor}
          onChange={(e) => setForm({ ...form, professor: e.target.value })}
          placeholder="Professor responsável"
          className="border border-slate-700 bg-slate-950 rounded p-2"
          disabled={!canManage}
          required
        />
        <select
          value={form.weekday}
          onChange={(e) => setForm({ ...form, weekday: e.target.value })}
          className="border border-slate-700 bg-slate-950 rounded p-2"
          disabled={!canManage}
        >
          {weekdayOptions.map((day) => <option key={day}>{day}</option>)}
        </select>
        <input
          type="time"
          value={form.startTime}
          onChange={(e) => setForm({ ...form, startTime: e.target.value })}
          className="border border-slate-700 bg-slate-950 rounded p-2"
          disabled={!canManage}
        />
        <input
          type="time"
          value={form.endTime}
          onChange={(e) => setForm({ ...form, endTime: e.target.value })}
          className="border border-slate-700 bg-slate-950 rounded p-2"
          disabled={!canManage}
        />
        <label className="inline-flex items-center gap-2 text-sm md:col-span-2">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
            disabled={!canManage}
          /> Aula ativa
        </label>
        <button
          type="submit"
          disabled={!canManage}
          className="px-4 py-2 rounded bg-primary text-white disabled:opacity-60"
        >
          {form.id ? 'Salvar edição' : 'Cadastrar horário'}
        </button>
      </form>

      {loading && <div className="text-sm text-slate-400">Carregando...</div>}

      <div className="space-y-2">
        {ordered.map((item) => (
          <div key={item.id} className="p-3 border border-slate-800 bg-slate-900/70 rounded-xl flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <div>
              <div className="font-semibold">{item.name} • {item.modality}</div>
              <div className="text-sm text-slate-400">
                {item.weekday} • {item.startTime} às {item.endTime} • Prof. {item.professor}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-1 rounded ${item.active ? 'bg-emerald-900/60 text-emerald-200' : 'bg-red-900/60 text-red-200'}`}>
                {item.active ? 'Ativa' : 'Inativa'}
              </span>
              <button onClick={() => handleEdit(item)} disabled={!canManage} className="px-3 py-1 text-sm rounded border border-slate-700 disabled:opacity-60">Editar</button>
              <button onClick={() => handleToggleActive(item)} disabled={!canManage} className="px-3 py-1 text-sm rounded border border-slate-700 disabled:opacity-60">
                {item.active ? 'Inativar' : 'Ativar'}
              </button>
              <button onClick={() => handleDelete(item)} disabled={!canManage} className="px-3 py-1 text-sm rounded border border-red-700 text-red-300 disabled:opacity-60">Excluir</button>
            </div>
          </div>
        ))}

        {!loading && ordered.length === 0 && (
          <div className="p-3 border border-slate-800 rounded-xl bg-slate-900/70 text-sm text-slate-400">
            Nenhum horário cadastrado.
          </div>
        )}
      </div>
    </div>
  )
}
