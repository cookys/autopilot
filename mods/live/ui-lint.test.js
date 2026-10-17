// mods/live/ui-lint.test.js — L3 of the live pane design system (docs/plans/2026-10-13-live-pane-design-system.md, I5 (a) and I20).
// Imports the REAL ui.ts (erasable syntax only, so Node strips the types) and lints its glyph tables; the planted-table cases are the
// negative controls (M7 to M10): each broken table must be reported, so a checker that goes quiet turns this suite red.
// Scope (BL-0207): the rules about what a mod screen may draw scan EVERY mod under mods/ through modSources(); the rules that name live's own files say why they stay live (see SCOPE below).
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

test('FRESH_MS pins the six freshness thresholds (section 2.5)', () => {
  assert.deepEqual({ ...ui.FRESH_MS }, { quiet: 1_800_000, planReview: 86_400_000, terminalPlan: 604_800_000, abandonedPlan: 604_800_000, codeReview: 86_400_000, dispatch: 21_600_000 })
})

// ---------------------------------------------------------------------------------------------------------------------------------------------
// L1, L2, L4, L5, L6, L7 (plan section 6.2): text lints over the real sources. Each rule is a pure function of one source text, so the negative control
// feeds it a planted violation and the real-source test feeds it the shipped file; a rule that goes quiet turns the control red.
const fs = require('node:fs')
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8')
// BL-0207 (evidence-discipline section 60): a rule's enforcement scope must equal its stated scope. Section 12 of the design plan binds EVERY mod surface, so a rule that is
// about what a mod screen may draw scans every mod through THIS one list, not `fs.readdirSync(__dirname)`. The list is every non-test source under mods/ (each mod directory,
// recursively, plus the composed mods/register.ts): .ts and .tsx, minus *.test.* and *.testkit.*, the generated locales.ts, the `types/` declaration folder and node_modules.
// Paths are relative to mods/ with the mod name first ('live/ui.ts', 'viewer/pane.tsx', 'register.ts'). A mod added tomorrow is scanned with no edit here.
const MODS_ROOT = path.join(__dirname, '..')
const modSources = (root = MODS_ROOT) => {
  const walkDir = (dir, rel) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (e.isDirectory()) return e.name === 'types' || e.name === 'node_modules' ? [] : walkDir(path.join(dir, e.name), path.join(rel, e.name))
    return [path.join(rel, e.name)]
  })
  return walkDir(root, '').filter(f => /\.(ts|tsx)$/.test(f) && !/\.d\.ts$/.test(f) && !/\.(test|testkit)\.(ts|tsx)$/.test(f) && path.basename(f) !== 'locales.ts').sort()
}
const readMod = (rel, root = MODS_ROOT) => fs.readFileSync(path.join(root, rel), 'utf8')
// per-file scan: returns `rel: finding` lines for every source under mods/ that `rule` reports on, except the files named in `except`
const scanMods = (rule, except = [], root = MODS_ROOT) => modSources(root).filter(f => !except.includes(f)).flatMap(f => rule(readMod(f, root)).map(x => f + ' ' + x))
// code only: block comments and `// ...` line comments are dropped (a glyph in a comment is documentation, not drawing)
const code = src => src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, '')).split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n')
const hits = (src, re) => code(src).split('\n').flatMap((l, i) => (re.test(l) ? [`${i + 1}: ${l.trim().slice(0, 100)}`] : []))
const THEME_KEYS = 'claude|warning|error|success|suggestion|inactive|subtle|merged'
const STATE_IDS_RE = 'need_you|failed|stalled|findings|running|done|pending|stopped|skipped|unknown'

