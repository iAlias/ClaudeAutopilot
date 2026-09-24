import { spawn as nodeSpawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runHook } from '../lib/hook-io.mjs'
import { readState } from '../lib/state.mjs'
import { latestUsage } from '../lib/usage.mjs'
import { fiveHourLimitHit, findOpenSession, scheduleResume, markResume, transcriptLanguage, scrubEnv, appendResumeLog } from '../lib/resume.mjs'

const resumerPath = fileURLToPath(new URL('../scripts/resumer.mjs', import.meta.url))

function startResumer(spawn, sessionId) {
  try {
    const child = spawn(process.execPath, [resumerPath, sessionId], { detached: true, stdio: 'ignore', windowsHide: true, env: scrubEnv(process.env) })
    child.on?.('error', () => {})
    child.unref?.()
    return Number.isInteger(child.pid) ? { pid: child.pid } : { error: 'no pid' }
  } catch (e) {
    return { error: e?.message ?? String(e) }
  }
}

export function handle(input, { now = Date.now(), spawn = nodeSpawn } = {}) {
  if (process.env.AUTOPILOT_RESUMER) return null
  const state = readState()
  if (state.mode !== 'auto' || state.resume === false) return null
  const sessionId = typeof input?.session_id === 'string' && input.session_id ? input.session_id : null
  if (!sessionId) return null
  const usage = latestUsage()
  if (!fiveHourLimitHit(usage, now)) {
    appendResumeLog({ sessionId, skipped: 'not a 5h limit' })
    return null
  }
  const { created, refused } = scheduleResume({
    sessionId,
    cwd: typeof input.cwd === 'string' && input.cwd ? input.cwd : null,
    name: findOpenSession(sessionId)?.name ?? null,
    permissionMode: input.permission_mode ?? 'default',
    language: transcriptLanguage(input.transcript_path),
    resetAt: usage.five_hour_resets_at,
    now,
  })
  if (refused) appendResumeLog({ sessionId, skipped: 'auto resume limit' })
  if (!created) return null
  const started = startResumer(spawn, sessionId)
  if (started.pid) markResume(sessionId, { pid: started.pid })
  else markResume(sessionId, { status: 'failed', note: `resumer did not start: ${started.error}` })
  return null
}

runHook(import.meta.url, handle)
