import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured, handleSupabaseAuthError, wasManualLogout, clearSessionExpiredFlag, markSessionExpiredMessage } from './supabaseClient'

export interface TenantInfo {
  organizationId: string
  organizationName: string
  logoUrl?: string | null
  plan: 'free' | 'pro'
}

export interface AuthContextValue {
  user: any | null
  loading: boolean
  tenant: TenantInfo | null
  refreshTenant: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any | null>(null)
  const [tenant, setTenant] = useState<TenantInfo | null>(null)
  const [loading, setLoading] = useState(true)

  async function loadSession() {
    if (!isSupabaseConfigured || !(supabase as any).auth) {
      setUser(null)
      setTenant(null)
      setLoading(false)
      return
    }
    try {
      const { data, error } = await (supabase as any).auth.getSession()
      if (error) {
        handleSupabaseAuthError(error)
        setUser(null)
        setTenant(null)
        setLoading(false)
        return
      }
      const session = data?.session
      setUser(session?.user ?? null)
      if (session?.user) {
        await loadTenantForUser(session.user.id)
        clearSessionExpiredFlag()
      } else {
        setTenant(null)
      }
      setLoading(false)
    } catch (e: any) {
      console.error('Erro ao carregar sessão Supabase', e)
      setUser(null)
      setTenant(null)
      setLoading(false)
    }
  }

  async function loadTenantForUser(userId: string) {
    if (!isSupabaseConfigured) return
    try {
      // Tenta carregar o profile do usuário
      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('id, organization_id')
        .eq('id', userId)
        .maybeSingle()

      if (profileErr) {
        if (!handleSupabaseAuthError(profileErr)) {
          console.error('Erro ao carregar profile do usuário', profileErr)
        }
        setTenant(null)
        return
      }

      let organizationId = profile?.organization_id as string | null | undefined

      // Se não houver organization ligada, criamos uma automaticamente e ligamos o usuário a ela
      if (!organizationId) {
        const { data: org, error: orgErr } = await supabase
          .from('organizations')
          .insert([{ name: 'Minha Academia', plan: 'free' }])
          .select('id')
          .single()

        if (orgErr || !org) {
          if (orgErr) {
            if (!handleSupabaseAuthError(orgErr)) {
              console.error('Erro ao criar organização padrão para o usuário', orgErr)
            }
          }
          setTenant(null)
          return
        }

        organizationId = org.id

        if (profile) {
          const { error: updateProfileErr } = await supabase
            .from('profiles')
            .update({ organization_id: organizationId })
            .eq('id', userId)
          if (updateProfileErr) {
            if (!handleSupabaseAuthError(updateProfileErr)) {
              console.error('Erro ao atualizar profile do usuário', updateProfileErr)
            }
            setTenant(null)
            return
          }
        } else {
          const { error: insertProfileErr } = await supabase
            .from('profiles')
            .insert([{ id: userId, organization_id: organizationId, role: 'admin' }])
          if (insertProfileErr) {
            if (!handleSupabaseAuthError(insertProfileErr)) {
              console.error('Erro ao criar profile do usuário', insertProfileErr)
            }
            setTenant(null)
            return
          }
        }
      }

      const { data: orgRow, error: orgFetchErr } = await supabase
        .from('organizations')
        .select('id, name, logo_url, plan')
        .eq('id', organizationId)
        .maybeSingle()

      if (!orgRow || orgFetchErr) {
        if (orgFetchErr) {
          if (!handleSupabaseAuthError(orgFetchErr)) {
            console.error('Erro ao carregar organização do tenant', orgFetchErr)
          }
        }
        setTenant(null)
        return
      }

      setTenant({
        organizationId: orgRow.id,
        organizationName: orgRow.name,
        logoUrl: orgRow.logo_url,
        plan: (orgRow.plan as 'free' | 'pro') ?? 'free',
      })
    } catch (e) {
      console.error('Erro ao carregar tenant', e)
      setTenant(null)
    }
  }

  useEffect(() => {
    loadSession()
    if (isSupabaseConfigured && (supabase as any).auth) {
      const { data: listener } = (supabase as any).auth.onAuthStateChange((event: any, session: any) => {
        setUser(session?.user ?? null)
        if (session?.user?.id) {
          loadTenantForUser(session.user.id)
          clearSessionExpiredFlag()
        } else {
          setTenant(null)
        }

        // Se a sessão terminou (SIGNED_OUT ou session nula) garantimos redirecionamento para /login
        if (event === 'SIGNED_OUT' || !session) {
          if (typeof window !== 'undefined') {
            try {
              window.localStorage.removeItem('session_started_at')
            } catch {
              // ignore storage errors
            }

            const manual = wasManualLogout()
            if (!manual && window.location.pathname !== '/login') {
              markSessionExpiredMessage('Sua sessão expirou por segurança. Faça login novamente para continuar.')
              window.location.href = '/login'
            }
          }
        }
      })
      return () => {
        listener?.subscription?.unsubscribe?.()
      }
    }
  }, [])

  const value: AuthContextValue = {
    user,
    loading,
    tenant,
    refreshTenant: async () => {
      if (user?.id) await loadTenantForUser(user.id)
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
