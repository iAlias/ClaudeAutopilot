import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { tempHome, writeTranscript } from './helpers.mjs'
import { startTurn, endTurn, addDelegation, openTurns } from '../lib/turns.mjs'
import { readHistory } from '../lib/history.mjs'
import { handle as stop } from '../hooks/stop.mjs'
import { handle as subagentStop } from '../hooks/subagent-stop.mjs'

let dir
beforeEach(() => {
  dir = tempHome()
})

const transcript = (text) => writeTranscript(dir, [
  { type: 'user', message: { content: 'fai x' } },
  { type: 'assistant', message: { content: [{ type: 'text', text }] } },
])

test('stop records the turn with the parsed recommendation', () => {
  startTurn('s1', { five_hour: 10, seven_day: 1 }, 1000)
  addDelegation('s1', 'autopilot:autopilot-sonnet-low')
  stop({ session_id: 's1', transcript_path: transcript('🧭 Sonnet · low · ~1–2% 5h · small-code → delegato\nfatto') }, 2000)
  const [r] = readHistory()
  assert.equal(r.model, 'sonnet')
  assert.equal(r.effort, 'low')
  assert.equal(r.taskType, 'small-code')
  assert.equal(r.delegated, true)
  assert.equal(r.pending, true)
  assert.equal(r.startedAt, 1000)
  assert.equal(r.endedAt, 2000)
  assert.deepEqual(r.agents, ['autopilot:autopilot-sonnet-low'])
  assert.deepEqual(r.usageStart, { five_hour: 10, seven_day: 1 })
  assert.equal(openTurns(2001).length, 0)
})

test('stop without an open turn does nothing', () => {
  stop({ session_id: 's1', transcript_path: transcript('x') }, 2000)
  assert.deepEqual(readHistory(), [])
})

test('stop_hook_active leaves the turn open', () => {
  startTurn('s1', null, 1000)
  stop({ session_id: 's1', stop_hook_active: true }, 2000)
  assert.deepEqual(readHistory(), [])
  assert.equal(openTurns(2001).length, 1)
})

test('a turn without usage is recorded as not pending; a missing line as unparsed', () => {
  startTurn('s1', null, 1000)
  stop({ session_id: 's1', transcript_path: transcript('nessuna riga') }, 2000)
  const [r] = readHistory()
  assert.equal(r.pending, false)
  assert.equal(r.parsed, false)
  assert.equal(r.model, null)
})

test('subagent-stop records only autopilot agents', () => {
  startTurn('s1', null, 1)
  subagentStop({ session_id: 's1', agent_type: 'Explore' })
  subagentStop({ session_id: 's1', agent_type: 'autopilot-opus-high' })
  subagentStop({ session_id: 's1' })
  assert.deepEqual(endTurn('s1').agents, ['autopilot-opus-high'])
})

for (const [marker, recorded] of [['messenger', 0], ['resume', 1]]) {
  test(`stop inside a ${marker} run of the resumer ${recorded ? 'records' : 'skips'} the turn`, () => {
    const saved = process.env.AUTOPILOT_RESUMER
    process.env.AUTOPILOT_RESUMER = marker
    try {
      startTurn('s1', null, 1000)
      stop({ session_id: 's1', transcript_path: transcript('x') }, 2000)
    } finally {
      if (saved === undefined) delete process.env.AUTOPILOT_RESUMER
      else process.env.AUTOPILOT_RESUMER = saved
    }
    assert.equal(readHistory().length, recorded)
  })
}
