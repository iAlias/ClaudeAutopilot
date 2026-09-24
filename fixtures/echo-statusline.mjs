import fs from 'node:fs'
const d = JSON.parse(fs.readFileSync(0, 'utf8'))
process.stdout.write(`WRAPPED ${d.session_id}`)
