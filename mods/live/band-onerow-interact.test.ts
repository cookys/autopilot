// mods/live/band-onerow-interact.test.ts — Mounted interaction evidence for single-row band (Codex R4 Major 3, Fleet-Task 01M837HGTX).
// Exercises the real register.ts AbovePrompt hook via $.ui.mount (`mountBand`):
//   1. `w` collapse <-> expand round-trip (toggle arrow ▾展開 <-> ▴收合 consistent with frame bottom hint and bandBottomHint).
//   2. Manual collapse / expand preference preserved across refresh, page switch, and narrow <-> widen resize (auto-dropped segments do not overwrite manual state).
//   3. Plan §2.3 click routing table (remind, line, source, pend, qc, tps, toggle arrow; non-clickable pet/sep/idle).
//   4. Narrow 75-col hidden segments remain reachable through digit hotkeys both collapsed and expanded.
// Picked up automatically by `claude plugin test` in `mods/live/run-tests.sh`.
import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { displayWidth } from '../tux/width.ts'
import { bandBottomHint } from './band-onerow'
import { makeT } from './i18n'
import { paneKey } from './register'

const HOME = '/fake/band-interact-home'
const LIVE = '/fake/band-interact-live'
const REPO = '/work/band-interact-repo'
const SID = 'band-interact-1'
const KEY = '0000000000000009'
const PUBLISHED = '2026-10-04T10:00:00.000Z'
const NOW = Date.parse(PUBLISHED) + 30_000
const PANE = 'autopilot-live'
const tZh = makeT('zh-TW')

type Node = { type?: string; props?: Record<string, any>; children?: any[] }
const text = (n: any): string => (typeof n === 'string' ? n : Array.isArray(n) ? n.map(text).join('') : n?.props?.label ?? text(n?.children ?? []))
const walk = (n: any): Node[] => (!n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(walk) : [n, ...walk(n.children)])
const buttons = (n: any): Node[] => walk(n).filter(x => x.type === 'Button')
const byKey = (n: any, key: string): Node | undefined => walk(n).find(x => x.props?.key === key)

type HostOpts = { withCard?: boolean; withPm?: boolean; withPet?: boolean; noMarker?: boolean }

