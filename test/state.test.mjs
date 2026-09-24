import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tempHome } from './helpers.mjs'
import { dataFile } from '../lib/paths.mjs'
import { readJson, writeJson, readJsonl, writeJsonl, appendJsonl } from '../lib/json-store.mjs'
import { readState, writeState, parseCommand } from '../lib/state.mjs'

beforeEach(() => tempHome())

test('readJson returns the fallback for missing or invalid files', () => {
  assert.deepEqual(readJson(dataFile('nope.json'), { a: 1 }), { a: 1 })
  writeJson(dataFile('bad.json'), {})
  fs.writeFileSync(dataFile('bad.json'), '{not json')
  assert.equal(readJson(dataFile('bad.json'), null), null)
})

test('writeJson creates the directory and round-trips', () => {
  writeJson(dataFile('x.json'), { mode: 'auto' })
  assert.deepEqual(readJson(dataFile('x.json'), null), { mode: 'auto' })
})

test('readJsonl skips broken lines', () => {
  appendJsonl(dataFile('h.jsonl'), { n: 1 })
  fs.appendFileSync(dataFile('h.jsonl'), 'garbage\n')
  appendJsonl(dataFile('h.jsonl'), { n: 2 })
  assert.deepEqual(readJsonl(dataFile('h.jsonl')).map((r) => r.n), [1, 2])
  assert.deepEqual(readJsonl(dataFile('missing.jsonl')), [])
})

test('writeJsonl rewrites the whole file', () => {
  appendJsonl(dataFile('h.jsonl'), { n: 1 })
  writeJsonl(dataFile('h.jsonl'), [{ n: 5 }])
  assert.deepEqual(readJsonl(dataFile('h.jsonl')), [{ n: 5 }])
})

test('readState defaults to suggest with permissions off', () => {
  assert.deepEqual(readState(), { mode: 'suggest', permissions: false, wrappedStatusline: null, resume: true })
})

test('readState repairs corrupted state', () => {
  writeJson(dataFile('state.json'), { mode: 'turbo', permissions: 'yes' })
  assert.deepEqual(readState(), { mode: 'suggest', permissions: false, wrappedStatusline: null, resume: true })
  fs.writeFileSync(dataFile('state.json'), '###')
  assert.equal(readState().mode, 'suggest')
  fs.writeFileSync(dataFile('state.json'), '[1,2]')
  assert.equal(readState().mode, 'suggest')
})

test('writeState merges patches', () => {
  writeState({ mode: 'auto' })
  writeState({ permissions: true })
  assert.deepEqual(readState(), { mode: 'auto', permissions: true, wrappedStatusline: null, resume: true })
})

test('state keeps the resume flag, true unless explicitly false', () => {
  writeState({ resume: false })
  assert.equal(readState().resume, false)
  writeState({ mode: 'auto' })
  assert.equal(readState().resume, false)
  writeState({ resume: true })
  assert.equal(readState().resume, true)
  writeJson(dataFile('state.json'), { resume: 'no' })
  assert.equal(readState().resume, true)
})

test('parseCommand recognises autopilot commands', () => {
  assert.deepEqual(parseCommand('/autopilot auto'), { action: 'mode', mode: 'auto' })
  assert.deepEqual(parseCommand('/autopilot:autopilot OFF'), { action: 'mode', mode: 'off' })
  assert.deepEqual(parseCommand('  /autopilot  '), { action: 'status' })
  assert.deepEqual(parseCommand('/autopilot permissions on'), { action: 'permissions', value: true })
  assert.deepEqual(parseCommand('/autopilot permissions off'), { action: 'permissions', value: false })
  assert.deepEqual(parseCommand('/autopilot permission on'), { action: 'permissions', value: true })
  assert.deepEqual(parseCommand('/autopilot permission off'), { action: 'permissions', value: false })
  assert.deepEqual(parseCommand('/autopilot perms on'), { action: 'permissions', value: true })
  assert.deepEqual(parseCommand('/autopilot perms off'), { action: 'permissions', value: false })
  assert.deepEqual(parseCommand('/autopilot resume on'), { action: 'resume', value: true })
  assert.deepEqual(parseCommand('/autopilot RESUME OFF'), { action: 'resume', value: false })
  assert.deepEqual(parseCommand('/autopilot resume'), { action: 'unknown', arg: 'resume' })
  assert.deepEqual(parseCommand('/autopilot stats'), { action: 'stats' })
  assert.deepEqual(parseCommand('/autopilot setup'), { action: 'setup' })
  assert.deepEqual(parseCommand('/autopilot boh'), { action: 'unknown', arg: 'boh' })
  assert.equal(parseCommand('/autopilotx auto'), null)
  assert.equal(parseCommand('attiva autopilot auto'), null)
  assert.equal(parseCommand(undefined), null)
})
