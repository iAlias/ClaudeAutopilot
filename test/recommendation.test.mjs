import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tempHome, writeTranscript } from './helpers.mjs'
import { parseRecommendation, agentName } from '../lib/recommendation.mjs'
import { lastTurnAssistantText } from '../lib/transcript.mjs'

test('parses a suggest line', () => {
  assert.deepEqual(
    parseRecommendation('intro\n🧭 Consigliato: Sonnet · low · ~1–2% 5h · small-code (/model sonnet)\nresto'),
    { model: 'sonnet', effort: 'low', estLow: 1, estHigh: 2, unit: 'pct5h', taskType: 'small-code', delegated: null },
  )
})

test('parses an auto line with delegation', () => {
  const r = parseRecommendation('🧭 Opus · xhigh · ~3-6% 5h · multi-file → delegato')
  assert.equal(r.model, 'opus')
  assert.equal(r.effort, 'xhigh')
  assert.equal(r.delegated, true)
})

test('parses in-session lines and token estimates', () => {
  const r = parseRecommendation('**🧭 Fable · high · ~20–40k tok · architecture → in sessione (serve il contesto)**')
  assert.equal(r.unit, 'ktok')
  assert.equal(r.delegated, false)
  assert.equal(r.estHigh, 40)
})

test('haiku has no effort and decimals are accepted', () => {
  const r = parseRecommendation('🧭 Haiku · - · ~0,5–1% 5h · trivial → delegated')
  assert.equal(r.effort, null)
  assert.equal(r.estLow, 0.5)
  assert.equal(r.delegated, true)
})

test('returns null without a valid line', () => {
  assert.equal(parseRecommendation('nothing here'), null)
  assert.equal(parseRecommendation('🧭 GPT · low · ~1–2% 5h · x'), null)
  assert.equal(parseRecommendation(''), null)
  assert.equal(parseRecommendation(undefined), null)
})

test('agentName maps model and effort to the agent file name', () => {
  assert.equal(agentName('haiku', null), 'autopilot-haiku')
  assert.equal(agentName('opus', 'xhigh'), 'autopilot-opus-xhigh')
})

test('collects assistant text after the last real user prompt', () => {
  const dir = tempHome()
  const f = writeTranscript(dir, [
    { type: 'user', message: { role: 'user', content: 'primo' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'vecchia risposta' }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'secondo' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: '🧭 Opus · high · ~2–4% 5h · feature' }, { type: 'tool_use', id: 't1', name: 'Read', input: {} }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
    { type: 'user', isMeta: true, message: { content: [{ type: 'text', text: 'skill body' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'fatto' }] } },
  ])
  assert.equal(lastTurnAssistantText(f), '🧭 Opus · high · ~2–4% 5h · feature\nfatto')
})

test('missing transcript returns an empty string', () => {
  assert.equal(lastTurnAssistantText('/no/such/file.jsonl'), '')
  assert.equal(lastTurnAssistantText(undefined), '')
})
