'use strict'
// Semantic palette & light/dark theme correspondence test for single-row band (Codex R3 Major5, Fleet-Task 01M837HGTX).
// Verifies every segment across normal/alert/stale/missing/idle uses only PALETTE roles (matched against mods/tux/tokens.json),
// never raw colour codes or dim+inactive stacking, and prints the role -> ThemeKey -> dark/light table to stdout.
// Run: node --test mods/live/band-onerow-palette.test.js (wired into mods/live/run-tests.sh).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const TOKENS_PATH = path.join(__dirname, '..', 'tux', 'tokens.json')
const ONEROW_PATH = path.join(__dirname, 'band-onerow.ts')

// ThemeKey -> dark / light theme contrast contract (mods/tux/tokens.json + doc/specs/tui-guideline.md §5).
// All band rendering passes only ThemeKey tokens to Claude Code's theme engine (zero raw hex/RGB/ANSI codes).
const THEME_CORRESPONDENCE = {
  default: {
    role: '(default)',
    dark: 'default light foreground on dark terminal background',
    light: 'default dark foreground on light terminal background',
    meaning: 'neutral content (normal labels, counts, QC ✓, toggle)',
  },
  warning: {
    role: 'PALETTE.attention',
    dark: 'theme.warning (high-contrast amber/yellow on dark bg; ANSI 33)',
    light: 'theme.warning (dark amber/ochre readable on light bg; ANSI 33)',
    meaning: 'operator action needed (single yellow focus per row: reminder alert with recommendation)',
  },
  merged: {
    role: 'PALETTE.needs_human',
    dark: 'theme.merged (distinct non-yellow semantic accent on dark bg)',
    light: 'theme.merged (distinct non-yellow semantic accent on light bg)',
    meaning: 'pending decision count awaiting human (non-yellow so row keeps at most one yellow focus)',
  },
  error: {
    role: 'PALETTE.broken',
    dark: 'theme.error (bright red on dark bg; ANSI 31)',
    light: 'theme.error (deep red readable on light bg; ANSI 31)',
    meaning: 'fault or blocked alert (line ✗ failed / ⊘ stalled, QC ⏶ alert)',
  },
  remember: {
    role: 'PALETTE.action',
    dark: 'theme.remember (periwinkle on dark bg, 11.2:1)',
    light: 'theme.remember (blue on light bg, 8.6:1; suggestion was 4.40)',
    meaning: 'pressable toggle (▾展開 / ▴收合)',
  },
  inactive: {
    role: 'PALETTE.idle',
    dark: 'theme.inactive (muted grey on dark bg, NO dim stacking)',
    light: 'theme.inactive (readable dark grey on light bg, NO dim stacking per §2.6)',
    meaning: 'stale (~ + ?), missing (—), idle (無待決), or the band separator `│` (subtle was 2.19:1 light / 2.60:1 dark, under the 3:1 non-text bar)',
  },
}

let B, P, ui, tokens, tZh

test.before(async () => {
  B = await import(path.join(__dirname, 'band-onerow.ts'))
  P = (await import(path.join(__dirname, '..', 'tux', 'palette.ts'))).PALETTE
  ui = await import(path.join(__dirname, 'ui.ts'))
  tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'))
  const { makeT } = await import(path.join(__dirname, 'i18n.ts'))
  tZh = makeT('zh-TW')
})

const stripComments = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

const makeInput = (over = {}) => ({
  reminder: { text: '要你決定：合併 shared-tui plan 進 develop？', cardId: 'd-001', state: 'normal', hasRec: false, ...(over.reminder || {}) },
  line: { stalled: 0, running: 3, failed: 0, waiting: 1, state: 'normal', ...(over.line || {}) },
  source: { label: '開發', flags: 1, state: 'normal', ...(over.source || {}) },
  pend: { count: 2, hasRec: false, state: 'normal', ...(over.pend || {}) },
  qc: { status: 'ok', state: 'normal', ...(over.qc || {}) },
  tps: { value: 120, state: 'normal', ...(over.tps || {}) },
  spark: { bars: '▇█▆▅▆', state: 'normal', ...(over.spark || {}) },
  pet: { text: 'Ferris Lv.1', state: 'normal', ...(over.pet || {}) },
  expanded: over.expanded ?? false,
})

const roleNameOf = themeKey => {
  if (themeKey === undefined) return '(default)'
  const hit = Object.entries(P).find(([, v]) => v === themeKey)
  return hit ? 'PALETTE.' + hit[0] : 'UNKNOWN'
}

const colorsOf = segs => [...new Set(segs.map(s => s.color ?? 'default'))]

