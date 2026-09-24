import { dataFile } from './paths.mjs'
import { readJson } from './json-store.mjs'

const num = (v) => (Number.isFinite(v) ? v : null)

export function latestUsage() {
  const data = readJson(dataFile('usage.json'), null)
  const sessions = data && typeof data.sessions === 'object' && data.sessions ? data.sessions : {}
  let best = null
  for (const [sessionId, s] of Object.entries(sessions)) {
    if (!s || !Number.isFinite(s.at)) continue
    if (!best || s.at > best.at) best = { sessionId, five_hour: num(s.five_hour), seven_day: num(s.seven_day), at: s.at }
  }
  return best
}
