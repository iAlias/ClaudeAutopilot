import { dataFile } from './paths.mjs'
import { readJsonl, writeJsonl, appendJsonl } from './json-store.mjs'

const FINALIZE_SLACK_MS = 30 * 1000
const file = () => dataFile('history.jsonl')
const round1 = (x) => Math.round(x * 10) / 10
const delta = (start, end) => (Number.isFinite(start) && Number.isFinite(end) && end - start >= 0 ? round1(end - start) : null)

export function readHistory() {
  return readJsonl(file())
}

export function appendRecord(record) {
  appendJsonl(file(), record)
}

export function isContaminated(rec, records, open, until) {
  const overlaps = (start, end) => start < until && end > rec.startedAt
  return (
    records.some((r) => r !== rec && r.sessionId !== rec.sessionId && overlaps(r.startedAt, r.endedAt ?? until)) ||
    open.some((t) => t.sessionId !== rec.sessionId && overlaps(t.startedAt, until))
  )
}

export function finalizePending(usage, open) {
  if (!usage || !Number.isFinite(usage.at)) return 0
  const records = readHistory()
  let changed = 0
  for (const rec of records) {
    if (!rec.pending || usage.at < rec.endedAt - FINALIZE_SLACK_MS) continue
    rec.delta5h = delta(rec.usageStart?.five_hour, usage.five_hour)
    rec.delta7d = delta(rec.usageStart?.seven_day, usage.seven_day)
    rec.contaminated = isContaminated(rec, records, open, usage.at)
    rec.pending = false
    changed++
  }
  if (changed) writeJsonl(file(), records)
  return changed
}

export function computeAverages(records, limit = 20) {
  const groups = new Map()
  for (const r of records) {
    if (r.pending || r.contaminated || !r.model || !Number.isFinite(r.delta5h)) continue
    const key = `${r.taskType ?? '?'}|${r.model}|${r.effort ?? '-'}`
    const g = groups.get(key) ?? { key, n: 0, sum5h: 0, sum7d: 0, n7d: 0 }
    g.n++
    g.sum5h += r.delta5h
    if (Number.isFinite(r.delta7d)) {
      g.sum7d += r.delta7d
      g.n7d++
    }
    groups.set(key, g)
  }
  return [...groups.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, limit)
    .map((g) => ({ key: g.key, n: g.n, avg5h: round1(g.sum5h / g.n), avg7d: g.n7d ? round1(g.sum7d / g.n7d) : null }))
}

export function computeStats(records) {
  const rows = new Map()
  let pending = 0
  let contaminated = 0
  let unparsed = 0
  for (const r of records) {
    if (r.pending) {
      pending++
      continue
    }
    if (!r.model) {
      unparsed++
      continue
    }
    if (r.contaminated) {
      contaminated++
      continue
    }
    const key = `${r.model}|${r.effort ?? '-'}`
    const row = rows.get(key) ?? { model: r.model, effort: r.effort ?? '-', turns: 0, delegated: 0, estSum: 0, estN: 0, actSum: 0, actN: 0 }
    row.turns++
    if (r.delegated) row.delegated++
    if (r.unit === 'pct5h' && Number.isFinite(r.estLow) && Number.isFinite(r.estHigh)) {
      row.estSum += (r.estLow + r.estHigh) / 2
      row.estN++
    }
    if (Number.isFinite(r.delta5h)) {
      row.actSum += r.delta5h
      row.actN++
    }
    rows.set(key, row)
  }
  return {
    rows: [...rows.values()]
      .sort((a, b) => b.turns - a.turns)
      .map((r) => ({
        model: r.model,
        effort: r.effort,
        turns: r.turns,
        delegated: r.delegated,
        estAvg5h: r.estN ? round1(r.estSum / r.estN) : null,
        actAvg5h: r.actN ? round1(r.actSum / r.actN) : null,
      })),
    pending,
    contaminated,
    unparsed,
    total: records.length,
  }
}
