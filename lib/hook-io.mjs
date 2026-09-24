import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p)

export function isMain(url) {
  return Boolean(process.argv[1]) && norm(path.resolve(process.argv[1])) === norm(fileURLToPath(url))
}

export function runHook(url, handle) {
  if (!isMain(url)) return
  try {
    const raw = fs.readFileSync(0, 'utf8')
    const out = handle(raw.trim() ? JSON.parse(raw) : {})
    if (out) process.stdout.write(JSON.stringify(out))
  } catch {}
  process.exit(0)
}