test('palette 1: band-onerow.ts uses zero raw colour codes and zero theme-key literals; PALETTE matches tokens.json', () => {
  assert.deepEqual(P, tokens.roles, 'PALETTE strictly equals mods/tux/tokens.json roles')
  const src = stripComments(fs.readFileSync(ONEROW_PATH, 'utf8'))
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(src), false, 'no hex colours in band-onerow.ts')
  assert.equal(/\brgba?\s*\(/.test(src), false, 'no rgb() colours in band-onerow.ts')
  assert.equal(/\x1b\[|38;5;|48;5;|\\u001b|\\x1b/.test(src), false, 'no raw ANSI SGR escapes in band-onerow.ts')
  const themeKeyLit = /['"`](claude|warning|error|success|suggestion|inactive|subtle|merged|remember)['"`]/
  assert.equal(themeKeyLit.test(src), false, 'no theme-key string literals in band-onerow.ts (must reference PALETTE.*)')
})

test('palette 2: every band segment across normal/alert/stale/missing/idle maps to exact PALETTE roles and valid light/dark ThemeKeys', () => {
  const validThemeKeys = new Set(Object.values(tokens.roles))

  const layNormal = B.layoutOneRowBand(makeInput(), 195, tZh)
  const layAlert = B.layoutOneRowBand(makeInput({
    reminder: { hasRec: true },
    line: { stalled: 4, running: 3, failed: 2, waiting: 0, state: 'normal' },
    pend: { count: 21, hasRec: true, state: 'normal' },
    qc: { status: 'alert', state: 'normal' },
  }), 195, tZh)
  const layStale = B.layoutOneRowBand(makeInput({
    reminder: { state: 'stale', hasRec: true },
    line: { stalled: 4, running: 3, failed: 2, waiting: 0, state: 'stale' },
    source: { label: '開發', flags: 1, state: 'stale' },
    pend: { count: 21, hasRec: true, state: 'stale' },
    qc: { status: 'alert', state: 'stale' },
    tps: { value: 120, state: 'stale' },
    spark: { bars: '▇█▆▅▆', state: 'stale' },
    pet: { text: 'Ferris Lv.1', state: 'stale' },
  }), 195, tZh)
  const layMissing = B.layoutOneRowBand(makeInput({
    reminder: { text: null, state: 'missing', hasRec: false },
    line: { stalled: null, running: null, failed: null, waiting: null, state: 'missing' },
    source: { label: null, flags: null, state: 'missing' },
    pend: { count: null, hasRec: false, state: 'missing' },
    qc: { status: 'none', state: 'missing' },
    tps: { value: null, state: 'missing' },
    spark: { bars: null, state: 'missing' },
    pet: { text: null, state: 'missing' },
  }), 195, tZh)
  const layIdle = B.layoutOneRowBand(makeInput({
    reminder: { text: null, state: 'normal', hasRec: false },
    pend: { count: 0, hasRec: false, state: 'normal' },
  }), 195, tZh)

  const segBy = (lay, id) => (id === 'remind' ? lay.remind : lay.segments.find(s => s.id === id))

  // Exhaustive matrix of (segment, state, segs, expected ThemeKey set)
  const rows = [
    ['remind', 'normal', segBy(layNormal, 'remind').segs, ['default']],
    ['remind', 'alert(rec)', segBy(layAlert, 'remind').segs, [P.attention, 'default']],
    ['remind', 'stale', segBy(layStale, 'remind').segs, [P.idle]],
    ['remind', 'missing', segBy(layMissing, 'remind').segs, [P.idle]],
    ['remind', 'idle(0 pend)', segBy(layIdle, 'remind').segs, [P.idle]],

    ['line', 'normal', segBy(layNormal, 'line').segs, ['default']],
    ['line', 'alert(✗/⊘)', segBy(layAlert, 'line').segs, ['default', P.broken]],
    ['line', 'stale', segBy(layStale, 'line').segs, [P.idle]],
    ['line', 'missing', segBy(layMissing, 'line').segs, [P.idle]],

    ['source', 'normal', segBy(layNormal, 'source').segs, ['default']],
    ['source', 'stale', segBy(layStale, 'source').segs, [P.idle]],
    ['source', 'missing', segBy(layMissing, 'source').segs, [P.idle]],

    ['pend', 'normal', segBy(layNormal, 'pend').segs, ['default']],
    ['pend', 'alert(rec)', segBy(layAlert, 'pend').segs, ['default', P.needs_human]],
    ['pend', 'stale', segBy(layStale, 'pend').segs, [P.idle]],
    ['pend', 'missing', segBy(layMissing, 'pend').segs, [P.idle]],

    ['qc', 'normal(✓)', segBy(layNormal, 'qc').segs, ['default']],
    ['qc', 'alert(⏶)', segBy(layAlert, 'qc').segs, ['default', P.broken]],
    ['qc', 'stale', segBy(layStale, 'qc').segs, [P.idle]],
    ['qc', 'missing', segBy(layMissing, 'qc').segs, [P.idle]],

    ['tps', 'normal', segBy(layNormal, 'tps').segs, ['default']],
    ['tps', 'stale', segBy(layStale, 'tps').segs, [P.idle]],
    ['tps', 'missing', segBy(layMissing, 'tps').segs, [P.idle]],

    ['spark', 'normal', segBy(layNormal, 'spark').segs, ['default']],
    ['spark', 'stale', segBy(layStale, 'spark').segs, [P.idle]],
    ['spark', 'missing', B.formatSpark({ bars: null, state: 'missing' }).segs, [P.idle]],

    ['pet', 'normal', segBy(layNormal, 'pet').segs, ['default']],
    ['pet', 'stale', segBy(layStale, 'pet').segs, [P.idle]],
    ['pet', 'missing', B.formatPet({ text: null, state: 'missing' }).segs, [P.idle]],

    ['sep', 'always', [B.BAND_SEP_SEG], [P.idle]],
    ['toggle', 'collapsed', layNormal.toggle.segs, [P.action]],
  ]

  process.stdout.write('\n[band-palette] Segment x State -> PALETTE Role -> ThemeKey -> Dark / Light Theme Mapping\n')
  process.stdout.write('| Segment | State | PALETTE Role | ThemeKey | Dark Theme | Light Theme |\n')
  process.stdout.write('|---|---|---|---|---|---|\n')

  for (const [segId, state, segs, expected] of rows) {
    const actual = colorsOf(segs)
    assert.deepEqual(actual, expected, `${segId} (${state}) colours`)
    for (const s of segs) {
      if (s.color !== undefined) {
        assert.ok(validThemeKeys.has(s.color), `${segId} (${state}): ${s.color} must be in tokens.json roles`)
      }
      assert.equal(ui.drawSeg(s).color, s.color, `${segId} (${state}): drawSeg preserves semantic ThemeKey`)
      assert.equal('backgroundColor' in s || 'inverse' in s, false, `${segId} (${state}): no background or inverse`)
      if (s.color === P.idle) {
        assert.notEqual(s.dim, true, `${segId} (${state}): PALETTE.idle (inactive) must NOT stack dim (light-theme legibility)`)
      }
    }
    const primaryKey = actual.find(k => k !== 'default') ?? 'default'
    const info = THEME_CORRESPONDENCE[primaryKey]
    assert.ok(info, 'theme correspondence documented for ' + primaryKey)
    process.stdout.write(`| ${segId} | ${state} | ${roleNameOf(primaryKey === 'default' ? undefined : primaryKey)} | ${primaryKey} | ${info.dark} | ${info.light} |\n`)
  }
})

test('palette 3: at most one yellow (PALETTE.attention) segment per rendered band row', () => {
  const yellowCount = lay => {
    const items = [lay.remind, ...lay.segments, lay.toggle]
    return items.filter(it => it.segs.some(s => s.color === P.attention))
  }
  const cases = [
    ['normal', makeInput()],
    ['alert(rec + pend rec)', makeInput({
      reminder: { hasRec: true },
      line: { stalled: 4, running: 3, failed: 2, waiting: 0, state: 'normal' },
      pend: { count: 21, hasRec: true, state: 'normal' },
      qc: { status: 'alert', state: 'normal' },
    })],
    ['stale', makeInput({ reminder: { state: 'stale', hasRec: true }, pend: { count: 21, hasRec: true, state: 'stale' } })],
    ['missing', makeInput({ reminder: { text: null, state: 'missing', hasRec: false }, pend: { count: null, hasRec: false, state: 'missing' } })],
    ['idle', makeInput({ reminder: { text: null, state: 'normal', hasRec: false }, pend: { count: 0, hasRec: false, state: 'normal' } })],
  ]
  for (const cols of [195, 75]) {
    for (const [label, inp] of cases) {
      const lay = B.layoutOneRowBand(inp, cols, tZh)
      const yellows = yellowCount(lay)
      assert.ok(yellows.length <= 1, `${label}@${cols}: at most 1 yellow segment per row, got ${yellows.map(x => x.id).join(',')}`)
      if (label.startsWith('alert')) {
        assert.deepEqual(yellows.map(x => x.id), ['remind'], `${label}@${cols}: only remind is yellow`)
        const pendSeg = lay.segments.find(s => s.id === 'pend')
        assert.ok(pendSeg, `${label}@${cols}: pend present`)
        assert.equal(pendSeg.segs.some(s => s.color === P.attention), false, `${label}@${cols}: pend is not yellow`)
        assert.equal(pendSeg.segs.some(s => s.color === P.needs_human), true, `${label}@${cols}: pend uses PALETTE.needs_human`)
      }
    }
  }
})
