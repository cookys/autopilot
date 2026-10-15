// mods/live/ui-lint.test.js — L3 of the live pane design system (docs/plans/2026-10-13-live-pane-design-system.md, I5 (a) and I20).
// Imports the REAL ui.ts (erasable syntax only, so Node strips the types) and lints its glyph tables; the planted-table cases are the
// negative controls (M7 to M10): each broken table must be reported, so a checker that goes quiet turns this suite red.
// Run: node --test mods/live/ui-lint.test.js   (also run by run-tests.sh)
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

let ui
test.before(async () => {
  ui = await import(path.join(__dirname, 'ui.ts'))
})

const clone = () => JSON.parse(JSON.stringify(ui.GLYPHS))

test('L3: the real glyph tables have no emoji hazard and every new glyph carries a verified entry', () => {
  assert.deepEqual(ui.glyphTableViolations(ui.GLYPHS), [])
})

test('L3: the real glyph tables keep one glyph to one meaning', () => {
  assert.deepEqual(ui.vocabularyViolations(ui.GLYPHS), [])
})

test('L3: every new-to-vocabulary glyph is recorded, and none is claimed verified before the owner ran glyph-check', () => {
  for (const g of ui.NEW_GLYPHS) assert.equal(typeof ui.GLYPHS.verified[g], 'string', 'verified entry for ' + g)
  for (const g of ui.NEW_GLYPHS) assert.ok(ui.verifiedOk(ui.GLYPHS.verified[g]), g + ' verified entry is pending-owner or "<YYYY-MM-DD> <terminal>"')
})

test('M7 control: stalled = the emoji-prone pause glyph is reported', () => {
  const g = clone()
  g.state.stalled = '⏸'
  const v = ui.glyphTableViolations(g)
  assert.ok(v.some(x => x.includes('⏸')), JSON.stringify(v))
})

test('M8 control: a line containing the gear glyph is reported', () => {
  assert.ok(ui.emojiViolations('● 2 ⚙ jobs').length > 0)
  assert.deepEqual(ui.emojiViolations('● 2 jobs'), [])
})

test('M9 control: a keycap sequence is reported; plain digits, # and * stay legal', () => {
  assert.ok(ui.emojiViolations('1️⃣').length >= 2)
  assert.ok(ui.emojiViolations('1⃣').length >= 1)
  assert.deepEqual(ui.emojiViolations('0123456789 # *'), [])
})

test('M10 control: a state glyph also in the structure table is reported', () => {
  const g = clone()
  g.structure.bullet = '●'
  const v = ui.vocabularyViolations(g)
  assert.ok(v.some(x => x.includes('●')), JSON.stringify(v))
})

test('control: a new glyph without a verified entry is reported', () => {
  const g = clone()
  delete g.verified['⊘']
  assert.ok(ui.glyphTableViolations(g).some(x => x.includes('⊘')))
})

test('control: two states sharing one glyph are reported', () => {
  const g = clone()
  g.state.failed = g.state.done
  assert.ok(ui.vocabularyViolations(g).length > 0)
})

test('verified format: pending-owner and "<date> <terminal>" pass; yes, empty, pending and a bare date are refused (negative controls)', () => {
  assert.equal(ui.verifiedOk('pending-owner'), true)
  assert.equal(ui.verifiedOk('2026-10-13 tmux-ssh'), true)
  for (const bad of ['yes', '', 'pending', '2026-10-13', ' 2026-10-13 x', undefined, 3]) assert.equal(ui.verifiedOk(bad), false, JSON.stringify(bad))
  const ok = clone()
  ok.verified['⊘'] = '2026-10-13 tmux-ssh'
  assert.deepEqual(ui.glyphTableViolations(ok), [])
  for (const bad of ['yes', '', 'pending']) {
    const g = clone()
    g.verified['⊘'] = bad
    assert.ok(ui.glyphTableViolations(g).some(x => x.includes('⊘')), 'refused: ' + JSON.stringify(bad))
  }
})

