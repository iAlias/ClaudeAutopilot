import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tempHome } from './helpers.mjs'
import { dataFile } from '../lib/paths.mjs'
import { readJsonl } from '../lib/json-store.mjs'
import { TTL_MS, isConfirmation, actionHash, addPending, resolvePending, consumeApproval } from '../lib/approvals.mjs'
import { logPermission } from '../lib/log.mjs'

beforeEach(() => tempHome())

test('actionHash is stable and input-sensitive', () => {
  assert.equal(actionHash('Bash', { command: 'git push' }), actionHash('Bash', { command: ' git push ' }))
  assert.notEqual(actionHash('Bash', { command: 'git push' }), actionHash('Bash', { command: 'git push -f' }))
  assert.notEqual(actionHash('Bash', { command: 'x' }), actionHash('PowerShell', { command: 'x' }))
})

test('pending, confirmation, single-use approval', () => {
  const h = actionHash('Bash', { command: 'git push' })
  addPending('s1', h, 'publishing commits', 1000)
  const r = resolvePending('s1', 'sì, procedi', 2000)
  assert.equal(r.approved.length, 1)
  assert.equal(r.approved[0].description, 'publishing commits')
  assert.equal(consumeApproval('s1', h, 3000), true)
  assert.equal(consumeApproval('s1', h, 3000), false)
})

test('a non-confirming reply clears pending without approving', () => {
  const h = actionHash('Bash', { command: 'git push' })
  addPending('s1', h, 'x', 1000)
  assert.deepEqual(resolvePending('s1', 'no aspetta', 2000), { approved: [], rejected: 1 })
  assert.equal(consumeApproval('s1', h, 3000), false)
  assert.deepEqual(resolvePending('s1', 'sì', 4000), { approved: [], rejected: 0 })
})

test('questions are never confirmations', () => {
  for (const p of ['si può evitare?', 'ok ma perché?', 'sicuro di no', 'okkio', '', 'certo che no', 'si ma non sono sicuro', 'si informa che non è possibile', 'ok però prima controlla i test', 'procedi con cautela ma fammi sapere', 'yes but wait', 'y']) assert.equal(isConfirmation(p), false, p)
  for (const p of ['sì', 'Si', 'ok', 'procedi pure', 'yes', 'va bene.', 'Sì!', 'vai', 'sì, procedi', 'ok grazie', 'go ahead']) assert.equal(isConfirmation(p), true, p)
})

test('approvals are per session and expire', () => {
  addPending('s1', 'h', 'x', 0)
  resolvePending('s1', 'ok', 0)
  assert.equal(consumeApproval('s2', 'h', 1), false)
  assert.equal(consumeApproval('s1', 'h', TTL_MS + 1), false)
})

test('expired pending entries are ignored', () => {
  addPending('s1', 'h', 'x', 0)
  assert.deepEqual(resolvePending('s1', 'ok', TTL_MS + 1), { approved: [], rejected: 0 })
})

test('corrupted files are treated as empty', () => {
  addPending('s1', 'h', 'x', 0)
  fs.writeFileSync(dataFile('pending.json'), '{')
  assert.deepEqual(resolvePending('s1', 'ok', 1), { approved: [], rejected: 0 })
})

test('logPermission appends JSON lines', () => {
  logPermission({ ts: 1, category: 'other' })
  logPermission({ ts: 2, category: 'blocked' })
  assert.deepEqual(readJsonl(dataFile('permissions.log')).map((e) => e.ts), [1, 2])
})

test('a confirmation approves only the most recent pending action', () => {
  const older = actionHash('Bash', { command: 'git push' })
  const newer = actionHash('Bash', { command: 'rm -rf dist' })
  addPending('s1', older, 'publishing commits', 1000)
  addPending('s1', newer, 'deleting files', 2000)
  addPending('s2', older, 'other session', 1500)
  const r = resolvePending('s1', 'sì', 3000)
  assert.deepEqual(r.approved.map((a) => a.description), ['deleting files'])
  assert.equal(consumeApproval('s1', older, 3500), false)
  assert.equal(consumeApproval('s1', newer, 3500), true)
  assert.deepEqual(resolvePending('s1', 'sì', 4000), { approved: [], rejected: 0 })
  assert.equal(resolvePending('s2', 'sì', 4000).approved.length, 1)
})

test('confirmations need a strong word, fillers alone do not count', () => {
  for (const p of ['grazie', 'dai', 'bene', 'va', 'go', 'pure', 'please', 'fai', 'dai pure', 'grazie mille']) assert.equal(isConfirmation(p), false, p)
  for (const p of ['fai pure', 'sì fai pure', 'yes please', 'yep', 'yeah', 'Va bene', 'go ahead!', 'ok, fallo']) assert.equal(isConfirmation(p), true, p)
})
