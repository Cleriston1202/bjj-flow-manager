import { createClient } from '@supabase/supabase-js'

type EnvRecord = Record<string, string | undefined>

// Lê variáveis de ambiente tanto em Next (process.env.NEXT_PUBLIC_*) quanto em Vite (import.meta.env.VITE_*)
function getSupabaseEnv() {
  let url: string | undefined
  let anonKey: string | undefined

  // Next.js (process.env.NEXT_PUBLIC_*)
  if (typeof process !== 'undefined' && (process as any).env) {
    const nodeEnv = (process as any).env as EnvRecord
    url = nodeEnv.NEXT_PUBLIC_SUPABASE_URL || url
    anonKey = nodeEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY || anonKey
  }

  // Vite (import.meta.env.VITE_*)
  try {
    const viteEnv = (import.meta as any).env as EnvRecord | undefined
    if (viteEnv) {
      url = url || viteEnv.VITE_SUPABASE_URL
      anonKey = anonKey || viteEnv.VITE_SUPABASE_ANON_KEY
    }
  } catch {
    // ignore quando import.meta não existe (Next em runtime)
  }

  return {
    supabaseUrl: url || '',
    supabaseAnonKey: anonKey || '',
  }
}

const { supabaseUrl, supabaseAnonKey } = getSupabaseEnv()

export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey)

// Flags usados para diferenciar logout manual de expiração e para evitar múltiplos alerts
const MANUAL_LOGOUT_FLAG = 'bondade_manual_logout'
const SESSION_EXPIRED_FLAG = 'bondade_session_expired'
const SESSION_EXPIRED_MESSAGE_KEY = 'bondade_session_expired_message'

function makeStub() {
  const stubQuery = {
    select: async () => ({ data: [], error: { message: 'Supabase não configurado' } }),
    insert: async () => ({ data: [], error: { message: 'Supabase não configurado' } }),
    update: async () => ({ error: { message: 'Supabase não configurado' } }),
    delete: async () => ({ error: { message: 'Supabase não configurado' } }),
    eq: () => stubQuery,
    ilike: () => stubQuery,
    order: () => stubQuery,
    limit: () => stubQuery,
    single: async () => ({ data: null, error: { message: 'Supabase não configurado' } }),
  }
  return {
    from: (_: string) => stubQuery,
    storage: {
      from: (_: string) => ({
        upload: async () => ({ error: { message: 'Supabase não configurado' } }),
        getPublicUrl: (_: string) => ({ data: { publicUrl: '' } }),
      }),
    },
  } as any
}

export const supabase: any =
  (supabaseUrl && supabaseAnonKey)
    ? createClient(supabaseUrl, supabaseAnonKey)
    : makeStub()

function isAuthErrorLike(error: any): boolean {
  if (!error) return false
  const message = String((error as any).message || (error as any).msg || '').toLowerCase()
  const code = String((error as any).code ?? (error as any).status ?? '')
  if (!message && !code) return false
  const keywords = ['jwt expired', 'invalid token', 'invalid jwt', 'unauthenticated', 'auth error', 'token has expired']
  const matchKeyword = keywords.some(k => message.includes(k))
  const is401 = code === '401'
  return matchKeyword || is401
}

export function markManualLogout() {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(MANUAL_LOGOUT_FLAG, '1')
  } catch {
    // ignore storage errors
  }
}

export function wasManualLogout(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const value = window.sessionStorage.getItem(MANUAL_LOGOUT_FLAG)
    if (value) {
      window.sessionStorage.removeItem(MANUAL_LOGOUT_FLAG)
      return true
    }
  } catch {
    // ignore storage errors
  }
  return false
}

export function clearSessionExpiredFlag() {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(SESSION_EXPIRED_FLAG)
    window.sessionStorage.removeItem(SESSION_EXPIRED_MESSAGE_KEY)
  } catch {
    // ignore storage errors
  }
}

export function markSessionExpiredMessage(message?: string) {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(SESSION_EXPIRED_FLAG, '1')
    window.sessionStorage.setItem(
      SESSION_EXPIRED_MESSAGE_KEY,
      message || 'Sua sessão expirou. Entre novamente para continuar.'
    )
  } catch {
    // ignore storage errors
  }
}

export function consumeSessionExpiredMessage(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const message = window.sessionStorage.getItem(SESSION_EXPIRED_MESSAGE_KEY)
    if (message) {
      window.sessionStorage.removeItem(SESSION_EXPIRED_MESSAGE_KEY)
      return message
    }
  } catch {
    // ignore storage errors
  }
  return null
}

// Tratamento centralizado de erros de autenticação vindos do Supabase
// Retorna true se tratou o erro (logout + redirecionamento)
export function handleSupabaseAuthError(error: any): boolean {
  if (!isSupabaseConfigured) return false
  if (!isAuthErrorLike(error)) return false

  if (typeof window !== 'undefined') {
    try {
      const alreadyHandled = window.sessionStorage.getItem(SESSION_EXPIRED_FLAG) === '1'
      if (alreadyHandled) return true
      markSessionExpiredMessage('Sua sessão expirou. Faça login novamente para continuar no app.')
    } catch {
      // ignore storage errors
    }
  }

  try {
    if ((supabase as any).auth?.signOut) {
      ;(supabase as any).auth.signOut()
    }
  } catch {
    // ignore signOut errors
  }

  if (typeof window !== 'undefined') {
    window.location.href = '/login'
  }

  return true
}

