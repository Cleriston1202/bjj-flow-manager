import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

function getSupabaseUrl() {
  return process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
}

function getValidateKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
}

function getResetConfig() {
  const SUPABASE_URL = getSupabaseUrl()
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  const RESET_TOKEN_SECRET = process.env.RESET_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RESET_TOKEN_SECRET) {
    throw new Error('Configuração ausente: SUPABASE_SERVICE_ROLE_KEY (e opcionalmente RESET_TOKEN_SECRET).')
  }
  return { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESET_TOKEN_SECRET }
}

function normalizeEmail(value: string) {
  return String(value || '').trim().toLowerCase()
}

function normalizeCpf(value: string) {
  return String(value || '').replace(/\D/g, '')
}

function signPayload(payload: Record<string, any>, secret: string) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${signature}`
}

function verifyPayload(token: string, secret: string) {
  const [body, signature] = String(token || '').split('.')
  if (!body || !signature) return null

  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  if (expected !== signature) return null

  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

async function findUserIdByEmail(supabase: any, email: string) {
  const normalized = normalizeEmail(email)
  if (!normalized) return null

  let page = 1
  const perPage = 200
  while (page <= 5) {
    const { data, error } = await (supabase as any).auth.admin.listUsers({ page, perPage })
    if (error) throw error

    const users = data?.users || []
    const found = users.find((u: any) => normalizeEmail(u?.email || '') === normalized)
    if (found?.id) return found.id

    if (users.length < perPage) break
    page += 1
  }

  return null
}

async function findAdminProfileByUserId(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, organization_id')
    .eq('id', userId)
    .maybeSingle()

  if (error || !data) return null
  const role = String(data.role || '').toLowerCase()
  if (role && role !== 'admin') return null
  return data
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { action } = req.body || {}
  if (!action) {
    res.status(400).json({ error: 'action is required' })
    return
  }

  try {
    if (action === 'validate') {
      const SUPABASE_URL = getSupabaseUrl()
      const key = getValidateKey()
      const RESET_TOKEN_SECRET = process.env.RESET_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
      if (!SUPABASE_URL || !key || !RESET_TOKEN_SECRET) {
        res.status(500).json({ error: 'Configuração ausente para validação de senha.' })
        return
      }

      const supabase = createClient(SUPABASE_URL, key)
      const email = normalizeEmail(String(req.body?.email || ''))
      const cpf = normalizeCpf(String(req.body?.cpf || ''))
      if (!email) {
        res.status(400).json({ error: 'Email é obrigatório.' })
        return
      }

      if (!cpf) {
        if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
          res.status(500).json({ error: 'Para recuperar senha sem CPF (conta admin), configure SUPABASE_SERVICE_ROLE_KEY no servidor.' })
          return
        }

        const userId = (await findUserIdByEmail(supabase, email)) || ''
        if (!userId) {
          res.status(400).json({ error: 'Conta não encontrada para este e-mail.' })
          return
        }

        const adminProfile = await findAdminProfileByUserId(supabase, userId)
        if (!adminProfile) {
          res.status(400).json({ error: 'Conta encontrada, mas não é admin. Para aluno, informe CPF junto com o e-mail.' })
          return
        }

        const exp = Date.now() + 10 * 60 * 1000
        const resetToken = signPayload({ uid: userId, exp }, RESET_TOKEN_SECRET)
        res.status(200).json({ success: true, resetToken })
        return
      }

      const { data: students, error: studentErr } = await supabase
        .from('students')
        .select('*')
        .ilike('contact->>email', email)
        .limit(20)

      if (studentErr) {
        res.status(500).json({ error: 'Erro ao validar os dados.' })
        return
      }

      const matched = (students || []).find((row: any) => {
        const rowCpf = normalizeCpf(String(row?.contact?.cpf || ''))
        return rowCpf && rowCpf === cpf
      })

      if (!matched) {
        res.status(400).json({ error: 'Dados não conferem' })
        return
      }

      const contact = (matched.contact || {}) as Record<string, any>
      let userId = String(matched.auth_user_id || contact.auth_user_id || '').trim()
      if (!userId && !!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        userId = (await findUserIdByEmail(supabase, email)) || ''
      }

      if (!userId) {
        res.status(400).json({ error: 'Dados conferem, mas o vínculo de autenticação do aluno não foi encontrado.' })
        return
      }

      const exp = Date.now() + 10 * 60 * 1000
      const resetToken = signPayload({ uid: userId, sid: matched.id, exp }, RESET_TOKEN_SECRET)
      res.status(200).json({ success: true, resetToken })
      return
    }

    if (action === 'reset') {
      const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESET_TOKEN_SECRET } = getResetConfig()
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
      const token = String(req.body?.resetToken || '')
      const newPassword = String(req.body?.newPassword || '')

      if (!token || !newPassword) {
        res.status(400).json({ error: 'resetToken e newPassword são obrigatórios.' })
        return
      }

      if (newPassword.length < 6) {
        res.status(400).json({ error: 'A nova senha deve ter ao menos 6 caracteres.' })
        return
      }

      const payload = verifyPayload(token, RESET_TOKEN_SECRET)
      if (!payload?.uid || !payload?.exp || Date.now() > Number(payload.exp)) {
        res.status(400).json({ error: 'Token inválido ou expirado. Revalide seus dados.' })
        return
      }

      const { error: updateErr } = await (supabase as any).auth.admin.updateUserById(String(payload.uid), {
        password: newPassword,
      })

      if (updateErr) {
        res.status(500).json({ error: updateErr.message || 'Erro ao atualizar senha.' })
        return
      }

      res.status(200).json({ success: true })
      return
    }

    res.status(400).json({ error: 'Ação inválida.' })
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Erro interno no reset de senha.' })
  }
}
