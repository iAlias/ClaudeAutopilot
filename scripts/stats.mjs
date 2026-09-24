import { readHistory, finalizePending, computeStats } from '../lib/history.mjs'
import { latestUsage } from '../lib/usage.mjs'
import { openTurns } from '../lib/turns.mjs'
import { isMain } from '../lib/hook-io.mjs'

export function renderStats(stats) {
  if (!stats.total) return 'No turns recorded yet.'
  const lines = [
    '| Model | Effort | Turns | Delegated | Est. avg 5h % | Actual avg 5h % |',
    '|---|---|---|---|---|---|',
    ...stats.rows.map((r) => `| ${r.model} | ${r.effort} | ${r.turns} | ${r.delegated} | ${r.estAvg5h ?? '-'} | ${r.actAvg5h ?? '-'} |`),
    '',
    `Total: ${stats.total} · pending: ${stats.pending} · excluded (parallel sessions): ${stats.contaminated} · without 🧭 line: ${stats.unparsed}`,
  ]
  return lines.join('\n')
}

if (isMain(import.meta.url)) {
  finalizePending(latestUsage(), openTurns())
  console.log(renderStats(computeStats(readHistory())))
}
