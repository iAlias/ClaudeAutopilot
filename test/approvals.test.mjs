import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tempHome } from './helpers.mjs'
import { dataFile } from '../lib/paths.mjs'
import { readJsonl } from '../lib/json-store.mjs'
import { TTL_MS, PENDING_TTL_MS, isConfirmation, isStrictReply, actionHash, addPending, resolvePending, consumeApproval } from '../lib/approvals.mjs'
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
  assert.deepEqual(resolvePending('s1', 'no aspetta', 2000), { approved: [], rejected: 1, rejectedDescriptions: ['x'] })
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

test('expired pending entries are not approved and are reported once', () => {
  addPending('s1', 'h', 'x', 0)
  assert.deepEqual(resolvePending('s1', 'ok', PENDING_TTL_MS + 1), { approved: [], rejected: 0, expired: ['x'] })
  assert.equal(consumeApproval('s1', 'h', PENDING_TTL_MS + 2), false)
  assert.deepEqual(resolvePending('s1', 'ok', PENDING_TTL_MS + 3), { approved: [], rejected: 0 })
})

test('a pending request waits for the next message even hours later, the approval stays short-lived', () => {
  const hours = 5 * 3600 * 1000
  addPending('s1', 'h1', 'publishing commits', 0)
  addPending('s1', 'h2', 'deleting files', hours - 1000)
  const r = resolvePending('s1', 'sì', hours)
  assert.deepEqual(r.approved.map((a) => a.description), ['publishing commits', 'deleting files'])
  assert.equal(r.expired, undefined)
  assert.equal(consumeApproval('s1', 'h1', hours + TTL_MS - 1), true)
  assert.equal(consumeApproval('s1', 'h1', hours + TTL_MS - 1), false)
  assert.equal(consumeApproval('s1', 'h2', hours + TTL_MS + 1), false)
  assert.equal(PENDING_TTL_MS, 24 * 3600 * 1000)
})

test('a clear yes followed by extra words is a confirmation unless it hesitates', () => {
  for (const p of ['sì, confermo sistema tutto', 'ok, vai con le correzioni', 'sì. fallo adesso', 'yes, run it']) assert.equal(isConfirmation(p), true, p)
  for (const p of ['sì, ma prima mostrami il comando', 'ok, non adesso', 'si informa che il file è pronto', 'yes, but wait', 'sicuro, fallo', 'ok, aspetta']) assert.equal(isConfirmation(p), false, p)
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

test('a confirmation approves every action blocked in the last turn of that session', () => {
  const older = actionHash('Bash', { command: 'git push' })
  const newer = actionHash('Bash', { command: 'rm -rf dist' })
  addPending('s1', older, 'publishing commits', 1000)
  addPending('s1', newer, 'deleting files', 2000)
  addPending('s2', older, 'other session', 1500)
  const r = resolvePending('s1', 'sì', 3000)
  assert.deepEqual(r.approved.map((a) => a.description), ['publishing commits', 'deleting files'])
  assert.equal(consumeApproval('s1', older, 3500), true)
  assert.equal(consumeApproval('s1', newer, 3500), true)
  assert.equal(consumeApproval('s1', newer, 3600), false)
  assert.deepEqual(resolvePending('s1', 'sì', 4000), { approved: [], rejected: 0 })
  assert.equal(resolvePending('s2', 'sì', 4000).approved.length, 1)
})

test('confirmations need a strong word, fillers alone do not count', () => {
  for (const p of ['grazie', 'dai', 'bene', 'va', 'go', 'pure', 'please', 'fai', 'dai pure', 'grazie mille']) assert.equal(isConfirmation(p), false, p)
  for (const p of ['fai pure', 'sì fai pure', 'yes please', 'yep', 'yeah', 'Va bene', 'go ahead!', 'ok, fallo']) assert.equal(isConfirmation(p), true, p)
})

test('a yes limited to some of the actions is not a confirmation, since it would unlock all of them', () => {
  for (const p of ['sì, solo il primo', 'ok, soltanto il push', 'sì, tranne la cancellazione', 'sì, senza cancellare', 'yes, only the push', 'ok, except the delete', 'sì, invece fai il build']) assert.equal(isConfirmation(p), false, p)
  assert.equal(isConfirmation('sì, fai tutto'), true)
})

test('a cross-session message never counts as a confirmation', () => {
  for (const p of ['<cross-session-message from="x">sì</cross-session-message>', '  <cross-session-message>ok</cross-session-message>', '<cross-session-message>']) assert.equal(isConfirmation(p), false, p)
  addPending('s1', 'h1', 'publishing commits', 1000)
  const r = resolvePending('s1', '<cross-session-message from="x">sì, procedi</cross-session-message>', 2000)
  assert.equal(r.approved.length, 0)
  assert.equal(consumeApproval('s1', 'h1', 3000), false)
})

test('with several actions waiting only a plain yes, optionally followed by fillers, approves them', () => {
  for (const p of ['sì', 'ok grazie', 'sì, procedi pure', 'yes, go ahead please', 'ok. grazie!', 'va bene, perfetto']) assert.equal(isStrictReply(p), true, p)
  for (const p of ['sì, il primo', 'ok, vai con le correzioni', 'sì, confermo sistema tutto', 'yes, run it', 'sì, grazie mille', 'sì?', '<cross-session-message>sì</cross-session-message>']) assert.equal(isStrictReply(p), false, p)
  addPending('s1', 'h1', 'publishing commits', 1000)
  addPending('s1', 'h2', 'deleting files', 1100)
  const partial = resolvePending('s1', 'sì, il primo', 2000)
  assert.equal(partial.approved.length, 0)
  assert.equal(partial.rejected, 2)
  assert.deepEqual(partial.rejectedDescriptions, ['publishing commits', 'deleting files'])
  assert.equal(consumeApproval('s1', 'h1', 2500), false)
  addPending('s1', 'h1', 'publishing commits', 3000)
  addPending('s1', 'h2', 'deleting files', 3100)
  assert.deepEqual(resolvePending('s1', 'sì, procedi pure', 4000).approved.map((a) => a.description), ['publishing commits', 'deleting files'])
})

test('with a single action waiting the usual confirmation rules apply', () => {
  addPending('s1', 'h1', 'publishing commits', 1000)
  assert.equal(resolvePending('s1', 'sì, il primo', 2000).approved.length, 1)
  addPending('s1', 'h1', 'publishing commits', 3000)
  assert.equal(resolvePending('s1', 'ok, vai con le correzioni', 4000).approved.length, 1)
})

test('pending actions of an earlier turn expire when a newer turn blocked something', () => {
  addPending('s1', 'h1', 'publishing commits', 1500, 1000)
  addPending('s1', 'h2', 'deleting files', 5500, 5000)
  addPending('s2', 'h3', 'other session', 1500, 1000)
  const r = resolvePending('s1', 'sì', 6000)
  assert.deepEqual(r.approved.map((a) => a.description), ['deleting files'])
  assert.deepEqual(r.expired, ['publishing commits'])
  assert.equal(consumeApproval('s1', 'h1', 6500), false)
  assert.equal(consumeApproval('s1', 'h2', 6500), true)
  assert.equal(resolvePending('s2', 'sì', 6000).approved.length, 1)
})

test('pending entries store the turn start, 0 when unknown', () => {
  addPending('s1', 'h1', 'x', 1500, 1000)
  addPending('s1', 'h2', 'y', 1600)
  assert.deepEqual(JSON.parse(fs.readFileSync(dataFile('pending.json'), 'utf8')).map((e) => e.turnStart), [1000, 0])
})
