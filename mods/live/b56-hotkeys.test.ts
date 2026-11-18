// mods/live/b56-hotkeys.test.ts — B56 regression tests: rotating Button, focus-anchor and frame Box keys by placement epoch
// when the pane moves between `dock` (side) and `inline` (above the prompt), so unmounting the previous placement cannot
// unregister the new placement's digit hotkeys (1-9, 0, per PAGE_DIGIT / PAGES).
// Run through `bash mods/live/run-tests.sh mods/live/b56-hotkeys.test.ts`.

import type { On } from 'claude-code'
import { test, expect, mock } from 'claude-code/testing'
import { FOCUS_ANCHOR_KEY, PAGE_DIGIT, Pane } from './pane'
import type { Page, PageId } from './pages/frame'
import { PAGES } from './pages/index'
import { parseConsole } from './console'
import full from './fixtures/console/console-full.fixture'
import { makeT } from './i18n'
import { NO_DETAIL, NO_SECTIONS } from './model'
import type { LiveSnapshot, PaneTab } from './model'

const t = makeT('zh-TW')
const NOW = 1794200000000
const SNAP = parseConsole(JSON.stringify(full))
const DIGITS_ALL = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']
const DIGIT_PAGE_IDS: PageId[] = ['now', 'decide', 'fleet', 'quota', 'dispatch', 'review', 'spend', 'hygiene', 'pet', 'forge']

type PureNode = { kind: string; props: Record<string, any> }
const mk = (kind: string) => (props: Record<string, any>): PureNode => ({ kind, props })
const EL = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Link: mk('Link'), Input: mk('Input') }

const walkPure = (n: any, out: PureNode[] = []): PureNode[] => {
  if (n === null || n === undefined || n === false || typeof n !== 'object') return out
  if (Array.isArray(n)) {
    n.forEach(c => walkPure(c, out))
    return out
  }
  if (n.kind !== undefined) out.push(n)
  walkPure(n.props?.children, out)
  return out
}

const LIVE0 = {
  state: 'ok',
  text: 'x',
  header: 'x',
  band: { kind: 'idle', verdict: '', reason: null, project: 'x', elapsed: '1m', phase: '', slots: [] },
  pending: [],
  project_key: null,
  root_run_id: null,
  link: null,
  rows: null,
  gates: null,
  sections: NO_SECTIONS,
  review: null,
  published_at: null,
  watcher_note: null,
  session_as_of: null,
  host_as_of: null,
  detail: { ...NO_DETAIL, now_ms: NOW },
} as unknown as LiveSnapshot

const SHOWN_PAGES: Page[] = PAGES.map(p => ({ ...p, framed: true as const }))

// Simulates a host hotkey registry keyed by React element `key`:
// render 0 mounts, render 1 mounts in the new placement, then render 0 unmounts and deletes its keys.
function hostRegistryAfterRemount(firstBtns: PureNode[], secondBtns: PureNode[]) {
  const reg = new Map<string, { hotkey: string | undefined; onPress: () => void }>()
  for (const b of firstBtns) {
    reg.set(String(b.props.key), { hotkey: b.props.hotkey, onPress: b.props.onPress })
  }
  for (const b of secondBtns) {
    reg.set(String(b.props.key), { hotkey: b.props.hotkey, onPress: b.props.onPress })
  }
  for (const b of firstBtns) {
    reg.delete(String(b.props.key))
  }
  return {
    pressHotkey(hotkey: string): boolean {
      for (const entry of reg.values()) {
        if (entry.hotkey === hotkey) {
          entry.onPress()
          return true
        }
      }
      return false
    },
  }
}

