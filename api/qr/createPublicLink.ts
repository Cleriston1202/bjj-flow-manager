import { createClient } from '@supabase/supabase-js'
import { createHmac } from 'crypto'

function getBaseUrl(req: any) {
  const explicit = process.env.NEXT_PUBLIC_APP_BASE_URL || ''
  if (explicit) return explicit.replace(/\/$/, '')

  const host = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '')
  const proto = String(req.headers?.['x-forwarded-proto'] || 'https')
  if (host) return `${proto}://${host}`

  return 'http://localhost:3000'
}

function getConfig() {
  const SUPABASE_URL =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL
  const SUPABASE_SERVER_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY
  const QR_PUBLIC_TOKEN_SECRET = process.env.QR_PUBLIC_TOKEN_SECRET || SUPABASE_SERVER_KEY

  if (!SUPABASE_URL || !SUPABASE_SERVER_KEY || !QR_PUBLIC_TOKEN_SECRET) {
    throw new Error('Configuração ausente para gerar link público de QR')
  }

  return { SUPABASE_URL, SUPABASE_SERVER_KEY, QR_PUBLIC_TOKEN_SECRET }
}

function signPayload(payload: Record<string, any>, secret: string) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${signature}`
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const { studentId, expiresInDays } = req.body || {}
    if (!studentId) {
      res.status(400).json({ error: 'studentId is required' })
      return
    }

    const { SUPABASE_URL, SUPABASE_SERVER_KEY, QR_PUBLIC_TOKEN_SECRET } = getConfig()
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVER_KEY)

    // Validação de existência é opcional para evitar falha por permissões em ambientes sem service role.
    try {
      const { data: student } = await supabase
        .from('students')
        .select('id')
        .eq('id', studentId)
        .maybeSingle()

      if (!student) {
        res.status(404).json({ error: 'Aluno não encontrado para gerar link.' })
        return
      }
    } catch {
      // segue com geração do token; a validação final ocorre em /api/qr/publicStudent
    }

    const days = Number(expiresInDays)
    const safeDays = Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 180
    const exp = Date.now() + safeDays * 24 * 60 * 60 * 1000

    const token = signPayload({ sid: studentId, exp }, QR_PUBLIC_TOKEN_SECRET)
    const baseUrl = getBaseUrl(req)
    const publicUrl = `${baseUrl}/meu-qr?t=${encodeURIComponent(token)}`

    res.status(200).json({ success: true, token, publicUrl, expiresAt: new Date(exp).toISOString() })
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Erro ao gerar link público do QR.' })
  }
}
