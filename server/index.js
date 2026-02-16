const express = require('express')
const cors = require('cors')
const { Pool } = require('pg')
const { randomUUID } = require('crypto')
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

app.post('/api/awardBelt', async (req, res) => {
  try {
    const { studentId } = req.body || {}
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
  const sinceIso = student.belt_since || student.created_at || new Date().toISOString()
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

app.get('/api/qr/sent', async (req, res) => {
  try {
    await pool.query('CREATE TABLE IF NOT EXISTS qr_notifications (id uuid PRIMARY KEY, student_id uuid, sent_at timestamptz DEFAULT now(), message text, qrcode_url text)')
    const r = await pool.query('SELECT student_id FROM qr_notifications')
    res.json({ sent: r.rows.map(x => x.student_id) })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/qr/markSent', async (req, res) => {
  try {
    const { studentId, qrcodeUrl, message } = req.body || {}
    if (!studentId) {
      res.status(400).json({ error: 'studentId required' })
      return
    }
    await pool.query('CREATE TABLE IF NOT EXISTS qr_notifications (id uuid PRIMARY KEY, student_id uuid, sent_at timestamptz DEFAULT now(), message text, qrcode_url text)')
    await pool.query('INSERT INTO qr_notifications (id, student_id, message, qrcode_url) VALUES ($1, $2, $3, $4)', [randomUUID(), studentId, message || '', qrcodeUrl || ''])
    res.json({ success: true })
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

const port = process.env.PORT || 3001
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`)
})
