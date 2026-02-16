import React, { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import { Lock, Mail } from 'lucide-react'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const { refreshTenant } = useAuth()
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      if (!isSupabaseConfigured || !(supabase as any).auth?.signInWithPassword) {
        setError('Backend de autenticação não configurado.')
        return
      }

      const { data, error: err } = await (supabase as any).auth.signInWithPassword({ email, password })
      if (err || !data?.session) {
        setError('E-mail ou senha inválidos.')
        return
      }

      await refreshTenant()
      const from = (location.state as any)?.from?.pathname || '/dashboard'
      navigate(from, { replace: true })
    } catch (e: any) {
      setError(e?.message || 'Falha no login')
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="min-h-screen flex items-center justify-center bg-white text-black">
      <div className="w-full max-w-md p-6 border rounded">
        <h2 className="text-2xl font-bold mb-4">Entrar</h2>
        <form onSubmit={handleLogin} className="space-y-3">
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
          <button
            type="submit"
            disabled={loading}
            className="w-full px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
        <div className="mt-4 text-sm">
          Não tem conta? <Link to="/signup" className="text-blue-600 hover:underline">Criar conta</Link>
        </div>
      </div>
    </div>
  )
}
