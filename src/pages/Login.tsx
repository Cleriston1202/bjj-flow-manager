import React, { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase, isSupabaseConfigured, consumeSessionExpiredMessage } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import { Lock, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

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
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Entrar</CardTitle>
        </CardHeader>
        <CardContent>
          {sessionNotice && (
            <div className="mb-4 rounded border border-blue-500/40 bg-blue-500/10 p-3 text-sm text-blue-300">
              {sessionNotice}
            </div>
          )}
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9"
                  placeholder="seu@email.com"
                  required
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">Senha</Label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>
            {error && (
              <div className="rounded border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive">
                {error}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Entrando...' : 'Entrar'}
            </Button>
            <div className="text-sm text-right">
              <Link to="/forgot-password" className="text-primary hover:underline">
                Esqueci minha senha
              </Link>
            </div>
          </form>
          <div className="mt-4 text-sm text-muted-foreground">
            Não tem conta?{' '}
            <Link to="/signup" className="text-primary hover:underline">
              Criar conta
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
