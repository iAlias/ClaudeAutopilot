import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tempHome } from './helpers.mjs'
import { claudeDir, dataDir } from '../lib/paths.mjs'
import { readJson, writeJson } from '../lib/json-store.mjs'
import { readState } from '../lib/state.mjs'
import { computeStats } from '../lib/history.mjs'
import { renderStats, renderResumes } from '../scripts/stats.mjs'
import { plan, apply, statuslineCommand } from '../scripts/setup.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
let settingsPath
beforeEach(() => {
  tempHome()
  settingsPath = path.join(claudeDir(), 'settings.json')
})

test('renderStats prints a table or an empty message', () => {
  assert.equal(renderStats(computeStats([])), 'No turns recorded yet.')
  const text = renderStats(computeStats([{ sessionId: 's', model: 'sonnet', effort: 'low', estLow: 1, estHigh: 2, unit: 'pct5h', delta5h: 3, delegated: true, pending: false, contaminated: false }]))
  assert.match(text, /\| sonnet \| low \| 1 \| 1 \| 1\.5 \| 3 \|/)
  assert.match(text, /Total: 1/)
})

test('plan reports current and proposed statusline', () => {
  writeJson(settingsPath, { statusLine: { type: 'command', command: 'node old.mjs' } })
  const p = plan()
  assert.equal(p.current.command, 'node old.mjs')
  assert.equal(p.proposed.command, statuslineCommand())
  assert.match(statuslineCommand(), /statusline\.mjs"$/)
})

test('apply replace installs statusline, backs up settings and writes no user skill', () => {
  writeJson(settingsPath, { model: 'opus', statusLine: { type: 'command', command: 'node old.mjs' } })
  const r = apply('replace', 123)
  const s = readJson(settingsPath, null)
  assert.equal(s.model, 'opus')
  assert.equal(s.statusLine.command, statuslineCommand())
  assert.equal(r.backup, `${settingsPath}.bak-autopilot-123`)
  assert.ok(fs.existsSync(r.backup))
  assert.ok(fs.existsSync(path.join(dataDir(), 'statusline.mjs')))
  assert.equal(fs.existsSync(path.join(claudeDir(), 'skills', 'autopilot', 'SKILL.md')), false)
  assert.equal(readState().wrappedStatusline, null)
})

test('apply wrap keeps the previous statusline command, also when re-run', () => {
  writeJson(settingsPath, { statusLine: { type: 'command', command: 'node old.mjs' } })
  apply('wrap', 1)
  assert.equal(readState().wrappedStatusline, 'node old.mjs')
  apply('wrap', 2)
  assert.equal(readState().wrappedStatusline, 'node old.mjs')
})

test('invalid settings.json aborts without writing anything', () => {
  fs.writeFileSync(settingsPath, '{oops')
  assert.throws(() => apply('replace', 1))
  assert.equal(fs.readFileSync(settingsPath, 'utf8'), '{oops')
  assert.equal(fs.existsSync(path.join(dataDir(), 'statusline.mjs')), false)
})

test('works without an existing settings.json and rejects unknown modes', () => {
  const r = apply('replace', 1)
  assert.equal(r.backup, null)
  assert.equal(readJson(settingsPath, null).statusLine.command, statuslineCommand())
  assert.throws(() => apply('boh', 2))
})

test('the skill declares its name and every task type', () => {
  const skill = fs.readFileSync(path.join(root, 'skills', 'autopilot', 'SKILL.md'), 'utf8')
  assert.match(skill, /^---\nname: autopilot\n/)
  for (const t of ['question', 'trivial', 'small-code', 'feature', 'multi-file', 'architecture', 'critical']) assert.match(skill, new RegExp('`' + t + '`'))
  assert.match(skill, /autopilot-haiku/)
})

test('a settings.json with a UTF-8 BOM is read by plan and apply', () => {
  fs.writeFileSync(settingsPath, '\uFEFF' + JSON.stringify({ model: 'opus', statusLine: { type: 'command', command: 'node old.mjs' } }))
  assert.equal(plan().current.command, 'node old.mjs')
  apply('wrap', 7)
  const s = readJson(settingsPath, null)
  assert.equal(s.model, 'opus')
  assert.equal(s.statusLine.command, statuslineCommand())
  assert.equal(readState().wrappedStatusline, 'node old.mjs')
})

test('renderResumes counts resumes by outcome and channel', () => {
  assert.equal(renderResumes({}), null)
  const sessions = {
    a: { status: 'done', via: 'message' },
    b: { status: 'done', via: 'resume' },
    c: { status: 'done', via: 'resume' },
    d: { status: 'done', via: null, note: 'user resumed manually' },
    e: { status: 'skipped', note: 'weekly limit' },
    f: { status: 'failed', via: 'resume' },
    g: { status: 'failed', via: 'message' },
  }
  assert.equal(renderResumes(sessions), 'Resumes: done 4 (message 1, background 2, manual 1) · skipped 1 · failed 2')
  assert.equal(renderResumes({ ...sessions, h: { status: 'waiting' }, i: null }), 'Resumes: done 4 (message 1, background 2, manual 1) · skipped 1 · failed 2 · waiting 1')
  assert.equal(renderResumes({ ...sessions, h: { status: 'waiting' }, j: { status: 'lost' } }), 'Resumes: done 4 (message 1, background 2, manual 1) · skipped 1 · failed 2 · lost 1 · waiting 1')
})

test('the stats script appends the resume line after the table', () => {
  writeJson(path.join(dataDir(), 'resume.json'), { sessions: { a: { status: 'done', via: 'message' } } })
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'stats.mjs')], { env: process.env, encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /^No turns recorded yet\.\r?\n\r?\nResumes: done 1 \(message 1, background 0\) · skipped 0 · failed 0/)
})