test('glyph-check.js lists exactly the NEW_GLYPHS, in order', () => {
  const src = require('node:fs').readFileSync(path.join(__dirname, 'glyph-check.js'), 'utf8')
  const m = src.match(/^const GLYPHS = (\[.*\])$/m)
  assert.ok(m, 'glyph-check.js has a GLYPHS array literal')
  assert.deepEqual(JSON.parse(m[1].replace(/'/g, '"')), [...ui.NEW_GLYPHS])
  assert.notDeepEqual(['⊘', '△'], [...ui.NEW_GLYPHS]) // control: a shortened list would not compare equal
})

test('FRESH_MS pins the five freshness thresholds (section 2.5)', () => {
  assert.deepEqual({ ...ui.FRESH_MS }, { quiet: 1_800_000, planReview: 86_400_000, terminalPlan: 604_800_000, codeReview: 86_400_000, dispatch: 21_600_000 })
})

// ---------------------------------------------------------------------------------------------------------------------------------------------
// L1, L2, L4, L5, L6, L7 (plan section 6.2): text lints over the real sources. Each rule is a pure function of one source text, so the negative control
// feeds it a planted violation and the real-source test feeds it the shipped file; a rule that goes quiet turns the control red.
const fs = require('node:fs')
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8')
// code only: block comments and `// ...` line comments are dropped (a glyph in a comment is documentation, not drawing)
const code = src => src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, '')).split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n')
const hits = (src, re) => code(src).split('\n').flatMap((l, i) => (re.test(l) ? [`${i + 1}: ${l.trim().slice(0, 100)}`] : []))
const THEME_KEYS = 'claude|warning|error|success|suggestion|inactive|subtle'
const STATE_IDS_RE = 'need_you|failed|stalled|findings|running|done|pending|stopped|skipped|unknown'

const L1 = src => [
  ...hits(src, new RegExp(`['"\`](${THEME_KEYS})['"\`]`)),
  ...hits(src, /\b(color|bold|dim)\s*:/),
  ...hits(src, /backgroundColor|\binverse\b/),
  ...hits(src, /\b(color|bold|dimColor)\s*=\s*(\{?\s*["'`]|\{\s*(true|false)\b)/),
  ...hits(src, /<(Text|Button|Box)[^>]*\s(bold|dimColor)(\s|>|\/)/),
]
// outside ui.ts: a codepoint in U+2190-2BFF or U+25A0-25FF (arrows, shapes, symbols, enclosed forms)
const L2_RE = /[←-⯿■-◿]/u
const L2 = src => hits(src, L2_RE)
const L4 = src => {
  const out = []
  for (const m of code(src).matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]\.\/model['"]/g)) {
    for (const name of m[1].split(',').map(x => x.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0])) if (['seg', 'row', 'rule', 'kv', 'padCells', 'NO_DATA'].includes(name)) out.push('imports ' + name + ' from ./model')
  }
  return out
}
const LINE_KINDS = 'verdict|header|kv|item|bullet|table|meter|empty|more|command|detail|chart|blank|choice|field'
// a hand-made line: a cast, a typed literal, or a spread of a PaneLine variable into a new object literal
const L5_HAND = src => [...hits(src, /\bas PaneLine\b/), ...hits(src, /:\s*PaneLine\s*=\s*\{/), ...hits(src, /\{\s*\.\.\.\s*(line|l|piece|head\[[^\]]*\])\s*[,}]/)]
const L5 = src => [...hits(src, new RegExp(`\\bkind\\s*:\\s*['"](${LINE_KINDS})['"]`)), ...L5_HAND(src)]
const L6 = src => [
  ...hits(src, /toFixed|toLocaleString/),
  ...hits(src, /Math\.(round|floor)\([^)]*\)\s*\+\s*['"` ]*\s*(%|MB|GB|KB|h|m)\b/),
  ...hits(src, /(['"`])(%| %|\$| MB| GB| KB|h|m|\*)\1/),
  ...hits(src, /\$\{[^}]*\}\s?(%|[KMGT]B|ms|s|m|h|d)(?![A-Za-z0-9_])/), // a unit written after a template placeholder: `${n} MB`
  ...hits(src, /\$\$\{/), // a currency sign before a placeholder: `$${n}`
]
const L7 = src => [...hits(src, new RegExp(`['"\`](${STATE_IDS_RE})['"\`]`)), ...hits(src, /\b(GLYPHS|STATES)\b/)]

const TABS = 'tabs.ts'
const CHROME = ['tabs.ts', 'pane.tsx', 'band.tsx']

test('L1: tabs.ts, pane.tsx and band.tsx hold no theme-key literal, no color:/bold:/dim: property, no background and no inverse', () => {
  for (const f of CHROME) assert.deepEqual(L1(read(f)), [], f)
})
test('L1 control: each planted violation is reported', () => {
  for (const bad of ["const k = 'warning'", 'const o = { color: x }', 'const o = { bold: true }', 'const o = { dim: true }', '<Text backgroundColor={x}>', 'const o = { inverse: true }', '<Text color="claude">', '<Text bold>hi</Text>', '<Text dimColor>hi</Text>']) {
    assert.ok(L1(bad).length > 0, bad)
  }
  assert.deepEqual(L1('// the "claude" key\nconst a = drawSeg(s)'), []) // a comment and a plain call are fine
})

test('L2: outside ui.ts no source file carries a glyph; glyphs come from GLYPHS', () => {
  const files = fs.readdirSync(__dirname).filter(f => /\.(ts|tsx)$/.test(f) && !/\.(test|testkit)\.ts$/.test(f) && f !== 'ui.ts' && f !== 'locales.ts')
  assert.ok(files.includes('model.ts') && files.includes('tabs.ts') && files.includes('band.tsx'))
  for (const f of files) assert.deepEqual(L2(read(f)), [], f)
})
test('L2: no string-table value carries a state or structure glyph', () => {
  for (const loc of ['en', 'zh-TW']) {
    const j = JSON.parse(read('locales/' + loc + '.json'))
    const bad = Object.entries(j).filter(([, v]) => typeof v === 'string' && L2_RE.test(v)).map(([k, v]) => k + ': ' + v)
    assert.deepEqual(bad, [], loc)
  }
})
test('L2 control: a planted glyph is reported, a comment is not', () => {
  assert.ok(L2("const g = '▲'").length > 0)
  assert.ok(L2("const g = '→'").length > 0)
  assert.ok(L2("const g = 'ⓘ'").length > 0)
  assert.deepEqual(L2('// ▲ in a comment\nconst g = 1'), [])
  assert.ok(L2_RE.test('⚑') && !L2_RE.test('abc 現況'))
})

test('L4: tabs.ts imports none of seg, row, rule, kv, padCells, NO_DATA from ./model', () => {
  assert.deepEqual(L4(read(TABS)), [])
})
test('L4 control: each retired helper is reported', () => {
  for (const n of ['seg', 'row', 'rule', 'kv', 'padCells', 'NO_DATA']) assert.ok(L4(`import { ${n}, other } from './model'`).length > 0, n)
  assert.deepEqual(L4("import { oneLine } from './model'"), [])
})

test('L5: outside ui.ts no source builds a line by hand', () => {
  for (const f of CHROME) assert.deepEqual(L5(read(f)), [], f)
  for (const f of ['model.ts', 'register.ts']) assert.deepEqual(L5_HAND(read(f)), [], f)
})
test('L5 control: a hand-made line, a cast, a typed literal and a spread are reported', () => {
  assert.ok(L5("return { kind: 'kv', text: 'x' }").length > 0)
  assert.ok(L5('const l = { text: x } as PaneLine').length > 0)
  assert.ok(L5("const l: PaneLine = { text: 'x' }").length > 0)
  assert.ok(L5('out[at] = { ...line, text: x }').length > 0)
  assert.deepEqual(L5("const a = { kind: 'plan', verdict: v }"), [])
})

test('L6: tabs.ts formats no number by hand', () => {
  assert.deepEqual(L6(read(TABS)), [])
})
test('L6 control: toFixed, toLocaleString and a hand-typed unit are reported', () => {
  for (const bad of ['x.toFixed(1)', 'x.toLocaleString()', "const s = n + ' MB'", "const s = n + '%'", "const s = '$' + n", "const s = n + 'h'", "const s = n + 'm'", 'const s = `${n} MB`', 'const s = `${n}%`', 'const s = `${n}m`', 'const s = `${a} ${b}h`', 'const s = `$${n}`']) assert.ok(L6(bad).length > 0, bad)
  assert.deepEqual(L6('const s = ui.size(n)'), [])
  // the template rule leaves ordinary placeholders alone: a word that merely starts with a unit letter, and a plain id
  assert.deepEqual(L6('const s = `${n} more`'), [])
  assert.deepEqual(L6('const s = `lane ${id}`'), [])
  assert.deepEqual(L6('const s = `${a}/${b}`'), [])
})

test('L7: tabs.ts holds no StateId literal and never reads GLYPHS or STATES', () => {
  assert.deepEqual(L7(read(TABS)), [])
})
test('L7 control: a state id literal and a table access are reported', () => {
  for (const id of STATE_IDS_RE.split('|')) assert.ok(L7(`const s = '${id}'`).length > 0, id)
  assert.ok(L7('const g = ui.GLYPHS.state.done').length > 0)
  assert.ok(L7('const g = STATES[s.id]').length > 0)
  assert.deepEqual(L7('const s = ui.stateOf(d, x)'), [])
})

// docs/plans/2026-10-03-mods-visible-dispatch.md §2.5 (owner ruling 2026-10-15): the pane may send ONE prompt, the owner's own 送出 press, and never as the user.
test('prompt.submit allowlist: only register.ts sendDecide calls $.prompt.submit; no file uses asUser or process spawning', () => {
  const files = fs.readdirSync(__dirname).filter(f => /\.(ts|tsx)$/.test(f) && !/\.(test|testkit)\.ts$/.test(f) && f !== 'locales.ts')
  const offenders = []
  for (const f of files) {
    const src = code(read(f))
    if (/\basUser\b/.test(src)) offenders.push(f + ': asUser')
    if (/process\.(spawn|run)\b/.test(src)) offenders.push(f + ': process spawn')
    const calls = [...src.matchAll(/prompt\.submit\(/g)]
    if (f !== 'register.ts' && calls.length > 0) offenders.push(f + ': prompt.submit')
    if (f === 'register.ts') {
      assert.equal(calls.length, 1, 'exactly one call site')
      const from = src.lastIndexOf('async function ', calls[0].index)
      assert.match(src.slice(from, from + 40), /^async function sendDecide\b/, 'the call is inside sendDecide')
    }
  }
  assert.deepEqual(offenders, [])
})
test('prompt.submit allowlist control: a second call site and asUser are reported', () => {
  assert.ok(/prompt\.submit\(/.test(code('async function other($) { $.prompt.submit({ text }) }')))
  assert.ok(/\basUser\b/.test(code('$.prompt.submit({ text, asUser: true })')))
})
