import crypto from 'node:crypto'
import { dataFile } from './paths.mjs'
import { readJson, writeJson } from './json-store.mjs'

export const TTL_MS = 10 * 60 * 1000
const CONFIRM_TOKENS = new Set(['sì', 'si', 'ok', 'okay', 'procedi', 'vai', 'confermo', 'conferma', 'certo', 'va', 'bene', 'fallo', 'fai', 'pure', 'esegui', 'dai', 'perfetto', 'grazie', 'yes', 'yep', 'yeah', 'sure', 'go', 'ahead', 'proceed', 'please'])
const STRONG_TOKENS = new Set(['sì', 'si', 'ok', 'okay', 'procedi', 'confermo', 'conferma', 'vai', 'fallo', 'esegui', 'yes', 'yep', 'yeah', 'proceed', 'sure', 'certo'])
const STRONG_PHRASES = ['va bene', 'go ahead', 'fai pure']

export function isConfirmation(prompt) {
  const p = String(prompt ?? '').trim().toLowerCase()
  if (!p || p.includes('?')) return false
  const stripped = p.replace(/[.!\s]+$/, '')
  const tokens = stripped.split(/[\s,]+/).filter(Boolean)
  if (tokens.length === 0 || tokens.length > 4) return false
  if (!tokens.every((t) => CONFIRM_TOKENS.has(t))) return false
  const joined = ` ${tokens.join(' ')} `
  return STRONG_PHRASES.some((phrase) => joined.includes(` ${phrase} `)) || tokens.some((t) => STRONG_TOKENS.has(t))
}

export function actionHash(toolName, toolInput = {}) {
  const key = toolInput.command ?? toolInput.file_path ?? toolInput.notebook_path ?? JSON.stringify(toolInput)
  return crypto.createHash('sha256').update(`${toolName}\n${String(key).trim()}`).digest('hex').slice(0, 16)
}

function load(name, now) {
  const v = readJson(dataFile(name), [])
  return (Array.isArray(v) ? v : []).filter((e) => e && Number.isFinite(e.createdAt) && now - e.createdAt < TTL_MS)
}

export function addPending(sessionId, hash, description, now = Date.now()) {
  const list = load('pending.json', now).filter((e) => !(e.sessionId === sessionId && e.hash === hash))
  list.push({ sessionId, hash, description, createdAt: now })
  writeJson(dataFile('pending.json'), list)
}

export function resolvePending(sessionId, prompt, now = Date.now()) {
  const all = load('pending.json', now)
  const mine = all.filter((e) => e.sessionId === sessionId)
  if (!mine.length) return { approved: [], rejected: 0 }
  writeJson(dataFile('pending.json'), all.filter((e) => e.sessionId !== sessionId))
  if (!isConfirmation(prompt)) return { approved: [], rejected: mine.length }
  const approvals = load('approvals.json', now)
  const latest = mine.reduce((a, b) => (b.createdAt >= a.createdAt ? b : a))
  const approved = [{ sessionId, hash: latest.hash, description: latest.description, createdAt: now }]
  writeJson(dataFile('approvals.json'), [...approvals, ...approved])
  return { approved, rejected: 0 }
}

export function consumeApproval(sessionId, hash, now = Date.now()) {
  const list = load('approvals.json', now)
  const i = list.findIndex((e) => e.sessionId === sessionId && e.hash === hash)
  if (i === -1) return false
  list.splice(i, 1)
  writeJson(dataFile('approvals.json'), list)
  return true
}
