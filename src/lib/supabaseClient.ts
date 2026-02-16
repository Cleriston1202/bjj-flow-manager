import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey)

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
