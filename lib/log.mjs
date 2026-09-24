import { dataFile } from './paths.mjs'
import { appendJsonl } from './json-store.mjs'

export function logPermission(entry) {
  try {
    appendJsonl(dataFile('permissions.log'), entry)
  } catch {}
}
