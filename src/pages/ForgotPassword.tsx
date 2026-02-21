import React, { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'

export default function ForgotPassword() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [cpf, setCpf] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [resetToken, setResetToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [emailLinkSent, setEmailLinkSent] = useState(false)
  const [recoveryMode, setRecoveryMode] = useState(false)

  useEffect(() => {
    async function initRecoveryFromUrl() {
      if (typeof window === 'undefined') return
      if (!isSupabaseConfigured || !(supabase as any).auth) return

      const query = new URLSearchParams(window.location.search)
      const hashRaw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
      const hash = new URLSearchParams(hashRaw)
      const type = hash.get('type') || query.get('type') || ''
      const isRecoveryLike =
        type === 'recovery' ||
        !!query.get('token_hash') ||
        !!hash.get('token_hash') ||
        !!query.get('token') ||
        !!hash.get('token') ||
        !!hash.get('access_token') ||
        !!query.get('access_token') ||
        !!query.get('code') ||
        !!hash.get('code')

      try {
        const accessToken = hash.get('access_token')
        const refreshToken = hash.get('refresh_token')
        if (isRecoveryLike && accessToken && refreshToken && (supabase as any).auth?.setSession) {
          const { error: setSessionErr } = await (supabase as any).auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })
          if (setSessionErr) {
            setError(setSessionErr.message || 'Link de recuperação inválido ou expirado.')
            return
          }

          setRecoveryMode(true)
          setEmailLinkSent(false)
          setError(null)
          setSuccess('Link validado. Defina sua nova senha abaixo.')
          window.history.replaceState({}, document.title, '/forgot-password')
          return
        }

        const code = query.get('code')
        if (isRecoveryLike && code && (supabase as any).auth?.exchangeCodeForSession) {
          const { error: exchangeErr } = await (supabase as any).auth.exchangeCodeForSession(code)
          if (exchangeErr) {
            setError(exchangeErr.message || 'Link de recuperação inválido ou expirado.')
            return
          }

          setRecoveryMode(true)
          setEmailLinkSent(false)
          setError(null)
          setSuccess('Link validado. Defina sua nova senha abaixo.')
          window.history.replaceState({}, document.title, '/forgot-password')
          return
        }

        const tokenHash = query.get('token_hash') || hash.get('token_hash') || query.get('token') || hash.get('token')
        if (isRecoveryLike && tokenHash && (supabase as any).auth?.verifyOtp) {
          const { error: verifyErr } = await (supabase as any).auth.verifyOtp({
            type: 'recovery',
            token_hash: tokenHash,
          })
          if (verifyErr) {
            setError(verifyErr.message || 'Link de recuperação inválido ou expirado.')
            return
          }

          setRecoveryMode(true)
          setEmailLinkSent(false)
          setError(null)
          setSuccess('Link validado. Defina sua nova senha abaixo.')
          window.history.replaceState({}, document.title, '/forgot-password')
        }
      } catch (e: any) {
        setError(e?.message || 'Não foi possível validar o link de recuperação.')
      }
    }

    initRecoveryFromUrl()
  }, [location.search, location.hash])

  async function parseApiResponse(res: Response) {
    const contentType = res.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      return res.json()
    }
    const text = await res.text()
    return { error: text || 'Resposta inválida do servidor.' }
  }

  async function handleValidateIdentity(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const safeEmail = email.trim().toLowerCase()
      const safeCpf = cpf.trim()

      if (!safeEmail) {
        setError('Informe seu e-mail.')
        return
      }

      if (!safeCpf) {
        if (!isSupabaseConfigured || !(supabase as any).auth?.resetPasswordForEmail) {
          setError('Recuperação por e-mail não está configurada.')
          return
        }

        const redirectTo = `${window.location.origin}/forgot-password`
        const { error: resetEmailErr } = await (supabase as any).auth.resetPasswordForEmail(safeEmail, { redirectTo })
        if (resetEmailErr) {
          setError(resetEmailErr.message || 'Não foi possível enviar o e-mail de recuperação.')
          return
        }

        setEmailLinkSent(true)
        setSuccess('Enviamos um link de recuperação para seu e-mail. Abra o link para redefinir a senha.')
        return
      }

      const res = await fetch('/api/forgotPassword', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'validate', email: safeEmail, cpf: safeCpf }),
      })
      const json = await parseApiResponse(res)
      if (!res.ok || !json?.resetToken) {
        setError(json?.error || 'Não foi possível validar seus dados agora. Verifique se a API está ativa.')
        return
      }
      setResetToken(json.resetToken)
    } catch (err: any) {
      setError(err?.message || 'Erro ao validar dados.')
    } finally {
      setLoading(false)
    }
  }

  async function handleUpdatePassword(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      if (!resetToken && !recoveryMode) {
        setError('Valide os dados antes de atualizar a senha.')
        return
      }
      if (!newPassword || !confirmPassword) {
        setError('Preencha os campos de senha.')
        return
      }
      if (newPassword !== confirmPassword) {
        setError('As senhas não conferem.')
        return
      }

      if (recoveryMode) {
        if (!isSupabaseConfigured || !(supabase as any).auth?.updateUser) {
          setError('Recuperação por e-mail não está configurada.')
          return
        }

        const { error: updateErr } = await (supabase as any).auth.updateUser({ password: newPassword })
        if (updateErr) {
          setError(updateErr.message || 'Erro ao atualizar senha.')
          return
        }

        setSuccess('Senha atualizada com sucesso! Redirecionando para o login...')
        setTimeout(() => {
          navigate('/login')
        }, 2000)
        return
      }

      const res = await fetch('/api/forgotPassword', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset', resetToken, newPassword }),
      })
      const json = await parseApiResponse(res)

      if (!res.ok) {
        setError(json.error || 'Erro ao atualizar senha.')
        return
      }

      setSuccess('Senha atualizada com sucesso! Redirecionando para o login...')
      setTimeout(() => {
        navigate('/login')
      }, 2000)
    } catch (err: any) {
      setError(err?.message || 'Erro ao atualizar senha.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white text-black">
      <div className="w-full max-w-md p-6 border rounded">
        <h2 className="text-2xl font-bold mb-4">Esqueci minha senha</h2>

        {!resetToken && !emailLinkSent && !recoveryMode ? (
          <form onSubmit={handleValidateIdentity} className="space-y-3">
            <div>
              <label className="text-sm">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="border rounded p-2 w-full mt-1"
                placeholder="seu@email.com"
                required
              />
            </div>
            <div>
              <label className="text-sm">CPF (opcional para conta admin)</label>
              <input
                value={cpf}
                onChange={(e) => setCpf(e.target.value)}
                className="border rounded p-2 w-full mt-1"
                placeholder="000.000.000-00"
              />
            </div>
            <p className="text-xs text-gray-600">
              Se sua conta foi criada na tela "Criar conta", você pode validar apenas com o e-mail.
            </p>
            {error && <div className="p-2 border rounded text-red-700 bg-red-50">{error}</div>}
            {success && <div className="p-2 border rounded text-green-700 bg-green-50">{success}</div>}
            <button
              type="submit"
              disabled={loading}
              className="w-full px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60"
            >
              {loading ? 'Validando...' : 'Validar dados'}
            </button>
          </form>
        ) : emailLinkSent ? (
          <div className="space-y-3">
            {success && <div className="p-2 border rounded text-green-700 bg-green-50">{success}</div>}
            {error && <div className="p-2 border rounded text-red-700 bg-red-50">{error}</div>}
            <div className="text-sm text-gray-700">
              Se não encontrar o e-mail, verifique a caixa de spam/lixo eletrônico.
            </div>
          </div>
        ) : (
          <form onSubmit={handleUpdatePassword} className="space-y-3">
            <div className="p-2 border rounded bg-green-50 text-green-700 text-sm">
              {recoveryMode ? 'Link validado. Defina sua nova senha.' : 'Dados validados. Defina sua nova senha.'}
            </div>
            <div>
              <label className="text-sm">Nova senha</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="border rounded p-2 w-full mt-1"
                minLength={6}
                required
              />
            </div>
            <div>
              <label className="text-sm">Confirmar nova senha</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="border rounded p-2 w-full mt-1"
                minLength={6}
                required
              />
            </div>
            {error && <div className="p-2 border rounded text-red-700 bg-red-50">{error}</div>}
            {success && <div className="p-2 border rounded text-green-700 bg-green-50">{success}</div>}
            <button
              type="submit"
              disabled={loading}
              className="w-full px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60"
            >
              {loading ? 'Atualizando...' : 'Atualizar senha'}
            </button>
          </form>
        )}

        <div className="mt-4 text-sm">
          <Link to="/login" className="text-blue-600 hover:underline">Voltar para o login</Link>
        </div>
      </div>
    </div>
  )
}
