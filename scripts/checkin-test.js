const studentId = process.env.TEST_STUDENT_ID || ''
fetch('http://localhost:3001/api/checkin', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ studentId }),
})
  .then((r) => r.text())
  .then((t) => {
    console.log(t)
  })
  .catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
