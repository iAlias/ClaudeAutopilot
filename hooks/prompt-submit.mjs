import { runHook } from '../lib/hook-io.mjs'
import { readState, writeState, parseCommand } from '../lib/state.mjs'
import { latestUsage } from '../lib/usage.mjs'
import { startTurn, openTurns, markSession } from '../lib/turns.mjs'
import { finalizePending, readHistory, computeAverages } from '../lib/history.mjs'
import { resolvePending, isCrossSessionMessage } from '../lib/approvals.mjs'
import { pendingResume, markResume, clearAutoResumes } from '../lib/resume.mjs'
import { buildContext } from '../lib/context.mjs'

const SIX_HOURS = 6 * 3600 * 1000
const START_USAGE_MAX_AGE = 10 * 60 * 1000
const out = (text) => ({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } })

export function handle(input, now = Date.now()) {
  if (process.env.AUTOPILOT_RESUMER === 'messenger') return null
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
  if (cmd?.action === 'resume') {
    const s = writeState({ resume: cmd.value })
    return out(`[autopilot] Auto-resume ${s.resume ? 'enabled' : 'disabled'} by the user. Confirm it in one sentence.`)
  }
  if (cmd) return null
  const state = readState()
  const crossSession = isCrossSessionMessage(prompt)
  const slash = prompt.trimStart().startsWith('/')
  if (!crossSession && !slash && !process.env.AUTOPILOT_RESUMER) {
    if (pendingResume(sessionId)) markResume(sessionId, { status: 'done', note: 'user resumed manually', autoResumes: 0 })
    else clearAutoResumes(sessionId)
  }
  const extra = []
  if (state.permissions && !crossSession && !process.env.AUTOPILOT_RESUMER) {
    const { approved, expired = [], rejectedDescriptions = [] } = resolvePending(sessionId, prompt, now)
    const list = (items) => [...new Set(items.map((a) => a.description ?? a))].join('; ')
    if (approved.length) extra.push(`[autopilot] The user approved: ${list(approved)}. Re-run exactly the same blocked action${approved.length > 1 ? 's' : ''} now.`)
    if (expired.length) extra.push(`[autopilot] A confirmation request expired before the user replied: ${list(expired)}. If the task still needs it, run the action again and ask the user to confirm again.`)
    if (rejectedDescriptions.length) extra.push(`[autopilot] The user's reply was not read as a clear confirmation, so this blocked action stays blocked: ${list(rejectedDescriptions)}. If the user seems to agree, tell them in one sentence that autopilot needs a plain "sì" (or "sì, procedi") to unlock it, then run the action again.`)
  }
  if (state.mode === 'off' || slash) return extra.length ? out(extra.join('\n')) : null
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
