import { runHook } from '../lib/hook-io.mjs'
import { addDelegation } from '../lib/turns.mjs'

export function handle(input) {
  const type = String(input.agent_type ?? '')
  if (!type.includes('autopilot-')) return null
  addDelegation(input.session_id ?? 'unknown', type)
  return null
}

runHook(import.meta.url, handle)
