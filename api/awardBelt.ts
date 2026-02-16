import { createClient } from '@supabase/supabase-js'

const BELT_ORDER = ['Branca','Azul','Roxa','Marrom','Preta']

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { studentId } = req.body || {}
  if (!studentId) {
    res.status(400).json({ error: 'studentId required' })
    return
  }

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      res.status(500).json({ error: 'Supabase keys not configured on server' })
      return
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // fetch current student
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
        // already at top belt
        res.status(400).json({ error: 'Student is already at top belt/degree' })
        return
      }
      newBelt = BELT_ORDER[idx + 1]
      newDegree = 0
    }

    // transaction: update student and insert history
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
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