test('b56 framed strip: epoch 0 -> epoch 1 preserves digit hotkeys 1-9, 0 and rotates every Button key, focus anchor and frame Box', () => {
  const renderFramed = (epoch: number, pageId: PageId = 'fleet') => {
    const root = Pane(
      EL as never,
      LIVE0,
      'fleet',
      () => {},
      t,
      120,
      () => {},
      new Set(),
      () => {},
      new Set(),
      null,
      null,
      null,
      null,
      null,
      { pages: SHOWN_PAGES, pageId, console: SNAP, nowMs: NOW, rows: 30, epoch } as never,
    ) as PureNode
    const nodes = walkPure(root)
    const buttons = nodes.filter(n => n.kind === 'Button')
    const digitButtons = buttons.filter(n => /^[0-9]$/.test(String(n.props.hotkey ?? '')))
    const anchors = buttons.filter(n => n.props.autoFocus === true)
    return { root, buttons, digitButtons, anchors }
  }

  const r0 = renderFramed(0)
  const r1 = renderFramed(1)

  expect(r0.root.props.key).toBeUndefined()
  expect(r1.root.props.key).toBe('frame:1')

  expect(r0.anchors.map(n => n.props.key)).toEqual([FOCUS_ANCHOR_KEY])
  expect(r1.anchors.map(n => n.props.key)).toEqual([FOCUS_ANCHOR_KEY + ':1'])

  expect(r0.digitButtons.map(n => n.props.hotkey)).toEqual(DIGITS_ALL)
  expect(r1.digitButtons.map(n => n.props.hotkey)).toEqual(DIGITS_ALL)
  expect(r0.digitButtons.map(n => n.props.key)).toEqual(DIGIT_PAGE_IDS)
  expect(r1.digitButtons.map(n => n.props.key)).toEqual(DIGIT_PAGE_IDS.map(id => id + ':1'))

  const keys0 = r0.buttons.map(n => String(n.props.key))
  const keys1 = r1.buttons.map(n => String(n.props.key))
  const set0 = new Set(keys0)
  expect(keys1.filter(k => set0.has(k)), 'no Button key from epoch 0 may survive into epoch 1').toEqual([])
  expect(keys1).toEqual(keys0.map(k => k + ':1'))
})

test('b56 legacy tabStrip: epoch 0 -> epoch 1 preserves PAGE_DIGIT hotkeys and rotates every strip Button and focus anchor key', () => {
  const renderStrip = (epoch: number) => {
    const root = Pane(
      EL as never,
      LIVE0,
      'now',
      () => {},
      t,
      120,
      () => {},
      new Set(),
      () => {},
      new Set(),
      null,
      null,
      null,
      null,
      null,
      { pages: [], console: null, nowMs: NOW, rows: 30, epoch } as never,
    ) as PureNode
    const buttons = walkPure(root).filter(n => n.kind === 'Button')
    const digitButtons = buttons.filter(n => n.props.hotkey !== undefined)
    const anchors = buttons.filter(n => n.props.autoFocus === true)
    return { buttons, digitButtons, anchors }
  }

  const s0 = renderStrip(0)
  const s1 = renderStrip(1)

  expect(Object.fromEntries(s0.digitButtons.map(n => [n.props.key, n.props.hotkey]))).toEqual(PAGE_DIGIT)
  expect(Object.fromEntries(s1.digitButtons.map(n => [n.props.key, n.props.hotkey]))).toEqual(
    Object.fromEntries(Object.entries(PAGE_DIGIT).map(([id, digit]) => [id + ':1', digit])),
  )
  expect(s0.anchors.map(n => n.props.key)).toEqual([FOCUS_ANCHOR_KEY])
  expect(s1.anchors.map(n => n.props.key)).toEqual([FOCUS_ANCHOR_KEY + ':1'])

  const set0 = new Set(s0.buttons.map(n => String(n.props.key)))
  const keys1 = s1.buttons.map(n => String(n.props.key))
  expect(keys1.filter(k => set0.has(k))).toEqual([])
  expect(keys1.every(k => k.endsWith(':1'))).toBe(true)
})

