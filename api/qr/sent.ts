import type { IncomingMessage, ServerResponse } from 'http'
import { Pool } from 'pg'

let pool: Pool | null = null

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error('DATABASE_URL not configured')
    }
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
    })
  }
  return pool
}

export default async function handler(req: IncomingMessage & { method?: string }, res: ServerResponse & { json?: (body: any) => void; status?: (code: number) => any }) {
  if (req.method !== 'GET') {
    ;(res.status ? res.status(405) : res).end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  try {
    const db = getPool()
    await db.query('CREATE TABLE IF NOT EXISTS qr_notifications (id uuid PRIMARY KEY, student_id uuid, sent_at timestamptz DEFAULT now(), message text, qrcode_url text)')
    const r = await db.query('SELECT student_id FROM qr_notifications')
    const body = { sent: r.rows.map((x: any) => x.student_id) }
    if (res.json) {
      res.json(body)
    } else {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(body))
    }
  } catch (e: any) {
    console.error('Erro em /api/qr/sent (serverless):', e?.message || e)
    // Em caso de erro (ex: DATABASE_URL não configurada), devolvemos
    // uma lista vazia em vez de 500 para não quebrar o painel.
    const body = { sent: [] }
    if (res.json) {
      res.json(body)
    } else {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(body))
    }
  }
}
