import path from 'node:path'
import defaults from '../rules/default-rules.mjs'
import { dataFile } from './paths.mjs'
import { readJson } from './json-store.mjs'

const READ_ONLY = /^(cat|type|get-content|head|tail|ls|dir|get-childitem|less|more|test-path|jq|grep|rg|select-string|wc|cut|stat|sort|uniq|find)\b/i
const FIND_ACTION = /\s-(delete|exec|execdir|ok|okdir|fprint0?|fprintf|fls)(?=\s|$)/i
const SORT_OUTPUT = /\s(-[^-\s]*o|--output|--compress-program|\/o)/i
const RG_PRE = /\s--pre(?=[=\s]|$)/i
const GIT_READ = /^git\s+(status|log|diff)(?=\s|$)/i
const GIT_READ_WRITES = /\s--(output|ext-diff)(?=[=\s]|$)/i
const PRINT_ONLY = /^(echo|printf|true|write-output|write-host)\b/i
const REDIRECT_NOISE = /\s*(2>&1|[12]?>\s*\/dev\/null|[12]?>\s*\$null|\|\s*out-null)/gi
const DELETE_CMD = /^(rm|del|erase|remove-item|ri|rmdir|rd|unlink)\s/i
const FILE_WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']
const INTERACTIVE_TOOLS = ['AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode']
const PROTECTED = 'modifying autopilot or Claude Code settings files'
const CREDENTIALS = 'reading a file that contains credentials or secrets'
const STRIP_MESSAGE = /(-m|--message)(=|\s+)("[^"]*"|'[^']*')/gi
const HIDDEN_EXEC = /\$\(|`|<\(/
const MESSAGE_HEREDOC = /(-m|--message)(=|\s+)(["']?)\$\(cat\s+<<-?\s*(['"]?)(\w+)\4[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\5[ \t]*\r?\n?\s*\)\3/gi
const CREDENTIAL_READ_CMD = /^(cat|type|get-content|gc|head|tail|less|more|grep|rg|select-string|sls)\b/i
const CP_CMD = /^(cp|copy|copy-item)\s+(.*)$/i
const SPLIT_RE = /[;|&\n]/
const SELF_DISABLE = "changing or bypassing autopilot's own safety settings"
const CLAUDE_CLI = /(^|[;&|\n(]\s*)(npx\s+)?(\S*[\\/])?claude(\.exe|\.cmd)?\s+([^|;&\n]*\s)?(-p|--print|-r|--resume|-c|--continue)(?=[\s=]|$)/i
const CD_CMD = /^(cd|chdir|pushd|set-location|sl)(\s+(\/d|-path|-literalpath))?\s+("[^"]*"|'[^']*'|\S+)\s*$/i

export function loadRules() {
  const raw = readJson(dataFile('permissions.json'), null)
  const user = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const arr = (v) => (Array.isArray(v) ? v : [])
  const errors = []
  const compile = (pattern, label, flags = 'i') => {
    try {
      return new RegExp(pattern, flags)
    } catch (e) {
      errors.push(`${label}: ${e.message}`)
      return null
    }
  }
  const disabled = new Set(arr(user.disabledRules))
  const risky = [...defaults.riskyShell, ...arr(user.riskyShell)]
    .filter((r) => r && typeof r.pattern === 'string' && !disabled.has(r.id))
    .map((r) => ({ id: r.id ?? 'custom', description: r.description ?? 'a custom risky action', re: compile(r.pattern, r.id ?? 'custom', r.caseSensitive ? '' : 'i') }))
    .filter((r) => r.re)
  const safe = [...defaults.safeShell, ...arr(user.safeShell)]
    .filter((p) => typeof p === 'string')
    .map((p) => compile(p, 'safeShell'))
    .filter(Boolean)
  return {
    safeTools: new Set([...defaults.safeTools, ...arr(user.safeTools)]),
    risky,
    safe,
    credential: disabled.has('credentials') ? null : compile(defaults.credentialPattern, 'credentials'),
    errors,
  }
}

export function normalizeText(text, home) {
  const h = home.replace(/\\/g, '/').toLowerCase()
  return String(text)
    .replace(/\\/g, '/')
    .toLowerCase()
    .replace(/(^|[\s"'=])(~|\$home|\$\{home\}|\$env:userprofile|%userprofile%)(?=\/|$)/g, (_, pre) => `${pre}${h}`)
    .replace(/(^|[\s"'=])\/([a-z])\//g, '$1$2:/')
}

export function expandPath(p, home) {
  let s = String(p).replace(/^["']|["']$/g, '')
  s = s.replace(/^(~|\$HOME|\$\{HOME\}|\$env:USERPROFILE|%USERPROFILE%)(?=[\\/]|$)/i, () => home)
  if (process.platform === 'win32') s = s.replace(/^\/([a-zA-Z])(?=\/|$)/, '$1:')
  return s
}

function splitOutsideQuotes(command, shell) {
  const escape = shell === 'powershell' ? '`' : '\\'
  const parts = []
  let current = ''
  let quote = null
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (c === escape && quote !== "'" && i + 1 < command.length) {
      current += c + command[++i]
      continue
    }
    if (quote) {
      if (c === quote) quote = null
      current += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      current += c
      continue
    }
    if (SPLIT_RE.test(c)) {
      parts.push(current)
      current = ''
      if ((c === '&' || c === '|') && command[i + 1] === c) i++
      continue
    }
    current += c
  }
  parts.push(current)
  return parts
}

