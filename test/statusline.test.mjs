import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tempHome } from './helpers.mjs'
import { latestUsage } from '../lib/usage.mjs'
import { writeState } from '../lib/state.mjs'

const script = fileURLToPath(new URL('../statusline/statusline.mjs', import.meta.url))
const fixture = fileURLToPath(new URL('../fixtures/echo-statusline.mjs', import.meta.url))
const run = (input) => spawnSync(process.execPath, [script], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env: process.env })

beforeEach(() => tempHome())

test('renders model, quotas and mode, and records usage', () => {
  const r = run({ session_id: 's9', model: { display_name: 'Opus' }, rate_limits: { five_hour: { used_percentage: 42 }, seven_day: { used_percentage: 7 } } })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /Opus/)
  assert.match(r.stdout, /42%/)
  assert.match(r.stdout, /🧭 suggest/)
  const u = latestUsage()
  assert.equal(u.sessionId, 's9')
  assert.equal(u.five_hour, 42)
  assert.equal(u.seven_day, 7)
})

test('does not record usage without rate limits', () => {
  run({ session_id: 's9', model: { display_name: 'X' } })
  assert.equal(latestUsage(), null)
})

test('shows auto mode and the permissions badge', () => {
  writeState({ mode: 'auto', permissions: true })
  const r = run({ session_id: 's9', model: { display_name: 'X' } })
  assert.match(r.stdout, /🧭 auto/)
  assert.match(r.stdout, /🛡/)
})

test('wrap mode prints the wrapped statusline and still records usage', () => {
  writeState({ wrappedStatusline: `"${process.execPath}" "${fixture}"` })
  const r = run({ session_id: 's9', rate_limits: { five_hour: { used_percentage: 5 } } })
  assert.equal(r.stdout, 'WRAPPED s9')
  assert.equal(latestUsage().five_hour, 5)
})

test('invalid input exits quietly', () => {
  const r = run('nope')
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
})

test('wrap mode falls back to the autopilot statusline when the wrapped one prints nothing or fails', () => {
  const input = { session_id: 's9', model: { display_name: 'Opus' }, rate_limits: { five_hour: { used_percentage: 5 } } }
  writeState({ wrappedStatusline: `"${process.execPath}" -e "0"` })
  const empty = run(input)
  assert.equal(empty.status, 0)
  assert.match(empty.stdout, /Opus/)
  assert.match(empty.stdout, /🧭 suggest/)
  writeState({ wrappedStatusline: `"${process.execPath}" -e "process.stdout.write('x');process.exit(3)"` })
  assert.match(run(input).stdout, /Opus/)
  assert.equal(latestUsage().five_hour, 5)
})

test('on Windows the wrapped statusline runs through CLAUDE_CODE_GIT_BASH_PATH', { skip: process.platform !== 'win32' }, () => {
  writeState({ wrappedStatusline: `"${process.execPath}" "${fixture}"` })
  const input = JSON.stringify({ session_id: 's9', model: { display_name: 'Opus' } })
  const r = spawnSync(process.execPath, [script], { input, encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_GIT_BASH_PATH: process.execPath } })
  assert.equal(r.status, 0)
  assert.doesNotMatch(r.stdout, /WRAPPED/)
  assert.match(r.stdout, /Opus/)
})