test('b56 digit press: choosing a digit in the second render calls onPage and onTab even after the first render unmounts', () => {
  const pagesDirect: PageId[] = []
  const pagesAfterUnmount: PageId[] = []
  const buildFramed = (epoch: number, sink: PageId[]) =>
    walkPure(
      Pane(
        EL as never,
        LIVE0,
        'now',
        () => {},
        t,
        120,
        () => {},
        new Set(),
        () => {},
        new Set(),
        null,
        null,
        null,
        null,
        null,
        { pages: SHOWN_PAGES, pageId: 'now', onPage: (id: PageId) => sink.push(id), console: SNAP, nowMs: NOW, rows: 30, epoch } as never,
      ),
    ).filter(n => n.kind === 'Button')

  const framed0 = buildFramed(0, pagesAfterUnmount)
  const framed1 = buildFramed(1, pagesAfterUnmount)
  const framed1Direct = buildFramed(1, pagesDirect)

  for (const d of DIGITS_ALL) {
    const btn = framed1Direct.find(n => n.props.hotkey === d)
    expect(btn, 'epoch 1 Button for digit ' + d).toBeDefined()
    btn!.props.onPress()
  }
  expect(pagesDirect).toEqual(DIGIT_PAGE_IDS)

  const framedHost = hostRegistryAfterRemount(framed0, framed1)
  for (const d of DIGITS_ALL) {
    expect(framedHost.pressHotkey(d), 'surviving hotkey ' + d + ' after epoch 0 unmount').toBe(true)
  }
  expect(pagesAfterUnmount).toEqual(DIGIT_PAGE_IDS)

  const tabsDirect: PaneTab[] = []
  const tabsAfterUnmount: PaneTab[] = []
  const buildStrip = (epoch: number, sink: PaneTab[]) =>
    walkPure(
      Pane(
        EL as never,
        LIVE0,
        'now',
        (tab: PaneTab) => sink.push(tab),
        t,
        120,
        () => {},
        new Set(),
        () => {},
        new Set(),
        null,
        null,
        null,
        null,
        null,
        { pages: [], console: null, nowMs: NOW, rows: 30, epoch } as never,
      ),
    ).filter(n => n.kind === 'Button')

  const strip0 = buildStrip(0, tabsAfterUnmount)
  const strip1 = buildStrip(1, tabsAfterUnmount)
  const strip1Direct = buildStrip(1, tabsDirect)
  const stripPairs = Object.entries(PAGE_DIGIT) as [PaneTab, string][]

  for (const [, digit] of stripPairs) {
    const btn = strip1Direct.find(n => n.props.hotkey === digit)
    expect(btn, 'epoch 1 tabStrip Button for digit ' + digit).toBeDefined()
    btn!.props.onPress()
  }
  expect(tabsDirect).toEqual(stripPairs.map(([tab]) => tab))

  const stripHost = hostRegistryAfterRemount(strip0, strip1)
  for (const [, digit] of stripPairs) {
    expect(stripHost.pressHotkey(digit), 'surviving tabStrip hotkey ' + digit + ' after epoch 0 unmount').toBe(true)
  }
  expect(tabsAfterUnmount).toEqual(stripPairs.map(([tab]) => tab))
})

// ---- Mounted register.ts placement transitions (dock <-> inline) against a fake host ----
const SURFACES = ['terminal', 'desktop'] as const
const HOME = '/fake/home'
const AHOME = HOME + '/.autopilot'
const LIVE = '/fake/live'
const REPO = '/work/repo'
const CWD = REPO + '/sub'
const KEY = '0000000000000056'
const ROOT = 'root-b56'
const SID = 'sid-b56'
const PUBLISHED = '2026-10-04T10:00:00.000Z'
const NOW_FRESH = Date.parse('2026-10-04T10:00:30.000Z')

type Tree = Record<string, string>
const j = (v: unknown): string => JSON.stringify(v)

