import { runHook } from '../lib/hook-io.mjs'
import { readState } from '../lib/state.mjs'
import { homeDir, dataDir, claudeDir, dataFile } from '../lib/paths.mjs'
import { loadRules, classify } from '../lib/rules.mjs'
import { actionHash, addPending, consumeApproval } from '../lib/approvals.mjs'
import { logPermission } from '../lib/log.mjs'
import { readJson, writeJson } from '../lib/json-store.mjs'

const decide = (decision, reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason } })

export function denyReason(description) {
  return [
    `autopilot: this action needs the user's confirmation (${description}).`,
    'Do not retry it and do not look for a workaround.',
    "Ask the user in plain language, in their own language, without showing the technical command unless they ask: say in one sentence what you need to do for the task and what effect it will have. Then stop and wait for the answer.",
    "If the user confirms, run exactly the same action again. If you are a subagent, end your work and state in your final report that this action is waiting for the user's confirmation, describing it in plain words.",
  ].join(' ')
}

export function handle(input, now = Date.now()) {
  if (!readState().permissions || input.permission_mode === 'plan') return null
  const sessionId = input.session_id ?? 'unknown'
  const tool = String(input.tool_name ?? '')
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {}
  const rules = loadRules()
  const key = rules.errors.join('\n')
  const last = readJson(dataFile('rules-errors.json'), null)
  if (key !== (last?.key ?? '')) {
    if (key !== '' || last?.key) {
      for (const error of rules.errors) logPermission({ ts: now, sessionId, tool, category: 'rules-error', summary: error })
    }
    writeJson(dataFile('rules-errors.json'), { key })
  }
  const result = classify(tool, toolInput, { cwd: input.cwd ?? process.cwd(), home: homeDir(), dataDir: dataDir(), claudeDir: claudeDir(), rules })
  const summary = String(toolInput.command ?? toolInput.file_path ?? toolInput.notebook_path ?? '').slice(0, 200)
  if (result.category === 'defer') return null
  if (result.category === 'safe') return decide('allow', 'autopilot: safe action')
  if (result.category === 'other') {
    logPermission({ ts: now, sessionId, tool, category: 'other', summary })
    return decide('allow', 'autopilot: allowed and logged')
  }
  const hash = actionHash(tool, toolInput)
  if (consumeApproval(sessionId, hash, now)) {
    logPermission({ ts: now, sessionId, tool, category: 'approved', ruleId: result.ruleId, summary })
    return decide('allow', 'autopilot: approved by the user')
  }
  addPending(sessionId, hash, result.description, now)
  logPermission({ ts: now, sessionId, tool, category: 'blocked', ruleId: result.ruleId, summary })
  return decide('deny', denyReason(result.description))
}

runHook(import.meta.url, handle)
