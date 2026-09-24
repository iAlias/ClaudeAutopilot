import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const R = '\x1b[0m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const CYAN = '\x1b[36m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const WEEK_MS = 7 * 24 * 3600 * 1000
const dataDir = process.env.AUTOPILOT_HOME || path.join(os.homedir(), '.claude', 'autopilot')

const sev = (p) => (p >= 90 ? RED : p >= 70 ? YELLOW : GREEN)

const bar = (p, w = 10) => {
  const v = Math.min(100, Math.max(0, Number(p) || 0))
  const f = Math.round((v / 100) * w)
  return '█'.repeat(f) + '░'.repeat(w - f)
}

const pct = (p) => `${Math.round(Number(p) || 0)}%`

const fmtReset = (epochSec) => {
  if (!Number.isFinite(epochSec)) return null
  const d = new Date(epochSec * 1000)
  const now = new Date()
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  if (d.toDateString() === now.toDateString()) return time
  const wd = d.toLocaleDateString(undefined, { weekday: 'short' }).replace('.', '')
  return `${wd} ${time}`
}

const quota = (label, used, resetsAt) => {
  if (!Number.isFinite(used)) return `${DIM}${label} —${R}`
  const c = sev(used)
  const at = fmtReset(resetsAt)
  return `${DIM}${label}${R} ${c}${bar(used)}${R} ${c}${pct(used)}${R}${at ? ` ${DIM}reset ${at}${R}` : ''}`
}

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

const num = (v) => (Number.isFinite(v) ? v : null)

function recordUsage(sessionId, rl, now) {
  const five = num(rl?.five_hour?.used_percentage)
  const seven = num(rl?.seven_day?.used_percentage)
  if (five === null && seven === null) return
  const file = path.join(dataDir, 'usage.json')
  const data = readJson(file, null)
  const sessions = data && typeof data.sessions === 'object' && data.sessions ? data.sessions : {}
  sessions[sessionId ?? 'unknown'] = { five_hour: five, seven_day: seven, at: now }
  for (const [id, s] of Object.entries(sessions)) {
    if (!s || !Number.isFinite(s.at) || now - s.at > WEEK_MS) delete sessions[id]
  }
  fs.mkdirSync(dataDir, { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ sessions }, null, 2))
  fs.renameSync(tmp, file)
}

let raw = ''
try {
  raw = fs.readFileSync(0, 'utf8')
} catch {}

let data
try {
  data = JSON.parse(raw)
} catch {
  process.exit(0)
}

try {
  recordUsage(data.session_id, data.rate_limits, Date.now())
} catch {}

const rawState = readJson(path.join(dataDir, 'state.json'), null)
const state = rawState && typeof rawState === 'object' ? rawState : {}

function findBash() {
  if (process.platform !== 'win32') return null
  const fromEnv = process.env.CLAUDE_CODE_GIT_BASH_PATH
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir || /[\\/](system32|windowsapps)([\\/]|$)/i.test(dir)) continue
    const candidate = path.join(dir, 'bash.exe')
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function runWrapped(command) {
  const options = { input: raw, encoding: 'utf8', timeout: 5000, windowsHide: true }
  const bash = findBash()
  const r = bash ? spawnSync(bash, ['-lc', command], options) : spawnSync(command, { ...options, shell: true })
  if (r.error || r.status !== 0 || !r.stdout || !r.stdout.trim()) return null
  return r.stdout
}

if (typeof state.wrappedStatusline === 'string' && state.wrappedStatusline) {
  let wrapped = null
  try {
    wrapped = runWrapped(state.wrappedStatusline)
  } catch {}
  if (wrapped !== null) {
    process.stdout.write(wrapped)
    process.exit(0)
  }
}

const mode = ['auto', 'suggest', 'off'].includes(state.mode) ? state.mode : 'suggest'

const head = []
head.push(`${BOLD}${CYAN}${data.model?.display_name ?? '?'}${R}`)
if (data.effort?.level) head.push(`${DIM}${data.effort.level}${R}`)
if (data.fast_mode) head.push(`${YELLOW}⚡fast${R}`)
if (data.thinking?.enabled === false) head.push(`${DIM}no-think${R}`)

const ctx = data.context_window?.used_percentage
if (Number.isFinite(ctx)) head.push(`${DIM}ctx${R} ${sev(ctx)}${pct(ctx)}${R}`)

const usd = data.cost?.total_cost_usd
if (Number.isFinite(usd)) head.push(`${DIM}$${usd.toFixed(2)}${R}`)

head.push(mode === 'off' ? `${DIM}🧭 off${R}` : `${mode === 'auto' ? GREEN : CYAN}🧭 ${mode}${R}`)
if (state.permissions === true) head.push(`${GREEN}🛡${R}`)

const rl = data.rate_limits ?? {}
const quotas = [
  quota('5h', rl.five_hour?.used_percentage, rl.five_hour?.resets_at),
  quota('7d', rl.seven_day?.used_percentage, rl.seven_day?.resets_at),
]
if (rl.spend_limit) quotas.push(quota('spend', rl.spend_limit.used_percentage, rl.spend_limit.resets_at))

process.stdout.write(`${head.join(` ${DIM}·${R} `)}\n${quotas.join('  ')}`)
