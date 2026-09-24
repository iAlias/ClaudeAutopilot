import { readHistory, finalizePending, computeStats } from '../lib/history.mjs'
import { latestUsage } from '../lib/usage.mjs'
import { openTurns } from '../lib/turns.mjs'
import { isMain } from '../lib/hook-io.mjs'
import { readResume } from '../lib/resume.mjs'

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

export function renderResumes(sessions) {
  const records = Object.values(sessions ?? {}).filter((r) => r && typeof r === 'object')
  if (!records.length) return null
  const count = (fn) => records.filter(fn).length
  const done = records.filter((r) => r.status === 'done')
  const message = done.filter((r) => r.via === 'message').length
  const background = done.filter((r) => r.via === 'resume').length
  const channels = [`message ${message}`, `background ${background}`]
  if (done.length > message + background) channels.push(`manual ${done.length - message - background}`)
  const parts = [`done ${done.length} (${channels.join(', ')})`, `skipped ${count((r) => r.status === 'skipped')}`, `failed ${count((r) => r.status === 'failed')}`]
  const lost = count((r) => r.status === 'lost')
  if (lost) parts.push(`lost ${lost}`)
  const waiting = count((r) => r.status === 'waiting')
  if (waiting) parts.push(`waiting ${waiting}`)
  return `Resumes: ${parts.join(' · ')}`
}

if (isMain(import.meta.url)) {
  finalizePending(latestUsage(), openTurns())
  const lines = [renderStats(computeStats(readHistory()))]
  const resumes = renderResumes(readResume().sessions)
  if (resumes) lines.push('', resumes)
  console.log(lines.join('\n'))
}
