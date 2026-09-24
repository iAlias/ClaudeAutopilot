import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const json = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'))

test('hooks.json wires the four hooks to existing scripts', () => {
  const hooks = json('hooks/hooks.json').hooks
  assert.deepEqual(Object.keys(hooks).sort(), ['PreToolUse', 'Stop', 'SubagentStop', 'UserPromptSubmit'])
  for (const entries of Object.values(hooks)) {
    for (const entry of entries) {
      for (const h of entry.hooks) {
        const m = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)/.exec(h.command)
        assert.ok(m && fs.existsSync(path.join(root, m[1])), h.command)
      }
    }
  }
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
