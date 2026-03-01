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
  const QR_PUBLIC_TOKEN_SECRET =
    process.env.QR_PUBLIC_TOKEN_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY

  if (!QR_PUBLIC_TOKEN_SECRET) {
    throw new Error('Configuração ausente para gerar link público de QR')
  }

  return { QR_PUBLIC_TOKEN_SECRET }
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
    const { studentId, expiresInDays, studentSnapshot } = req.body || {}
    if (!studentId) {
      res.status(400).json({ error: 'studentId is required' })
      return
    }

    const { QR_PUBLIC_TOKEN_SECRET } = getConfig()

    const days = Number(expiresInDays)
    const safeDays = Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 180
    const exp = Date.now() + safeDays * 24 * 60 * 60 * 1000

    const snapshot = studentSnapshot && typeof studentSnapshot === 'object'
      ? {
          full_name: String(studentSnapshot.full_name || ''),
          current_belt: String(studentSnapshot.current_belt || 'Branca'),
          current_degree: Number(studentSnapshot.current_degree || 0),
          photo_url: studentSnapshot.photo_url ? String(studentSnapshot.photo_url) : null,
        }
      : null

    const token = signPayload({ sid: studentId, exp, student: snapshot }, QR_PUBLIC_TOKEN_SECRET)
    const baseUrl = getBaseUrl(req)
    const publicUrl = `${baseUrl}/meu-qr?t=${encodeURIComponent(token)}`

    res.status(200).json({ success: true, token, publicUrl, expiresAt: new Date(exp).toISOString() })
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Erro ao gerar link público do QR.' })
  }
}
