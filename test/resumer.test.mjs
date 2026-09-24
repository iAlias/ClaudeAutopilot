import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tempHome } from './helpers.mjs'
import { dataFile, claudeDir } from '../lib/paths.mjs'
import { writeJson, readJsonl } from '../lib/json-store.mjs'
import { writeState } from '../lib/state.mjs'
import { RESUME_MARGIN_MS, readResume, scheduleResume, markResume, resumePrompt } from '../lib/resume.mjs'
import { runResumer, defaultExec, messengerInstruction, safePermissionMode } from '../scripts/resumer.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const fakeClaude = path.join(root, 'fixtures', 'fake-claude.mjs')
const resumerScript = path.join(root, 'scripts', 'resumer.mjs')

const ENV_KEYS = ['AUTOPILOT_CLAUDE_BIN', 'AUTOPILOT_FAKE_CLAUDE_OUT', 'AUTOPILOT_FAKE_CLAUDE_EXIT', 'AUTOPILOT_FAKE_CLAUDE_STDOUT', 'AUTOPILOT_FAKE_CLAUDE_SLEEP', 'AUTOPILOT_RESUMER', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']
let home
let work
let savedEnv
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  home = tempHome()
  process.env.AUTOPILOT_CLAUDE_BIN = fakeClaude
  process.env.AUTOPILOT_FAKE_CLAUDE_OUT = path.join(home, 'fake-claude.jsonl')
  delete process.env.AUTOPILOT_FAKE_CLAUDE_EXIT
  delete process.env.AUTOPILOT_FAKE_CLAUDE_STDOUT
  delete process.env.AUTOPILOT_FAKE_CLAUDE_SLEEP
  delete process.env.AUTOPILOT_RESUMER
  work = path.join(home, 'work')
  fs.mkdirSync(work)
  writeState({ mode: 'auto' })
})
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

const clock = (start = 1000) => {
  const c = { t: start, sleeps: [] }
  c.now = () => c.t
  c.sleep = async (ms) => {
    c.sleeps.push(ms)
    c.t += ms
  }
  return c
}

const SENT = { status: 0, error: null, output: 'Message sent.\nAUTOPILOT_RESUME_SENT\n' }

const recorder = (result = { status: 0, error: null, output: '' }) => {
  const calls = []
  const exec = (bin, args, options) => {
    calls.push({ bin, args, options })
    return typeof result === 'function' ? result(args, options) : result
  }
  return { exec, calls }
}

const schedule = (extra = {}) => scheduleResume({ sessionId: 's1', cwd: work, name: 'work-1a', permissionMode: 'acceptEdits', resetAt: 151000, now: 1000, ...extra })

const openSession = (data = {}) => {
  const dir = path.join(claudeDir(), 'sessions')
  fs.mkdirSync(dir, { recursive: true })
  writeJson(path.join(dir, `${process.pid}.json`), { pid: process.pid, sessionId: 's1', kind: 'interactive', name: 'work-1a', ...data })
}

const fakeRuns = () => readJsonl(process.env.AUTOPILOT_FAKE_CLAUDE_OUT)

test('resumer waits until the reset plus margin in steps of at most a minute', async () => {
  schedule()
  const c = clock()
  const { exec, calls } = recorder()
  await runResumer('s1', { now: c.now, sleep: c.sleep, exec })
  assert.deepEqual(c.sleeps, [60000, 60000, 60000, 60000, 30000])
  assert.equal(c.t, 151000 + RESUME_MARGIN_MS)
  assert.equal(calls.length, 1)
})

test('resumer resumes a closed session in background in its cwd', async () => {
  schedule()
  const c = clock()
  const { exec, calls } = recorder()
  const record = await runResumer('s1', { now: c.now, sleep: c.sleep, exec })
  assert.equal(calls[0].bin, fakeClaude)
  assert.deepEqual(calls[0].args, ['-p', resumePrompt(), '--resume', 's1', '--permission-mode', 'acceptEdits'])
  assert.equal(calls[0].options.cwd, work)
  assert.equal(calls[0].options.marker, 'resume')
  assert.equal(calls[0].options.timeout, undefined)
  assert.equal(record.status, 'done')
  assert.equal(record.via, 'resume')
  assert.equal(readResume().sessions.s1.status, 'done')
  assert.equal(readResume().sessions.s1.via, 'resume')
  const [log] = readJsonl(dataFile('resume.log'))
  assert.equal(log.sessionId, 's1')
  assert.equal(log.status, 'done')
  assert.equal(log.via, 'resume')
})

