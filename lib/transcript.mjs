import fs from 'node:fs'

const MAX_BYTES = 4 * 1024 * 1024

function readTail(file) {
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    const start = Math.max(0, size - MAX_BYTES)
    const buf = Buffer.alloc(size - start)
    fs.readSync(fd, buf, 0, buf.length, start)
    return buf.toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

function textOf(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
}

function isRealUserPrompt(entry) {
  if (entry?.type !== 'user' || entry.isMeta) return false
  const c = entry.message?.content
  if (typeof c === 'string') return true
  return Array.isArray(c) && c.some((b) => b?.type === 'text') && !c.some((b) => b?.type === 'tool_result')
}

const NOT_TYPED = /^\s*<(command-|local-command-|cross-session-message)/

export function lastUserPromptText(transcriptPath) {
  let text
  try {
    text = readTail(transcriptPath)
  } catch {
    return null
  }
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue
    let entry
    try {
      entry = JSON.parse(lines[i])
    } catch {
      continue
    }
    if (!isRealUserPrompt(entry)) continue
    const prompt = textOf(entry.message?.content)
    if (prompt.trim() && !NOT_TYPED.test(prompt)) return prompt
  }
  return null
}

export function lastTurnAssistantText(transcriptPath) {
  let text
  try {
    text = readTail(transcriptPath)
  } catch {
    return ''
  }
  const lines = text.split('\n')
  const parts = []
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue
    let entry
    try {
      entry = JSON.parse(lines[i])
    } catch {
      continue
    }
    if (isRealUserPrompt(entry)) break
    if (entry.type === 'assistant') {
      const t = textOf(entry.message?.content)
      if (t) parts.unshift(t)
    }
  }
  return parts.join('\n')
}
