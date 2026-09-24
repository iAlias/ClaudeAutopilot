import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tempHome, writeTranscript } from './helpers.mjs'
import { dataFile, claudeDir } from '../lib/paths.mjs'
import { writeJson, readJsonl } from '../lib/json-store.mjs'
import { writeState } from '../lib/state.mjs'
import { readResume, scheduleResume, markResume } from '../lib/resume.mjs'
import { handle } from '../hooks/stop-failure.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const hook = path.join(root, 'hooks', 'stop-failure.mjs')
const resumer = path.join(root, 'scripts', 'resumer.mjs')

const fakeSpawn = (pid = 4242) => {
  const calls = []
  const spawn = (cmd, args, options) => {
    const child = { pid, unrefCalled: false, unref() { this.unrefCalled = true } }
    calls.push({ cmd, args, options, child })
    return child
  }
  return { spawn, calls }
}

const input = (extra = {}) => ({
  session_id: 's1',
  transcript_path: 'C:/t.jsonl',
  cwd: 'C:/work',
  permission_mode: 'acceptEdits',
  hook_event_name: 'StopFailure',
  ...extra,
})

const writeUsage = (entry) => writeJson(dataFile('usage.json'), { sessions: { s1: entry } })

const ENV_KEYS = ['AUTOPILOT_RESUMER', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']
let savedEnv
let home
beforeEach(() => {
  home = tempHome()
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  delete process.env.AUTOPILOT_RESUMER
  process.env.CLAUDECODE = '1'
  process.env.CLAUDE_CODE_ENTRYPOINT = 'cli'
})
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

for (const mode of ['suggest', 'off']) {
  test(`stop-failure does nothing in mode ${mode}`, () => {
    writeState({ mode })
    const { spawn, calls } = fakeSpawn()
    assert.equal(handle(input(), { now: 1000, spawn }), null)
    assert.equal(calls.length, 0)
    assert.deepEqual(readResume(), { sessions: {} })
  })
}

test('stop-failure does nothing when resume is off', () => {
  writeState({ mode: 'auto', resume: false })
  const { spawn, calls } = fakeSpawn()
  handle(input(), { now: 1000, spawn })
  assert.equal(calls.length, 0)
  assert.deepEqual(readResume(), { sessions: {} })
})

test('stop-failure does nothing without a session id', () => {
  writeState({ mode: 'auto' })
  const { spawn, calls } = fakeSpawn()
  handle(input({ session_id: undefined }), { now: 1000, spawn })
  assert.equal(calls.length, 0)
  assert.deepEqual(readResume(), { sessions: {} })
})

for (const marker of ['messenger', 'resume']) {
  test(`stop-failure does nothing inside a ${marker} run started by the resumer`, () => {
    writeState({ mode: 'auto' })
    process.env.AUTOPILOT_RESUMER = marker
    const { spawn, calls } = fakeSpawn()
    handle(input(), { now: 1000, spawn })
    assert.equal(calls.length, 0)
    assert.deepEqual(readResume(), { sessions: {} })
  })
}

const limitHit = (now = 1000, extra = {}) => writeUsage({ at: now - 100, five_hour: 100, seven_day: 40, five_hour_resets_at: now + 49000, ...extra })

test('stop-failure stores the language of the last user prompt', () => {
  writeState({ mode: 'auto' })
  limitHit()
  const { spawn } = fakeSpawn()
  handle(input({ transcript_path: writeTranscript(home, [{ type: 'user', message: { content: 'aggiorna il README e fai il commit' } }]) }), { now: 1000, spawn })
  assert.equal(readResume().sessions.s1.language, 'it')
  handle(input({ session_id: 's2', transcript_path: writeTranscript(home, [{ type: 'user', message: { content: 'update the README and commit' } }]) }), { now: 1000, spawn })
  assert.equal(readResume().sessions.s2.language, 'en')
})

test('stop-failure schedules a resume and starts a detached resumer', () => {
  writeState({ mode: 'auto' })
  writeUsage({ at: 900, five_hour: 100, seven_day: 40, five_hour_resets_at: 50000 })
  const sessions = path.join(claudeDir(), 'sessions')
  fs.mkdirSync(sessions, { recursive: true })
  writeJson(path.join(sessions, `${process.pid}.json`), { pid: process.pid, sessionId: 's1', kind: 'interactive', name: 'work-1a' })
  const { spawn, calls } = fakeSpawn(4242)
  assert.equal(handle(input(), { now: 1000, spawn }), null)
  assert.equal(calls.length, 1)
  const [call] = calls
  assert.equal(call.cmd, process.execPath)
  assert.deepEqual(call.args, [resumer, 's1'])
  const { env, ...options } = call.options
  assert.deepEqual(options, { detached: true, stdio: 'ignore', windowsHide: true })
  assert.equal(env.CLAUDECODE, undefined)
  assert.equal(env.CLAUDE_CODE_ENTRYPOINT, undefined)
  assert.equal(env.AUTOPILOT_HOME, process.env.AUTOPILOT_HOME)
  assert.ok(Object.keys(env).some((k) => k.toUpperCase() === 'PATH'))
  assert.equal(call.child.unrefCalled, true)
  assert.deepEqual(readResume().sessions.s1, {
    cwd: 'C:/work',
    name: 'work-1a',
    resetAt: 50000,
    scheduledAt: 1000,
    permissionMode: 'acceptEdits',
    language: null,
    status: 'waiting',
    via: null,
    pid: 4242,
    note: null,
    autoResumes: 1,
  })
})

test('stop-failure falls back to default values', () => {
  writeState({ mode: 'auto' })
  limitHit()
  const { spawn } = fakeSpawn()
  handle(input({ permission_mode: undefined, cwd: undefined }), { now: 1000, spawn })
  const record = readResume().sessions.s1
  assert.equal(record.resetAt, 50000)
  assert.equal(record.permissionMode, 'default')
  assert.equal(record.name, null)
  assert.equal(record.cwd, null)
})

const usageCases = {
  'no usage reading': null,
  'a reading older than 15 minutes': { at: 1000 - 15 * 60 * 1000, five_hour: 100, seven_day: 40, five_hour_resets_at: 50000 },
  'a five hour window below 95%': { at: 900, five_hour: 94, seven_day: 40, five_hour_resets_at: 50000 },
  'an exhausted weekly limit': { at: 900, five_hour: 100, seven_day: 100, five_hour_resets_at: 50000 },
  'a reset time in the past': { at: 900, five_hour: 100, seven_day: 40, five_hour_resets_at: 1000 },
  'no reset time': { at: 900, five_hour: 100, seven_day: 40 },
}
for (const [label, usage] of Object.entries(usageCases)) {
  test(`stop-failure schedules nothing with ${label}`, () => {
    writeState({ mode: 'auto' })
    if (usage) writeUsage(usage)
    const { spawn, calls } = fakeSpawn()
    assert.equal(handle(input(), { now: 1000, spawn }), null)
    assert.equal(calls.length, 0)
    assert.deepEqual(readResume(), { sessions: {} })
    const log = readJsonl(dataFile('resume.log'))
    assert.equal(log.length, 1)
    assert.equal(log[0].sessionId, 's1')
    assert.equal(log[0].skipped, 'not a 5h limit')
  })
}

test('stop-failure refuses a third automatic resume until the user writes again', () => {
  writeState({ mode: 'auto' })
  limitHit()
  const { spawn, calls } = fakeSpawn(4242)
  handle(input(), { now: 1000, spawn })
  markResume('s1', { status: 'done', via: 'message' })
  handle(input(), { now: 1000, spawn })
  markResume('s1', { status: 'done', via: 'message' })
  assert.equal(readResume().sessions.s1.autoResumes, 2)
  handle(input(), { now: 1000, spawn })
  assert.equal(calls.length, 2)
  assert.equal(readResume().sessions.s1.status, 'done')
  const log = readJsonl(dataFile('resume.log'))
  assert.equal(log.at(-1).skipped, 'auto resume limit')
})

test('stop-failure only updates the reset time while a resumer is live', () => {
  writeState({ mode: 'auto' })
  scheduleResume({ sessionId: 's1', cwd: 'C:/work', resetAt: 9000, now: 500 })
  markResume('s1', { pid: process.pid })
  writeUsage({ at: 900, five_hour: 100, seven_day: 40, five_hour_resets_at: 70000 })
  const { spawn, calls } = fakeSpawn()
  handle(input(), { now: 1000, spawn })
  assert.equal(calls.length, 0)
  const record = readResume().sessions.s1
  assert.equal(record.resetAt, 70000)
  assert.equal(record.pid, process.pid)
})

test('stop-failure does not start a second resumer before the first pid is stored', () => {
  writeState({ mode: 'auto' })
  limitHit(2000)
  scheduleResume({ sessionId: 's1', cwd: 'C:/work', resetAt: 9000, now: 1000 })
  const { spawn, calls } = fakeSpawn()
  handle(input(), { now: 2000, spawn })
  assert.equal(calls.length, 0)
  assert.equal(readResume().sessions.s1.pid, null)
  assert.equal(readResume().sessions.s1.status, 'waiting')
})

test('stop-failure marks the record failed when the resumer cannot start', () => {
  writeState({ mode: 'auto' })
  limitHit()
  handle(input(), { now: 1000, spawn: () => { throw new Error('boom') } })
  const record = readResume().sessions.s1
  assert.equal(record.status, 'failed')
  assert.match(record.note, /boom/)
  handle(input(), { now: 2000, spawn: () => ({ pid: undefined, unref() {} }) })
  assert.equal(readResume().sessions.s1.status, 'failed')
  assert.match(readResume().sessions.s1.note, /resumer/)
})

test('stop-failure runs as a hook, exits 0 and prints nothing', () => {
  writeState({ mode: 'auto' })
  const now = Date.now()
  writeUsage({ at: now, five_hour: 100, seven_day: 40, five_hour_resets_at: now + 3600000 })
  scheduleResume({ sessionId: 's1', resetAt: 9000, now: now - 1000 })
  markResume('s1', { pid: process.pid })
  const env = { ...process.env }
  delete env.AUTOPILOT_RESUMER
  const r = spawnSync(process.execPath, [hook], { input: JSON.stringify(input()), env, encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
  const record = readResume().sessions.s1
  assert.equal(record.resetAt, now + 3600000)
  assert.equal(record.pid, process.pid)
  const bad = spawnSync(process.execPath, [hook], { input: '{oops', env, encoding: 'utf8' })
  assert.equal(bad.status, 0)
  assert.equal(bad.stdout, '')
})
