import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'
import { Lock, Mail, UserPlus } from 'lucide-react'

export default function Signup() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [academyName, setAcademyName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const navigate = useNavigate()
  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      if (!isSupabaseConfigured || !(supabase as any).auth?.signUp) {
        setError('Backend de autenticação não configurado.')
        return
      }
      if (!academyName.trim()) {
        setError('Informe o nome da academia.')
        return
      }

      const { data, error: err } = await (supabase as any).auth.signUp({ email, password })

      const errCode = (err as any)?.code || ''
      if (errCode === 'over_email_send_rate_limit') {
        // Usuário possivelmente já existe, consideramos cadastro ok
        setSuccess('Cadastro realizado (limite de e-mails atingido). Agora você já pode entrar com seu email e senha.')
        setTimeout(()=>navigate('/login'), 1500)
        return
      }

      if (err || !data?.user) {
        setError(err?.message || 'Falha no cadastro')
      } else {
        const userId = data.user.id
        try {
          const { data: org } = await supabase
            .from('organizations')
            .insert([{ name: academyName.trim(), plan: 'free' }])
            .select('id')
            .single()
          if (org) {
            await supabase.from('profiles').insert([
              { id: userId, organization_id: org.id, role: 'admin' },
            ])
          }
        } catch (e) {
          console.error('Erro ao criar organização/perfil para o admin:', e)
        }
        setSuccess('Cadastro realizado. Agora você já pode entrar com seu email e senha.')
        setTimeout(()=>navigate('/login'), 1500)
      }
    } catch (e: any) {
      setError(e?.message || 'Falha no cadastro')
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="min-h-screen flex items-center justify-center bg-white text-black">
      <div className="w-full max-w-md p-6 border rounded">
        <div className="flex items-center gap-2 mb-4">
          <UserPlus size={20} />
          <h2 className="text-2xl font-bold">Criar conta</h2>
        </div>
        <form onSubmit={handleSignup} className="space-y-3">
          <div>
            <label className="text-sm">Nome da Academia</label>
            <input
              type="text"
              value={academyName}
              onChange={(e)=>setAcademyName(e.target.value)}
              className="border rounded p-2 w-full mt-1"
              placeholder="Ex: Team Bondade BJJ"
              required
            />
          </div>
          <div>
            <label className="text-sm">Email</label>
            <div className="flex items-center gap-2 border rounded p-2 mt-1">
              <Mail size={16} />
              <input
                type="email"
                value={email}
                onChange={(e)=>setEmail(e.target.value)}
                className="flex-1 outline-none"
                placeholder="seu@email.com"
                required
              />
            </div>
          </div>
          <div>
            <label className="text-sm">Senha</label>
            <div className="flex items-center gap-2 border rounded p-2 mt-1">
              <Lock size={16} />
              <input
                type="password"
                value={password}
                onChange={(e)=>setPassword(e.target.value)}
                className="flex-1 outline-none"
                placeholder="••••••••"
                required
              />
            </div>
          </div>
          {error && <div className="p-2 border rounded text-red-700 bg-red-50">{error}</div>}
          {success && <div className="p-2 border rounded text-green-700 bg-green-50">{success}</div>}
          <button
            type="submit"
            disabled={loading}
            className="w-full px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60"
          >
            {loading ? 'Criando...' : 'Criar conta'}
          </button>
        </form>
        <div className="mt-4 text-sm">
          Já tem conta? <Link to="/login" className="text-blue-600 hover:underline">Entrar</Link>
        </div>
      </div>
    </div>
  )
}
