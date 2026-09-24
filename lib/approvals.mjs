import crypto from 'node:crypto'
import { dataFile } from './paths.mjs'
import { readJson, writeJson } from './json-store.mjs'

export const TTL_MS = 30 * 60 * 1000
export const PENDING_TTL_MS = 24 * 3600 * 1000
const CONFIRM_TOKENS = new Set(['sì', 'si', 'ok', 'okay', 'procedi', 'vai', 'confermo', 'conferma', 'certo', 'va', 'bene', 'fallo', 'fai', 'pure', 'esegui', 'dai', 'perfetto', 'grazie', 'yes', 'yep', 'yeah', 'sure', 'go', 'ahead', 'proceed', 'please'])
const STRONG_TOKENS = new Set(['sì', 'si', 'ok', 'okay', 'procedi', 'confermo', 'conferma', 'vai', 'fallo', 'esegui', 'yes', 'yep', 'yeah', 'proceed', 'sure', 'certo'])
const STRONG_PHRASES = ['va bene', 'go ahead', 'fai pure']
const FILLERS = new Set(['grazie', 'procedi', 'pure', 'perfetto', 'ok', 'go', 'ahead', 'please', 'thanks'])

const BLOCKERS = new Set(['no', 'non', 'ma', 'però', 'pero', 'aspetta', 'attendi', 'prima', 'stop', 'fermo', 'fermati', 'annulla', 'mai', 'solo', 'soltanto', 'tranne', 'eccetto', 'senza', 'invece', 'not', 'only', 'except', 'without', 'instead', "don't", 'dont', 'but', 'wait', 'before', 'first', 'cancel', 'never'])

export const isCrossSessionMessage = (prompt) => String(prompt ?? '').trimStart().startsWith('<cross-session-message')

function confirmationClauses(prompt) {
  const p = String(prompt ?? '').trim().toLowerCase()
  if (!p || p.includes('?') || isCrossSessionMessage(p)) return null
  if (isStrictConfirmation(p)) return { rest: [] }
  const clause = /^([^,.;:!]+)[,.;:!]\s*(.+)$/s.exec(p)
  if (!clause || !isStrictConfirmation(clause[1])) return null
  return { rest: clause[2].split(/[\s,.;:!]+/).filter(Boolean) }
}

export function isConfirmation(prompt) {
  const c = confirmationClauses(prompt)
  return Boolean(c) && !c.rest.some((t) => BLOCKERS.has(t))
}

export function isStrictReply(prompt) {
  const c = confirmationClauses(prompt)
  return Boolean(c) && c.rest.every((t) => FILLERS.has(t))
}

function isStrictConfirmation(p) {
  const stripped = p.trim().replace(/[.!\s]+$/, '')
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

function load(name, now, ttl = TTL_MS) {
  const v = readJson(dataFile(name), [])
  return (Array.isArray(v) ? v : []).filter((e) => e && Number.isFinite(e.createdAt) && now - e.createdAt < ttl)
}

const turnStartOf = (entry) => (Number.isFinite(entry.turnStart) ? entry.turnStart : 0)

export function addPending(sessionId, hash, description, now = Date.now(), turnStart = 0) {
  const list = load('pending.json', now, PENDING_TTL_MS).filter((e) => !(e.sessionId === sessionId && e.hash === hash))
  list.push({ sessionId, hash, description, createdAt: now, turnStart: Number.isFinite(turnStart) ? turnStart : 0 })
  writeJson(dataFile('pending.json'), list)
}

export function resolvePending(sessionId, prompt, now = Date.now()) {
  const raw = readJson(dataFile('pending.json'), [])
  const stored = (Array.isArray(raw) ? raw : []).filter((e) => e && Number.isFinite(e.createdAt))
  const all = load('pending.json', now, PENDING_TTL_MS)
  const session = all.filter((e) => e.sessionId === sessionId)
  const since = Math.max(0, ...session.map(turnStartOf))
  const mine = session.filter((e) => e.createdAt >= since)
  const expired = [
    ...stored.filter((e) => e.sessionId === sessionId && now - e.createdAt >= PENDING_TTL_MS),
    ...session.filter((e) => e.createdAt < since),
  ].map((e) => e.description)
  if (!mine.length && !expired.length) return { approved: [], rejected: 0 }
  writeJson(dataFile('pending.json'), all.filter((e) => e.sessionId !== sessionId))
  const result = (approved, rejected) => (expired.length ? { approved, rejected, expired } : { approved, rejected })
  if (!mine.length) return result([], 0)
  const confirmed = mine.length > 1 ? isStrictReply(prompt) : isConfirmation(prompt)
  if (!confirmed) return { ...result([], mine.length), rejectedDescriptions: [...new Set(mine.map((e) => e.description))] }
  const approvals = load('approvals.json', now)
  const approved = mine.map((e) => ({ sessionId, hash: e.hash, description: e.description, createdAt: now }))
  writeJson(dataFile('approvals.json'), [...approvals, ...approved])
  return result(approved, 0)
}

export function consumeApproval(sessionId, hash, now = Date.now()) {
  const list = load('approvals.json', now)
  const i = list.findIndex((e) => e.sessionId === sessionId && e.hash === hash)
  if (i === -1) return false
  list.splice(i, 1)
  writeJson(dataFile('approvals.json'), list)
  return true
}
