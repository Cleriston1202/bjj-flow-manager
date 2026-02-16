const { Pool } = require('pg')

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL ausente')
  process.exit(1)
}

const pool = new Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
})

async function main() {
  const res = await pool.query('select now() as now')
  console.log(res.rows[0].now.toISOString())
  await pool.end()
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
