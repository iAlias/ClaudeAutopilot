import os from 'node:os'
import path from 'node:path'

export function homeDir() {
  return process.env.AUTOPILOT_USER_HOME || os.homedir()
}

export function claudeDir() {
  return process.env.AUTOPILOT_CLAUDE_DIR || path.join(homeDir(), '.claude')
}

export function dataDir() {
  return process.env.AUTOPILOT_HOME || path.join(claudeDir(), 'autopilot')
}

export function dataFile(name) {
  return path.join(dataDir(), name)
}
