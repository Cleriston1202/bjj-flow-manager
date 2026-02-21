import React, { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase, isSupabaseConfigured, consumeSessionExpiredMessage } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import { Lock, Mail } from 'lucide-react'

function mapLoginError(err: any) {
  const message = String(err?.message || '').toLowerCase()
  const status = Number(err?.status || 0)

  if (message.includes('email not confirmed')) {
    return 'Seu e-mail ainda não foi confirmado.'
  }
  if (message.includes('invalid login credentials') || message.includes('invalid_grant')) {
    return 'E-mail ou senha inválidos.'
  }
  if (status === 400) {
    return 'Não foi possível autenticar. Confira e-mail e senha.'
  }

  return err?.message || 'Falha no login'
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionNotice, setSessionNotice] = useState<string | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const { refreshTenant } = useAuth()

  useEffect(() => {
    const message = consumeSessionExpiredMessage()
    if (message) {
      setSessionNotice(message)
    }
  }, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      if (!isSupabaseConfigured || !(supabase as any).auth?.signInWithPassword) {
        setError('Backend de autenticação não configurado.')
        return
      }

      const safeEmail = email.trim().toLowerCase()
      const safePassword = password
      if (!safeEmail || !safePassword) {
        setError('Informe e-mail e senha.')
        return
      }

      const { data, error: err } = await (supabase as any).auth.signInWithPassword({
        email: safeEmail,
        password: safePassword,
      })
      if (err || !data?.session) {
        setError(mapLoginError(err))
        return
      }

      await refreshTenant()
      const from = (location.state as any)?.from?.pathname || '/dashboard'
      navigate(from, { replace: true })
    } catch (e: any) {
      setError(mapLoginError(e))
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="min-h-screen flex items-center justify-center bg-white text-black">
      <div className="w-full max-w-md p-6 border rounded">
        <h2 className="text-2xl font-bold mb-4">Entrar</h2>
        {sessionNotice && (
          <div className="mb-3 rounded border border-blue-200 bg-blue-50 p-3 text-sm leading-5 text-blue-800">
            {sessionNotice}
          </div>
        )}
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
          <div className="text-sm text-right">
            <Link to="/forgot-password" className="text-blue-600 hover:underline">Esqueci minha senha</Link>
          </div>
        </form>
        <div className="mt-4 text-sm">
          Não tem conta? <Link to="/signup" className="text-blue-600 hover:underline">Criar conta</Link>
        </div>
      </div>
    </div>
  )
}