const LOOP_KEYWORD = /^(do|then|else)\s+/i

export function splitSegments(command, shell = 'bash') {
  return splitOutsideQuotes(command.replace(REDIRECT_NOISE, ''), shell)
    .map((s) => s.trim().replace(LOOP_KEYWORD, '').trim())
    .filter(Boolean)
}

function stripHeredocs(command) {
  return command.replace(MESSAGE_HEREDOC, (match, flag, sep, outer, quote, tag, body) => (HIDDEN_EXEC.test(body) ? match : flag))
}

function stripMessages(command) {
  return command.replace(STRIP_MESSAGE, (match, flag, sep, value) => (HIDDEN_EXEC.test(value) ? match : flag))
}

function credentialSegmentText(segment) {
  const cp = CP_CMD.exec(segment)
  if (cp) {
    const args = cp[2].split(/\s+/).filter((a) => a && !a.startsWith('-'))
    return args.slice(0, -1).join(' ')
  }
  return CREDENTIAL_READ_CMD.test(segment) ? segment : ''
}

function isInside(file, dir) {
  const rel = path.relative(path.resolve(dir), path.resolve(dir, file))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

const normalizedDir = (dir, ctx) => normalizeText(path.resolve(dir), ctx.home).replace(/\/$/, '')

function protectedDirs(ctx) {
  return [ctx.dataDir, path.join(ctx.claudeDir, 'plugins')].map((p) => normalizeText(p, ctx.home))
}

function protectedPaths(ctx) {
  return [
    ...protectedDirs(ctx),
    ...[path.join(ctx.claudeDir, 'settings.json'), path.join(ctx.claudeDir, 'settings.local.json'), path.join(ctx.projectDir ?? ctx.cwd, '.claude', 'settings.json'), path.join(ctx.projectDir ?? ctx.cwd, '.claude', 'settings.local.json')].map((p) => normalizeText(p, ctx.home)),
  ]
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function includesRelative(text, rel) {
  return new RegExp(`(^|[\\s"'=(/])${escapeRe(rel)}(?=$|[\\s"'/);|&>])`).test(text)
}

function mentionsProtected(text, ctx) {
  const t = normalizeText(text, ctx.home)
  const cwdN = normalizedDir(ctx.cwd, ctx)
  return protectedPaths(ctx).some((p) => t.includes(p) || (p.startsWith(`${cwdN}/`) && includesRelative(t, p.slice(cwdN.length + 1))))
}

function insideProtectedDir(cwd, ctx) {
  const cwdN = normalizedDir(cwd, ctx)
  return protectedDirs(ctx).some((d) => cwdN === d || cwdN.startsWith(`${d}/`))
}

const LOOP_SYNTAX = /^(for\s+\w+(\s+in\s+[^$`<>()]*)?|done)$/i

function uniqReadsOnly(args) {
  let positional = 0
  for (let i = 0; i < args.length; i++) {
    if (/^(-[fsw]|--(skip-fields|skip-chars|check-chars))$/.test(args[i])) {
      i++
      continue
    }
    if (!args[i].startsWith('-') || args[i] === '-') positional++
  }
  return positional <= 1
}

function readOnlyCommand(s) {
  if (GIT_READ.test(s)) return !GIT_READ_WRITES.test(s)
  const m = READ_ONLY.exec(s)
  if (!m) return false
  const name = m[1].toLowerCase()
  if (name === 'find') return !FIND_ACTION.test(s)
  if (name === 'sort') return !SORT_OUTPUT.test(s)
  if (name === 'rg') return !RG_PRE.test(s)
  if (name === 'uniq') return uniqReadsOnly(s.split(/\s+/).slice(1).filter(Boolean))
  return true
}

const readOnlySegment = (s) => CD_CMD.test(s) || (!s.includes('>') && (readOnlyCommand(s) || PRINT_ONLY.test(s) || LOOP_SYNTAX.test(s)))

function writesProtected(command, segments, ctx) {
  if (mentionsProtected(command, ctx) || insideProtectedDir(ctx.cwd, ctx)) {
    const readOnly = !command.replace(REDIRECT_NOISE, '').includes('>') && !HIDDEN_EXEC.test(command) && segments.every(readOnlySegment)
    if (!readOnly) return true
  }
  let cwd = ctx.cwd
  let moved = false
  for (const s of segments) {
    const cd = CD_CMD.exec(s)
    if (cd) {
      cwd = path.resolve(cwd, expandPath(cd[4], ctx.home))
      moved = true
      continue
    }
    if (!moved || (readOnlySegment(s) && !HIDDEN_EXEC.test(s))) continue
    if (insideProtectedDir(cwd, ctx) || mentionsProtected(s, { ...ctx, cwd, projectDir: ctx.cwd })) return true
  }
  return false
}

function deletesOutside(segment, ctx) {
  if (!DELETE_CMD.test(segment)) return false
  return segment
    .split(/\s+/)
    .slice(1)
    .filter((a) => a && !a.startsWith('-') && !/^\/[a-z]$/i.test(a))
    .some((a) => !isInside(expandPath(a, ctx.home), ctx.cwd))
}

const risky = (ruleId, description) => ({ category: 'risky', ruleId, description })

function classifyShell(rawCommand, ctx, shell) {
  const { rules } = ctx
  const plain = stripHeredocs(rawCommand)
  const command = stripMessages(plain)
  if (/setup\.mjs["']?\s+apply\b/i.test(command)) return risky('setup', 'changing Claude Code settings (statusline)')
  if (CLAUDE_CLI.test(command)) return risky('self-disable', SELF_DISABLE)
  for (const r of rules.risky) if (r.re.test(command)) return risky(r.id, r.description)
  const segments = splitSegments(command, shell)
  if (rules.credential && segments.some((s) => rules.credential.test(credentialSegmentText(s)))) return risky('credentials', CREDENTIALS)
  if (writesProtected(command, segments, ctx)) return risky('protected', PROTECTED)
  if (segments.some((s) => deletesOutside(s, ctx))) return risky('delete-outside', 'deleting files outside the project folder')
  if (!HIDDEN_EXEC.test(plain) && segments.length && segments.every((s) => !s.includes('>') && rules.safe.some((re) => re.test(s)))) return { category: 'safe' }
  return { category: 'other' }
}

export function classify(toolName, toolInput = {}, ctx) {
  const { rules } = ctx
  if (INTERACTIVE_TOOLS.includes(toolName)) return { category: 'defer' }
  if (toolName === 'Bash' || toolName === 'PowerShell') return classifyShell(String(toolInput.command ?? ''), ctx, toolName === 'PowerShell' ? 'powershell' : 'bash')
  const file = toolInput.file_path ?? toolInput.notebook_path ?? toolInput.path
  if (FILE_WRITE_TOOLS.includes(toolName)) {
    if (!file) return { category: 'other' }
    if (mentionsProtected(path.resolve(ctx.cwd, expandPath(file, ctx.home)), ctx)) return risky('protected', PROTECTED)
    return isInside(expandPath(file, ctx.home), ctx.cwd) ? { category: 'safe' } : { category: 'other' }
  }
  if ((toolName === 'Read' || toolName === 'Grep') && file && rules.credential?.test(String(file))) return risky('credentials', CREDENTIALS)
  if (rules.safeTools.has(toolName)) return { category: 'safe' }
  return { category: 'defer' }
}
