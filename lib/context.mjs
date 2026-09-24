export function buildContext({ mode, firstInSession, averages, limitsAvailable }) {
  const lines = [`[autopilot · mode: ${mode}]`]
  if (firstInSession) lines.push('Invoke the autopilot skill once now to load the selection criteria, then apply them to every message.')
  lines.push("Start your reply with the 🧭 line in the exact format defined by the skill, written in the user's language.")
  if (mode === 'auto') lines.push('Delegation rules apply: when they call for it, run the task through the matching autopilot-* agent without asking for confirmation, then report the result.')
  else lines.push('Do not delegate: after the 🧭 line, answer normally.')
  lines.push(limitsAvailable ? 'Estimate usage in % of the 5h window.' : 'Plan usage limits are unavailable: estimate in k tokens.')
  if (averages.length) {
    lines.push('Measured average usage (taskType|model|effort: turns, avg 5h %, avg 7d %):')
    for (const a of averages) lines.push(`- ${a.key}: ${a.n}, ${a.avg5h}, ${a.avg7d ?? '-'}`)
  }
  return lines.join('\n')
}
