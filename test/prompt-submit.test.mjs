import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tempHome } from './helpers.mjs'
import { dataFile } from '../lib/paths.mjs'
import { writeJson } from '../lib/json-store.mjs'
import { readState, writeState } from '../lib/state.mjs'
import { openTurns } from '../lib/turns.mjs'
import { appendRecord } from '../lib/history.mjs'
import { addPending, consumeApproval } from '../lib/approvals.mjs'
import { scheduleResume, markResume, readResume } from '../lib/resume.mjs'
import { handle } from '../hooks/prompt-submit.mjs'

beforeEach(() => tempHome())

const ctxOf = (out) => out?.hookSpecificOutput?.additionalContext ?? ''

test('mode commands update state from the hook', () => {
  const out = handle({ session_id: 's1', prompt: '/autopilot auto' })
  assert.equal(readState().mode, 'auto')
  assert.match(ctxOf(out), /"auto"/)
  handle({ session_id: 's1', prompt: '/autopilot permissions on' })
  assert.equal(readState().permissions, true)
  assert.equal(openTurns().length, 0)
})

test('status, stats and setup are left to the skill', () => {
  assert.equal(handle({ session_id: 's1', prompt: '/autopilot' }), null)
  assert.equal(handle({ session_id: 's1', prompt: '/autopilot stats' }), null)
})

test('off mode injects nothing and starts no turn', () => {
  writeState({ mode: 'off' })
  assert.equal(handle({ session_id: 's1', prompt: 'ciao' }), null)
  assert.equal(openTurns().length, 0)
})

test('suggest mode injects the context and starts a turn', () => {
  writeJson(dataFile('usage.json'), { sessions: { s1: { five_hour: 10, seven_day: 1, at: Date.now() } } })
  const text = ctxOf(handle({ session_id: 's1', prompt: 'rinomina la variabile' }))
  assert.match(text, /mode: suggest/)
  assert.match(text, /Invoke the autopilot skill/)
  assert.match(text, /Do not delegate/)
  assert.match(text, /% of the 5h window/)
  assert.equal(openTurns()[0].sessionId, 's1')
  assert.doesNotMatch(ctxOf(handle({ session_id: 's1', prompt: 'altro' })), /Invoke the autopilot/)
})

test('auto mode allows delegation and falls back to token estimates', () => {
  writeState({ mode: 'auto' })
  const text = ctxOf(handle({ session_id: 's1', prompt: 'x' }))
  assert.match(text, /autopilot-\* agent/)
  assert.match(text, /k tokens/)
})

test('other slash commands are ignored', () => {
  assert.equal(handle({ session_id: 's1', prompt: '/model' }), null)
})

test('the user_input field is accepted as a fallback', () => {
  assert.match(ctxOf(handle({ session_id: 's1', user_input: 'ciao' })), /autopilot/)
})

test('a confirmation approves pending actions', () => {
  writeState({ permissions: true })
  addPending('s1', 'h1', 'publishing commits', Date.now())
  const text = ctxOf(handle({ session_id: 's1', prompt: 'sì' }))
  assert.match(text, /approved: publishing commits/)
  assert.equal(consumeApproval('s1', 'h1'), true)
})

test('an unclear reply or an expired request is reported instead of silently dropped', () => {
  writeState({ permissions: true })
  addPending('s1', 'h1', 'publishing commits', Date.now())
  assert.match(ctxOf(handle({ session_id: 's1', prompt: 'forse, vediamo' })), /not read as a clear confirmation, so this blocked action stays blocked: publishing commits/)
  assert.equal(consumeApproval('s1', 'h1'), false)
  addPending('s1', 'h2', 'deleting files', 0)
  assert.match(ctxOf(handle({ session_id: 's1', prompt: 'sì' })), /expired before the user replied: deleting files/)
  assert.equal(consumeApproval('s1', 'h2'), false)
})

