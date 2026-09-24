import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { isMain } from '../lib/hook-io.mjs'
import { readState } from '../lib/state.mjs'
import { latestUsage } from '../lib/usage.mjs'
import { RESUME_MARGIN_MS, LATE_RESUME_MS, readResume, markResume, findOpenSession, resumePrompt, appendResumeLog, scrubEnv } from '../lib/resume.mjs'

const CHECK_INTERVAL_MS = 60000
const MESSENGER_TIMEOUT_MS = 5 * 60 * 1000
const STDERR_TAIL = 300
const OUTPUT_TAIL = 2000
const MESSENGER_TOOLS = 'ListAgents,SendMessage'
const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions']
const UNATTENDED_FORBIDDEN = ['bypassPermissions']

export const SENT_MARKER = 'AUTOPILOT_RESUME_SENT'

export const safePermissionMode = (mode) => (PERMISSION_MODES.includes(mode) && !UNATTENDED_FORBIDDEN.includes(mode) ? mode : 'default')

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const claudeBin = () => process.env.AUTOPILOT_CLAUDE_BIN || 'claude'

export function messengerInstruction(name, text) {
  return `Use the SendMessage tool to send one message to the session named ${name} (use ListAgents first if you need to find it). The message must contain exactly the text between [[ and ]], without the brackets and without adding, removing or changing anything: [[${text}]] Do nothing else. Only if SendMessage succeeded, end your answer with a last line that contains exactly ${SENT_MARKER} and nothing else. If it did not succeed, never write ${SENT_MARKER}.`
}

const quoteCmdArg = (arg) => `"${String(arg).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`

function findCmdWrapper(bin) {
  if (process.platform !== 'win32' || path.extname(bin)) return null
  const name = `${bin}.cmd`
  if (path.basename(bin) !== bin) return fs.existsSync(name) ? name : null
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, name)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function killTree(child) {
  if (process.platform === 'win32' && Number.isInteger(child.pid)) {
    spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true, stdio: 'ignore' })
  }
  try {
    child.kill('SIGKILL')
  } catch {}
}

function run(file, args, options, extra = {}) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let timer = null
    let settled = false
    const done = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ...result, stdout, stderr, timedOut })
    }
    let child
    try {
      child = spawn(file, args, {
        cwd: options.cwd || undefined,
        env: { ...scrubEnv(options.env ?? process.env), AUTOPILOT_RESUMER: options.marker || 'resume' },
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        ...extra,
      })
    } catch (error) {
      done({ status: null, error })
      return
    }
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => {
      stdout = (stdout + chunk).slice(-OUTPUT_TAIL)
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-OUTPUT_TAIL)
    })
    if (options.timeout > 0) {
      timer = setTimeout(() => {
        timedOut = true
        killTree(child)
      }, options.timeout)
    }
    child.on('error', (error) => done({ status: null, error }))
    child.on('close', (status) => done({ status, error: null }))
  })
}

export async function defaultExec(bin, args, options = {}) {
  if (options.cwd && !fs.existsSync(options.cwd)) return { status: null, error: 'cwd missing', output: '' }
  let r = bin.endsWith('.mjs') ? await run(process.execPath, [bin, ...args], options) : await run(bin, args, options)
  if (r.error?.code === 'ENOENT') {
    const wrapper = findCmdWrapper(bin)
    if (wrapper) {
      const line = `"${[wrapper, ...args].map(quoteCmdArg).join(' ')}"`
      r = await run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', line], options, { windowsVerbatimArguments: true })
    }
  }
  const output = String(r.stdout ?? '').slice(-OUTPUT_TAIL)
  if (r.timedOut) return { status: null, error: `timed out after ${options.timeout} ms`, output }
  if (r.error) return { status: null, error: r.error.message, output }
  if (r.status === 0) return { status: 0, error: null, output }
  const tail = String(r.stderr ?? '').trim().slice(-STDERR_TAIL)
  return { status: r.status, error: tail || null, output }
}

