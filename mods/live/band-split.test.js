'use strict'
// Red-first for the collapsed-band split (PM 2026-11-16): the collapsed row keeps action
// fields only; progress, spend and the quota windows leave it; both sides read one contract.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const dir = __dirname
const contractPath = path.join(dir, 'band-statusline-contract.json')

const facts = {
  verdict: { mark: '◉', word: 'Running', key: 'suggestion' },
  marker: {
    size: 'M', urgent: false, bug: false, high_risk: false, level: 'l5', stage: 'implement', stage_set_at_ms: 1,
    unit: { kind: 'task', index: 3, total: 5, label: 'do not publish this label' }, review_families: ['a'],
  },
  live: 4, stalled: 2,
  review: { plan: null, code: { phase: null, generation: 9, base: null, head: null, seats: [], converged: false, at: null } },
  qc: { state: 'owed', range: null, protected_files_count: 1, evidence: null },
  decisions: { rows: [], count: 3, irreversible: 0, writers: [], undocumented: 0, identity: null, root: null, ladder: null },
  spend: { brain: 40, cap: 50 },
  loadSource: null,
  residue: null,
  quota: [{ kind: 'five_hour', pct: 91, resetsAtMs: null }, { kind: 'seven_day', pct: 10, resetsAtMs: null }],
  nowMs: 0,
  fleet: { stuck: 1, running: 0, waiting: 0 },
}

test('(a) the collapsed row has no quota, spend, position, unit, decisions, live count or review round', async () => {
  const { bandSlots } = await import('./model.ts')
  const slots = bandSlots(facts)
  const ids = slots.map(s => s.id)
  assert.deepEqual(ids.filter(id => ['quota', 'spend', 'position', 'unit', 'decisions'].includes(id)), [])
  const text = slots.map(s => s.segs.map(g => g.text).join('')).join('|')
  assert.equal(text.includes('5h'), false)
  assert.equal(text.includes('7d'), false)
  assert.equal(text.includes('$'), false)
  assert.equal(text.includes('R9'), false)
  assert.equal(text.includes('◉ 4'), false)
  assert.equal(text.includes('do not publish'), false)
  assert.equal(text.includes('⊘ 2'), true)
  assert.equal(text.includes('QC'), true)
})

test('(c) spendColor in model.ts has no literal 80 threshold; it reads the contract', () => {
  const src = fs.readFileSync(path.join(dir, 'model.ts'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n')
  const start = code.indexOf('function spendColor')
  const end = code.indexOf('function spendBarSegs')
  assert.ok(start > 0 && end > start)
  const body = code.slice(start, end)
  assert.equal(/0\.8|>=\s*80\b/.test(body), false, body)
  assert.match(body, /ratioLevel|BAND_CONTRACT|quota_warn_pct/)
})

test('(b) bandFactsDocument copies band-statusline-contract.json and carries numbers only', async () => {
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'))
  const { bandFactsDocument } = await import('./model.ts')
  assert.equal(typeof bandFactsDocument, 'function')
  const doc = bandFactsDocument({
    written_at_ms: 1,
    session_id: 'sid-1',
    live: 2,
    marker: facts.marker,
    review: facts.review,
    decisions: 7,
    spend: { brain: 1.5, cap: 9 },
  })
  assert.equal(doc.v, 1)
  assert.deepEqual(doc.contract, contract)
  assert.equal(doc.progress.live_dispatches, 2)
  assert.equal(doc.progress.position, 'M·l5·implement')
  assert.equal(doc.progress.unit, '3/5')
  assert.equal(doc.progress.review_round, 9)
  assert.equal(doc.progress.decisions_open, 7)
  assert.deepEqual(doc.spend, { usd: 1.5, cap_usd: 9 })
  assert.equal(JSON.stringify(doc).includes('do not publish'), false)
  assert.equal(JSON.stringify(doc).includes('secret'), false)
  assert.deepEqual(Object.keys(contract), ['quota_warn_pct', 'quota_error_pct', 'round', 'bar_on', 'bar_off', 'alert', 'age'])
  assert.equal(contract.round, 'floor')
  assert.equal(contract.quota_warn_pct, 80)
  assert.equal(contract.quota_error_pct, 100)
  assert.deepEqual(Object.keys(doc.progress), ['live_dispatches', 'position', 'unit', 'review_round', 'decisions_open'])
  assert.deepEqual(Object.keys(doc.spend), ['usd', 'cap_usd'])
  const bare = bandFactsDocument({ written_at_ms: 1, session_id: 'sid-1', live: 0, marker: null, review: null, decisions: 0, spend: null })
  assert.equal(bare.progress.live_dispatches, 0)
  assert.equal(bare.progress.position, null)
  assert.equal(bare.progress.unit, null)
  assert.equal(bare.progress.review_round, null)
  assert.equal(bare.progress.decisions_open, 0)
  assert.deepEqual(bare.spend, { usd: null, cap_usd: null })
  const { GLYPHS } = await import('./ui.ts')
  assert.equal(contract.bar_on, GLYPHS.chart.meterOn)
  assert.equal(contract.bar_off, GLYPHS.chart.meterOff)
  assert.equal(contract.alert, GLYPHS.state.need_you)
  assert.equal(contract.age, GLYPHS.structure.age)
  const reg = fs.readFileSync(path.join(dir, 'register.ts'), 'utf8')
  const regCode = reg.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n')
  assert.match(regCode, /autopilot\/band-facts/)
  assert.match(regCode, /sanitizeSid\(sessionId\)/)
  assert.equal(regCode.includes('band-facts.json\''), false)
  assert.equal(regCode.includes('renameSync'), false)
  assert.equal(regCode.includes('node:fs'), false)
  assert.equal(regCode.includes('$.fs.delete'), false)
  assert.match(regCode, /\$\.fs\.write\(tmp, text\)/)
  assert.match(regCode, /\$\.fs\.write\(dest, text\)/)
  const reader = fs.readFileSync(path.join(dir, 'band-contract.ts'), 'utf8')
  assert.equal(/from\s+['"]node:/.test(reader), false)
  assert.match(reader, /band-contract-data/)
})
