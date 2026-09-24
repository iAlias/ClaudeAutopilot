import { dataFile } from './paths.mjs'
import { readJson, writeJson } from './json-store.mjs'

export const MODES = ['auto', 'suggest', 'off']

function normalize(raw) {
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return {
    mode: MODES.includes(s.mode) ? s.mode : 'suggest',
    permissions: s.permissions === true,
    wrappedStatusline: typeof s.wrappedStatusline === 'string' && s.wrappedStatusline ? s.wrappedStatusline : null,
  }
}

export function readState() {
  return normalize(readJson(dataFile('state.json'), null))
}

export function writeState(patch) {
  const next = normalize({ ...readState(), ...patch })
  writeJson(dataFile('state.json'), next)
  return next
}

export function parseCommand(prompt) {
  const m = /^\s*\/autopilot(?::autopilot)?(?:\s+([\s\S]*))?$/i.exec(prompt ?? '')
  if (!m) return null
  const args = (m[1] ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (args.length === 0) return { action: 'status' }
  if (MODES.includes(args[0])) return { action: 'mode', mode: args[0] }
  if (['permission', 'permissions', 'perms'].includes(args[0]) && (args[1] === 'on' || args[1] === 'off')) {
    return { action: 'permissions', value: args[1] === 'on' }
  }
  if (args[0] === 'stats' || args[0] === 'setup') return { action: args[0] }
  return { action: 'unknown', arg: args.join(' ') }
}
