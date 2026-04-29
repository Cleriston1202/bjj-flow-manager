import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface Student {
  id?: string
  organization_id?: string
  full_name: string
  photo_url?: string
  dob?: string
  contact?: {
    phone?: string
    email?: string
    cpf?: string
    whatsapp?: string
    plan?: 'Mensal' | 'Trimestral' | 'Anual'
    monthly_fee?: number
    due_day?: number
    status?: 'Ativo' | 'Inadimplente' | 'Cancelado'
    modality?: string
  }
  current_belt?: string
  current_degree?: number
  active?: boolean
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
  const todayDueDay = new Date().getDate()
  const [form, setForm] = useState<Student>(
    initial || {
      full_name: '',
      photo_url: '',
      dob: '',
      contact: {
        phone: '',
        whatsapp: '',
        email: '',
        cpf: '',
        plan: 'Mensal',
        monthly_fee: 100,
        due_day: todayDueDay,
        status: 'Ativo',
        modality: 'Jiu-Jitsu',
      },
      active: true,
      current_belt: 'Branca',
      current_degree: 0,
    }
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(form.photo_url || null)
  const { tenant } = useAuth()

  useEffect(() => {
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
      if (file) {
        const fileExt = file.name.split('.').pop()
        const filePath = `public/avatars/${form.full_name.replace(/\s+/g, '_')}_${Date.now()}.${fileExt}`
        const { error: uploadErr } = await supabase.storage.from('avatars').upload(filePath, file, { upsert: true })
        if (uploadErr) throw uploadErr
        const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(filePath)
        form.photo_url = urlData.publicUrl
      }
      if (form.id) {
        const status = form.contact?.status || 'Ativo'
        const { error } = await supabase.from('students').update({
          full_name: form.full_name,
          photo_url: form.photo_url,
          dob: form.dob,
          contact: form.contact,
          active: status !== 'Cancelado',
          current_belt: form.current_belt,
          current_degree: form.current_degree,
        }).eq('id', form.id)
        if (error) throw error
        onSaved(form)
      } else {
        if (tenant.plan === 'free') {
          const { count } = await supabase
            .from('students')
            .select('id', { count: 'exact', head: true })
          if (typeof count === 'number' && count >= 10) {
            throw new Error('Limite do plano grátis atingido (10 alunos). Faça upgrade para o Pro para cadastrar mais alunos.')
          }
        }

        const nowIso = new Date().toISOString()
        const status = form.contact?.status || 'Ativo'

        const payload = {
          ...form,
          organization_id: tenant.organizationId,
          active: status !== 'Cancelado',
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
    <form onSubmit={handleSave} className="p-4 border border-border rounded-xl bg-card">
      {error && <div className="text-destructive mb-3 text-sm">{error}</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="full_name">Nome</Label>
          <Input
            id="full_name"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="dob">Data de Nascimento</Label>
          <Input
            id="dob"
            type="date"
            value={form.dob || ''}
            onChange={(e) => setForm({ ...form, dob: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            value={form.contact?.email || ''}
            onChange={(e) => setForm({ ...form, contact: { ...form.contact, email: e.target.value } })}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="phone">Telefone</Label>
          <Input
            id="phone"
            value={form.contact?.phone || ''}
            onChange={(e) => setForm({ ...form, contact: { ...form.contact, phone: e.target.value } })}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="whatsapp">WhatsApp</Label>
          <Input
            id="whatsapp"
            value={form.contact?.whatsapp || ''}
            onChange={(e) => setForm({ ...form, contact: { ...form.contact, whatsapp: e.target.value } })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cpf">CPF</Label>
          <Input
            id="cpf"
            value={form.contact?.cpf || ''}
            onChange={(e) => setForm({ ...form, contact: { ...form.contact, cpf: e.target.value } })}
            placeholder="000.000.000-00"
            required
          />
        </div>
        <div className="space-y-1">
          <Label>Plano</Label>
          <Select
            value={form.contact?.plan || 'Mensal'}
            onValueChange={(v) => setForm({ ...form, contact: { ...form.contact, plan: v as any } })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Mensal">Mensal</SelectItem>
              <SelectItem value="Trimestral">Trimestral</SelectItem>
              <SelectItem value="Anual">Anual</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="monthly_fee">Valor da mensalidade (R$)</Label>
          <Input
            id="monthly_fee"
            type="number"
            min={0}
            step="0.01"
            value={form.contact?.monthly_fee ?? 100}
            onChange={(e) => setForm({ ...form, contact: { ...form.contact, monthly_fee: Number(e.target.value) } })}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="due_day">Dia de vencimento</Label>
          <Input
            id="due_day"
            type="number"
            min={1}
            max={31}
            value={form.contact?.due_day ?? 10}
            onChange={(e) => setForm({ ...form, contact: { ...form.contact, due_day: Number(e.target.value) } })}
            required
          />
        </div>
        <div className="space-y-1">
          <Label>Status</Label>
          <Select
            value={form.contact?.status || 'Ativo'}
            onValueChange={(v) => setForm({ ...form, contact: { ...form.contact, status: v as any }, active: v !== 'Cancelado' })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Ativo">Ativo</SelectItem>
              <SelectItem value="Inadimplente">Inadimplente</SelectItem>
              <SelectItem value="Cancelado">Cancelado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="modality">Modalidade</Label>
          <Input
            id="modality"
            value={form.contact?.modality || ''}
            onChange={(e) => setForm({ ...form, contact: { ...form.contact, modality: e.target.value } })}
            placeholder="Ex: Jiu-Jitsu Kids"
            required
          />
        </div>
        <div className="space-y-1">
          <Label>Faixa atual</Label>
          <Select
            value={form.current_belt || 'Branca'}
            onValueChange={(v) => setForm({ ...form, current_belt: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Branca">Branca</SelectItem>
              <SelectItem value="Azul">Azul</SelectItem>
              <SelectItem value="Roxa">Roxa</SelectItem>
              <SelectItem value="Marrom">Marrom</SelectItem>
              <SelectItem value="Preta">Preta</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="degree">Grau</Label>
          <Input
            id="degree"
            type="number"
            min={0}
            max={4}
            value={form.current_degree ?? 0}
            onChange={(e) => setForm({ ...form, current_degree: Number(e.target.value) })}
          />
        </div>
        <div className="md:col-span-2 space-y-1">
          <Label htmlFor="photo_url">Foto (URL)</Label>
          <Input
            id="photo_url"
            value={form.photo_url || ''}
            onChange={(e) => setForm({ ...form, photo_url: e.target.value })}
            className="mb-2"
          />
          <div className="flex items-center gap-3">
            <input type="file" accept="image/*" onChange={(e) => {
              const f = e.target.files?.[0] || null
              setFile(f)
              if (f) setPreview(URL.createObjectURL(f))
            }} />
            {preview && <img src={preview} alt="preview" className="h-16 w-16 object-cover rounded border border-border" />}
          </div>
        </div>
      </div>

      <div className="mt-6 flex gap-2">
        <Button type="submit" disabled={loading}>
          {loading ? 'Salvando...' : 'Salvar'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
