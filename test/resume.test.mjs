import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { tempHome, writeTranscript } from './helpers.mjs'
import { dataFile, claudeDir } from '../lib/paths.mjs'
import { readJson, writeJson, readJsonl } from '../lib/json-store.mjs'
import {
  RESUME_MARGIN_MS,
  SCHEDULE_GRACE_MS,
  readResume,
  pendingResume,
  markResume,
  scheduleResume,
  isPidAlive,
  findOpenSession,
  resumePrompt,
  appendResumeLog,
  detectLanguage,
  transcriptLanguage,
  scrubEnv,
  fiveHourLimitHit,
  clearAutoResumes,
  LATE_RESUME_MS,
  MAX_AUTO_RESUMES,
  USAGE_FRESH_MS,
} from '../lib/resume.mjs'

const deadPid = () => spawnSync(process.execPath, ['-e', '0']).pid

const writeSession = (dir, pid, data) => {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${pid}.json`), JSON.stringify(data))
}

let home
beforeEach(() => {
  home = tempHome()
})

test('constants', () => {
  assert.equal(RESUME_MARGIN_MS, 120000)
  assert.equal(LATE_RESUME_MS, 6 * 3600 * 1000)
})

test('readResume tolerates missing and broken files', () => {
  assert.deepEqual(readResume(), { sessions: {} })
  writeJson(dataFile('resume.json'), { sessions: [1] })
  assert.deepEqual(readResume(), { sessions: {} })
  fs.writeFileSync(dataFile('resume.json'), 'nope')
  assert.deepEqual(readResume(), { sessions: {} })
})

test('scheduleResume creates a waiting record', () => {
  const r = scheduleResume({ sessionId: 's1', cwd: 'C:/w', name: 'work-1a', permissionMode: 'auto', language: 'en', resetAt: 9000, now: 1000 })
  assert.equal(r.created, true)
  assert.deepEqual(r.record, { cwd: 'C:/w', name: 'work-1a', resetAt: 9000, scheduledAt: 1000, permissionMode: 'auto', language: 'en', status: 'waiting', via: null, pid: null, note: null, autoResumes: 1 })
  assert.deepEqual(readJson(dataFile('resume.json'), null), { sessions: { s1: r.record } })
})

test('scheduleResume defaults the optional fields', () => {
  const { record } = scheduleResume({ sessionId: 's1', resetAt: 9000, now: 1000 })
  assert.equal(record.cwd, null)
  assert.equal(record.name, null)
  assert.equal(record.permissionMode, 'default')
})

test('scheduleResume keeps a single waiting record while its pid is alive', () => {
  scheduleResume({ sessionId: 's1', cwd: 'C:/w', name: 'n', permissionMode: 'auto', resetAt: 9000, now: 1000 })
  markResume('s1', { pid: process.pid })
  const r = scheduleResume({ sessionId: 's1', cwd: 'C:/other', name: 'x', permissionMode: 'default', resetAt: 12000, now: 2000 })
  assert.equal(r.created, false)
  assert.equal(r.record.resetAt, 12000)
  assert.equal(r.record.scheduledAt, 1000)
  assert.equal(r.record.cwd, 'C:/w')
  assert.equal(r.record.pid, process.pid)
  assert.equal(readResume().sessions.s1.resetAt, 12000)
})

test('scheduleResume replaces a waiting record whose pid is dead', () => {
  scheduleResume({ sessionId: 's1', cwd: 'C:/w', resetAt: 9000, now: 1000 })
  markResume('s1', { pid: deadPid() })
  const r = scheduleResume({ sessionId: 's1', cwd: 'C:/new', resetAt: 12000, now: 2000 })
  assert.equal(r.created, true)
  assert.equal(r.record.cwd, 'C:/new')
  assert.equal(r.record.scheduledAt, 2000)
  assert.equal(r.record.pid, null)
})

test('scheduleResume treats a fresh waiting record without pid as live', () => {
  assert.equal(SCHEDULE_GRACE_MS, 60000)
  scheduleResume({ sessionId: 's1', cwd: 'C:/w', resetAt: 9000, now: 1000 })
  const r = scheduleResume({ sessionId: 's1', cwd: 'C:/other', resetAt: 12000, now: 1000 + SCHEDULE_GRACE_MS - 1 })
  assert.equal(r.created, false)
  assert.equal(r.record.resetAt, 12000)
  assert.equal(r.record.cwd, 'C:/w')
  assert.equal(r.record.scheduledAt, 1000)
})

test('scheduleResume replaces a waiting record without pid once the grace period is over', () => {
  scheduleResume({ sessionId: 's1', cwd: 'C:/w', resetAt: 9000, now: 1000 })
  const r = scheduleResume({ sessionId: 's1', cwd: 'C:/new', resetAt: 12000, now: 1000 + SCHEDULE_GRACE_MS })
  assert.equal(r.created, true)
  assert.equal(r.record.cwd, 'C:/new')
  assert.equal(r.record.scheduledAt, 1000 + SCHEDULE_GRACE_MS)
})

test('scheduleResume ignores the grace period for a record scheduled in the future', () => {
  scheduleResume({ sessionId: 's1', resetAt: 9000, now: 5000 })
  const r = scheduleResume({ sessionId: 's1', resetAt: 12000, now: 1000 })
  assert.equal(r.created, true)
  assert.equal(r.record.scheduledAt, 1000)
})

test('scheduleResume replaces a finished record', () => {
  scheduleResume({ sessionId: 's1', resetAt: 9000, now: 1000 })
  markResume('s1', { status: 'done', via: 'resume', pid: process.pid })
  const r = scheduleResume({ sessionId: 's1', resetAt: 12000, now: 2000 })
  assert.equal(r.created, true)
  assert.equal(r.record.status, 'waiting')
  assert.equal(r.record.via, null)
})

test('scheduleResume leaves other sessions untouched', () => {
  scheduleResume({ sessionId: 's1', resetAt: 9000, now: 1000 })
  scheduleResume({ sessionId: 's2', resetAt: 9500, now: 1500 })
  assert.deepEqual(Object.keys(readResume().sessions).sort(), ['s1', 's2'])
})

test('markResume merges a patch and ignores unknown sessions', () => {
  scheduleResume({ sessionId: 's1', resetAt: 9000, now: 1000 })
  const rec = markResume('s1', { status: 'done', via: 'message', note: 'ok' })
  assert.equal(rec.status, 'done')
  assert.equal(rec.via, 'message')
  assert.equal(rec.note, 'ok')
  assert.equal(rec.resetAt, 9000)
  assert.deepEqual(readResume().sessions.s1, rec)
  assert.equal(markResume('missing', { status: 'done' }), null)
  assert.equal(readResume().sessions.missing, undefined)
})

test('pendingResume returns only waiting records', () => {
  assert.equal(pendingResume('s1'), null)
  scheduleResume({ sessionId: 's1', resetAt: 9000, now: 1000 })
  assert.equal(pendingResume('s1').resetAt, 9000)
  markResume('s1', { status: 'skipped' })
  assert.equal(pendingResume('s1'), null)
})

test('isPidAlive', () => {
  assert.equal(isPidAlive(process.pid), true)
  assert.equal(isPidAlive(deadPid()), false)
  assert.equal(isPidAlive(null), false)
  assert.equal(isPidAlive(undefined), false)
  assert.equal(isPidAlive(0), false)
  assert.equal(isPidAlive(-5), false)
  assert.equal(isPidAlive('123'), false)
})

test('isPidAlive counts EPERM as alive', (t) => {
  t.mock.method(process, 'kill', () => {
    const e = new Error('perm')
    e.code = 'EPERM'
    throw e
  })
  assert.equal(isPidAlive(4242), true)
})

test('findOpenSession finds an interactive session with a live pid', () => {
  const dir = path.join(claudeDir(), 'sessions')
  writeSession(dir, process.pid, { pid: process.pid, sessionId: 's1', kind: 'interactive', status: 'idle', name: 'work-1a' })
  assert.deepEqual(findOpenSession('s1'), { pid: process.pid, name: 'work-1a' })
})

test('findOpenSession uses the file name when the pid field is missing', () => {
  const dir = path.join(claudeDir(), 'sessions')
  writeSession(dir, process.pid, { sessionId: 's1', kind: 'interactive' })
  assert.deepEqual(findOpenSession('s1'), { pid: process.pid, name: null })
})

test('findOpenSession ignores dead pids, other kinds, other sessions and broken files', () => {
  const dir = path.join(claudeDir(), 'sessions')
  assert.equal(findOpenSession('s1'), null)
  const dead = deadPid()
  writeSession(dir, dead, { pid: dead, sessionId: 's1', kind: 'interactive', name: 'a' })
  writeSession(dir, process.pid, { pid: process.pid, sessionId: 's1', kind: 'headless', name: 'b' })
  writeSession(dir, 1, { pid: process.pid, sessionId: 's2', kind: 'interactive', name: 'c' })
  fs.writeFileSync(path.join(dir, '2.json'), '{broken')
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x')
  assert.equal(findOpenSession('s1'), null)
  assert.deepEqual(findOpenSession('s2'), { pid: process.pid, name: 'c' })
})

test('findOpenSession accepts a custom sessions directory', () => {
  const dir = path.join(claudeDir(), 'elsewhere')
  writeSession(dir, process.pid, { pid: process.pid, sessionId: 's1', kind: 'interactive', name: 'x' })
  assert.equal(findOpenSession('s1'), null)
  assert.deepEqual(findOpenSession('s1', dir), { pid: process.pid, name: 'x' })
})

test('resumePrompt returns the Italian resume text', () => {
  assert.equal(
    resumePrompt(),
    "Il limite di utilizzo si è resettato. Riprendi il lavoro che era stato interrotto dal limite, da dove eri rimasto, senza ripetere quanto già fatto. Se serve una conferma dell'utente per un'azione rischiosa, fermati e chiedila.",
  )
  assert.equal(resumePrompt('it'), resumePrompt())
  assert.match(resumePrompt('en'), /^The usage limit has reset\./)
})

test('appendResumeLog appends JSONL entries with a timestamp', () => {
  appendResumeLog({ sessionId: 's1', status: 'done', at: 5 })
  appendResumeLog({ sessionId: 's2', status: 'failed' })
  const rows = readJsonl(dataFile('resume.log'))
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], { at: 5, sessionId: 's1', status: 'done' })
  assert.equal(rows[1].sessionId, 's2')
  assert.ok(Number.isFinite(rows[1].at))
})

test('scheduleResume stores a null language when none is given', () => {
  assert.equal(scheduleResume({ sessionId: 's1', resetAt: 9000, now: 1000 }).record.language, null)
})

test('detectLanguage recognises Italian by accented letters or common words', () => {
  for (const t of ['sì', 'perché non va?', 'fai il push del branch', 'Aggiungi i test e controlla che passino', 'continua', 'CIAO, sistema questo file']) assert.equal(detectLanguage(t), 'it', t)
  for (const t of ['fix the failing test', 'please continue', 'add a README section for the new feature', 'go ahead', 'del x in the python script']) assert.equal(detectLanguage(t), 'en', String(t))
})

test('detectLanguage falls back to Italian on a tie', () => {
  for (const t of ['', null, 'ciao the', 'commit', 'ok']) assert.equal(detectLanguage(t), 'it', String(t))
})

test('transcriptLanguage reads the last real user prompt of the transcript', () => {
  const file = writeTranscript(home, [
    { type: 'user', message: { content: 'fix the tests please' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } },
    { type: 'user', message: { content: [{ type: 'text', text: 'adesso aggiorna il README' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'the file content is here' }] } },
    { type: 'user', isMeta: true, message: { content: 'the meta entry is in English' } },
    { type: 'user', message: { content: '<command-name>/model</command-name>' } },
    { type: 'user', message: { content: '<cross-session-message from="x">please resume the work</cross-session-message>' } },
  ])
  assert.equal(transcriptLanguage(file), 'it')
  const en = writeTranscript(home, [
    { type: 'user', message: { content: 'aggiorna il README' } },
    { type: 'user', message: { content: 'now update the tests' } },
  ])
  assert.equal(transcriptLanguage(en), 'en')
})

test('transcriptLanguage returns null without a readable prompt', () => {
  assert.equal(transcriptLanguage(path.join(home, 'missing.jsonl')), null)
  assert.equal(transcriptLanguage(undefined), null)
  assert.equal(transcriptLanguage(writeTranscript(home, [{ type: 'assistant', message: { content: 'x' } }])), null)
})

test('scrubEnv drops the inherited Claude Code session variables and keeps the rest', () => {
  const kept = {
    PATH: '/bin',
    Path: 'C:/bin',
    HOME: '/h',
    CLAUDE_CONFIG_DIR: '/c',
    CLAUDECODE_X: 'y',
    AUTOPILOT_HOME: '/a',
    CLAUDE_CODE_USE_BEDROCK: '1',
    CLAUDE_CODE_USE_VERTEX: '1',
    CLAUDE_CODE_GIT_BASH_PATH: 'C:/git/bin/bash.exe',
    CLAUDE_CODE_OAUTH_TOKEN: 't',
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: '100',
    CLAUDE_CODE_ENTRYPOINT_X: 'y',
    CLAUDE_CODE_SSE_PORT_X: 'y',
  }
  const dropped = {
    CLAUDECODE: '1',
    claudecode: '1',
    CLAUDE_CODE_ENTRYPOINT: 'cli',
    claude_code_entrypoint: 'cli',
    CLAUDE_CODE_SSE_PORT: '5',
    CLAUDE_CODE_SESSION_ID: 's',
    CLAUDE_CODE_SESSION_ACCESS_TOKEN: 'x',
    CLAUDE_CODE_CHILD_PROCESS: '1',
    CLAUDE_CODE_MESSAGING_SOCKET: 'x',
    Claude_Code_Parent_Pid: '1',
    CLAUDE_CODE_PEER_ID: 'p',
  }
  const env = { ...kept, ...dropped }
  assert.deepEqual(scrubEnv(env), kept)
  assert.equal(env.CLAUDECODE, '1')
})

test('fiveHourLimitHit needs a fresh reading of an exhausted five hour window with a future reset', () => {
  const now = 10_000_000
  const usage = { at: now - 1000, five_hour: 100, seven_day: 40, five_hour_resets_at: now + 3600000 }
  assert.equal(USAGE_FRESH_MS, 15 * 60 * 1000)
  assert.equal(fiveHourLimitHit(usage, now), true)
  assert.equal(fiveHourLimitHit({ ...usage, five_hour: 95 }, now), true)
  assert.equal(fiveHourLimitHit({ ...usage, at: now - USAGE_FRESH_MS + 1 }, now), true)
  for (const patch of [{ at: now - USAGE_FRESH_MS }, { five_hour: 94.9 }, { five_hour: null }, { seven_day: 100 }, { seven_day: null }, { five_hour_resets_at: now }, { five_hour_resets_at: null }, { at: undefined }]) {
    assert.equal(fiveHourLimitHit({ ...usage, ...patch }, now), false, JSON.stringify(patch))
  }
  assert.equal(fiveHourLimitHit(null, now), false)
})

test('scheduleResume counts the automatic resumes and refuses a third one', () => {
  assert.equal(MAX_AUTO_RESUMES, 2)
  assert.equal(scheduleResume({ sessionId: 's1', resetAt: 9000, now: 1000 }).record.autoResumes, 1)
  markResume('s1', { status: 'done', via: 'resume' })
  const second = scheduleResume({ sessionId: 's1', resetAt: 19000, now: 11000 })
  assert.equal(second.created, true)
  assert.equal(second.record.autoResumes, 2)
  markResume('s1', { pid: process.pid })
  const update = scheduleResume({ sessionId: 's1', resetAt: 20000, now: 12000 })
  assert.equal(update.created, false)
  assert.equal(update.record.autoResumes, 2)
  markResume('s1', { status: 'done', via: 'resume' })
  const third = scheduleResume({ sessionId: 's1', resetAt: 29000, now: 21000 })
  assert.equal(third.created, false)
  assert.equal(third.refused, true)
  assert.equal(readResume().sessions.s1.status, 'done')
  assert.equal(readResume().sessions.s1.autoResumes, 2)
})

test('clearAutoResumes resets the counter so the next limit schedules again', () => {
  scheduleResume({ sessionId: 's1', resetAt: 9000, now: 1000 })
  markResume('s1', { status: 'done', autoResumes: 2 })
  clearAutoResumes('s1')
  assert.equal(readResume().sessions.s1.autoResumes, 0)
  assert.equal(readResume().sessions.s1.status, 'done')
  assert.equal(scheduleResume({ sessionId: 's1', resetAt: 19000, now: 11000 }).record.autoResumes, 1)
  clearAutoResumes('missing')
  assert.equal(readResume().sessions.missing, undefined)
})

test('scheduleResume prunes old finished records and marks lost waiting ones', () => {
  const day = 24 * 3600 * 1000
  const now = 30 * day
  writeJson(dataFile('resume.json'), {
    sessions: {
      old: { status: 'done', scheduledAt: now - 7 * day - 1, resetAt: now - 7 * day },
      recent: { status: 'failed', scheduledAt: now - 7 * day + 1000, resetAt: now - 6 * day },
      lost: { status: 'waiting', scheduledAt: now - day, resetAt: now - LATE_RESUME_MS - 1, pid: deadPid() },
      alive: { status: 'waiting', scheduledAt: now - day, resetAt: now - LATE_RESUME_MS - 1, pid: process.pid },
      soon: { status: 'waiting', scheduledAt: now - 1000, resetAt: now + 1000, pid: deadPid() },
      broken: 'x',
    },
  })
  scheduleResume({ sessionId: 's1', resetAt: now + 9000, now })
  const { sessions } = readResume()
  assert.deepEqual(Object.keys(sessions).sort(), ['alive', 'lost', 'recent', 's1', 'soon'])
  assert.equal(sessions.lost.status, 'lost')
  assert.equal(sessions.alive.status, 'waiting')
  assert.equal(sessions.soon.status, 'waiting')
})
