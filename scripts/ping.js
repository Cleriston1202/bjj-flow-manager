fetch('http://localhost:3001/api/ping')
  .then((r) => r.text())
  .then((t) => {
    console.log(t)
  })
  .catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