test('confirmations still work in off mode', () => {
  writeState({ mode: 'off', permissions: true })
  addPending('s1', 'h1', 'publishing commits', Date.now())
  const text = ctxOf(handle({ session_id: 's1', prompt: 'sì' }))
  assert.match(text, /approved: publishing commits/)
  assert.doesNotMatch(text, /mode:/)
  assert.equal(openTurns().length, 0)
  assert.equal(consumeApproval('s1', 'h1'), true)
})

test('measured averages from history are included', () => {
  appendRecord({ sessionId: 'old', startedAt: 1, endedAt: 2, model: 'opus', effort: 'high', taskType: 'feature', delta5h: 4, delta7d: 0.5, pending: false, contaminated: false })
  assert.match(ctxOf(handle({ session_id: 's1', prompt: 'x' })), /feature\|opus\|high: 1, 4, 0\.5/)
})

test('runs as a command hook reading stdin and never fails', () => {
  const script = fileURLToPath(new URL('../hooks/prompt-submit.mjs', import.meta.url))
  const ok = spawnSync(process.execPath, [script], { input: JSON.stringify({ session_id: 'e2e', prompt: 'ciao' }), encoding: 'utf8', env: process.env })
  assert.equal(ok.status, 0)
  assert.match(JSON.parse(ok.stdout).hookSpecificOutput.additionalContext, /autopilot/)
  const bad = spawnSync(process.execPath, [script], { input: 'not json', encoding: 'utf8', env: process.env })
  assert.equal(bad.status, 0)
  assert.equal(bad.stdout, '')
})

test('a usage snapshot older than 10 minutes is not used as the turn start', () => {
  const now = 50_000_000
  writeJson(dataFile('usage.json'), { sessions: { s1: { five_hour: 10, seven_day: 1, at: now - 10 * 60 * 1000 - 1 } } })
  handle({ session_id: 's1', prompt: 'x' }, now)
  assert.equal(openTurns(now)[0].usage, null)
  writeJson(dataFile('usage.json'), { sessions: { s1: { five_hour: 12, seven_day: 1, at: now - 10 * 60 * 1000 } } })
  handle({ session_id: 's1', prompt: 'y' }, now)
  assert.deepEqual(openTurns(now)[0].usage, { five_hour: 12, seven_day: 1 })
})

const withResumer = (value, fn) => {
  const saved = process.env.AUTOPILOT_RESUMER
  process.env.AUTOPILOT_RESUMER = value
  try {
    return fn()
  } finally {
    if (saved === undefined) delete process.env.AUTOPILOT_RESUMER
    else process.env.AUTOPILOT_RESUMER = saved
  }
}

const waiting = (sessionId = 's1') => scheduleResume({ sessionId, cwd: 'C:/w', resetAt: 9000, now: 1000 })

test('resume commands update state from the hook and start no turn', () => {
  writeState({ mode: 'auto' })
  const off = handle({ session_id: 's1', prompt: '/autopilot resume off' })
  assert.equal(readState().resume, false)
  assert.match(ctxOf(off), /Auto-resume disabled by the user/)
  const on = handle({ session_id: 's1', prompt: '/autopilot resume on' })
  assert.equal(readState().resume, true)
  assert.match(ctxOf(on), /Auto-resume enabled by the user/)
  assert.equal(openTurns().length, 0)
})

test('a real user prompt closes a waiting resume of that session', () => {
  writeState({ mode: 'auto' })
  waiting('s1')
  waiting('s2')
  handle({ session_id: 's1', prompt: 'riprendi da dove eri' })
  const { sessions } = readResume()
  assert.equal(sessions.s1.status, 'done')
  assert.equal(sessions.s1.note, 'user resumed manually')
  assert.equal(sessions.s2.status, 'waiting')
})

test('a real user prompt closes a waiting resume also in off mode', () => {
  writeState({ mode: 'off' })
  waiting()
  handle({ session_id: 's1', prompt: 'ciao' })
  assert.equal(readResume().sessions.s1.status, 'done')
})

