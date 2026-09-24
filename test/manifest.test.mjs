import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const json = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'))

test('hooks.json wires the five hooks to existing scripts', () => {
  const hooks = json('hooks/hooks.json').hooks
  assert.deepEqual(Object.keys(hooks).sort(), ['PreToolUse', 'Stop', 'StopFailure', 'SubagentStop', 'UserPromptSubmit'])
  for (const entries of Object.values(hooks)) {
    for (const entry of entries) {
      for (const h of entry.hooks) {
        const m = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)/.exec(h.command)
        assert.ok(m && fs.existsSync(path.join(root, m[1])), h.command)
      }
    }
  }
})

test('StopFailure runs the stop-failure hook asynchronously on rate limits only', () => {
  const entries = json('hooks/hooks.json').hooks.StopFailure
  assert.equal(entries.length, 1)
  assert.equal(entries[0].matcher, 'rate_limit')
  assert.deepEqual(entries[0].hooks, [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/stop-failure.mjs"', async: true }])
})

test('manifests agree on the plugin name', () => {
  assert.equal(json('.claude-plugin/plugin.json').name, 'autopilot')
  const market = json('.claude-plugin/marketplace.json')
  assert.equal(market.name, 'claude-autopilot')
  assert.equal(market.plugins[0].name, 'autopilot')
})

test('README covers requirements, short commands, uninstall and deferred permissions in both languages', () => {
  const en = fs.readFileSync(path.join(root, 'README.md'), 'utf8')
  const it = fs.readFileSync(path.join(root, 'README.it.md'), 'utf8')
  assert.match(it, /Node\.js >= 18/)
  assert.match(en, /Node\.js >= 18/)
  for (const part of [it, en]) {
    assert.match(part, /`\/autopilot setup`/)
    assert.doesNotMatch(part, /autopilot:autopilot/)
    assert.match(part, /`statusLine`/)
    assert.match(part, /MCP/)
    assert.doesNotMatch(part, /(ripristina la statusline dal backup|restore your statusline from)/)
  }
})

test('README and skill document auto-resume in both languages', () => {
  const en = fs.readFileSync(path.join(root, 'README.md'), 'utf8')
  const it = fs.readFileSync(path.join(root, 'README.it.md'), 'utf8')
  const skill = fs.readFileSync(path.join(root, 'skills', 'autopilot', 'SKILL.md'), 'utf8')
  assert.match(en, /^## Auto-resume after the usage limit$/m)
  assert.match(en, /\(#auto-resume-after-the-usage-limit\)/)
  assert.match(it, /^## Ripresa automatica dopo il limite$/m)
  assert.match(it, /\(#ripresa-automatica-dopo-il-limite\)/)
  for (const part of [en, it]) {
    assert.match(part, /`\/autopilot resume on` \\\| `off`/)
    assert.match(part, /`resume\.json`/)
    assert.match(part, /`hooks\/stop-failure\.mjs`/)
    assert.match(part, /`scripts\/resumer\.mjs`/)
  }
  assert.match(en, /### Permissions in a background resume/)
  assert.match(it, /### Permessi in una ripresa in background/)
  for (const part of [en, it]) {
    assert.match(part, /`bypassPermissions`[^\n]*`default`/)
    assert.match(part, /headless/)
    assert.match(part, /AUTOPILOT_RESUME_SENT/)
    assert.match(part, /30 min/)
    assert.doesNotMatch(part, /valid for that single action only|vale per quella sola azione/)
  }
  assert.match(en, /one "yes" unlocks all the actions waiting in that turn, for 30 minutes/)
  assert.match(it, /un solo "sì" sblocca tutte le azioni in attesa in quel turno, per 30 minuti/)
  assert.match(skill, /`resume on`, `resume off`/)
  assert.match(skill, /^description: .*resume/m)
})
