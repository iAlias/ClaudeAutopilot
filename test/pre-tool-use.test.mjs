import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tempHome } from './helpers.mjs'
import { dataFile, dataDir } from '../lib/paths.mjs'
import { writeState } from '../lib/state.mjs'
import { resolvePending } from '../lib/approvals.mjs'
import { writeJson, readJsonl } from '../lib/json-store.mjs'
import { startTurn } from '../lib/turns.mjs'
import { handle } from '../hooks/pre-tool-use.mjs'

let cwd
beforeEach(() => {
  cwd = path.join(tempHome(), 'proj')
  fs.mkdirSync(cwd, { recursive: true })
})

const decision = (out) => out?.hookSpecificOutput?.permissionDecision
const bash = (command) => ({ session_id: 's1', tool_name: 'Bash', tool_input: { command }, cwd })

test('does nothing when the permissions module is off', () => {
  assert.equal(handle(bash('git push')), null)
})

test('allows safe actions without logging', () => {
  writeState({ permissions: true })
  assert.equal(decision(handle(bash('git status'))), 'allow')
  assert.equal(fs.existsSync(dataFile('permissions.log')), false)
})

test('allows and logs other actions', () => {
  writeState({ permissions: true })
  assert.equal(decision(handle(bash('python script.py'))), 'allow')
  assert.match(fs.readFileSync(dataFile('permissions.log'), 'utf8'), /python script\.py/)
})

test('blocks risky actions, then allows them once after confirmation', () => {
  writeState({ permissions: true })
  const first = handle(bash('git push origin main'))
  assert.equal(decision(first), 'deny')
  assert.match(first.hookSpecificOutput.permissionDecisionReason, /publishing commits/)
  resolvePending('s1', 'sì')
  assert.equal(decision(handle(bash('git push origin main'))), 'allow')
  assert.equal(decision(handle(bash('git push origin main'))), 'deny')
})

test('writing the approvals file is blocked', () => {
  writeState({ permissions: true })
  const out = handle({ session_id: 's1', tool_name: 'Write', tool_input: { file_path: dataFile('approvals.json') }, cwd: dataDir() })
  assert.equal(decision(out), 'deny')
})

test('rules errors are logged once, not on every call', () => {
  writeState({ permissions: true })
  writeJson(dataFile('permissions.json'), { riskyShell: [{ id: 'bad', pattern: '(' }] })
  handle(bash('git status'))
  handle(bash('git status'))
  handle(bash('git status'))
  const lines = readJsonl(dataFile('permissions.log'))
  const errorLines = lines.filter((l) => l.category === 'rules-error')
  assert.equal(errorLines.length, 1)
})

test('MCP tools, web fetches and interactive tools get no decision and no log', () => {
  writeState({ permissions: true })
  for (const tool_name of ['mcp__slack__send_message', 'WebFetch', 'AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode']) {
    assert.equal(handle({ session_id: 's1', tool_name, tool_input: { url: 'https://x' }, cwd }), null, tool_name)
  }
  assert.equal(fs.existsSync(dataFile('permissions.log')), false)
})

test('plan mode gets no decision for any tool', () => {
  writeState({ permissions: true })
  assert.equal(handle({ ...bash('git push origin main'), permission_mode: 'plan' }), null)
  assert.equal(handle({ ...bash('git status'), permission_mode: 'plan' }), null)
  assert.equal(handle({ session_id: 's1', tool_name: 'Read', tool_input: { file_path: 'a.js' }, cwd, permission_mode: 'plan' }), null)
  assert.equal(fs.existsSync(dataFile('pending.json')), false)
})

test('two actions blocked in the same turn are both unlocked by one confirmation', () => {
  writeState({ permissions: true })
  const push = handle(bash('git push origin main'))
  const wipe = handle(bash('rm -rf ../old-build'))
  assert.equal(decision(push), 'deny')
  assert.equal(decision(wipe), 'deny')
  for (const out of [push, wipe]) assert.match(out.hookSpecificOutput.permissionDecisionReason, /all actions waiting for the user's confirmation/i)
  assert.equal(resolvePending('s1', 'sì').approved.length, 2)
  assert.equal(decision(handle(bash('git push origin main'))), 'allow')
  assert.equal(decision(handle(bash('rm -rf ../old-build'))), 'allow')
  assert.equal(decision(handle(bash('rm -rf ../old-build'))), 'deny')
})

test('the messenger run started by the resumer gets no decision and blocks nothing', () => {
  writeState({ permissions: true })
  const saved = process.env.AUTOPILOT_RESUMER
  process.env.AUTOPILOT_RESUMER = 'messenger'
  try {
    assert.equal(handle(bash('git push origin main')), null)
    assert.equal(handle({ session_id: 's1', tool_name: 'SendMessage', tool_input: { to: 'x' }, cwd }), null)
  } finally {
    if (saved === undefined) delete process.env.AUTOPILOT_RESUMER
    else process.env.AUTOPILOT_RESUMER = saved
  }
  assert.equal(fs.existsSync(dataFile('pending.json')), false)
  assert.equal(fs.existsSync(dataFile('permissions.log')), false)
  assert.equal(decision(handle(bash('git push origin main'))), 'deny')
})

test('blocked actions are tagged with the start of the current turn and older turns expire', () => {
  writeState({ permissions: true })
  startTurn('s1', null, 1000)
  handle(bash('git push origin main'), 1500)
  startTurn('s1', null, 5000)
  handle(bash('rm -rf ../old-build'), 5500)
  const pending = JSON.parse(fs.readFileSync(dataFile('pending.json'), 'utf8'))
  assert.deepEqual(pending.map((e) => e.turnStart), [1000, 5000])
  const r = resolvePending('s1', 'sì', 6000)
  assert.equal(r.approved.length, 1)
  assert.equal(r.expired.length, 1)
  assert.equal(decision(handle(bash('rm -rf ../old-build'), 6100)), 'allow')
  assert.equal(decision(handle(bash('git push origin main'), 6200)), 'deny')
})