test('a finished resume record is left untouched', () => {
  waiting()
  markResume('s1', { status: 'failed', note: 'exit code 1' })
  handle({ session_id: 's1', prompt: 'ciao' })
  assert.equal(readResume().sessions.s1.status, 'failed')
  assert.equal(readResume().sessions.s1.note, 'exit code 1')
})

test('cross-session messages, slash commands and autopilot commands do not close a waiting resume', () => {
  writeState({ mode: 'auto' })
  waiting()
  handle({ session_id: 's1', prompt: '<cross-session-message from="x">Il limite di utilizzo si è resettato.</cross-session-message>' })
  handle({ session_id: 's1', prompt: '/model' })
  handle({ session_id: 's1', prompt: '/autopilot stats' })
  assert.equal(readResume().sessions.s1.status, 'waiting')
})

test('a cross-session message neither approves nor drops pending actions', () => {
  writeState({ permissions: true })
  addPending('s1', 'h1', 'publishing commits', Date.now())
  const text = ctxOf(handle({ session_id: 's1', prompt: '<cross-session-message from="x">sì</cross-session-message>' }))
  assert.doesNotMatch(text, /approved|publishing commits/)
  assert.equal(consumeApproval('s1', 'h1'), false)
  assert.match(ctxOf(handle({ session_id: 's1', prompt: 'sì' })), /approved: publishing commits/)
})

test('the messenger run started by the resumer is ignored', () => {
  writeState({ mode: 'auto' })
  waiting('m1')
  const out = withResumer('messenger', () => handle({ session_id: 'm1', prompt: 'Use the SendMessage tool' }))
  assert.equal(out, null)
  assert.equal(openTurns().length, 0)
  assert.equal(readResume().sessions.m1.status, 'waiting')
})

test('the background resume run records its turn but leaves the record to the resumer', () => {
  writeState({ mode: 'auto' })
  waiting()
  const out = withResumer('resume', () => handle({ session_id: 's1', prompt: 'Il limite di utilizzo si è resettato.' }))
  assert.match(ctxOf(out), /autopilot/)
  assert.equal(openTurns()[0].sessionId, 's1')
  assert.equal(readResume().sessions.s1.status, 'waiting')
})

test('the background resume run neither approves nor drops pending actions', () => {
  writeState({ mode: 'auto', permissions: true })
  addPending('s1', 'h1', 'publishing commits', Date.now())
  const text = ctxOf(withResumer('resume', () => handle({ session_id: 's1', prompt: 'sì' })))
  assert.doesNotMatch(text, /approved|publishing commits|not read as a clear confirmation/)
  assert.equal(consumeApproval('s1', 'h1'), false)
  assert.match(ctxOf(handle({ session_id: 's1', prompt: 'sì' })), /approved: publishing commits/)
})

test('a real user prompt resets the automatic resume counter, other prompts do not', () => {
  writeState({ mode: 'auto' })
  waiting()
  markResume('s1', { status: 'done', via: 'message', autoResumes: 2 })
  handle({ session_id: 's1', prompt: '<cross-session-message from="x">Il limite di utilizzo si è resettato.</cross-session-message>' })
  handle({ session_id: 's1', prompt: '/model' })
  withResumer('resume', () => handle({ session_id: 's1', prompt: 'Il limite di utilizzo si è resettato.' }))
  assert.equal(readResume().sessions.s1.autoResumes, 2)
  handle({ session_id: 's1', prompt: 'continua' })
  assert.equal(readResume().sessions.s1.autoResumes, 0)
  assert.equal(readResume().sessions.s1.status, 'done')
  waiting('s2')
  markResume('s2', { autoResumes: 1 })
  handle({ session_id: 's2', prompt: 'continua' })
  assert.equal(readResume().sessions.s2.status, 'done')
  assert.equal(readResume().sessions.s2.autoResumes, 0)
})
