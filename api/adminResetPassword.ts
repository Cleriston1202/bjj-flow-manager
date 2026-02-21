import { createClient } from '@supabase/supabase-js'

function getServerConfig() {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase keys not configured on server')
  }
  return { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY }
}

function normalizeEmail(value: string) {
  return String(value || '').trim().toLowerCase()
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

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { studentId, newPassword } = req.body || {}
  if (!studentId || !newPassword) {
    res.status(400).json({ error: 'studentId and newPassword are required' })
    return
  }

  if (String(newPassword).length < 6) {
    res.status(400).json({ error: 'A senha temporária deve ter ao menos 6 caracteres.' })
    return
  }

  try {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getServerConfig()
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    const authHeader = String(req.headers?.authorization || '')
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (!token) {
      res.status(401).json({ error: 'Não autenticado.' })
      return
    }

    const { data: callerData, error: callerErr } = await (supabase as any).auth.getUser(token)
    if (callerErr || !callerData?.user?.id) {
      res.status(401).json({ error: 'Sessão inválida.' })
      return
    }

    const callerId = callerData.user.id
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('organization_id, role')
      .eq('id', callerId)
      .maybeSingle()

    if (profileErr || !profile?.organization_id) {
      res.status(403).json({ error: 'Sem permissão para reset manual.' })
      return
    }

    const role = String(profile.role || '').toLowerCase()
    if (role && role !== 'admin') {
      res.status(403).json({ error: 'Apenas admins podem resetar senha.' })
      return
    }

    const { data: student, error: studentErr } = await supabase
      .from('students')
      .select('*')
      .eq('id', studentId)
      .maybeSingle()

    if (studentErr || !student) {
      res.status(404).json({ error: 'Aluno não encontrado.' })
      return
    }

    if (student.organization_id !== profile.organization_id) {
      res.status(403).json({ error: 'Aluno fora da sua organização.' })
      return
    }

    const contact = (student.contact || {}) as Record<string, any>
    const email = normalizeEmail(String(contact.email || ''))

    let userId = String(student.auth_user_id || contact.auth_user_id || '').trim()
    if (!userId && email) {
      userId = (await findUserIdByEmail(supabase, email)) || ''
    }

    if (!userId) {
      res.status(400).json({ error: 'Não foi possível localizar o usuário de autenticação deste aluno.' })
      return
    }

    const { error: updateErr } = await (supabase as any).auth.admin.updateUserById(userId, {
      password: String(newPassword),
    })

    if (updateErr) {
      res.status(500).json({ error: updateErr.message || 'Erro ao atualizar senha.' })
      return
    }

    res.status(200).json({ success: true })
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Erro interno no reset manual.' })
  }
}