function baseFiles(): Tree {
  const envDoc = (rootRunId: string | null) => ({
    schema: 'autopilot.runs-live/1',
    scope: { project_key: KEY, repo_identity: 'git-common-dir:' + REPO + '/.git', root_run_id: rootRunId },
    published_at: PUBLISHED,
    observed_at: PUBLISHED,
    valid_for_s: 180,
    writer: null,
    runs: [],
    counts: { confirmed_live: 0, exited: 0, unknown: 0, fresh_bound_s: 30 },
    sessions: { [SID]: { session_usd: 0.1, as_of: PUBLISHED } },
    host_today_usd: 0.5,
    host_today_as_of: PUBLISHED,
  })
  return {
    [AHOME + '/live-pointer.json']: j({ schema: 'autopilot.live-pointer/1', live_base: LIVE, autopilot_home: AHOME, written_at: PUBLISHED }),
    [AHOME + '/session-mode/' + SID + '.json']: j({ session_id: SID, level: 'l5', project_key: KEY, root_run_id: ROOT, expires_at: '2026-10-05T10:00:00.000Z' }),
    [LIVE + '/runs/' + KEY + '--' + ROOT + '.json']: j(envDoc(ROOT)),
    [LIVE + '/runs/' + KEY + '.json']: j(envDoc(null)),
    [LIVE + '/context/' + SID + '.json']: j({ schema_version: 1, written_at: '2026-10-04T10:00:20.000Z', context_window: { used_percentage: 25 } }),
    [REPO + '/.git/HEAD']: 'ref: refs/heads/main\n',
  }
}

function listDir(files: Tree, dirPath: string) {
  const prefix = dirPath.replace(/\/$/, '') + '/'
  const seen = new Map<string, 'file' | 'dir'>()
  for (const p of Object.keys(files)) {
    if (!p.startsWith(prefix)) continue
    const rest = p.slice(prefix.length)
    const slash = rest.indexOf('/')
    if (slash === -1) seen.set(rest, 'file')
    else if (!seen.has(rest.slice(0, slash))) seen.set(rest.slice(0, slash), 'dir')
  }
  if (seen.size === 0) throw new Error('ENOENT ' + dirPath)
  return [...seen].map(([name, kind]) => ({ name, kind, size: 1, mtimeMs: 0, isLink: false as const }))
}

function statPath(files: Tree, p: string, resolve?: boolean) {
  if (files[p] !== undefined) return { kind: 'file' as const, isLink: false as const, size: files[p].length, mtimeMs: 0 }
  const prefix = p.replace(/\/$/, '') + '/'
  if (p === CWD || p === REPO || Object.keys(files).some(k => k.startsWith(prefix))) {
    return { kind: 'dir' as const, isLink: false as const, size: 0, mtimeMs: 0, realPath: resolve ? p : undefined }
  }
  throw new Error('ENOENT ' + p)
}