function host(on: On, opts: HostOpts = {}) {
  const { withCard = true, withPm = true, withPet = true, noMarker = false } = opts
  const files: Record<string, string> = {
    [HOME + '/.autopilot/live-pointer.json']: JSON.stringify({ schema: 'autopilot.live-pointer/1', live_base: LIVE, autopilot_home: HOME + '/.autopilot' }),
    [LIVE + '/runs/' + KEY + '.json']: JSON.stringify({
      schema: 'autopilot.runs-live/1',
      scope: { project_key: KEY, root_run_id: null },
      published_at: PUBLISHED,
      valid_for_s: 180,
      runs: [],
      counts: { confirmed_live: 0, exited: 0, unknown: 0 },
    }),
    [LIVE + '/load-source.json']: JSON.stringify({ schema: 'autopilot.load-source/1', source: 'dev', flags: [] }),
    [REPO + '/.git/HEAD']: 'ref: refs/heads/main\n',
  }
  if (!noMarker) {
    files[HOME + '/.autopilot/session-mode/' + SID + '.json'] = JSON.stringify({ session_id: SID, project_key: KEY, expires_at: '2026-10-05T10:00:00.000Z' })
  }
  if (withPet) {
    files[LIVE + '/codeforge/pet.json'] = JSON.stringify({ schema: 'codeforge.pet-view/1', pet: { name: 'Ferris', level: 1 } })
  }
  const pmJson = JSON.stringify({
    schema: 'fleet.pm.status',
    schema_version: 1,
    generated_at_ms: NOW,
    selector: null,
    projects: [
      { project: 'autopilot', root_id: 'r1', counts: { stuck: 1, overdue: 0, running: 2, waiting: 1, total: 4 }, tasks: [] },
    ],
  })
  const decideJson = JSON.stringify({
    cards: withCard
      ? [{
          card: {
            card_id: 'd-interact-1',
            kind: 'plan',
            question: '要不要把 shared-tui plan 合進 develop？',
            background: '測試背景',
            recommendation: '合併',
            options: [
              { label: '合併', description: '直接合進 develop' },
              { label: '暫緩', description: '再補測一輪' },
            ],
          },
        }]
      : [],
  })
  let open = false
  const clock = mock.clock(on, { now: NOW })
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? HOME : e.name === 'AUTOPILOT_LOCALE' ? 'zh-TW' : undefined }))
  on('fs.read', (_, e) => { if (!(e.path in files)) throw new Error('ENOENT'); return { value: files[e.path] } })
  on('fs.exists', (_, e) => ({ value: e.path in files }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', (_, e) => {
    if (!(e.path in files) && e.path !== REPO) throw new Error('ENOENT')
    return { value: { kind: e.path === REPO ? 'dir' : 'file', size: files[e.path]?.length ?? 1, mtimeMs: NOW, isLink: false, realPath: e.path } }
  })
  on('config.list', () => ({ value: [] }))
  on('session.id', () => ({ value: SID }))
  on('session.cwd', () => ({ value: REPO }))
  on('session.root', () => ({ value: REPO }))
  on('session.start', () => ({ cwd: REPO }))
  on('session.end', () => ({ sessionId: SID }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine' as const, ref: 0 }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => { open = true; return { value: { isPlaced: true } } })
  on('ui.close', () => { open = false; return { value: undefined } })
  on('ui.panes', () => ({ value: open ? [{ id: PANE, title: 'Autopilot', isShown: true, isFocused: true, isPlaced: true }] : [] }))
  on('ui.scroll', () => ({ value: undefined }))
  on('ui.focus', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    if (withPm && e.argv[0] === 'fleet' && e.argv[1] === 'pm') {
      return { value: { exitCode: 0, stdout: pmJson, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (e.argv[0] === 'fleet' && e.argv[1] === 'decision') {
      return { value: { exitCode: 0, stdout: decideJson, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { clock }
}

const mountBand = ($: any, columns: number, maxRows = 20) => $.ui.mount({
  plugin: 'autopilot',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { bodyColumns: columns, maxRows, view: { agentId: undefined } },
  viewport: { columns, rows: 50, isFullscreen: true },
})

const settle = async (h: { clock: ReturnType<typeof mock.clock> }) => {
  await Promise.resolve()
  await Promise.resolve()
  await h.clock.advance(0)
  await Promise.resolve()
}

const boot = async ($: any, h: { clock: ReturnType<typeof mock.clock> }) => {
  await $.session.start({ surface: 'terminal', cwd: REPO })
  await h.clock.advance(5000)
  await h.clock.advance(5000)
}

test('R4-Major3.1: w hotkey round-trip (collapsed ▾展開 <-> expanded ▴收合) stays consistent with bottom hint', async ($, on) => {
  const h = host(on)
  await boot($, h)

  // Collapsed initially
  let band = await mountBand($, 195, 20)
  let tree = await band.drawn()
  expect(text(byKey(tree, 'pane-toggle')).trim()).toBe('▾展開')
  expect(byKey(tree, 'v74-top')).toBeUndefined()
  expect(byKey(tree, 'band-hotkey:w')?.props?.hotkey).toBe('w')
  expect(bandBottomHint(195, false, tZh)).toContain('w 展開')

  // Press w (collapsed -> expanded)
  await band.press({ key: 'band-hotkey:w' })
  await settle(h)
  await band.unmount()

  band = await mountBand($, 195, 20)
  tree = await band.drawn()
  expect(text(byKey(tree, 'pane-toggle')).trim()).toBe('▴收合')
  expect(text(byKey(tree, 'v74-top'))).toMatch(/^╭─ 現況/)
  expect(text(byKey(tree, 'v74-bottom'))).toContain('w 收合')
  expect(bandBottomHint(195, true, tZh)).toContain('w 收合')
  expect(byKey(tree, 'letter:w')?.props?.hotkey).toBe('w')

  // Press w (expanded -> collapsed)
  await band.press({ key: 'letter:w' })
  await settle(h)
  await band.unmount()

  band = await mountBand($, 195, 20)
  tree = await band.drawn()
  expect(text(byKey(tree, 'pane-toggle')).trim()).toBe('▾展開')
  expect(byKey(tree, 'v74-top')).toBeUndefined()
  expect(byKey(tree, 'band-hotkey:w')?.props?.hotkey).toBe('w')

  // Second round-trip (collapsed -> expanded again)
  await band.press({ key: 'band-hotkey:w' })
  await settle(h)
  await band.unmount()

  band = await mountBand($, 195, 20)
  tree = await band.drawn()
  expect(text(byKey(tree, 'pane-toggle')).trim()).toBe('▴收合')
  expect(text(byKey(tree, 'v74-top'))).toMatch(/^╭─ 現況/)
  expect(text(byKey(tree, 'v74-bottom'))).toContain('w 收合')

  await band.unmount()
  await $.session.end({ reason: 'exit' })
})

test('R4-Major3.2: manual collapse/expand preference survives refresh, page switch, and narrow->widen resize', async ($, on) => {
  const h = host(on)
  await boot($, h)

  // Expand then manually collapse via w
  let band = await mountBand($, 195, 20)
  await band.press({ key: 'band-hotkey:w' })
  await settle(h)
  await band.unmount()

  band = await mountBand($, 195, 20)
  await band.press({ key: 'letter:w' })
  await settle(h)
  await band.unmount()

  // (a) Refresh ticks preserve manual collapse
  await h.clock.advance(5000)
  await h.clock.advance(5000)
  band = await mountBand($, 195, 20)
  let tree = await band.drawn()
  expect(text(byKey(tree, 'pane-toggle')).trim()).toBe('▾展開')
  expect(byKey(tree, 'v74-top')).toBeUndefined()
  await band.unmount()

  // (b) Page change while collapsed preserves manual collapse
  await paneKey($, '4')
  await settle(h)
  band = await mountBand($, 195, 20)
  tree = await band.drawn()
  expect(text(byKey(tree, 'pane-toggle')).trim()).toBe('▾展開')
  expect(byKey(tree, 'v74-top')).toBeUndefined()
  await band.unmount()

  // (c) Narrow -> widen auto-drops segments then restores them without overwriting manual collapse
  band = await mountBand($, 75, 20)
  tree = await band.drawn()
  expect(byKey(tree, 'band:source')).toBeUndefined()
  expect(text(byKey(tree, 'pane-toggle')).trim()).toBe('▾展開')
  expect(byKey(tree, 'v74-top')).toBeUndefined()
  await band.unmount()

  band = await mountBand($, 195, 20)
  tree = await band.drawn()
  expect(byKey(tree, 'band:source')).toBeDefined()
  expect(byKey(tree, 'band:qc')).toBeDefined()
  expect(byKey(tree, 'band:tps')).toBeDefined()
  expect(text(byKey(tree, 'pane-toggle')).trim()).toBe('▾展開')
  expect(byKey(tree, 'v74-top')).toBeUndefined()

  // (d) Manual expand survives page switch, refresh, narrow resize, and short-height squeeze -> restore
  await band.press({ key: 'band-hotkey:w' })
  await settle(h)
  await band.unmount()

  band = await mountBand($, 195, 20)
  await band.press({ key: 'hotkey:4' })
  await settle(h)
  await band.unmount()

  await h.clock.advance(5000)
  band = await mountBand($, 75, 20)
  tree = await band.drawn()
  expect(byKey(tree, 'band:source')).toBeUndefined()
  expect(text(byKey(tree, 'pane-toggle')).trim()).toBe('▴收合')
  expect(text(byKey(tree, 'v74-top'))).toMatch(/^╭─ 審查/)
  await band.unmount()

  // Temporarily too short to draw frame (maxRows=2): arrow reflects invisible frame, does not erase manual expand
  band = await mountBand($, 75, 2)
  tree = await band.drawn()
  expect(byKey(tree, 'v74-top')).toBeUndefined()
  expect(text(byKey(tree, 'pane-toggle')).trim()).toBe('▾展開')
  await band.unmount()

  // Restoring width & height brings back both the expanded frame on 審查 and all band segments
  band = await mountBand($, 195, 20)
  tree = await band.drawn()
  expect(byKey(tree, 'band:source')).toBeDefined()
  expect(byKey(tree, 'band:qc')).toBeDefined()
  expect(byKey(tree, 'band:tps')).toBeDefined()
  expect(text(byKey(tree, 'pane-toggle')).trim()).toBe('▴收合')
  expect(text(byKey(tree, 'v74-top'))).toMatch(/^╭─ 審查/)

  await band.unmount()
  await $.session.end({ reason: 'exit' })
})

test('R4-Major3.3: plan §2.3 click routing for remind, each segment, toggle arrow; decorations/separators non-clickable', async ($, on) => {
  const h = host(on, { withCard: true, withPm: true, withPet: true })
  await boot($, h)

  const routes: [string, RegExp][] = [
    ['band:remind', /^╭─ 待決/],
    ['band:line', /^╭─ 派工/],
    ['band:source', /^╭─ 待辦/],
    ['band:pend', /^╭─ 待決/],
    ['band:qc', /^╭─ 審查/],
    ['band:tps', /^╭─ 花費/],
  ]

  let band = await mountBand($, 195, 20)
  let tree = await band.drawn()
  // Pet decoration is visible at 195 cols but has no Button; separators have no Button
  expect(text(byKey(tree, 'onerow-band'))).toContain('Ferris Lv.1')
  expect(byKey(tree, 'band:pet-plain')).toBeDefined()
  const btnKeys = buttons(tree).map(b => String(b.props?.key ?? ''))
  expect(btnKeys).not.toContain('band:pet')
  expect(btnKeys).not.toContain('band:spark')
  expect(btnKeys.some(k => k.startsWith('sep-'))).toBe(false)

  for (const [btnKey, titleRe] of routes) {
    expect(byKey(tree, btnKey), btnKey + ' is clickable').toBeDefined()
    await band.press({ key: btnKey })
    await settle(h)
    await band.unmount()

    band = await mountBand($, 195, 20)
    tree = await band.drawn()
    expect(text(byKey(tree, 'v74-top')), btnKey + ' routes to expected page').toMatch(titleRe)
    expect(text(byKey(tree, 'pane-toggle')).trim()).toBe('▴收合')
  }

  // Toggle arrow collapses and expands to 現況
  await band.press({ key: 'pane-toggle' })
  await settle(h)
  await band.unmount()

  band = await mountBand($, 195, 20)
  tree = await band.drawn()
  expect(byKey(tree, 'v74-top')).toBeUndefined()
  expect(text(byKey(tree, 'pane-toggle')).trim()).toBe('▾展開')

  await band.press({ key: 'pane-toggle' })
  await settle(h)
  await band.unmount()

  band = await mountBand($, 195, 20)
  tree = await band.drawn()
  expect(text(byKey(tree, 'v74-top'))).toMatch(/^╭─ 現況/)
  expect(text(byKey(tree, 'pane-toggle')).trim()).toBe('▴收合')

  await band.unmount()
  await $.session.end({ reason: 'exit' })
})

test('R4-Major3.3b: normal 0-pending idle reminder (無待決) is not clickable', async ($, on) => {
  const h = host(on, { withCard: false, withPm: true, withPet: false, noMarker: true })
  await boot($, h)

  const band = await mountBand($, 195, 20)
  const tree = await band.drawn()
  expect(text(byKey(tree, 'onerow-band'))).toContain('無待決')
  expect(byKey(tree, 'band:remind-plain')).toBeDefined()
  expect(byKey(tree, 'band:remind')).toBeUndefined()

  await band.unmount()
  await $.session.end({ reason: 'exit' })
})

test('R4-Major3.4: hidden segments at 75 cols remain reachable via digit hotkeys (collapsed and expanded)', async ($, on) => {
  const h = host(on, { withCard: true, withPm: true, withPet: true })
  await boot($, h)

  // Collapsed at 75 cols: source (8), qc (4), tps (5) are dropped from the visible row
  let band = await mountBand($, 75, 20)
  let tree = await band.drawn()
  expect(displayWidth(text(byKey(tree, 'onerow-band')))).toBeLessThanOrEqual(75)
  expect(byKey(tree, 'band:source')).toBeUndefined()
  expect(byKey(tree, 'band:qc')).toBeUndefined()
  expect(byKey(tree, 'band:tps')).toBeUndefined()
  expect(byKey(tree, 'band-hotkey:4')?.props?.hotkey).toBe('4')
  expect(byKey(tree, 'band-hotkey:5')?.props?.hotkey).toBe('5')
  expect(byKey(tree, 'band-hotkey:8')?.props?.hotkey).toBe('8')

  // Digit 8 while source is hidden opens 待辦
  await band.press({ key: 'band-hotkey:8' })
  await settle(h)
  await band.unmount()

  band = await mountBand($, 75, 20)
  tree = await band.drawn()
  expect(text(byKey(tree, 'v74-top'))).toMatch(/^╭─ 待辦/)
  expect(text(byKey(tree, 'pane-toggle')).trim()).toBe('▴收合')
  expect(byKey(tree, 'band:tps')).toBeUndefined()
  expect(byKey(tree, 'band:qc')).toBeUndefined()

  // While open at 75 cols, digit 5 (hidden tps) switches to 花費, digit 4 (hidden qc) switches to 審查
  await band.press({ key: 'hotkey:5' })
  await settle(h)
  await band.unmount()

  band = await mountBand($, 75, 20)
  tree = await band.drawn()
  expect(text(byKey(tree, 'v74-top'))).toMatch(/^╭─ 花費/)

  await band.press({ key: 'hotkey:4' })
  await settle(h)
  await band.unmount()

  band = await mountBand($, 75, 20)
  tree = await band.drawn()
  expect(text(byKey(tree, 'v74-top'))).toMatch(/^╭─ 審查/)

  // Collapse via w, then reach hidden segment 5 directly from collapsed 75-col band
  await band.press({ key: 'letter:w' })
  await settle(h)
  await band.unmount()

  band = await mountBand($, 75, 20)
  tree = await band.drawn()
  expect(byKey(tree, 'v74-top')).toBeUndefined()
  expect(text(byKey(tree, 'pane-toggle')).trim()).toBe('▾展開')
  await band.press({ key: 'band-hotkey:5' })
  await settle(h)
  await band.unmount()

  band = await mountBand($, 75, 20)
  tree = await band.drawn()
  expect(text(byKey(tree, 'v74-top'))).toMatch(/^╭─ 花費/)
  expect(text(byKey(tree, 'pane-toggle')).trim()).toBe('▴收合')

  await band.unmount()
  await $.session.end({ reason: 'exit' })
})
