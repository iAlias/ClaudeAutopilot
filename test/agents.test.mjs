import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tempHome } from './helpers.mjs'
import { agentSpecs, renderAgent, generate } from '../scripts/generate-agents.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))

test('generates 16 agents and removes stale ones', () => {
  const dir = path.join(tempHome(), 'agents')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'autopilot-old.md'), 'x')
  assert.equal(generate(dir), 16)
  const files = fs.readdirSync(dir).sort()
  assert.equal(files.length, 16)
  assert.ok(files.includes('autopilot-haiku.md'))
  assert.ok(files.includes('autopilot-fable-max.md'))
  assert.ok(!files.includes('autopilot-old.md'))
})

test('haiku has no effort, the others do', () => {
  assert.doesNotMatch(renderAgent({ name: 'autopilot-haiku', model: 'haiku', effort: null }), /effort:/)
  assert.match(renderAgent({ name: 'autopilot-opus-xhigh', model: 'opus', effort: 'xhigh' }), /^---\nname: autopilot-opus-xhigh\ndescription: .+\nmodel: opus\neffort: xhigh\n---\n/)
})

test('committed agents match the generator', () => {
  for (const s of agentSpecs()) {
    assert.equal(fs.readFileSync(path.join(root, 'agents', `${s.name}.md`), 'utf8'), renderAgent(s), s.name)
  }
})
