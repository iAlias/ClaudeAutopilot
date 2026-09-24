const LINE_RE = /🧭\s*(?:[^\s·:]+:\s*)?(Haiku|Sonnet|Opus|Fable)\s*·\s*(low|medium|high|xhigh|max|-|—)\s*·\s*~?\s*(\d+(?:[.,]\d+)?)\s*[–-]\s*(\d+(?:[.,]\d+)?)\s*(%\s*5h|k\s*tok\w*)\s*·\s*([a-z-]+)(?:\s*→\s*(.+))?/i

const toNum = (s) => Number(s.replace(',', '.'))

export function parseRecommendation(text) {
  if (!text) return null
  const line = String(text).split('\n').find((l) => l.includes('🧭'))
  if (!line) return null
  const m = LINE_RE.exec(line)
  if (!m) return null
  const tail = m[7]?.trim() ?? null
  return {
    model: m[1].toLowerCase(),
    effort: m[2] === '-' || m[2] === '—' ? null : m[2].toLowerCase(),
    estLow: toNum(m[3]),
    estHigh: toNum(m[4]),
    unit: m[5].includes('%') ? 'pct5h' : 'ktok',
    taskType: m[6].toLowerCase(),
    delegated: tail === null ? null : /delegat/i.test(tail),
  }
}

export function agentName(model, effort) {
  return model === 'haiku' ? 'autopilot-haiku' : `autopilot-${model}-${effort}`
}