test('resumer sends a message to an open session through a haiku run', async () => {
  schedule({ name: 'old-name' })
  openSession()
  const c = clock()
  const { exec, calls } = recorder(SENT)
  const record = await runResumer('s1', { now: c.now, sleep: c.sleep, exec })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].args, ['-p', messengerInstruction('work-1a', resumePrompt()), '--model', 'haiku', '--permission-mode', 'dontAsk', '--tools', 'ListAgents,SendMessage', '--allowedTools', 'ListAgents,SendMessage'])
  assert.equal(calls[0].options.cwd, work)
  assert.equal(calls[0].options.marker, 'messenger')
  assert.equal(calls[0].options.timeout, 5 * 60 * 1000)
  assert.equal(record.status, 'done')
  assert.equal(record.via, 'message')
  assert.equal(readJsonl(dataFile('resume.log'))[0].via, 'message')
})

test('messenger instruction names the session and carries the exact resume text on one line', () => {
  const text = messengerInstruction('work-1a', resumePrompt())
  assert.match(text, /SendMessage/)
  assert.match(text, /session named work-1a/)
  assert.ok(text.includes(`[[${resumePrompt()}]]`))
  assert.doesNotMatch(text, /["\r\n%]/)
  assert.match(text, /only if SendMessage succeeded.*exactly AUTOPILOT_RESUME_SENT/i)
})

test('a messenger run without the sent marker fails while the session is still open', async () => {
  schedule()
  openSession()
  const c = clock()
  const { exec, calls } = recorder({ status: 0, error: null, output: 'I could not find the session.' })
  const record = await runResumer('s1', { now: c.now, sleep: c.sleep, exec })
  assert.equal(calls.length, 1)
  assert.equal(record.status, 'failed')
  assert.equal(record.via, 'message')
  assert.match(record.note, /not confirmed/)
})

test('a messenger run with the marker but a non zero exit is not a success', async () => {
  schedule()
  openSession()
  const c = clock()
  const { exec, calls } = recorder({ ...SENT, status: 1 })
  const record = await runResumer('s1', { now: c.now, sleep: c.sleep, exec })
  assert.equal(calls.length, 1)
  assert.equal(record.status, 'failed')
  assert.match(record.note, /not confirmed: exit code 1/)
})

test('the sent marker counts only on the last line', async () => {
  schedule()
  openSession()
  const c = clock()
  const { exec } = recorder({ status: 0, error: null, output: 'AUTOPILOT_RESUME_SENT\nbut then it failed' })
  assert.equal((await runResumer('s1', { now: c.now, sleep: c.sleep, exec })).status, 'failed')
})

test('a messenger run without the marker falls back to a background resume once the session is closed', async () => {
  schedule()
  openSession()
  const c = clock()
  const { exec, calls } = recorder((args) => {
    if (!args.includes('--resume')) fs.rmSync(path.join(claudeDir(), 'sessions'), { recursive: true, force: true })
    return { status: 0, error: null, output: '' }
  })
  const record = await runResumer('s1', { now: c.now, sleep: c.sleep, exec })
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[1].args, ['-p', resumePrompt(), '--resume', 's1', '--permission-mode', 'acceptEdits'])
  assert.equal(calls[1].options.marker, 'resume')
  assert.equal(record.status, 'done')
  assert.equal(record.via, 'resume')
})

test('resumer skips a resume that wakes more than six hours after the reset', async () => {
  schedule()
  const c = clock(151000 + 6 * 3600 * 1000 + 1)
  const { exec, calls } = recorder()
  const record = await runResumer('s1', { now: c.now, sleep: c.sleep, exec })
  assert.equal(calls.length, 0)
  assert.equal(record.status, 'skipped')
  assert.equal(record.note, 'too late')
  schedule({ sessionId: 's2' })
  const late = clock(151000 + 6 * 3600 * 1000)
  const second = recorder()
  await runResumer('s2', { now: late.now, sleep: late.sleep, exec: second.exec })
  assert.equal(second.calls.length, 1)
})

test('resumer fails without running when the cwd no longer exists', async () => {
  schedule({ cwd: path.join(home, 'gone') })
  const c = clock()
  const { exec, calls } = recorder()
  const record = await runResumer('s1', { now: c.now, sleep: c.sleep, exec })
  assert.equal(calls.length, 0)
  assert.equal(record.status, 'failed')
  assert.equal(record.note, 'cwd missing')
})

test('resumer uses the recorded name when the open session has none', async () => {
  schedule()
  openSession({ name: undefined })
  const c = clock()
  const { exec, calls } = recorder(SENT)
  await runResumer('s1', { now: c.now, sleep: c.sleep, exec })
  assert.equal(calls[0].args[1], messengerInstruction('work-1a', resumePrompt()))
})

test('resumer fails an open session without any name instead of resuming it twice', async () => {
  schedule({ name: null })
  openSession({ name: undefined })
  const c = clock()
  const { exec, calls } = recorder()
  const record = await runResumer('s1', { now: c.now, sleep: c.sleep, exec })
  assert.equal(calls.length, 0)
  assert.equal(record.status, 'failed')
  assert.equal(record.via, 'message')
  assert.match(record.note, /name/)
})

test('resumer skips when the weekly limit is still exhausted', async () => {
  schedule()
  writeJson(dataFile('usage.json'), { sessions: { s1: { at: 2000, five_hour: 0, seven_day: 100 } } })
  const c = clock()
  const { exec, calls } = recorder()
  const record = await runResumer('s1', { now: c.now, sleep: c.sleep, exec })
  assert.equal(calls.length, 0)
  assert.equal(record.status, 'skipped')
  assert.equal(record.note, 'weekly limit')
  assert.equal(readResume().sessions.s1.status, 'skipped')
  assert.equal(readJsonl(dataFile('resume.log'))[0].status, 'skipped')
})

test('resumer ignores weekly usage older than the scheduling', async () => {
  schedule()
  writeJson(dataFile('usage.json'), { sessions: { s1: { at: 500, five_hour: 100, seven_day: 100 } } })
  const c = clock()
  const { exec, calls } = recorder()
  await runResumer('s1', { now: c.now, sleep: c.sleep, exec })
  assert.equal(calls.length, 1)
})

test('resumer exits without running when the record is closed while waiting', async () => {
  schedule()
  const c = clock()
  const sleep = async (ms) => {
    await c.sleep(ms)
    if (c.sleeps.length === 2) markResume('s1', { status: 'done', note: 'user resumed manually' })
  }
  const { exec, calls } = recorder()
  assert.equal(await runResumer('s1', { now: c.now, sleep, exec }), null)
  assert.equal(calls.length, 0)
  assert.equal(c.sleeps.length, 2)
  assert.equal(readResume().sessions.s1.note, 'user resumed manually')
  assert.deepEqual(readJsonl(dataFile('resume.log')), [])
})

test('resumer exits without running when there is no record', async () => {
  const c = clock()
  const { exec, calls } = recorder()
  assert.equal(await runResumer('s1', { now: c.now, sleep: c.sleep, exec }), null)
  assert.equal(calls.length, 0)
  assert.deepEqual(c.sleeps, [])
})

test('resumer exits at once when another resumer owns the record', async () => {
  schedule()
  markResume('s1', { pid: 4242 })
  const c = clock()
  const { exec, calls } = recorder()
  assert.equal(await runResumer('s1', { now: c.now, sleep: c.sleep, exec, pid: 1234 }), null)
  assert.equal(calls.length, 0)
  assert.deepEqual(c.sleeps, [])
  assert.equal(readResume().sessions.s1.status, 'waiting')
})

test('resumer runs when it owns the record', async () => {
  schedule()
  markResume('s1', { pid: 1234 })
  const c = clock()
  const { exec, calls } = recorder()
  await runResumer('s1', { now: c.now, sleep: c.sleep, exec, pid: 1234 })
  assert.equal(calls.length, 1)
})

for (const patch of [{ mode: 'suggest' }, { mode: 'off' }, { resume: false }]) {
  test(`resumer skips when autopilot changes to ${JSON.stringify(patch)} while waiting`, async () => {
    schedule()
    const c = clock()
    const sleep = async (ms) => {
      await c.sleep(ms)
      writeState(patch)
    }
    const { exec, calls } = recorder()
    const record = await runResumer('s1', { now: c.now, sleep, exec })
    assert.equal(calls.length, 0)
    assert.equal(record.status, 'skipped')
    assert.equal(record.note, 'resume disabled')
  })
}

test('resumer marks the record failed on a non zero exit code', async () => {
  schedule()
  const c = clock()
  const { exec } = recorder({ status: 3, error: null })
  const record = await runResumer('s1', { now: c.now, sleep: c.sleep, exec })
  assert.equal(record.status, 'failed')
  assert.equal(record.via, 'resume')
  assert.match(record.note, /exit code 3/)
  assert.equal(readJsonl(dataFile('resume.log'))[0].status, 'failed')
})

test('resumer marks the record failed when the command cannot run', async () => {
  schedule()
  const c = clock()
  const { exec } = recorder({ status: null, error: 'spawn claude ENOENT' })
  const record = await runResumer('s1', { now: c.now, sleep: c.sleep, exec })
  assert.equal(record.status, 'failed')
  assert.match(record.note, /ENOENT/)
})

test('resumer marks the record failed when exec throws', async () => {
  schedule()
  const c = clock()
  const record = await runResumer('s1', { now: c.now, sleep: c.sleep, exec: () => { throw new Error('kaboom') } })
  assert.equal(record.status, 'failed')
  assert.match(record.note, /kaboom/)
})

test('defaultExec runs the fake claude with args, cwd and the resumer marker', async () => {
  const cwd = fs.mkdtempSync(path.join(home, 'cwd-'))
  const r = await defaultExec(fakeClaude, ['-p', 'x y', resumePrompt()], { cwd, marker: 'messenger' })
  assert.deepEqual(r, { status: 0, error: null, output: '' })
  const [run] = fakeRuns()
  assert.deepEqual(run.args, ['-p', 'x y', resumePrompt()])
  assert.equal(fs.realpathSync(run.cwd), fs.realpathSync(cwd))
  assert.equal(run.resumer, 'messenger')
  await defaultExec(fakeClaude, [], {})
  assert.equal(fakeRuns()[1].resumer, 'resume')
})

test('defaultExec returns the last 2000 characters of the output', async () => {
  process.env.AUTOPILOT_FAKE_CLAUDE_STDOUT = `${'x'.repeat(3000)}\nAUTOPILOT_RESUME_SENT\n`
  const r = await defaultExec(fakeClaude, [], {})
  assert.equal(r.status, 0)
  assert.equal(r.output.length, 2000)
  assert.ok(r.output.endsWith('\nAUTOPILOT_RESUME_SENT\n'))
})

test('defaultExec removes the inherited Claude Code session variables', async () => {
  const env = { ...process.env, CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CODE_SSE_PORT: '1234', CLAUDE_CONFIG_DIR: 'kept', CLAUDE_CODE_USE_BEDROCK: '1', AUTOPILOT_RESUMER: 'stale' }
  await defaultExec(fakeClaude, [], { env, marker: 'messenger' })
  const [run] = fakeRuns()
  assert.equal(run.env.CLAUDECODE, undefined)
  assert.equal(run.env.CLAUDE_CODE_ENTRYPOINT, undefined)
  assert.equal(run.env.CLAUDE_CODE_SSE_PORT, undefined)
  assert.equal(run.env.CLAUDE_CONFIG_DIR, 'kept')
  assert.equal(run.env.CLAUDE_CODE_USE_BEDROCK, '1')
  assert.equal(run.resumer, 'messenger')
})

test('defaultExec uses the process environment without the session variables by default', async () => {
  process.env.CLAUDECODE = '1'
  process.env.CLAUDE_CODE_ENTRYPOINT = 'cli'
  await defaultExec(fakeClaude, [], {})
  const [run] = fakeRuns()
  assert.equal(run.env.CLAUDECODE, undefined)
  assert.equal(run.env.CLAUDE_CODE_ENTRYPOINT, undefined)
})

test('defaultExec stops a run that exceeds its timeout', async () => {
  process.env.AUTOPILOT_FAKE_CLAUDE_SLEEP = '20000'
  const start = Date.now()
  const r = await defaultExec(fakeClaude, [], { timeout: 500 })
  assert.ok(Date.now() - start < 15000, `${Date.now() - start} ms`)
  assert.equal(r.status, null)
  assert.match(r.error, /timed out/)
})

test('defaultExec reports the exit code and spawn errors', async () => {
  process.env.AUTOPILOT_FAKE_CLAUDE_EXIT = '5'
  assert.equal((await defaultExec(fakeClaude, [], {})).status, 5)
  const missing = await defaultExec(path.join(home, 'missing-bin'), [], {})
  assert.equal(missing.status, null)
  assert.match(missing.error, /ENOENT/)
})

test('defaultExec reports a missing cwd without looking for a wrapper', async () => {
  const r = await defaultExec(fakeClaude, [], { cwd: path.join(home, 'gone') })
  assert.deepEqual(r, { status: null, error: 'cwd missing', output: '' })
  assert.deepEqual(fakeRuns(), [])
})

test('defaultExec falls back to a .cmd wrapper on Windows', { skip: process.platform !== 'win32' }, async () => {
  const bin = path.join(home, 'bin')
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, 'claude.cmd'), `@"${process.execPath}" "${fakeClaude}" %*\r\n`)
  const args = ['-p', messengerInstruction('work-1a', resumePrompt()), '--tools', 'ListAgents,SendMessage', resumePrompt('en'), 'a\\b\\', '']
  const r = await defaultExec(path.join(bin, 'claude'), args, {})
  assert.deepEqual(r, { status: 0, error: null, output: '' })
  assert.deepEqual(fakeRuns()[0].args, args)
})

