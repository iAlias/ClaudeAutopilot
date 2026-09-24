import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { claudeDir, dataDir } from '../lib/paths.mjs'
import { writeJson } from '../lib/json-store.mjs'
import { readState, writeState } from '../lib/state.mjs'
import { isMain } from '../lib/hook-io.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const slash = (p) => p.replace(/\\/g, '/')

const parseSettings = (file) => {
  const text = fs.readFileSync(file, 'utf8')
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
}

export function statuslineCommand() {
  return `node "${slash(path.join(dataDir(), 'statusline.mjs'))}"`
}

export function plan() {
  const settingsPath = path.join(claudeDir(), 'settings.json')
  let settings = null
  try {
    settings = parseSettings(settingsPath)
  } catch {}
  return {
    settingsPath,
    current: settings?.statusLine ?? null,
    proposed: { type: 'command', command: statuslineCommand(), padding: 0, refreshInterval: 60 },
  }
}

export function apply(mode, now = Date.now()) {
  if (mode !== 'replace' && mode !== 'wrap') throw new Error('mode must be "replace" or "wrap"')
  const p = plan()
  let settings = {}
  let backup = null
  if (fs.existsSync(p.settingsPath)) {
    settings = parseSettings(p.settingsPath)
    backup = `${p.settingsPath}.bak-autopilot-${now}`
    fs.copyFileSync(p.settingsPath, backup)
  }
  fs.mkdirSync(dataDir(), { recursive: true })
  fs.copyFileSync(path.join(root, 'statusline', 'statusline.mjs'), path.join(dataDir(), 'statusline.mjs'))
  const currentCommand = p.current?.command ?? null
  const isOurs = currentCommand === p.proposed.command
  const wrapped = mode === 'wrap' ? (isOurs ? readState().wrappedStatusline : currentCommand) : null
  writeState({ wrappedStatusline: wrapped })
  settings.statusLine = p.proposed
  writeJson(p.settingsPath, settings)
  return { ...p, mode, wrapped, backup }
}

if (isMain(import.meta.url)) {
  const [cmd, arg] = process.argv.slice(2)
  try {
    console.log(JSON.stringify(cmd === 'apply' ? apply(arg) : plan(), null, 2))
  } catch (e) {
    console.error(`autopilot setup: ${e.message}`)
    process.exit(1)
  }
}
