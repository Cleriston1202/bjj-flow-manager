import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'

export interface Student {
  id?: string
  organization_id?: string
  full_name: string
  photo_url?: string
  dob?: string
  contact?: { phone?: string; email?: string; cpf?: string }
  current_belt?: string
  current_degree?: number
  created_at?: string
  belt_since?: string
}

export default function StudentForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: Student
  onSaved: (student: Student) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<Student>(
    initial || {
      full_name: '',
      photo_url: '',
      dob: '',
      contact: { phone: '', email: '' },
      current_belt: 'Branca',
      current_degree: 0,
    }
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(form.photo_url || null)
  const { tenant } = useAuth()

  useEffect(()=>{
    setPreview(form.photo_url || null)
  }, [form.photo_url])

  async function handleSave(e?: React.FormEvent) {
    e?.preventDefault()
    setLoading(true)
    setError(null)
    try {
      if (!tenant) {
        throw new Error('Tenant não carregado. Faça login novamente.')
      }
      // if a file is selected, upload it to Supabase Storage first
      if (file) {
        const fileExt = file.name.split('.').pop()
        const filePath = `public/avatars/${form.full_name.replace(/\s+/g, '_')}_${Date.now()}.${fileExt}`
        const { error: uploadErr } = await supabase.storage.from('avatars').upload(filePath, file, { upsert: true })
        if (uploadErr) throw uploadErr
        const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(filePath)
        form.photo_url = urlData.publicUrl
      }
      if (form.id) {
        const { error } = await supabase.from('students').update({
          full_name: form.full_name,
          photo_url: form.photo_url,
          dob: form.dob,
          contact: form.contact,
          current_belt: form.current_belt,
          current_degree: form.current_degree,
        }).eq('id', form.id)
        if (error) throw error
        onSaved(form)
      } else {
        // Limite de plano: free até 10 alunos
        if (tenant.plan === 'free') {
          const { count } = await supabase
            .from('students')
            .select('id', { count: 'exact', head: true })
          if (typeof count === 'number' && count >= 10) {
            throw new Error('Limite do plano grátis atingido (10 alunos). Faça upgrade para o Pro para cadastrar mais alunos.')
          }
        }

        const nowIso = new Date().toISOString()

        const payload = {
          ...form,
          organization_id: tenant.organizationId,
          created_at: nowIso,
          belt_since: form.belt_since || nowIso,
        }
        const { data, error } = await supabase.from('students').insert([payload]).select().single()
        if (error) throw error
        onSaved(data as Student)
      }
    } catch (err: any) {
      setError(err.message || 'Erro')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="p-4 border border-slate-800 rounded-xl bg-slate-900/80">
      {error && <div className="text-red-500 mb-2 text-sm">{error}</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-slate-50">
        <div>
          <label className="block text-sm text-slate-200">Nome</label>
          <input
            className="border border-slate-700 bg-slate-950 text-slate-50 placeholder:text-slate-500 p-2 rounded w-full"
            value={form.full_name}
            onChange={(e)=>setForm({...form, full_name: e.target.value})}
            required
          />
        </div>
        <div>
          <label className="block text-sm text-slate-200">Data de Nascimento</label>
          <input
            type="date"
            className="border border-slate-700 bg-slate-950 text-slate-50 placeholder:text-slate-500 p-2 rounded w-full"
            value={form.dob || ''}
            onChange={(e)=>setForm({...form, dob: e.target.value})}
          />
        </div>
        <div>
          <label className="block text-sm text-slate-200">E-mail</label>
          <input
            className="border border-slate-700 bg-slate-950 text-slate-50 placeholder:text-slate-500 p-2 rounded w-full"
            value={form.contact?.email || ''}
            onChange={(e)=>setForm({...form, contact: {...form.contact, email: e.target.value}})}
          />
        </div>
        <div>
          <label className="block text-sm text-slate-200">Telefone</label>
          <input
            className="border border-slate-700 bg-slate-950 text-slate-50 placeholder:text-slate-500 p-2 rounded w-full"
            value={form.contact?.phone || ''}
            onChange={(e)=>setForm({...form, contact: {...form.contact, phone: e.target.value}})}
          />
        </div>
        <div>
          <label className="block text-sm text-slate-200">CPF</label>
          <input
            className="border border-slate-700 bg-slate-950 text-slate-50 placeholder:text-slate-500 p-2 rounded w-full"
            value={form.contact?.cpf || ''}
            onChange={(e)=>setForm({...form, contact: {...form.contact, cpf: e.target.value}})}
            placeholder="000.000.000-00"
          />
        </div>
        <div>
          <label className="block text-sm text-slate-200">Faixa atual</label>
          <select
            className="border border-slate-700 bg-slate-950 text-slate-50 p-2 rounded w-full"
            value={form.current_belt}
            onChange={(e)=>setForm({...form, current_belt: e.target.value})}
          >
            <option>Branca</option>
            <option>Azul</option>
            <option>Roxa</option>
            <option>Marrom</option>
            <option>Preta</option>
          </select>
        </div>
        <div>
          <label className="block text-sm text-slate-200">Grau</label>
          <input
            type="number"
            min={0}
            max={4}
            className="border border-slate-700 bg-slate-950 text-slate-50 p-2 rounded w-full"
            value={form.current_degree ?? 0}
            onChange={(e)=>setForm({...form, current_degree: Number(e.target.value)})}
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm text-slate-200">Foto (URL)</label>
          <input
            className="border border-slate-700 bg-slate-950 text-slate-50 placeholder:text-slate-500 p-2 rounded w-full mb-2"
            value={form.photo_url || ''}
            onChange={(e)=>setForm({...form, photo_url: e.target.value})}
          />
          <div className="flex items-center gap-2">
            <input type="file" accept="image/*" onChange={(e)=>{
              const f = e.target.files?.[0] || null
              setFile(f)
              if (f) setPreview(URL.createObjectURL(f))
            }} />
            {preview && <img src={preview} alt="preview" className="h-16 w-16 object-cover rounded border border-slate-700" />}
          </div>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="bg-primary text-white px-4 py-2 rounded shadow-sm disabled:opacity-60"
        >
          {loading? 'Salvando...' : 'Salvar'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-slate-700 rounded bg-slate-900 text-slate-100 hover:bg-slate-800"
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}