test('defaultExec stops the whole wrapper tree on Windows when it times out', { skip: process.platform !== 'win32' }, async () => {
  const bin = path.join(home, 'bin')
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, 'claude.cmd'), `@"${process.execPath}" "${fakeClaude}" %*\r\n`)
  process.env.AUTOPILOT_FAKE_CLAUDE_SLEEP = '20000'
  const start = Date.now()
  const r = await defaultExec(path.join(bin, 'claude'), [], { timeout: 1000 })
  assert.ok(Date.now() - start < 15000, `${Date.now() - start} ms`)
  assert.match(r.error, /timed out/)
})

test('resumer runs as a script and resumes through the configured binary', () => {
  scheduleResume({ sessionId: 's1', cwd: home, name: null, permissionMode: 'default', resetAt: Date.now() - RESUME_MARGIN_MS - 1000, now: Date.now() - 1000 })
  const r = spawnSync(process.execPath, [resumerScript, 's1'], { env: process.env, encoding: 'utf8', timeout: 30000 })
  assert.equal(r.status, 0)
  const record = readResume().sessions.s1
  assert.equal(record.status, 'done')
  assert.equal(record.via, 'resume')
  const [run] = fakeRuns()
  assert.deepEqual(run.args, ['-p', resumePrompt(), '--resume', 's1', '--permission-mode', 'default'])
  assert.equal(fs.realpathSync(run.cwd), fs.realpathSync(home))
  assert.equal(run.resumer, 'resume')
})

