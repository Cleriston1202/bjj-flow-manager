const express = require('express')
const cors = require('cors')
const path = require('path')
const crypto = require('crypto')
const { Pool } = require('pg')
require('dotenv').config()

const app = express()
app.use(cors())
app.use(express.json())

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL ausente')
  process.exit(1)
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
})

app.get('/api/health', async (req, res) => {
  try {
    const r = await pool.query('select now() as now')
    res.json({ now: r.rows[0].now })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/ping', (req, res) => {
  res.json({ now: new Date().toISOString() })
})

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function getSupabaseUrl() {
  return process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
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

function normalizeCpf(value) {
  return String(value || '').replace(/\D/g, '')
}

function signPayload(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${signature}`
}

function verifyPayload(token, secret) {
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

async function findUserIdByEmail(supabase, email) {
  const normalized = normalizeEmail(email)
  if (!normalized) return null

  let page = 1
  const perPage = 200
  while (page <= 5) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error) throw error

    const users = data?.users || []
    const found = users.find((u) => normalizeEmail(u?.email || '') === normalized)
    if (found?.id) return found.id

    if (users.length < perPage) break
    page += 1
  }

  return null
}

async function findAdminProfileByUserId(supabase, userId) {
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

app.post('/api/forgotPassword', async (req, res) => {
  try {
    const { action } = req.body || {}
    if (!action) {
      res.status(400).json({ error: 'action is required' })
      return
    }

    if (action === 'validate') {
      const SUPABASE_URL = getSupabaseUrl()
      const key = getValidateKey()
      const RESET_TOKEN_SECRET = process.env.RESET_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
      if (!SUPABASE_URL || !key || !RESET_TOKEN_SECRET) {
        res.status(500).json({ error: 'Configuração ausente para validação de senha.' })
        return
      }

      const { createClient } = await import('@supabase/supabase-js')
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

      const matched = (students || []).find((row) => {
        const rowCpf = normalizeCpf(String(row?.contact?.cpf || ''))
        return rowCpf && rowCpf === cpf
      })

      if (!matched) {
        res.status(400).json({ error: 'Dados não conferem' })
        return
      }

      const contact = matched.contact || {}
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
      const { createClient } = await import('@supabase/supabase-js')
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

      const { error: updateErr } = await supabase.auth.admin.updateUserById(String(payload.uid), {
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
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erro interno no reset de senha.' })
  }
})

app.post('/api/checkin', async (req, res) => {
  try {
    const { studentId, qrToken } = req.body || {}
    if (!studentId && !qrToken) {
      res.status(400).json({ error: 'studentId or qrToken required' })
      return
    }
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
    if (!SUPABASE_URL || !key) {
      res.status(500).json({ error: 'Supabase keys not configured' })
      return
    }
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(SUPABASE_URL, key)
    const sid = studentId || qrToken || null
    if (!sid) {
      res.status(400).json({ error: 'Unable to resolve student id from qrToken' })
      return
    }
    const { data, error } = await supabase.from('attendances').insert([{ student_id: sid }]).select()
    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
    res.status(200).json({ success: true, attendance: data })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

if (process.env.NODE_ENV !== 'production') {
  app.post('/api/admin/createTestUser', async (req, res) => {
    try {
      const email = (req.body && req.body.email) || 'teste@bondade.local'
      const password = (req.body && req.body.password) || '123456'
      const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (!SUPABASE_URL || !key) {
        res.status(500).json({ error: 'Supabase admin keys not configured' })
        return
      }
      const { createClient } = await import('@supabase/supabase-js')
      const supabase = createClient(SUPABASE_URL, key)
      const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true })
      if (error && !String(error.message || '').toLowerCase().includes('already')) {
        res.status(500).json({ error: error.message })
        return
      }
      res.json({ success: true, email, password, user: data?.user || null })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })
}

app.post('/api/awardBelt', async (req, res) => {
  try {
    const { studentId } = req.body || {}
    if (!studentId) {
      res.status(400).json({ error: 'studentId required' })
      return
    }
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      res.status(500).json({ error: 'Supabase keys not configured on server' })
      return
    }
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const BELT_ORDER = ['Branca','Azul','Roxa','Marrom','Preta']
    const { data: student, error: fetchErr } = await supabase.from('students').select('*').eq('id', studentId).single()
    if (fetchErr || !student) {
      res.status(404).json({ error: 'Student not found' })
      return
    }
    const currentDegree = Number(student.current_degree || 0)
    const currentBelt = student.current_belt || 'Branca'
    let newDegree = currentDegree
    let newBelt = currentBelt
    if (currentDegree < 4) {
      newDegree = currentDegree + 1
    } else {
      const idx = BELT_ORDER.indexOf(currentBelt)
      if (idx === -1 || idx === BELT_ORDER.length - 1) {
        res.status(400).json({ error: 'Student is already at top belt/degree' })
        return
      }
      newBelt = BELT_ORDER[idx + 1]
      newDegree = 0
    }
    const { error: updateErr } = await supabase.from('students').update({ current_belt: newBelt, current_degree: newDegree, belt_since: new Date().toISOString() }).eq('id', studentId)
    if (updateErr) {
      res.status(500).json({ error: updateErr.message })
      return
    }
    const { data: historyData, error: histErr } = await supabase.from('belt_history').insert([{ student_id: studentId, belt: newBelt, degree: newDegree, notes: 'Automated award via teacher UI' }]).select().single()
    if (histErr) {
      res.status(500).json({ error: histErr.message })
      return
    }
    res.status(200).json({ success: true, student: { id: studentId, current_belt: newBelt, current_degree: newDegree }, history: historyData })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/payments/reconcile', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM payments WHERE status <> $1::payment_status', ['paid'])
    const payments = r.rows || []
    const now = Date.now()
    const updates = []
    for (const p of payments || []) {
      const due = p.end_date ? new Date(p.end_date).getTime() : null
      if (!due) continue
      const graceEnd = due + 5 * 24 * 60 * 60 * 1000
      if (now > graceEnd && p.status !== 'late') {
        updates.push({ id: p.id, status: 'late' })
      }
    }
    for (const u of updates) {
      await pool.query('UPDATE payments SET status = $1::payment_status WHERE id = $2', ['late', u.id])
    }
    res.json({ updated: updates.length })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/payments/settle', async (req, res) => {
  try {
    const { paymentId, amount_received, method, received_at } = req.body || {}
    if (!paymentId) {
      res.status(400).json({ error: 'paymentId required' })
      return
    }
    await pool.query('CREATE TABLE IF NOT EXISTS payment_receipts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payment_id uuid REFERENCES payments(id) ON DELETE CASCADE, amount numeric(10,2), method text, received_at timestamptz DEFAULT now())')
    if (amount_received || method || received_at) {
      await pool.query('INSERT INTO payment_receipts (payment_id, amount, method, received_at) VALUES ($1,$2,$3,COALESCE($4, now()))', [paymentId, amount_received ?? null, method ?? null, received_at ?? null])
    }
    await pool.query('UPDATE payments SET status = \'paid\'::payment_status WHERE id = $1', [paymentId])
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

function monthBounds(ym) {
  const [y, m] = String(ym).split('-').map(x => Number(x))
  const start = new Date(y, m - 1, 1)
  const end = new Date(y, m, 0)
  const pad = (n) => String(n).padStart(2, '0')
  return { start: `${start.getFullYear()}-${pad(start.getMonth()+1)}-${pad(1)}`, end: `${end.getFullYear()}-${pad(end.getMonth()+1)}-${pad(end.getDate())}` }
}
function dueDateForMonth(student, ym) {
  const [y, m] = String(ym).split('-').map(x => Number(x))
  const sinceIso = student.created_at || student.belt_since || new Date().toISOString()
  const since = new Date(sinceIso)
  const day = since.getDate()
  const lastDay = new Date(y, m, 0).getDate()
  const d = Math.min(day, lastDay)
  const pad = (n) => String(n).padStart(2, '0')
  return `${y}-${pad(m)}-${pad(d)}`
}

app.post('/api/payments/ensureMonth', async (req, res) => {
  try {
    const { month } = req.body || {}
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      res.status(400).json({ error: 'month (YYYY-MM) required' })
      return
    }
    const { start, end } = monthBounds(month)
    const studentsRes = await pool.query('SELECT id, full_name, active, belt_since, created_at FROM students WHERE active = true')
    const students = studentsRes.rows || []
    let created = 0
    for (const s of students) {
      const existsRes = await pool.query('SELECT id FROM payments WHERE student_id = $1 AND start_date BETWEEN $2::date AND $3::date LIMIT 1', [s.id, start, end])
      if (existsRes.rows.length === 0) {
        const due = dueDateForMonth(s, month)
        await pool.query('INSERT INTO payments (student_id, amount, start_date, end_date, status) VALUES ($1,$2::numeric,$3::date,$4::date,\'pending\'::payment_status)', [s.id, null, start, due])
        created++
      }
    }
    res.json({ ensured: true, created })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/payments/byMonth', async (req, res) => {
  try {
    const month = req.query.month
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      res.status(400).json({ error: 'month (YYYY-MM) required' })
      return
    }
    const { start, end } = monthBounds(month)
    const listRes = await pool.query('SELECT * FROM payments WHERE start_date BETWEEN $1::date AND $2::date ORDER BY end_date DESC NULLS LAST', [start, end])
    const rows = listRes.rows || []
    const map = {}
    for (const p of rows) {
      const olderRes = await pool.query('SELECT count(*)::int as c FROM payments WHERE student_id = $1 AND status <> \'paid\'::payment_status AND end_date < $2::date', [p.student_id, start])
      const c = olderRes.rows[0]?.c || 0
      map[p.id] = { older_unpaid_count: c }
    }
    const merged = rows.map(p => ({ ...p, older_unpaid_count: map[p.id]?.older_unpaid_count || 0 }))
    res.json(merged)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/payments', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM payments ORDER BY end_date DESC NULLS LAST, start_date DESC NULLS LAST')
    res.json(r.rows || [])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/whatsapp/send-qrcode', async (req, res) => {
  try {
    const { phone, message, qrcodeImageUrl } = req.body || {}
    if (!phone || !message) {
      res.status(400).json({ error: 'phone and message are required' })
      return
    }

    const provider = String(process.env.WHATSAPP_PROVIDER || '').toLowerCase()
    if (provider !== 'evolution') {
      res.status(501).json({ error: 'No WhatsApp provider configured' })
      return
    }

    const baseUrl = process.env.EVOLUTION_API_URL
    const apiKey = process.env.EVOLUTION_API_KEY
    const instance = process.env.EVOLUTION_INSTANCE

    if (!baseUrl || !apiKey || !instance) {
      res.status(500).json({ error: 'Evolution API env vars are missing' })
      return
    }

    if (qrcodeImageUrl) {
      const mediaEndpoint = `${baseUrl.replace(/\/$/, '')}/message/sendMedia/${instance}`
      const mediaRes = await fetch(mediaEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: apiKey,
        },
        body: JSON.stringify({
          number: phone,
          mediatype: 'image',
          media: qrcodeImageUrl,
          caption: message,
        }),
      })

      if (mediaRes.ok) {
        res.json({ success: true, mode: 'media' })
        return
      }
    }

    const endpoint = `${baseUrl.replace(/\/$/, '')}/message/sendText/${instance}`
    const evolutionRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
      },
      body: JSON.stringify({ number: phone, text: message }),
    })

    if (!evolutionRes.ok) {
      const errTxt = await evolutionRes.text()
      res.status(502).json({ error: `Evolution API error: ${errTxt}` })
      return
    }

    res.json({ success: true, mode: 'text' })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/payments/upsert', async (req, res) => {
  try {
    const { paymentId, studentId, amount, start_date, end_date } = req.body || {}
    if (paymentId) {
      const r = await pool.query(
        'UPDATE payments SET amount = $1::numeric, start_date = $2::date, end_date = $3::date WHERE id = $4 RETURNING id',
        [amount ?? null, start_date ?? null, end_date ?? null, paymentId]
      )
      if (!r.rows.length) {
        res.status(404).json({ error: 'Payment not found' })
        return
      }
      res.json({ success: true, id: r.rows[0].id })
      return
    }
    if (!studentId) {
      res.status(400).json({ error: 'studentId required for creation' })
      return
    }
    const r = await pool.query(
      'INSERT INTO payments (student_id, amount, start_date, end_date, status) VALUES ($1,$2::numeric,$3::date,$4::date,\'pending\'::payment_status) RETURNING id',
      [studentId, amount ?? null, start_date ?? null, end_date ?? null]
    )
    res.json({ success: true, id: r.rows[0].id })
  } catch (e) {
    console.error('upsert error', { body: req.body, message: e.message })
    res.status(500).json({ error: e.message })
  }
})

// Em produção, servir o frontend buildado (Vite) a partir de "dist"
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist')
  app.use(express.static(distPath))

  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

const port = process.env.PORT || 3001
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`)
})
