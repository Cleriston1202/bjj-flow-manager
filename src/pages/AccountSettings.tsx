import React, { useState } from 'react'
import { supabase, handleSupabaseAuthError } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import { Upload, Save } from 'lucide-react'

export default function AccountSettings() {
  const { tenant, refreshTenant } = useAuth()
  const [name, setName] = useState(tenant?.organizationName || '')
  const [plan, setPlan] = useState<'free' | 'pro'>(tenant?.plan || 'free')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      if (!tenant) {
        throw new Error('Dados da conta não carregados. Faça login novamente.')
      }
      let logoUrl = tenant.logoUrl || null
      if (logoFile) {
        const ext = logoFile.name.split('.').pop()
        const path = `public/logos/${tenant.organizationId}.${ext}`
        const { error: upErr } = await supabase.storage.from('avatars').upload(path, logoFile, { upsert: true })
        if (upErr) {
          if (handleSupabaseAuthError(upErr)) {
            return
          }
          throw upErr
        }
        const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
        logoUrl = urlData.publicUrl
      }

      const { error } = await supabase
        .from('organizations')
        .update({ name, plan, logo_url: logoUrl })
        .eq('id', tenant.organizationId)
      if (error) {
        if (handleSupabaseAuthError(error)) {
          return
        }
        throw error
      }
      await refreshTenant()
      setMessage('Configurações salvas com sucesso.')
    } catch (err: any) {
      setMessage(err.message || 'Erro ao salvar configurações.')
    } finally {
      setSaving(false)
    }
  }

  const appBaseUrl = ((): string => {
    if (typeof window !== 'undefined') return window.location.origin
    const fromEnv = (() => {
      const nodeProcess = (globalThis as any).process as { env?: Record<string, string | undefined> } | undefined
      if (nodeProcess?.env) {
        return nodeProcess.env.NEXT_PUBLIC_APP_BASE_URL || nodeProcess.env.VITE_APP_BASE_URL
      }
      return undefined
    })()
    return fromEnv || 'https://app.seusaas.com'
  })()

  const checkinUrl = tenant ? `${appBaseUrl}/checkin/${tenant.organizationId}` : ''

  return (
    <div className="max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">Configurações da Conta</h2>
      {message && <div className="mb-3 p-2 border rounded text-sm">{message}</div>}
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Nome da academia</label>
          <input
            className="border rounded p-2 w-full"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Plano</label>
          <select
            className="border rounded p-2 w-full"
            value={plan}
            onChange={e => setPlan(e.target.value as 'free' | 'pro')}
          >
            <option value="free">Grátis - até 10 alunos</option>
            <option value="pro">Pro - Alunos ilimitados + QR Code avançado</option>
          </select>
          <p className="text-xs text-gray-500 mt-1">(Integração real de cobrança pode ser conectada aqui depois)</p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Logo da academia</label>
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded bg-gray-100 overflow-hidden flex items-center justify-center">
              {tenant?.logoUrl ? (
                <img src={tenant.logoUrl} alt="Logo" className="h-full w-full object-cover" />
              ) : (
                <span className="text-xs text-gray-400">Sem logo</span>
              )}
            </div>
            <label className="inline-flex items-center gap-2 px-3 py-2 border rounded cursor-pointer bg-white hover:bg-gray-50">
              <Upload size={16} />
              <span className="text-sm">Escolher arquivo</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => setLogoFile(e.target.files?.[0] || null)}
              />
            </label>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">URL de Check-in dos alunos</label>
          <div className="text-xs text-blue-700 break-all border rounded p-2 bg-blue-50">{checkinUrl}</div>
          <p className="text-xs text-gray-500 mt-1">Use esta URL em um tablet ou TV na recepção para o check-in via QR.</p>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 rounded bg-primary text-white disabled:opacity-60"
        >
          <Save size={16} /> {saving ? 'Salvando...' : 'Salvar alterações'}
        </button>
      </form>
    </div>
  )
}
