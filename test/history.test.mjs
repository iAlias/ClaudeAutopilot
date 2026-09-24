import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tempHome } from './helpers.mjs'
import { dataFile } from '../lib/paths.mjs'
import { writeJson } from '../lib/json-store.mjs'
import { latestUsage } from '../lib/usage.mjs'
import { startTurn, endTurn, addDelegation, openTurns, markSession, STALE_MS } from '../lib/turns.mjs'
import { appendRecord, readHistory, finalizePending, computeAverages, computeStats } from '../lib/history.mjs'

beforeEach(() => tempHome())

const base = (over = {}) => ({
  sessionId: 's1', startedAt: 1000, endedAt: 2000, parsed: true,
  model: 'sonnet', effort: 'low', taskType: 'small-code',
  estLow: 1, estHigh: 2, unit: 'pct5h', delegated: true, agents: [],
  usageStart: { five_hour: 10, seven_day: 1 },
  delta5h: null, delta7d: null, contaminated: false, pending: true,
  ...over,
})

test('latestUsage picks the most recent snapshot and tolerates bad files', () => {
  assert.equal(latestUsage(), null)
  writeJson(dataFile('usage.json'), { sessions: { a: { five_hour: 10, seven_day: 2, at: 100 }, b: { five_hour: 12, seven_day: 3, at: 200 } } })
  assert.deepEqual(latestUsage(), { sessionId: 'b', five_hour: 12, seven_day: 3, five_hour_resets_at: null, seven_day_resets_at: null, at: 200 })
  fs.writeFileSync(dataFile('usage.json'), 'nope')
  assert.equal(latestUsage(), null)
})

test('turns: start, delegate, end', () => {
  startTurn('s1', { five_hour: 10, seven_day: 1, at: 1 }, 1000)
  assert.equal(addDelegation('s1', 'autopilot-sonnet-low'), true)
  assert.equal(addDelegation('nope', 'x'), false)
  assert.deepEqual(endTurn('s1'), { startedAt: 1000, usage: { five_hour: 10, seven_day: 1 }, agents: ['autopilot-sonnet-low'] })
  assert.equal(endTurn('s1'), null)
})

test('openTurns ignores stale turns', () => {
  startTurn('old', null, 0)
  startTurn('new', null, STALE_MS + 10)
  assert.deepEqual(openTurns(STALE_MS + 20).map((t) => t.sessionId), ['new'])
})

test('markSession is true only the first time', () => {
  assert.equal(markSession('s1', 1), true)
  assert.equal(markSession('s1', 2), false)
  assert.equal(markSession('s2', 3), true)
})

test('finalizePending waits for usage no older than 30 seconds before the turn end', () => {
  appendRecord(base({ startedAt: 100000, endedAt: 200000 }))
  assert.equal(finalizePending({ five_hour: 13, seven_day: 1.5, at: 169999 }, []), 0)
  assert.equal(finalizePending({ five_hour: 13, seven_day: 1.5, at: 170000 }, []), 1)
  const [r] = readHistory()
  assert.equal(r.pending, false)
  assert.equal(r.delta5h, 3)
  assert.equal(r.delta7d, 0.5)
  assert.equal(r.contaminated, false)
  assert.equal(finalizePending(null, []), 0)
})

test('finalizePending drops negative deltas caused by a window reset', () => {
  appendRecord(base())
  finalizePending({ five_hour: 2, seven_day: 1, at: 2500 }, [])
  const [r] = readHistory()
  assert.equal(r.delta5h, null)
  assert.equal(r.delta7d, 0)
})

test('overlapping turns from other sessions mark the record contaminated', () => {
  appendRecord(base())
  appendRecord(base({ sessionId: 's2', startedAt: 1500, endedAt: 1800, pending: false }))
  finalizePending({ five_hour: 13, seven_day: 1, at: 2500 }, [])
  assert.equal(readHistory()[0].contaminated, true)
})

test('an open turn in another session contaminates too', () => {
  appendRecord(base())
  finalizePending({ five_hour: 13, seven_day: 1, at: 2500 }, [{ sessionId: 's3', startedAt: 2200 }])
  assert.equal(readHistory()[0].contaminated, true)
})

test('turns of other sessions that ended before the start do not contaminate', () => {
  appendRecord(base({ sessionId: 's2', startedAt: 100, endedAt: 500, pending: false }))
  appendRecord(base())
  finalizePending({ five_hour: 13, seven_day: 1, at: 2500 }, [])
  assert.equal(readHistory()[1].contaminated, false)
})

test('computeAverages ignores pending and contaminated records', () => {
  const recs = [
    base({ pending: false, delta5h: 2, delta7d: 0.2 }),
    base({ pending: false, delta5h: 4, delta7d: 0.4 }),
    base({ pending: false, delta5h: 50, contaminated: true }),
    base({ pending: true, delta5h: 50 }),
  ]
  assert.deepEqual(computeAverages(recs), [{ key: 'small-code|sonnet|low', n: 2, avg5h: 3, avg7d: 0.3 }])
})

test('computeStats summarises by model and effort', () => {
  const recs = [
    base({ pending: false, delta5h: 2 }),
    base({ pending: false, delta5h: 4, delegated: false }),
    base({ pending: true }),
    base({ pending: false, model: null, parsed: false }),
    base({ pending: false, contaminated: true }),
  ]
  const s = computeStats(recs)
  assert.deepEqual(s.rows, [{ model: 'sonnet', effort: 'low', turns: 2, delegated: 1, estAvg5h: 1.5, actAvg5h: 3 }])
  assert.equal(s.pending, 1)
  assert.equal(s.unparsed, 1)
  assert.equal(s.contaminated, 1)
  assert.equal(s.total, 5)
})
