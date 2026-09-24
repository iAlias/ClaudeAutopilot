import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDirs = []

process.on('exit', () => {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {}
  }
})

export function tempHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-'))
  tempDirs.push(dir)
  process.env.AUTOPILOT_USER_HOME = dir
  process.env.AUTOPILOT_CLAUDE_DIR = path.join(dir, 'claude')
  process.env.AUTOPILOT_HOME = path.join(dir, 'data')
  fs.mkdirSync(process.env.AUTOPILOT_CLAUDE_DIR, { recursive: true })
  return dir
}

export function writeTranscript(dir, entries) {
  const file = path.join(dir, `transcript-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`)
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n')
  return file
}
