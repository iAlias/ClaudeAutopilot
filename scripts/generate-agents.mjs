import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMain } from '../lib/hook-io.mjs'

export const MODELS = ['sonnet', 'opus', 'fable']
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const LABEL = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus', fable: 'Fable' }

const BODY = `You are an autopilot worker. The main session delegated this task to you because your model and effort level fit it best.

You do not see the conversation: work only from the brief you received. It contains the goal, the relevant files and paths, the constraints and the completion criterion.

- Carry the task through to completion within the brief's scope. Do not expand the scope.
- If something in the brief is ambiguous, pick the most reasonable interpretation and state it in your report.
- If an action is blocked waiting for the user's confirmation, stop and describe that action in plain words in your report.
- Follow the user's preferences quoted in the brief.

End with a short report: what you did, which files you changed, what is left open.`

export function agentSpecs() {
  const specs = [{ name: 'autopilot-haiku', model: 'haiku', effort: null }]
  for (const model of MODELS) {
    for (const effort of EFFORTS) specs.push({ name: `autopilot-${model}-${effort}`, model, effort })
  }
  return specs
}

export function renderAgent({ name, model, effort }) {
  const description = `Autopilot worker running on ${LABEL[model]}${effort ? ` at ${effort} effort` : ''}. Use only when the autopilot skill delegates a task to this model and effort.`
  const frontmatter = ['---', `name: ${name}`, `description: ${description}`, `model: ${model}`]
  if (effort) frontmatter.push(`effort: ${effort}`)
  frontmatter.push('---')
  return `${frontmatter.join('\n')}\n\n${BODY}\n`
}

export function generate(dir) {
  fs.mkdirSync(dir, { recursive: true })
  for (const f of fs.readdirSync(dir)) {
    if (/^autopilot-.*\.md$/.test(f)) fs.rmSync(path.join(dir, f))
  }
  const specs = agentSpecs()
  for (const s of specs) fs.writeFileSync(path.join(dir, `${s.name}.md`), renderAgent(s))
  return specs.length
}

if (isMain(import.meta.url)) {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'agents')
  console.log(`${generate(dir)} agents written to ${dir}`)
}