const L1 = src => [
  ...hits(src, new RegExp(`['"\`](${THEME_KEYS})['"\`]`)),
  ...hits(src, /\b(color|bold|dim)\s*:/),
  ...hits(src, /backgroundColor|\binverse\b/),
  ...hits(src, /\b(color|bold|dimColor)\s*=\s*(\{?\s*["'`]|\{\s*(true|false)\b)/),
  ...hits(src, /<(Text|Button|Box)[^>]*\s(bold|dimColor)(\s|>|\/)/),
  ...boldTagHits(src),
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

// SCOPE of each rule (BL-0207, judged one by one; shared rules scan every mod through modSources(), see below):
//   all mods:  L2 (glyphs), L5_HAND (no hand-made PaneLine), L6_CORE (no hand-formatted number in drawing code), L8 (palette), L1b/L9 (no background / inverse, bold whitelist), process and prompt.submit allowlists.
//   live only: L1 full / L4 / L5 full / L7 name live's own files (tabs.ts, pane.tsx, band.tsx are live's chrome layer over ui.ts / model.ts; the viewer has no such layering, its
//              look is covered by the all-mod rules and the render-level buttonFindings); L3 and the glyph tables test live's ui.ts exports (GLYPHS, PALETTE live in the one file).
const TABS = 'tabs.ts'
const CHROME = ['tabs.ts', 'pane.tsx', 'band.tsx']

// live only: these three files are live's chrome layer; the all-mod part of this rule is L8 and L1b/L9 below.
test('L1: tabs.ts, pane.tsx and band.tsx hold no theme-key literal, no color:/bold:/dim: property, no background and no inverse', () => {
  for (const f of CHROME) assert.deepEqual(L1(read(f)), [], f)
})
test('L1 control: each planted violation is reported', () => {
  for (const bad of ["const k = 'warning'", 'const o = { color: x }', 'const o = { bold: true }', 'const o = { dim: true }', '<Text backgroundColor={x}>', 'const o = { inverse: true }', '<Text color="claude">', '<Text bold>hi</Text>', '<Text dimColor>hi</Text>']) {
    assert.ok(L1(bad).length > 0, bad)
  }
  assert.deepEqual(L1('// the "claude" key\nconst a = drawSeg(s)'), []) // a comment and a plain call are fine
})

// L8 (owner ruling 2026-10-16, semantic palette): a theme-key literal may appear ONLY in the PALETTE table of ui.ts (and in the ThemeKey type that names the keys).
// Everything else draws a colour through a role (`PALETTE.attention`), so one colour keeps one meaning and a new use has to pick a role on purpose.
const PALETTE_DECL = /export const PALETTE\b[^=]*=\s*\{[^}]*\}/
const THEME_TYPE = /^export type ThemeKey = .*$/m
const blank = m => m.replace(/[^\n]/g, '')
const L8 = src => hits(src.replace(PALETTE_DECL, blank).replace(THEME_TYPE, blank), new RegExp(`['"\`](${THEME_KEYS})['"\`]`))
test('mods source list: every mod directory and mods/register.ts is scanned, tests and generated files are not, and a newly added mod shows up with no edit', () => {
  const files = modSources()
  for (const f of ['live/ui.ts', 'live/model.ts', 'live/tabs.ts', 'live/band.tsx', 'live/scroll.tsx', 'viewer/pane.tsx', 'viewer/show.ts', 'viewer/register.ts', 'register.ts']) assert.ok(files.includes(f), f)
  for (const f of files) assert.ok(!/\.(test|testkit)\./.test(f) && !f.endsWith('locales.ts') && !f.endsWith('.d.ts') && !f.split(path.sep).includes('types'), 'excluded kind in the list: ' + f)
  // negative control: a throwaway mods root with a brand-new mod, a test, a generated file and a types folder; only the new mod's source is listed
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'modsrc-'))
  try {
    fs.mkdirSync(path.join(tmp, 'newmod', 'types'), { recursive: true })
    for (const f of ['newmod/pane.tsx', 'newmod/x.test.ts', 'newmod/y.testkit.ts', 'newmod/locales.ts', 'newmod/types/index.d.ts', 'register.ts']) fs.writeFileSync(path.join(tmp, f), '')
    assert.deepEqual(modSources(tmp), [path.join('newmod', 'pane.tsx'), 'register.ts'])
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
})
// The scan-level negative control (BL-0207): the pure-function controls below feed a rule a planted string, which proves the RULE but not that the LIST reaches the viewer. This one
// copies the real mods/ tree to a temp dir, plants ONE violation per shared rule in the copied viewer/pane.tsx and runs the real list + real rule over the copy: each must come
// back non-empty, and the unplanted copy must come back empty. Shrink modSources() to live only and every row below turns red.
test('scan-level control: one violation planted in a copy of viewer/pane.tsx is found by every all-mod rule through the shared source list', () => {
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'modscan-'))
  try {
    fs.cpSync(MODS_ROOT, tmp, { recursive: true, filter: src => !src.includes('node_modules') })
    const target = path.join(tmp, 'viewer', 'pane.tsx')
    const clean = fs.readFileSync(target, 'utf8')
    const HINT = '<Text key="hint" dimColor>'
    assert.ok(clean.includes(HINT))
    const rows = [
      ['L8 theme-key literal', L8, [], HINT, '<Text key="hint" color=\'warning\'>'],
      ['L9 bold', boldHits, BOLD_FILES, HINT, '<Text key="hint" bold>'],
      ['L9 bold on its own line', boldHits, BOLD_FILES, HINT, '<Text\n  key="hint"\n  bold\n>'],
      ['L1b inverse', src => hits(src, BG_RE), [], HINT, '<Text key="hint" inverse>'],
      ['L1b backgroundColor', src => hits(src, BG_RE), [], HINT, '<Text key="hint" backgroundColor={x}>'],
      ['L2 glyph', L2, ['live/ui.ts'], HINT, '<Text key="hint" dimColor>{\'▲\'}</Text>' + HINT],
      ['L5 hand-made line', L5_HAND, ['live/ui.ts'], HINT, 'void ({ text: x } as PaneLine)\n' + HINT],
      ['L6 core hand formatting', L6_CORE, modSources().filter(f => !L6_FILES().includes(f)), HINT, 'void x.toFixed(1)\n' + HINT],
    ]
    for (const [name, rule, except, from, to] of rows) {
      fs.writeFileSync(target, clean)
      assert.deepEqual(scanMods(rule, except, tmp), [], name + ': the unplanted copy is clean')
      fs.writeFileSync(target, clean.replace(from, to))
      const found = scanMods(rule, except, tmp)
      assert.ok(found.length > 0 && found.every(x => x.startsWith('viewer/pane.tsx ')), name + ': ' + JSON.stringify(found))
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
})
test('L8: no theme-key literal outside the PALETTE table (every source file under every mod in mods/)', () => {
  const files = modSources()
  assert.ok(files.includes('live/ui.ts') && files.includes('live/model.ts') && files.includes('live/tabs.ts') && files.includes('live/band.tsx') && files.includes('viewer/pane.tsx'))
  assert.deepEqual(scanMods(L8), [])
  assert.match(read('ui.ts'), PALETTE_DECL, 'ui.ts declares PALETTE') // the exemption must be real: a renamed table would otherwise leave the lint with nothing to exempt
})
test('L8 control: a planted theme-key literal in the real viewer sources is reported (the viewer pane draws no colour of its own: its quiet lines are dim)', () => {
  const pane = readMod('viewer/pane.tsx')
  const planted = pane.replace('<Text key="hint" dimColor>', '<Text key="hint" color=\'subtle\'>')
  assert.notEqual(planted, pane)
  assert.ok(L8(planted).length > 0)
  assert.deepEqual(L8(pane), [])
})
// L1b / L9 (all mods): no background and no inverse anywhere; bold is a whitelist. The only bold in all of mods/ is live's ui.ts (BOLD_USES, checked by the I4 invariant) and live's model.ts (the band: pinned below).
const BG_RE = /\b(backgroundColor|inverse)\b/
const BOLD_ANY = /\bbold\s*[:=]|<(Text|Button|Box)[^>]*\sbold(\s|>|\/)/
const BOLD_FILES = ['live/ui.ts', 'live/model.ts']
// BL-0210: BOLD_ANY is per line, so a bare `bold` attribute that JSX wraps onto its own line escapes it. This scanner reads each <Text|Button|Box opening tag across lines (brace depth and
// quotes tracked, so `{...}` expressions, strings and comments never count) and reports a `bold` attribute written at the tag's own level. Same whitelist as BOLD_ANY: callers pass BOLD_FILES as the except list.
const boldTagHits = src => {
  const c = code(src), out = [], lineOf = i => c.slice(0, i).split('\n').length
  for (const m of c.matchAll(/<(Text|Button|Box)\b/g)) {
    let depth = 0, q = '', i = m.index + m[0].length
    for (; i < c.length; i++) {
      const ch = c[i]
      if (q) { if (ch === '\\') i++; else if (ch === q) q = ''; continue }
      if (ch === '"' || ch === "'" || ch === '`') q = ch
      else if (ch === '{') depth++
      else if (ch === '}') depth--
      else if (depth === 0 && ch === '>') break
      else if (depth === 0 && /\s/.test(ch) && /^\s+bold(?![\w$-])/.test(c.slice(i, i + 40))) { const at = i + c.slice(i).search(/bold/); out.push(`${lineOf(at)}: ${c.split('\n')[lineOf(at) - 1].trim().slice(0, 100)}`); i = at + 3 }
    }
  }
  return out
}
const boldHits = src => [...new Set([...hits(src, BOLD_ANY), ...boldTagHits(src)])].sort((a, b) => parseInt(a) - parseInt(b))
test('L1b/L9: no mod source sets a background or inverse, and no mod source but live ui.ts and live model.ts sets bold', () => {
  assert.ok(modSources().includes('viewer/pane.tsx'), 'the scan reaches the viewer')
  assert.deepEqual(scanMods(src => hits(src, BG_RE)), [])
  assert.deepEqual(scanMods(boldHits, BOLD_FILES), [])
})
test('L1b/L9 control: a bold, a background and an inverse planted in the real viewer sources are each reported (negative control)', () => {
  const pane = readMod('viewer/pane.tsx')
  for (const [name, re, ins] of [['bold attr', BOLD_ANY, '<Text key="hint" bold>'], ['bold prop', BOLD_ANY, '<Text key="hint" {...{ bold: true }}>'], ['background', BG_RE, '<Text key="hint" backgroundColor={x}>'], ['inverse', BG_RE, '<Text key="hint" inverse>']]) {
    const planted = pane.replace('<Text key="hint" dimColor>', ins)
    assert.notEqual(planted, pane, name)
    assert.ok(hits(planted, re).length > 0, name)
    assert.deepEqual(hits(pane, re), [], name + ': the unmodified file is clean')
  }
  const reg = readMod('viewer/register.ts') // a second viewer file, not only the pane
  assert.ok(hits(reg + '\nconst o = { bold: true }', BOLD_ANY).length > 0)
  assert.ok(hits('<Text bold>x</Text> {bold: true}', BOLD_ANY).length > 0, 'the bold scan sees a planted bold')
})
test('L9 control (BL-0210): a bold attribute on its own JSX line is reported; strings, comments, expressions and other attributes are not (negative control)', () => {
  const own = '<Text\n  key="k"\n  bold\n  color={x}\n>hi</Text>'
  assert.equal(hits(own, BOLD_ANY).length, 0, 'the per-line rule alone misses it (this is the gap)')
  assert.deepEqual(boldTagHits(own), ['3: bold'])
  assert.equal(boldHits('<Button\n  bold={ok}\n/>').length, 1)
  assert.equal(boldHits('<Box\n  a="1"\n  bold={true}\n>').length, 1)
  for (const ok of ['<Text\n  key="bold"\n  color={x}\n>bold</Text>', '<Text\n  title="a bold move"\n>x</Text>', '// <Text\n//   bold\n', '<Text\n  {...{ boldly: 1 }}\n  data-bold\n>x</Text>', '<Text\n  onClick={() => (a > b ? 1 : 2)}\n>\n  bold\n</Text>']) assert.deepEqual(boldHits(ok), [], ok)
  // scan level: planted in a copy of the real viewer pane (outside the whitelist) it is reported; in a whitelisted file it is not
  const pane = readMod('viewer/pane.tsx'), HINT = '<Text key="hint" dimColor>'
  assert.ok(pane.includes(HINT))
  assert.ok(boldHits(pane.replace(HINT, '<Text\n  key="hint"\n  bold\n>')).length > 0)
  assert.deepEqual(boldHits(pane), [])
})
test('L8 control: a prose segment painted with a literal key is reported, a role is not (negative control, red before green)', () => {
  // the planted fixture: a prose seg coloured `warning` directly, exactly the regression this lint exists to stop
  assert.ok(L8("const s = sg(body, { role: 'prose', color: 'warning' })").length > 0)
  for (const k of THEME_KEYS.split('|')) assert.ok(L8(`const o = { color: '${k}' }`).length > 0, k)
  assert.deepEqual(L8("const s = sg(body, { role: 'prose', color: PALETTE.attention })"), [])
  // the real ui.ts with ONE seg repainted by hand turns red; the unmodified file is green
  const real = read('ui.ts')
  const planted = real.replace("segs.push(sg(body, { role: 'prose',", "segs.push(sg(body, { color: 'warning', role: 'prose',")
  assert.notEqual(planted, real, 'the planted edit applied')
  assert.deepEqual(L8(real), [])
  assert.equal(L8(planted).length, 1)
  // and the real model.ts (the band) the same way
  const band = read('model.ts')
  const plantedBand = band.replace("sp(m.stage, { color: PALETTE.here,", "sp(m.stage, { color: 'claude',")
  assert.notEqual(plantedBand, band, 'the planted band edit applied')
  assert.equal(L8(plantedBand).length, 1)
  // a comment naming a key is documentation, not a colour
  assert.deepEqual(L8("// the 'warning' key\nconst a = 1"), [])
})

// L9: bold is a whitelist. The band draws bold in exactly one place (the verdict word); the pane's bold segments live in ui.ts only (the I4 invariant checks what is drawn).
const BOLD_PROP = /\bbold\s*:/
test('L9: the band source (model.ts) is bold only on the verdict slot (plus the legacy PaneLine bold passthrough); tabs.ts, pane.tsx and band.tsx never set bold (L1)', () => {
  const hit = hits(read('model.ts'), BOLD_PROP)
  assert.equal(hit.length, 2, JSON.stringify(hit))
  assert.match(hit[0], /v\.mark \+ ' ' \+ v\.word/)
  assert.match(hit[1], /const base: Seg\[\]/)
})
test('L9 control: a second bold in the band source is reported', () => {
  const planted = read('model.ts').replace("sp(m.stage, { color: PALETTE.here,", "sp(m.stage, { color: PALETTE.here, bold: true,")
  assert.equal(hits(planted, BOLD_PROP).length, 3)
})

test('L2: outside live ui.ts no mod source file carries a glyph; glyphs come from GLYPHS', () => {
  const files = modSources().filter(f => f !== 'live/ui.ts')
  assert.ok(files.includes('live/model.ts') && files.includes('live/tabs.ts') && files.includes('live/band.tsx') && files.includes('viewer/pane.tsx') && files.includes('viewer/strings.ts'))
  assert.deepEqual(scanMods(L2, ['live/ui.ts']), [])
})
test('L2 control: a glyph planted in the real viewer pane and viewer strings is reported', () => {
  for (const f of ['viewer/pane.tsx', 'viewer/strings.ts']) {
    const src = readMod(f)
    assert.deepEqual(L2(src), [], f)
    assert.ok(L2(src + "\nconst g = '▲'").length > 0, f)
  }
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

// live only: tabs.ts is live's tab-content layer, retired helpers are live's model.ts exports.
test('L4: tabs.ts imports none of seg, row, rule, kv, padCells, NO_DATA from ./model', () => {
  assert.deepEqual(L4(read(TABS)), [])
})
test('L4 control: each retired helper is reported', () => {
  for (const n of ['seg', 'row', 'rule', 'kv', 'padCells', 'NO_DATA']) assert.ok(L4(`import { ${n}, other } from './model'`).length > 0, n)
  assert.deepEqual(L4("import { oneLine } from './model'"), [])
})

// L5 full (a `kind:` literal) is live only: PaneLine kinds are live's line vocabulary and the chrome files are the ones that must not build one. The hand-made-line scan
// (a PaneLine cast, typed literal or spread) applies to EVERY mod source but live ui.ts, the one place a PaneLine is made.
test('L5: outside ui.ts no source builds a line by hand', () => {
  for (const f of CHROME) assert.deepEqual(L5(read(f)), [], f)
  assert.ok(modSources().includes('viewer/pane.tsx'), 'the scan reaches the viewer')
  assert.deepEqual(scanMods(L5_HAND, ['live/ui.ts']), [])
})
test('L5 control: a hand-made line planted in the real viewer pane is reported', () => {
  const pane = readMod('viewer/pane.tsx')
  assert.deepEqual(L5_HAND(pane), [])
  assert.ok(L5_HAND(pane + '\nconst l = { text: x } as PaneLine').length > 0)
  assert.ok(L5_HAND(pane + '\nconst l: PaneLine = { text: x }').length > 0)
})
test('L5 control: a hand-made line, a cast, a typed literal and a spread are reported', () => {
  assert.ok(L5("return { kind: 'kv', text: 'x' }").length > 0)
  assert.ok(L5('const l = { text: x } as PaneLine').length > 0)
  assert.ok(L5("const l: PaneLine = { text: 'x' }").length > 0)
  assert.ok(L5('out[at] = { ...line, text: x }').length > 0)
  assert.deepEqual(L5("const a = { kind: 'plan', verdict: v }"), [])
})

// L6 full is live's tabs.ts only: ui.ts and model.ts are where live's formatters live (they carry toFixed and the unit suffixes by design), and the bare quoted-unit pattern also
// matches a cache key like `(v ? 'v' : 'h')`. The unambiguous core (toFixed, toLocaleString, a unit after a template placeholder, a currency sign before one) applies to
// every drawing file: tabs.ts and every .tsx under mods/.
const L6_CORE = src => [...hits(src, /toFixed|toLocaleString/), ...hits(src, /\$\{[^}]*\}\s?(%|[KMGT]B|ms|s|m|h|d)(?![A-Za-z0-9_])/), ...hits(src, /\$\$\{/)]
const L6_FILES = () => modSources().filter(f => f.endsWith('.tsx') || f === path.join('live', 'tabs.ts'))
test('L6: tabs.ts formats no number by hand; no drawing file (tabs.ts, every .tsx in mods/) does either, in the L6 core', () => {
  assert.deepEqual(L6(read(TABS)), [])
  assert.ok(L6_FILES().includes('viewer/pane.tsx') && L6_FILES().includes('live/tabs.ts'))
  assert.deepEqual(scanMods(L6_CORE, modSources().filter(f => !L6_FILES().includes(f))), [])
})
test('L6 control: toFixed and a unit after a placeholder planted in the real viewer pane are reported', () => {
  const pane = readMod('viewer/pane.tsx')
  assert.deepEqual(L6_CORE(pane), [])
  assert.ok(L6_CORE(pane + '\nconst s = x.toFixed(1)').length > 0)
  assert.ok(L6_CORE(pane + '\nconst s = `${n} MB`').length > 0)
})
test('L6 control: toFixed, toLocaleString and a hand-typed unit are reported', () => {
  for (const bad of ['x.toFixed(1)', 'x.toLocaleString()', "const s = n + ' MB'", "const s = n + '%'", "const s = '$' + n", "const s = n + 'h'", "const s = n + 'm'", 'const s = `${n} MB`', 'const s = `${n}%`', 'const s = `${n}m`', 'const s = `${a} ${b}h`', 'const s = `$${n}`']) assert.ok(L6(bad).length > 0, bad)
  assert.deepEqual(L6('const s = ui.size(n)'), [])
  // the template rule leaves ordinary placeholders alone: a word that merely starts with a unit letter, and a plain id
  assert.deepEqual(L6('const s = `${n} more`'), [])
  assert.deepEqual(L6('const s = `lane ${id}`'), [])
  assert.deepEqual(L6('const s = `${a}/${b}`'), [])
})

// live only: StateId, GLYPHS and STATES are live's state vocabulary, and tabs.ts is the file that must go through ui.stateOf.
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
// The scan is the plan's `grep -r mods/`: every non-test source under mods/, recursively. A use is `prompt.submit`, `prompt["submit"]` / `prompt['submit']`, or a
// destructuring of `submit` out of `prompt` (`const { submit } = $.prompt`); a string such as on('prompt.submit', ...) is an event name, not a call, and is not one.
const SUBMIT_USE = [/\bprompt\s*\.\s*submit\b(?!['"`])/g, /\bprompt\s*\[\s*['"`]submit['"`]\s*\]/g, /\{[^}]*\bsubmit\b[^}]*\}\s*=\s*[^;\n]*\bprompt\b/g]
const submitUses = src => SUBMIT_USE.flatMap(re => [...code(src).matchAll(re)].map(m => ({ at: m.index, text: m[0] })))
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
// $.process allowlist. Owner ruling 2026-10-16 (decision d-7a7ee75c, 「合併，改成不用確認」): the 殘留 cleanup buttons may run `$.process.run` (argument vector, no shell, no
// permission dialog) because the two scripts they run re-check the safety condition themselves at run time (repo-residue-sweep.js reap classifies every worktree again;
// prune-plugin-cache.js re-checks the path, the live pids and the loaded copy). So the ban on `$.process` stays for everything else: `process.run` is allowed once, in
// register.ts, and only while CLEAN_SCRIPTS names exactly those two scripts; `process.spawn`, any other file and any second use are offenders.
// Owner ruling 2026-10-17 (the viewer mod): ONE more use, in mods/viewer/show.ts, `$.process.run(gitDiffArgv(args))` - the `show` tool's `git diff` (argument vector, no shell). It is
// allowed only while gitDiffArgv (viewer/model.ts) forces `--no-ext-diff --no-textconv` after the model's arguments and parseShowInput is a WHITELIST (revisions, --cached, --staged,
// -U<n>, --unified=<n>; git accepts abbreviated long options, so a blacklist is bypassed by --ext / --textc / --open / --outp).
const ALLOWED_CLEAN_SCRIPTS = ['scripts/repo-residue-sweep.js', 'scripts/prune-plugin-cache.js']
// every way to reach the `process` member of `$`: `$.process`, `$?.process`, `$['process']`, `$["process"]`, `$[`process`]`, and a destructuring `const { process } = $` / `const { process: p } = $`.
// Counting the ACCESS, not the `.run` call, is what makes an alias (`const p = $.process; p.run(...)`, `const { run } = $.process`) show up: the access is still there.
const PROCESS_ACCESS = [/\$\s*\??\.\s*process\b/g, /\$\s*\[\s*['"`]process['"`]\s*\]/g, /\{[^}]*\bprocess\b[^}]*\}\s*=\s*\$(?![\w$])/g]
const processAccesses = src => PROCESS_ACCESS.flatMap(re => [...src.matchAll(re)].map(m => m[0]))
const VIEWER_SHOW = path.join('viewer', 'show.ts')
function viewerDiffOffenders(src) {
  const uses = processAccesses(src)
  const out = []
  if (uses.length !== 1) out.push('$.process reached ' + uses.length + ' times, one allowed')
  if (!/\$\.process\.run\(gitDiffArgv\(/.test(src)) out.push('the one use is not `$.process.run(gitDiffArgv(...))`')
  return out
}
function processRunOffenders(src, where) {
  const isRegister = where === true || where === 'register'
  const uses = processAccesses(src)
  if (uses.length === 0) return []
  if (where === 'viewer') return viewerDiffOffenders(src)
  if (!isRegister) return ['$.process outside register.ts']
  const out = []
  if (uses.length !== 1) out.push('$.process reached ' + uses.length + ' times, one allowed')
  if (!/\$\.process\.run\(argv,/.test(src)) out.push('the one use is not `$.process.run(argv, ...)`')
  const m = /export const CLEAN_SCRIPTS = \[([^\]]*)\]/.exec(src)
  const names = m === null ? null : [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1])
  if (names === null || names.length !== ALLOWED_CLEAN_SCRIPTS.length || names.some((n, i) => n !== ALLOWED_CLEAN_SCRIPTS[i])) out.push('CLEAN_SCRIPTS is not exactly the two allowed scripts')
  return out
}
// THE rule (main net): the whole word `process` appears in the code of mods/ (comments stripped, string literals KEPT) exactly as often as the one allowed use,
// `$.process.run(argv, ...)` in live/register.ts and `$.process.run(gitDiffArgv(...))` in viewer/show.ts. No receiver, alias, destructuring, helper argument or string key (`Reflect.get($, 'process')`, `$['process']`) can get a second
// reach for it past a word count. The other nets above only give a better message. Anything legitimate that needs the word (copy, a type name) goes to a locale string.
const PROCESS_WORD_BASELINE = 2 // live/register.ts (the cleanup scripts) and viewer/show.ts (the show tool's git diff)
const processWords = src => [...code(src).matchAll(/\bprocess\b/g)].map(m => m[0])
test('process allowlist, word count: `process` as a whole word occurs exactly ' + PROCESS_WORD_BASELINE + ' time(s) in the non-test sources of mods/, in register.ts', () => {
  const root = path.join(__dirname, '..')
  const files = walk(root).filter(f => /\.(ts|tsx)$/.test(f) && !/\.(test|testkit)\.(ts|tsx)$/.test(f) && !f.includes('node_modules'))
  assert.ok(files.some(f => f.endsWith('register.ts')) && files.some(f => f.endsWith('locales.ts')), 'the scan sees register.ts and the generated locales.ts')
  const found = files.flatMap(f => processWords(fs.readFileSync(f, 'utf8')).map(() => path.relative(root, f)))
  assert.deepEqual(found, ['live/register.ts', 'viewer/show.ts'])
  assert.equal(found.length, PROCESS_WORD_BASELINE)
})
test('process allowlist, word count, controls: an alias, a helper argument, a nested destructuring, a string key and a bracket key each add a count (negative controls)', () => {
  const one = 'const r = await $.process.run(argv, {})'
  assert.equal(processWords(code(one)).length, 1)
  assert.equal(processWords(code(one + '\nconst p = $.process; p.run(x)')).length, 2, 'alias')
  assert.equal(processWords(code(one + '\nhelper(eng.process)')).length, 2, 'helper argument')
  assert.equal(processWords(code(one + '\nconst { exec: { process } } = $')).length, 2, 'nested destructuring')
  assert.equal(processWords(code(one + "\nReflect.get($, 'process')")).length, 2, 'string key')
  assert.equal(processWords(code(one + "\nconst q = $['process']")).length, 2, 'bracket key')
  assert.equal(processWords(code('const processing = 1; // a process')).length, 0, 'a longer identifier and a comment are not counted')
})
test('process allowlist controls: an alias, a destructuring, a bracket access, another file, a second use and a changed script list are each reported (negative controls)', () => {
  const list = "export const CLEAN_SCRIPTS = ['scripts/repo-residue-sweep.js', 'scripts/prune-plugin-cache.js'] as const\n"
  const ok = list + 'const r = await $.process.run(argv, { timeoutMs: 1 })'
  assert.deepEqual(processRunOffenders(code(ok), true), [])
  assert.equal(processRunOffenders(code('await $.process.run(argv, {})'), false).length, 1)
  assert.equal(processRunOffenders(code(ok + '\nawait $.process.run(x)'), true).length, 1)
  assert.ok(processRunOffenders(code(ok + '\nconst p = $.process; await p.run(x)'), true).length > 0, 'alias')
  assert.ok(processRunOffenders(code(ok + '\nconst { run } = $.process; await run(x)'), true).length > 0, 'destructured member')
  assert.ok(processRunOffenders(code(ok + "\nawait $['process'].run(x)"), true).length > 0, 'bracket access')
  assert.ok(processRunOffenders(code(ok + '\nawait $["process"].run(x)'), true).length > 0, 'double-quoted bracket access')
  assert.ok(processRunOffenders(code(ok + '\nawait $[`process`].run(x)'), true).length > 0, 'template bracket access')
  assert.ok(processRunOffenders(code(ok + '\nconst { process: p } = $'), true).length > 0, 'destructured process')
  assert.ok(processRunOffenders(code(list + "const p = $['process']; p.run(argv, {})"), true).length > 0, 'the only access is not the allowed call')
  assert.equal(processRunOffenders(code(list.replace(']', ", 'scripts/other.js']") + 'await $.process.run(argv, {})'), true).length, 1)
  assert.equal(processRunOffenders(code(list.replace("'scripts/prune-plugin-cache.js'", '') + 'await $.process.run(argv, {})'), true).length, 1)
})
test('process allowlist, viewer: show.ts may run exactly one `$.process.run(gitDiffArgv(...))`; a second use, an alias, another argv and another file are each reported (negative controls)', async () => {
  const ok = 'const ran = await $.process.run(gitDiffArgv(req.args))'
  assert.deepEqual(processRunOffenders(code(ok), 'viewer'), [])
  assert.ok(processRunOffenders(code(ok + '\nawait $.process.run(argv)'), 'viewer').length > 0, 'a second use')
  assert.ok(processRunOffenders(code('await $.process.run(["git", "diff", x])'), 'viewer').length > 0, 'another argv')
  assert.ok(processRunOffenders(code(ok + '\nconst p = $.process'), 'viewer').length > 0, 'alias')
  assert.equal(processRunOffenders(code(ok), '').length, 1, 'any other file is refused')
  // the argv head and the refused options are the ones the rule above names
  const vm = await import(path.join(__dirname, '..', 'viewer', 'model.ts'))
  assert.deepEqual(vm.gitDiffArgv(['HEAD~1', '--', 'p']), ['git', '--no-pager', 'diff', '--no-color', 'HEAD~1', '--no-ext-diff', '--no-textconv', '--', 'p'])
  for (const bad of ['--output=/tmp/x', '--output', '--outp', '--ext-diff', '--ext', '--textconv', '--textc', '--open-files-in-pager', '--open', '-O', '-Oorder', '--no-index']) {
    assert.equal(vm.parseShowInput({ diff: ['HEAD', bad] }).ok, false, bad)
  }
  assert.equal(vm.parseShowInput({ diff: ['HEAD', '--', '--output=x'] }).ok, true, 'after -- an argument is a path')
})
test('prompt.submit allowlist: under mods/ only register.ts sendDecide uses prompt.submit; nothing uses asUser or process spawning', () => {
  const root = path.join(__dirname, '..')
  const files = walk(root).filter(f => /\.(ts|tsx|js|mjs|cjs)$/.test(f) && !/\.(test|testkit)\.(ts|js)$/.test(f) && !f.endsWith('locales.ts'))
  assert.ok(files.some(f => f.endsWith('register.ts')) && files.some(f => f.endsWith(path.join('types', 'index.d.ts')) || f.endsWith('model.ts')))
  const offenders = []
  for (const f of files) {
    const rel = path.relative(root, f)
    const src = code(fs.readFileSync(f, 'utf8'))
    if (/\basUser\b/.test(src)) offenders.push(rel + ': asUser')
    if (/process\s*\.\s*spawn\b/.test(src)) offenders.push(rel + ': process spawn')
    for (const bad of processRunOffenders(src, rel === path.join('live', 'register.ts') ? 'register' : rel === VIEWER_SHOW ? 'viewer' : '')) offenders.push(rel + ': ' + bad)
    const uses = submitUses(src)
    if (rel !== path.join('live', 'register.ts')) { if (uses.length > 0) offenders.push(rel + ': prompt.submit') ; continue }
    assert.equal(uses.length, 1, 'exactly one use in register.ts')
    const from = src.lastIndexOf('async function ', uses[0].at)
    assert.match(src.slice(from, from + 40), /^async function sendDecide\b/, 'the use is inside sendDecide')
  }
  assert.deepEqual(offenders, [])
})
test('prompt.submit allowlist controls: the call, the bracket forms, destructuring and asUser are each reported; an event name is not', () => {
  assert.equal(submitUses('async function other($) { $.prompt.submit({ text }) }').length, 1)
  assert.equal(submitUses("$.prompt['submit']({ text })").length, 1)
  assert.equal(submitUses('$.prompt["submit"]({ text })').length, 1)
  assert.equal(submitUses('const { submit } = $.prompt').length, 1)
  assert.equal(submitUses("const { a, submit: go } = $.prompt;").length, 1)
  assert.equal(submitUses("on('prompt.submit', ($, e) => e)").length, 0)
  assert.ok(/\basUser\b/.test(code('$.prompt.submit({ text, asUser: true })')))
})
