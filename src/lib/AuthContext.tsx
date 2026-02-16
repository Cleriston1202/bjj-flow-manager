import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from './supabaseClient'

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
    const { data: { session } } = await (supabase as any).auth.getSession()
    setUser(session?.user ?? null)
    if (session?.user) {
      await loadTenantForUser(session.user.id)
    }
    setLoading(false)
  }

  async function loadTenantForUser(userId: string) {
    if (!isSupabaseConfigured) return
    try {
      // Tenta carregar o profile do usuário
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, organization_id')
        .eq('id', userId)
        .maybeSingle()

      let organizationId = profile?.organization_id as string | null | undefined

      // Se não houver organization ligada, criamos uma automaticamente e ligamos o usuário a ela
      if (!organizationId) {
        const { data: org, error: orgErr } = await supabase
          .from('organizations')
          .insert([{ name: 'Minha Academia', plan: 'free' }])
          .select('id')
          .single()

        if (orgErr || !org) {
          console.error('Erro ao criar organização padrão para o usuário', orgErr)
          setTenant(null)
          return
        }

        organizationId = org.id

        if (profile) {
          await supabase
            .from('profiles')
            .update({ organization_id: organizationId })
            .eq('id', userId)
        } else {
          await supabase
            .from('profiles')
            .insert([{ id: userId, organization_id: organizationId, role: 'admin' }])
        }
      }

      const { data: orgRow, error: orgFetchErr } = await supabase
        .from('organizations')
        .select('id, name, logo_url, plan')
        .eq('id', organizationId)
        .maybeSingle()

      if (!orgRow || orgFetchErr) {
        console.error('Erro ao carregar organização do tenant', orgFetchErr)
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
      const { data: listener } = (supabase as any).auth.onAuthStateChange((_event: any, session: any) => {
        setUser(session?.user ?? null)
        if (session?.user?.id) loadTenantForUser(session.user.id)
        else setTenant(null)
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
