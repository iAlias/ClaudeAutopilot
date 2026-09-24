import fs from 'node:fs'
import path from 'node:path'
import { dataFile, claudeDir } from './paths.mjs'
import { readJson, writeJson, appendJsonl } from './json-store.mjs'
import { lastUserPromptText } from './transcript.mjs'

export const RESUME_MARGIN_MS = 120000
export const SCHEDULE_GRACE_MS = 60000
export const LATE_RESUME_MS = 6 * 3600 * 1000
export const USAGE_FRESH_MS = 15 * 60 * 1000
export const MAX_AUTO_RESUMES = 2
const KEEP_FINISHED_MS = 7 * 24 * 3600 * 1000

const PROMPTS = {
  it: "Il limite di utilizzo si è resettato. Riprendi il lavoro che era stato interrotto dal limite, da dove eri rimasto, senza ripetere quanto già fatto. Se serve una conferma dell'utente per un'azione rischiosa, fermati e chiedila.",
  en: "The usage limit has reset. Resume the work that was interrupted by the limit, from where you left off, without repeating what is already done. If a risky action needs the user's confirmation, stop and ask for it.",
}

const ITALIAN_WORDS = new Set(['il', 'lo', 'gli', 'di', 'del', 'della', 'delle', 'dei', 'degli', 'nel', 'nella', 'alla', 'che', 'non', 'una', 'uno', 'sono', 'questo', 'questa', 'quello', 'quella', 'cosa', 'anche', 'ciao', 'grazie', 'adesso', 'ora', 'poi', 'dopo', 'prima', 'tutto', 'tutti', 'ogni', 'dove', 'quando', 'fai', 'puoi', 'fare', 'vai', 'continua', 'procedi', 'aggiungi', 'aggiorna', 'controlla', 'correggi', 'sistema', 'rimuovi', 'crea', 'scrivi', 'leggi', 'mostra', 'dimmi', 'passino'])
const ENGLISH_WORDS = new Set(['the', 'and', 'is', 'are', 'to', 'of', 'this', 'that', 'with', 'for', 'you', 'it', 'please', 'can', 'what', 'how', 'not', 'be', 'do', 'in', 'on', 'now', 'fix', 'add', 'update', 'go', 'ahead', 'continue', 'new', 'script'])

const resumeFile = () => dataFile('resume.json')

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

const SESSION_ENV = /^(CLAUDECODE|CLAUDE_CODE_ENTRYPOINT|CLAUDE_CODE_SSE_PORT)$|^CLAUDE_CODE_(SESSION|CHILD|MESSAGING|PARENT|PEER)/i

export function scrubEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !SESSION_ENV.test(key)))
}

export function fiveHourLimitHit(usage, now = Date.now()) {
  if (!isObject(usage) || !Number.isFinite(usage.at) || now - usage.at >= USAGE_FRESH_MS) return false
  const { five_hour: fiveHour, seven_day: sevenDay, five_hour_resets_at: resetsAt } = usage
  return Number.isFinite(fiveHour) && fiveHour >= 95 && Number.isFinite(sevenDay) && sevenDay < 100 && Number.isFinite(resetsAt) && resetsAt > now
}

export function readResume() {
  const data = readJson(resumeFile(), null)
  return { sessions: isObject(data) && isObject(data.sessions) ? data.sessions : {} }
}

function writeRecord(sessionId, record) {
  const data = readResume()
  data.sessions[sessionId] = record
  writeJson(resumeFile(), data)
  return record
}

export function pendingResume(sessionId) {
  const record = readResume().sessions[sessionId]
  return isObject(record) && record.status === 'waiting' ? record : null
}

export function markResume(sessionId, patch) {
  const record = readResume().sessions[sessionId]
  if (!isObject(record)) return null
  return writeRecord(sessionId, { ...record, ...patch })
}

export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e?.code === 'EPERM'
  }
}

function isLive(record, now) {
  if (isPidAlive(record.pid)) return true
  if (record.pid != null || !Number.isFinite(record.scheduledAt)) return false
  const age = now - record.scheduledAt
  return age >= 0 && age < SCHEDULE_GRACE_MS
}

function prune(sessions, now) {
  for (const [id, record] of Object.entries(sessions)) {
    if (!isObject(record)) delete sessions[id]
    else if (record.status === 'waiting') {
      if (Number.isFinite(record.resetAt) && now > record.resetAt + LATE_RESUME_MS && !isPidAlive(record.pid)) sessions[id] = { ...record, status: 'lost', note: 'resumer lost' }
    } else if (!Number.isFinite(record.scheduledAt) || now - record.scheduledAt > KEEP_FINISHED_MS) delete sessions[id]
  }
}

const autoResumesOf = (record) => (isObject(record) && Number.isInteger(record.autoResumes) && record.autoResumes > 0 ? record.autoResumes : 0)

export function clearAutoResumes(sessionId) {
  const record = readResume().sessions[sessionId]
  return autoResumesOf(record) ? markResume(sessionId, { autoResumes: 0 }) : null
}

export function scheduleResume({ sessionId, cwd, name, permissionMode, language, resetAt, now = Date.now() }) {
  const data = readResume()
  prune(data.sessions, now)
  const existing = data.sessions[sessionId]
  const save = (record) => {
    if (record) data.sessions[sessionId] = record
    writeJson(resumeFile(), data)
    return record ?? existing ?? null
  }
  if (isObject(existing) && existing.status === 'waiting' && isLive(existing, now)) {
    return { created: false, record: save({ ...existing, resetAt }) }
  }
  const count = autoResumesOf(existing)
  if (count >= MAX_AUTO_RESUMES) return { created: false, refused: true, record: save(null) }
  const record = {
    cwd: cwd ?? null,
    name: name ?? null,
    resetAt,
    scheduledAt: now,
    permissionMode: permissionMode ?? 'default',
    language: language ?? null,
    status: 'waiting',
    via: null,
    pid: null,
    note: null,
    autoResumes: count + 1,
  }
  return { created: true, record: save(record) }
}

export function findOpenSession(sessionId, sessionsDir = path.join(claudeDir(), 'sessions')) {
  let files
  try {
    files = fs.readdirSync(sessionsDir)
  } catch {
    return null
  }
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const data = readJson(path.join(sessionsDir, file), null)
    if (!isObject(data) || data.sessionId !== sessionId || data.kind !== 'interactive') continue
    const pid = Number.isInteger(data.pid) ? data.pid : Number.parseInt(path.basename(file, '.json'), 10)
    if (isPidAlive(pid)) return { pid, name: typeof data.name === 'string' && data.name ? data.name : null }
  }
  return null
}

export function detectLanguage(text) {
  const t = String(text ?? '').toLowerCase()
  if (/[àèéìòù]/.test(t)) return 'it'
  const words = t.split(/[^a-z']+/).filter(Boolean)
  const italian = words.filter((w) => ITALIAN_WORDS.has(w)).length
  const english = words.filter((w) => ENGLISH_WORDS.has(w)).length
  return italian >= english ? 'it' : 'en'
}

export function transcriptLanguage(transcriptPath) {
  if (typeof transcriptPath !== 'string' || !transcriptPath) return null
  const prompt = lastUserPromptText(transcriptPath)
  return prompt ? detectLanguage(prompt) : null
}

export function resumePrompt(language = 'it') {
  return PROMPTS[language] ?? PROMPTS.it
}

export function appendResumeLog(entry) {
  appendJsonl(dataFile('resume.log'), { at: Date.now(), ...entry })
}