test('resumer script without a session id exits 0', () => {
  const r = spawnSync(process.execPath, [resumerScript], { env: process.env, encoding: 'utf8', timeout: 30000 })
  assert.equal(r.status, 0)
  assert.deepEqual(fakeRuns(), [])
})

test('safePermissionMode keeps known modes and never resumes with permissions bypassed', () => {
  for (const m of ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk']) assert.equal(safePermissionMode(m), m)
  for (const m of ['bypassPermissions', 'yolo', '', null, undefined, 42]) assert.equal(safePermissionMode(m), 'default', String(m))
})

for (const permissionMode of ['bypassPermissions', 'something-else']) {
  test(`resumer resumes in default mode when the record says ${permissionMode}`, async () => {
    schedule({ permissionMode })
    const c = clock()
    const { exec, calls } = recorder()
    await runResumer('s1', { now: c.now, sleep: c.sleep, exec })
    assert.deepEqual(calls[0].args.slice(2), ['--resume', 's1', '--permission-mode', 'default'])
  })
}

test('resumer uses the language stored in the record', async () => {
  schedule({ language: 'en' })
  const c = clock()
  const { exec, calls } = recorder()
  await runResumer('s1', { now: c.now, sleep: c.sleep, exec })
  assert.equal(calls[0].args[1], resumePrompt('en'))
  scheduleResume({ sessionId: 's2', cwd: work, name: 'work-1a', language: 'en', resetAt: 151000, now: 1000 })
  openSession({ sessionId: 's2' })
  const second = recorder(SENT)
  await runResumer('s2', { now: c.now, sleep: c.sleep, exec: second.exec })
  assert.equal(second.calls[0].args[1], messengerInstruction('work-1a', resumePrompt('en')))
})
