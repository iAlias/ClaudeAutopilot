import fs from 'node:fs'

const out = process.env.AUTOPILOT_FAKE_CLAUDE_OUT
if (out) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^CLAUDE/i.test(k)))
  fs.appendFileSync(out, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), resumer: process.env.AUTOPILOT_RESUMER ?? null, env }) + '\n')
}
if (process.env.AUTOPILOT_FAKE_CLAUDE_STDOUT) process.stdout.write(process.env.AUTOPILOT_FAKE_CLAUDE_STDOUT)
const code = Number.parseInt(process.env.AUTOPILOT_FAKE_CLAUDE_EXIT ?? '0', 10) || 0
const sleep = Number.parseInt(process.env.AUTOPILOT_FAKE_CLAUDE_SLEEP ?? '0', 10) || 0
if (sleep > 0) setTimeout(() => process.exit(code), sleep)
else process.exit(code)
