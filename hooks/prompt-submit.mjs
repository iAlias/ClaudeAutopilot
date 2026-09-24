import { runHook } from '../lib/hook-io.mjs'
import { readState, writeState, parseCommand } from '../lib/state.mjs'
import { latestUsage } from '../lib/usage.mjs'
import { startTurn, openTurns, markSession } from '../lib/turns.mjs'
import { finalizePending, readHistory, computeAverages } from '../lib/history.mjs'
import { resolvePending } from '../lib/approvals.mjs'
import { buildContext } from '../lib/context.mjs'

const SIX_HOURS = 6 * 3600 * 1000
const START_USAGE_MAX_AGE = 10 * 60 * 1000
const out = (text) => ({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } })

export function handle(input, now = Date.now()) {
  const sessionId = input.session_id ?? 'unknown'
  const prompt = String(input.prompt ?? input.user_input ?? '')
  const cmd = parseCommand(prompt)
  if (cmd?.action === 'mode') {
    const s = writeState({ mode: cmd.mode })
    return out(`[autopilot] Mode set to "${s.mode}" by the user. Confirm it in one sentence.`)
  }
  if (cmd?.action === 'permissions') {
    const s = writeState({ permissions: cmd.value })
    return out(`[autopilot] Permissions module ${s.permissions ? 'enabled' : 'disabled'} by the user. Confirm it in one sentence.`)
  }
  if (cmd) return null
  const state = readState()
  const extra = []
  if (state.permissions) {
    const { approved } = resolvePending(sessionId, prompt, now)
    if (approved.length) extra.push(`[autopilot] The user approved: ${approved.map((a) => a.description).join('; ')}. Re-run exactly the same blocked action now.`)
  }
  if (state.mode === 'off' || prompt.trimStart().startsWith('/')) return extra.length ? out(extra.join('\n')) : null
  const usage = latestUsage()
  finalizePending(usage, openTurns(now))
  startTurn(sessionId, usage && now - usage.at <= START_USAGE_MAX_AGE ? usage : null, now)
  const context = buildContext({
    mode: state.mode,
    firstInSession: markSession(sessionId, now),
    averages: computeAverages(readHistory()),
    limitsAvailable: Boolean(usage) && Number.isFinite(usage.five_hour) && now - usage.at < SIX_HOURS,
  })
  return out([...extra, context].join('\n'))
}

runHook(import.meta.url, handle)