function finish(sessionId, patch) {
  const record = markResume(sessionId, patch)
  appendResumeLog({ sessionId, status: patch.status, via: patch.via ?? null, note: patch.note ?? null })
  return record
}

function resumeDisabled() {
  const state = readState()
  return state.mode !== 'auto' || state.resume === false
}

function weeklyLimitReached(record) {
  const usage = latestUsage()
  return Boolean(usage) && usage.at > record.scheduledAt && Number.isFinite(usage.seven_day) && usage.seven_day >= 100
}

function outcome(result) {
  if (result.status === 0) return { status: 'done', note: null }
  const parts = [result.status === null ? 'error' : `exit code ${result.status}`]
  if (result.error) parts.push(result.error)
  return { status: 'failed', note: parts.join(': ') }
}

const lastLine = (text) => String(text ?? '').trim().split(/\r?\n/).pop().replace(/^[\s*`"']+|[\s*`"'.]+$/g, '')

const messageSent = (result) => result.status === 0 && lastLine(result.output) === SENT_MARKER

const messengerArgs = (name, text) => ['-p', messengerInstruction(name, text), '--model', 'haiku', '--permission-mode', 'dontAsk', '--tools', MESSENGER_TOOLS, '--allowedTools', MESSENGER_TOOLS]

const resumeArgs = (sessionId, record, text) => ['-p', text, '--resume', sessionId, '--permission-mode', safePermissionMode(record.permissionMode)]

async function execSafe(exec, args, options) {
  try {
    return await exec(claudeBin(), args, options)
  } catch (e) {
    return { status: null, error: e?.message ?? String(e) }
  }
}

export async function runResumer(sessionId, { now = Date.now, sleep = defaultSleep, exec = defaultExec, pid = process.pid, sessionsDir } = {}) {
  let record
  for (;;) {
    record = readResume().sessions[sessionId]
    if (!record || record.status !== 'waiting') return null
    if (record.pid != null && record.pid !== pid) return null
    if (resumeDisabled()) return finish(sessionId, { status: 'skipped', note: 'resume disabled' })
    const remaining = record.resetAt + RESUME_MARGIN_MS - now()
    if (!(remaining > 0)) break
    await sleep(Math.min(CHECK_INTERVAL_MS, remaining))
  }
  if (now() > record.resetAt + LATE_RESUME_MS) return finish(sessionId, { status: 'skipped', note: 'too late' })
  if (weeklyLimitReached(record)) return finish(sessionId, { status: 'skipped', note: 'weekly limit' })
  if (record.cwd && !fs.existsSync(record.cwd)) return finish(sessionId, { status: 'failed', note: 'cwd missing' })
  const cwd = record.cwd || undefined
  const text = resumePrompt(record.language)
  let fallbackNote = null
  const open = findOpenSession(sessionId, sessionsDir)
  if (open) {
    const name = open.name ?? record.name
    if (!name) return finish(sessionId, { status: 'failed', via: 'message', note: 'open session has no name' })
    const sent = await execSafe(exec, messengerArgs(name, text), { cwd, marker: 'messenger', timeout: MESSENGER_TIMEOUT_MS })
    if (messageSent(sent)) return finish(sessionId, { status: 'done', via: 'message', note: null })
    fallbackNote = sent.status === 0 ? 'message not confirmed' : `message not confirmed: ${outcome(sent).note}`
    if (findOpenSession(sessionId, sessionsDir)) return finish(sessionId, { status: 'failed', via: 'message', note: fallbackNote })
  }
  const result = await execSafe(exec, resumeArgs(sessionId, record, text), { cwd, marker: 'resume' })
  const { status, note } = outcome(result)
  return finish(sessionId, { status, via: 'resume', note: note ?? fallbackNote })
}

if (isMain(import.meta.url)) {
  const sessionId = process.argv[2]
  const exit = () => process.exit(0)
  if (!sessionId) exit()
  else runResumer(sessionId).then(exit, exit)
}
