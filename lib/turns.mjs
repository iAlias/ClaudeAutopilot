import { dataFile } from './paths.mjs'
import { readJson, writeJson } from './json-store.mjs'

export const STALE_MS = 2 * 3600 * 1000
const WEEK_MS = 7 * 24 * 3600 * 1000

function loadObject(name) {
  const v = readJson(dataFile(name), null)
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
}

export function startTurn(sessionId, usage, now = Date.now()) {
  const turns = loadObject('turns.json')
  for (const [id, t] of Object.entries(turns)) {
    if (!t || !Number.isFinite(t.startedAt) || now - t.startedAt > STALE_MS) delete turns[id]
  }
  turns[sessionId] = {
    startedAt: now,
    usage: usage ? { five_hour: usage.five_hour, seven_day: usage.seven_day } : null,
    agents: [],
  }
  writeJson(dataFile('turns.json'), turns)
  return turns[sessionId]
}

export function addDelegation(sessionId, agentType) {
  const turns = loadObject('turns.json')
  const t = turns[sessionId]
  if (!t) return false
  t.agents = [...(Array.isArray(t.agents) ? t.agents : []), agentType]
  writeJson(dataFile('turns.json'), turns)
  return true
}

export function endTurn(sessionId) {
  const turns = loadObject('turns.json')
  const t = turns[sessionId]
  if (!t) return null
  delete turns[sessionId]
  writeJson(dataFile('turns.json'), turns)
  return t
}

export function openTurns(now = Date.now()) {
  return Object.entries(loadObject('turns.json'))
    .filter(([, t]) => t && Number.isFinite(t.startedAt) && now - t.startedAt <= STALE_MS)
    .map(([sessionId, t]) => ({ sessionId, ...t }))
}

export function markSession(sessionId, now = Date.now()) {
  const seen = loadObject('seen.json')
  for (const [id, at] of Object.entries(seen)) {
    if (!Number.isFinite(at) || now - at > WEEK_MS) delete seen[id]
  }
  const first = !(sessionId in seen)
  seen[sessionId] = now
  writeJson(dataFile('seen.json'), seen)
  return first
}
