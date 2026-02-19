import type { IncomingMessage, ServerResponse } from 'http'
// Usar CommonJS para compatibilidade com runtimes Node que não tratam ESM
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Pool } = require('pg')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { randomUUID } = require('crypto')

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

interface JsonRequest extends IncomingMessage {
  body?: any
  method?: string
}

interface JsonResponse extends ServerResponse {
  json?: (body: any) => void
  status?: (code: number) => JsonResponse
}

async function handler(req: JsonRequest, res: JsonResponse) {
  if (req.method !== 'POST') {
    ;(res.status ? res.status(405) : res).end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  try {
    const { studentId, qrcodeUrl, message } = req.body || {}
    if (!studentId) {
      const body = { error: 'studentId required' }
      if (res.status) {
        res.status(400).json(body)
      } else {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(body))
      }
      return
    }

    const db = getPool()
    await db.query('CREATE TABLE IF NOT EXISTS qr_notifications (id uuid PRIMARY KEY, student_id uuid, sent_at timestamptz DEFAULT now(), message text, qrcode_url text)')
    await db.query('INSERT INTO qr_notifications (id, student_id, message, qrcode_url) VALUES ($1, $2, $3, $4)', [
      randomUUID(),
      studentId,
      message || '',
      qrcodeUrl || '',
    ])

    const body = { success: true }
    if (res.json) {
      res.json(body)
    } else {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(body))
    }
  } catch (e: any) {
    const body = { error: e.message || 'Internal error' }
    if (res.status) {
      res.status(500).json(body)
    } else {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(body))
    }
  }
}

// Export estilo CommonJS para runtimes que esperam module.exports
// @ts-ignore
module.exports = handler