function fakeHost(on: On) {
  const files = baseFiles()
  const opens: { id: string; focus?: boolean }[] = []
  mock.clock(on, { now: NOW_FRESH })
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? HOME : e.name === 'AUTOPILOT_LOCALE' ? 'zh-TW' : undefined }))
  on('fs.read', (_$, e) => {
    const text = files[e.path]
    if (text === undefined) throw new Error('ENOENT ' + e.path)
    return { value: text }
  })
  on('fs.exists', (_$, e) => ({ value: files[e.path] !== undefined }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', (_$, e) => ({ value: listDir(files, e.path) }))
  on('fs.stat', (_$, e) => ({ value: statPath(files, e.path, e.resolve) }))
  on('config.list', () => ({ value: [] }))
  on('session.id', () => ({ value: SID }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.root', () => ({ value: REPO }))
  on('session.start', () => ({ cwd: CWD }))
  on('session.end', () => ({ sessionId: SID }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine' as const, ref: 0 }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', (_$, e) => {
    opens.push({ id: e.id, focus: e.focus })
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false as const, isStderrTruncated: false as const } }))
  return { opens }
}

type MountedNode = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

const mountedText = (n: MountedNode): string =>
  (n.type === 'Link' || n.type === 'Button') && typeof n.props?.label === 'string'
    ? (n.props.label as string)
    : (n.children || []).map(c => (typeof c === 'string' ? c : mountedText(c as MountedNode))).join('')

const framedRowsOf = (tree: MountedNode): string[] => {
  const out: string[] = []
  const walk = (n: MountedNode) => {
    for (const c of (n.children || []) as MountedNode[]) {
      if (typeof c === 'string') continue
      if (/^f\d+$/.test(String(c.props?.key))) out.push(mountedText(c))
      else walk(c)
    }
  }
  walk(tree)
  return out
}

for (const surface of SURFACES) {
  test('b56 placement sync: register.ts increases epoch on dock <-> inline moves and keeps it unchanged on same-placement re-renders (' + surface + ')', async ($, on) => {
    fakeHost(on)
    await $.session.start({ surface, cwd: CWD })
    await $.command.run({ command: 'live-pane', args: '' })

    const mountPane = (placement: 'dock' | 'inline', isFocused: boolean) =>
      $.ui.mount({
        plugin: 'autopilot',
        surface,
        component: 'Pane',
        requestId: 'autopilot-live',
        props: { title: 'Autopilot', isFocused, bodyColumns: 120, placement, scroll: { offset: 0, bodyRows: 40 }, view: { agentId: undefined } },
        viewport: { columns: 160, rows: 50, isFullscreen: true },
      })

    const inspect = async (pane: Awaited<ReturnType<typeof mountPane>>) => {
      const tree = (await pane.drawn()) as MountedNode
      const buttons = (await pane.findAll({ type: 'Button' })) as MountedNode[]
      const digits = buttons.filter(b => /^[0-9]$/.test(String(b.props?.hotkey ?? '')))
      const anchor = buttons.find(b => b.props?.autoFocus === true)
      return {
        frameKey: tree.props?.key,
        anchorKey: anchor?.props?.key,
        digitKeys: digits.map(b => String(b.props?.key)),
        digitHotkeys: digits.map(b => String(b.props?.hotkey)),
        rows: framedRowsOf(tree),
      }
    }

    // Initial dock render: epoch 0
    const dock0 = await mountPane('dock', true)
    const s0 = await inspect(dock0)
    expect(s0.frameKey).toBeUndefined()
    expect(s0.anchorKey).toBe(FOCUS_ANCHOR_KEY)
    expect(s0.digitHotkeys).toEqual(DIGITS_ALL)
    expect(s0.digitKeys).toEqual(DIGIT_PAGE_IDS)
    await dock0.unmount()

    // Re-render at dock without a placement change: epoch stays 0
    const dock0Again = await mountPane('dock', true)
    const s0Again = await inspect(dock0Again)
    expect(s0Again.frameKey).toBeUndefined()
    expect(s0Again.anchorKey).toBe(FOCUS_ANCHOR_KEY)
    expect(s0Again.digitKeys).toEqual(DIGIT_PAGE_IDS)
    await dock0Again.unmount()

    // Move dock -> inline: epoch increases to 1
    const inline1 = await mountPane('inline', false)
    const s1 = await inspect(inline1)
    expect(s1.frameKey).toBe('frame:1')
    expect(s1.anchorKey).toBe(FOCUS_ANCHOR_KEY + ':1')
    expect(s1.digitHotkeys).toEqual(DIGITS_ALL)
    expect(s1.digitKeys).toEqual(DIGIT_PAGE_IDS.map(id => id + ':1'))

    // Pressing a rotated page Button in the inline placement selects that page without bumping epoch
    await inline1.press({ key: 'decide:1' })
    const afterPress = await inspect(inline1)
    expect(afterPress.rows[0]?.startsWith('待決')).toBe(true)
    expect(afterPress.frameKey).toBe('frame:1')
    expect(afterPress.anchorKey).toBe(FOCUS_ANCHOR_KEY + ':1')
    await inline1.unmount()

    // Another re-render at inline without a placement change: epoch stays 1
    const inline1Again = await mountPane('inline', true)
    const s1Again = await inspect(inline1Again)
    expect(s1Again.frameKey).toBe('frame:1')
    expect(s1Again.anchorKey).toBe(FOCUS_ANCHOR_KEY + ':1')
    expect(s1Again.digitKeys).toEqual(DIGIT_PAGE_IDS.map(id => id + ':1'))
    await inline1Again.unmount()

    // Move inline -> dock: epoch increases to 2
    const dock2 = await mountPane('dock', false)
    const s2 = await inspect(dock2)
    expect(s2.frameKey).toBe('frame:2')
    expect(s2.anchorKey).toBe(FOCUS_ANCHOR_KEY + ':2')
    expect(s2.digitHotkeys).toEqual(DIGITS_ALL)
    expect(s2.digitKeys).toEqual(DIGIT_PAGE_IDS.map(id => id + ':2'))
    await dock2.unmount()
  })
}
