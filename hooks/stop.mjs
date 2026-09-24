import { runHook } from '../lib/hook-io.mjs'
import { endTurn } from '../lib/turns.mjs'
import { appendRecord } from '../lib/history.mjs'
import { lastTurnAssistantText } from '../lib/transcript.mjs'
import { parseRecommendation } from '../lib/recommendation.mjs'

export function handle(input, now = Date.now()) {
  if (input.stop_hook_active || process.env.AUTOPILOT_RESUMER === 'messenger') return null
  const sessionId = input.session_id ?? 'unknown'
  const turn = endTurn(sessionId)
  if (!turn) return null
  const rec = parseRecommendation(lastTurnAssistantText(input.transcript_path))
  const agents = Array.isArray(turn.agents) ? turn.agents : []
  appendRecord({
    sessionId,
    startedAt: turn.startedAt,
    endedAt: now,
    parsed: Boolean(rec),
    model: rec?.model ?? null,
    effort: rec?.effort ?? null,
    taskType: rec?.taskType ?? null,
    estLow: rec?.estLow ?? null,
    estHigh: rec?.estHigh ?? null,
    unit: rec?.unit ?? null,
    delegated: agents.length > 0 || rec?.delegated === true,
    agents,
    usageStart: turn.usage ?? null,
    delta5h: null,
    delta7d: null,
    contaminated: false,
    pending: Boolean(turn.usage),
  })
  return null
}

runHook(import.meta.url, handle)
