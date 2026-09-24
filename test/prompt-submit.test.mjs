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
