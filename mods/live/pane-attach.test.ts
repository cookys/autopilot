// mods/live/pane-attach.test.ts — pane tests for:
//   1. recordShowLook (`show` -> `給你看` row in the pane model -> survives unrelated updates -> gone only when dismissed).
//   2. `--attach` cards rendering pressable/clickable elements (`show:<path>` Button for local file paths, `<Link>` for https URLs).
//   3. Section routing: operator step / look cards in `要你做或看`, decision cards in `要你決定`.
// Run through `bash mods/live/run-tests.sh`.

import type { EngineInterface, On } from 'claude-code'
import { test, expect, mock } from 'claude-code/testing'
import { makeT } from './i18n'
import { NO_DECIDE, NO_DETAIL, NO_SECTIONS, decideFillText, decideLine, decideOpen, isStepCard, mergeDurableDecisions, readDurableDecisionFiles } from './model'
import type { DecideView, LiveDecision, LiveSnapshot, PaneLine } from './model'
import { recordShowLook } from './register'
import { decideTabLines } from './tabs'
import * as ui from './ui'
import { violations } from './invariants.testkit'
import { show } from '../viewer/show'

const SURFACES = ['terminal', 'desktop'] as const
const LOCALES = [['zh-TW', makeT('zh-TW')], ['en', makeT('en')]] as const

const HOME = '/fake/home'
const AHOME = HOME + '/.autopilot'
const LIVE = '/fake/live'
const REPO = '/work/repo'
const CWD = REPO + '/sub'
const PLUGIN_ROOT = '/plugin-root'
const KEY = 'a1b2c3d4e5f60718'
const ROOT = 'root-1'
const SID = 'sid-aaaa'
const PUBLISHED = '2026-10-04T10:00:00.000Z'
const NOW_FRESH = Date.parse('2026-10-04T10:00:30.000Z')
const W_MODEL = AHOME + '/review/' + KEY + '/2026-10-04/' + ROOT + '/current/model.json'
const DECISIONS_DIR = REPO + '/.git/autopilot/decisions'
const DIFF_SAMPLE = ['diff --git a/src/a.ts b/src/a.ts', '@@ -1,1 +1,2 @@', ' const a = 1', '+const b = 2', ''].join('\n')

type Tree = Record<string, string>
const j = (v: unknown): string => JSON.stringify(v)

const dec = (id: string | null, question: string, over: Partial<LiveDecision> = {}): LiveDecision => ({
  id,
  title: null,
  question,
  background: null,
  options: [],
  recommendation: null,
  why: null,
  blocks: null,
  not_authorized: null,
  source: null,
  opened_at: null,
  stale: false,
  age_s: 60,
  origin: null,
  orphaned: false,
  ...over,
})

const OPT = (label: string, description = ''): { label: string; description: string } => ({ label, description })

const snapOf = (pending: LiveDecision[]): LiveSnapshot => ({
  state: 'ok',
  text: '',
  header: 'h',
  metrics: { ctx: '37%' },
  band: {
    kind: 'decide',
    key: 'warning',
    why: 'r',
    verdictReason: null,
    mark: '▲',
    verdict: 'v',
    head: '',
    progress: '—',
    progressDim: false,
    reason: null,
    project: 'repo',
    elapsed: '10m',
    phase: '—',
    slots: [],
  },
  pending,
  project_key: KEY,
  root_run_id: ROOT,
  link: null,
  rows: [],
  gates: null,
  sections: NO_SECTIONS,
  review: null,
  published_at: PUBLISHED,
  session_as_of: PUBLISHED,
  host_as_of: PUBLISHED,
  detail: { ...NO_DETAIL, now_ms: NOW_FRESH, counts: { confirmed_live: 0, exited: 0, unknown: 0 } },
  activity: [],
  recent: [],
}) as never

const viewOf = (over: Partial<DecideView> = {}): DecideView => ({ ...NO_DECIDE, inputs: true, ...over })
const ctxOf = (t: ReturnType<typeof makeT>, cols: number, decide?: DecideView) => ({
  t,
  cols,
  expanded: new Set<string>(),
  folded: new Set<string>(),
  ...(decide === undefined ? {} : { decide }),
})
const textsOf = (ls: PaneLine[]): string[] => ls.map(l => l.text.trimEnd())
const pressIdsOf = (ls: PaneLine[]): string[] => ls.flatMap(l => [...new Set((l.segs ?? []).flatMap(s => (s.press === undefined ? [] : [s.press])))])
const hrefsOf = (ls: PaneLine[]): string[] => ls.flatMap(l => [...new Set((l.segs ?? []).flatMap(s => (s.href === undefined ? [] : [s.href])))])

function runRow(over: Record<string, unknown> = {}) {
  return {
    run_id: 'r1',
    role: 'implementer',
    runner: 'codex',
    model: 'gpt',
    root_run_id: ROOT,
    started_at: '2026-10-04T09:50:00.000Z',
    fact_at: '2026-10-04T09:50:00.000Z',
    elapsed_s: 600,
    phase: 'running',
    alive: true,
    probe_age_s: 5,
    stall: false,
    rc: null,
    final_status: null,
    ...over,
  }
}

function envelope(over: Record<string, unknown> = {}, rootRunId: string | null = ROOT) {
  return {
    schema: 'autopilot.runs-live/1',
    scope: { project_key: KEY, repo_identity: 'git-common-dir:' + REPO + '/.git', root_run_id: rootRunId },
    published_at: PUBLISHED,
    observed_at: PUBLISHED,
    valid_for_s: 180,
    writer: null,
    runs: [runRow({ run_id: 'r1' })],
    counts: { confirmed_live: 1, exited: 0, unknown: 0, fresh_bound_s: 30 },
    sessions: { [SID]: { session_usd: 0.42, as_of: PUBLISHED } },
    host_today_usd: 3.1,
    host_today_as_of: PUBLISHED,
    ...over,
  }
}

function context(pct: number, writtenAt = '2026-10-04T10:00:20.000Z') {
  return { schema_version: 1, written_at: writtenAt, context_window: { used_percentage: pct } }
}

function jobModel(over: Record<string, unknown> = {}) {
  return {
    schema: 'review-job-model/1',
    job: ROOT,
    date: '2026-10-04',
    project: KEY,
    root_run_id: ROOT,
    published_at: PUBLISHED,
    axes: { execution: { running: 1, exited: 0, unknown: 0 }, acceptance: 'unknown', can_close: null },
    conclusion: '驗收結論：尚未產生',
    needs_decision: false,
    decisions: [],
    progress: null,
    gates: [],
    ...over,
  }
}

function durableStore(decisions: object[], rootRunId: string | null = ROOT) {
  return {
    schema: 'autopilot.decision/2',
    project_key: KEY,
    repo_identity: 'git-common-dir:' + REPO + '/.git',
    root_run_id: rootRunId,
    updated_at: PUBLISHED,
    decisions,
  }
}

function baseFiles(extra: Tree = {}): Tree {
  return {
    [AHOME + '/live-pointer.json']: j({ schema: 'autopilot.live-pointer/1', live_base: LIVE, autopilot_home: AHOME, written_at: PUBLISHED }),
    [AHOME + '/session-mode/' + SID + '.json']: j({ session_id: SID, level: 'l5', project_key: KEY, root_run_id: ROOT, expires_at: '2026-10-05T10:00:00.000Z' }),
    [LIVE + '/runs/' + KEY + '--' + ROOT + '.json']: j(envelope()),
    [LIVE + '/runs/' + KEY + '.json']: j(envelope({}, null)),
    [LIVE + '/context/' + SID + '.json']: j(context(37)),
    [REPO + '/.git/HEAD']: 'ref: refs/heads/main\n',
    [CWD + '/docs/plan.md']: '# Plan\nfirst line\nsecond line\n',
    [CWD + '/docs/spec.md']: Array.from({ length: 25 }, (_, i) => 'spec line ' + (i + 1)).join('\n') + '\n',
    ...extra,
  }
}

type World = {
  files: Tree
  scriptExists: boolean
  seq: number
  nowMs: number
  opens: { id: string; title?: string }[]
  closes: string[]
  toasts: string[]
  invalidates: number
  runs: string[][]
  env: Record<string, string>
  clock: ReturnType<typeof mock.clock>
}

function flagValues(args: readonly string[], flag: string): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) out.push(args[++i])
  }
  return out
}

function runDecisionCli(w: World, argv: readonly string[]): { exitCode: number; stdout: string; stderr: string; isStdoutTruncated: false; isStderrTruncated: false } {
  const sub = argv[2]
  const rest = argv.slice(3)
  if (sub === 'open') {
    const kind = flagValues(rest, '--kind')[0] ?? 'decide'
    const question = flagValues(rest, '--question')[0] ?? ''
    const source = flagValues(rest, '--source')[0] ?? null
    const rawTarget = flagValues(rest, '--look-target')[0]
    const lookTarget = rawTarget !== undefined ? JSON.parse(rawTarget) : null
    const attachments = flagValues(rest, '--attach')
    const rootRunId = flagValues(rest, '--root-run-id')[0] ?? null
    const scopeFile = DECISIONS_DIR + '/' + KEY + (rootRunId !== null ? '--' + rootRunId : '') + '.json'
    const prev = w.files[scopeFile] !== undefined ? JSON.parse(w.files[scopeFile]) : durableStore([], rootRunId)
    const id = 'd-look' + String(++w.seq).padStart(4, '0')
    prev.decisions.push({
      id,
      question,
      status: 'open',
      kind,
      source,
      opened_at: new Date(w.nowMs).toISOString(),
      attachments,
      look_target: lookTarget,
    })
    w.files[scopeFile] = j(prev)
    return { exitCode: 0, stdout: id + '\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
  }
  if (sub === 'close') {
    const targetId = flagValues(rest, '--id')[0] ?? ''
    const prefix = DECISIONS_DIR + '/'
    for (const p of Object.keys(w.files)) {
      if (!p.startsWith(prefix) || !p.endsWith('.json')) continue
      const store = JSON.parse(w.files[p])
      let touched = false
      for (const entry of store.decisions ?? []) {
        if (entry.id === targetId && entry.status !== 'closed') {
          entry.status = 'closed'
          entry.closed_at = new Date(w.nowMs).toISOString()
          touched = true
        }
      }
      if (touched) w.files[p] = j(store)
    }
    return { exitCode: 0, stdout: 'closed ' + targetId + '\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
  }
  return { exitCode: 1, stdout: '', stderr: 'unexpected subcommand: ' + String(sub), isStdoutTruncated: false, isStderrTruncated: false }
}

function listDir(files: Tree, dirPath: string): { name: string; kind: 'file' | 'dir'; size: number; mtimeMs: number; isLink: false }[] {
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
  if (files[p] !== undefined) {
    return { kind: 'file' as const, isLink: false as const, size: files[p].length, mtimeMs: 0 }
  }
  const prefix = p.replace(/\/$/, '') + '/'
  if (p === CWD || p === REPO || Object.keys(files).some(k => k.startsWith(prefix))) {
    return { kind: 'dir' as const, isLink: false as const, size: 0, mtimeMs: 0, realPath: resolve ? p : undefined }
  }
  throw new Error('ENOENT ' + p)
}

function existsPath(w: World, p: string): boolean {
  if (p.endsWith('/scripts/open-decision.js')) return w.scriptExists
  return w.files[p] !== undefined
}

function runProc(w: World, argv: readonly string[]) {
  w.runs.push([...argv])
  if (argv[1]?.endsWith('/scripts/open-decision.js')) return runDecisionCli(w, argv)
  if (argv[0] === 'git') return { exitCode: 0, stdout: DIFF_SAMPLE, stderr: '', isStdoutTruncated: false as const, isStderrTruncated: false as const }
  return { exitCode: 1, stdout: '', stderr: 'unexpected command', isStdoutTruncated: false as const, isStderrTruncated: false as const }
}

function world(on: On, files: Tree = baseFiles(), locale: 'en' | 'zh-TW' = 'zh-TW'): World {
  const w: World = {
    files,
    scriptExists: true,
    seq: 0,
    nowMs: NOW_FRESH,
    opens: [],
    closes: [],
    toasts: [],
    invalidates: 0,
    runs: [],
    env: { HOME, AUTOPILOT_LOCALE: locale },
    clock: undefined as never,
  }
  w.clock = mock.clock(on, { now: NOW_FRESH })
  on('env.get', (_$, e) => ({ value: w.env[e.name] }))
  on('fs.read', (_$, e) => {
    const t = w.files[e.path]
    if (t === undefined) throw new Error('ENOENT ' + e.path)
    return { value: t }
  })
  on('fs.exists', (_$, e) => ({ value: existsPath(w, e.path) }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', (_$, e) => ({ value: listDir(w.files, e.path) }))
  on('fs.stat', (_$, e) => ({ value: statPath(w.files, e.path, e.resolve) }))
  on('config.list', () => ({ value: [] }))
  on('session.id', () => ({ value: SID }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.root', () => ({ value: REPO }))
  on('session.start', () => ({ cwd: CWD }))
  on('session.end', () => ({ sessionId: SID }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine' as const, ref: 0 }))
  on('ui.invalidate', () => { w.invalidates += 1; return { value: undefined } })
  on('ui.toast', (_$, e) => { w.toasts.push(e.text); return { value: undefined } })
  on('ui.open', (_$, e) => { w.opens.push({ id: e.id, title: e.title }); return { value: { isPlaced: true } } })
  on('ui.close', (_$, e) => { w.closes.push(e.id); return { value: undefined } })
  on('ui.panes', () => ({ value: [] }))
  on('process.run', (_$, e) => ({ value: runProc(w, e.argv) }))
  return w
}

// Stand-in plugin EngineInterface sharing `w` (same pattern as viewer.test.ts: the test driver `$` has no $.plugin or $.fs of its own).
function pluginEngine(w: World): EngineInterface {
  return {
    plugin: { root: PLUGIN_ROOT },
    env: { get: async (name: string) => w.env[name] },
    fs: {
      read: async (p: string) => {
        if (w.files[p] === undefined) throw new Error('ENOENT ' + p)
        return w.files[p]
      },
      exists: async (p: string) => existsPath(w, p),
      stat: async (p: string, opts?: { resolve?: boolean }) => statPath(w.files, p, opts?.resolve),
      list: async (p: string) => listDir(w.files, p),
      write: async () => undefined,
    },
    config: { list: async () => [] },
    clock: { now: async () => w.nowMs, every: () => ({ cancel: () => {} }) },
    session: {
      id: async () => SID,
      cwd: async () => CWD,
      messages: async () => [],
      usage: async () => ({}),
    },
    agent: { list: async () => [] },
    state: {
      get: async () => ({ value: NO_DECIDE }),
      set: async () => undefined,
    },
    process: { run: async (argv: string[]) => runProc(w, argv) },
    ui: {
      invalidate: () => { w.invalidates += 1 },
      toast: (text: string) => { w.toasts.push(text) },
      open: async (a: { id: string; title?: string }) => { w.opens.push({ id: a.id, title: a.title }); return { isPlaced: true } },
      close: async (a: { id: string }) => { w.closes.push(a.id) },
    },
  } as unknown as EngineInterface
}

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const PANE_PROPS = { title: 'Dispatch', isFocused: false, bodyColumns: 120, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: { agentId: undefined } }

const nodeText = (n: Node): string =>
  (n.type === 'Link' || n.type === 'Button') && typeof n.props?.label === 'string'
    ? (n.props.label as string)
    : (n.children || []).map(c => (typeof c === 'string' ? c : nodeText(c as Node))).join('')

const flatPane = (tree: Node): Node => {
  const fixed = ((tree.children || []) as Node[]).find(k => k.props?.key === 'fixed')
  if (fixed === undefined) return tree
  const kids = (fixed.children || []) as Node[]
  const content = kids.find(k => k.props?.key === 'content') as Node
  const rows = ((content.children || []) as Node[]).find(k => k.props?.key === 'rows') as Node
  const at = kids.indexOf(content)
  const rest = kids.slice(at + 1).filter((k, i) => !(i === 0 && /^─+$/.test(nodeText(k))))
  return { ...tree, children: [...kids.slice(0, at), ...((rows.children || []) as Node[]), ...rest] }
}

const allPaneRows = (tree: Node): string[] => ((flatPane(tree).children || []) as Node[]).slice(1).map(nodeText)
const paneHeadEnd = (rows: string[]): number => rows.findIndex(r => r.trim() === '') + 1
const bodyRowsOf = (tree: Node): string[] => { const r = allPaneRows(tree); return r.slice(paneHeadEnd(r)) }
const headRowsOf = (tree: Node): string[] => { const r = allPaneRows(tree); return r.slice(0, paneHeadEnd(r)) }

async function paneOn($: any, surface: (typeof SURFACES)[number], tab: string) {
  const mountPane = () => $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-live', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
  const first = await mountPane()
  await first.press({ key: tab })
  await first.unmount()
  return mountPane()
}

async function readDecidePane($: any, surface: (typeof SURFACES)[number]) {
  const pane = await paneOn($, surface, 'decide')
  const tree = (await pane.drawn()) as Node
  const buttons = ((await pane.findAll({ type: 'Button' })) as Node[]).map(b => b.props?.key as string)
  const links = ((await pane.findAll({ type: 'Link' })) as Node[]).map(l => ({
    href: l.props?.href as string,
    label: l.props?.label as string,
  }))
  const inputs = ((await pane.findAll({ type: 'Input' })) as Node[]).map(inp => inp.props?.key as string)
  await pane.unmount()
  return { rows: bodyRowsOf(tree), head: headRowsOf(tree), buttons, links, inputs }
}

async function advance(w: World, ms: number) {
  w.nowMs += ms
  await w.clock.advance(ms)
}

// ============================================================================
// 1. recordShowLook: `show` records `給你看` -> survives unrelated updates -> gone only after dismiss
// ============================================================================

for (const surface of SURFACES) {
  test('pane-attach 1: after show records via recordShowLook, the pane model contains 給你看, keeps it across unrelated updates, and removes it only when dismissed (' + surface + ')', async ($, on) => {
    const w = world(on)
    const eng = pluginEngine(w)
    await $.session.start({ surface, cwd: CWD })

    // Before `show`: no `給你看` row and no `要你做或看` section
    const initial = await readDecidePane($, surface)
    expect(initial.rows.some(r => r.includes('目前沒有待你回答的問題'))).toBe(true)
    expect(initial.rows.some(r => r.includes('給你看'))).toBe(false)
    expect(initial.rows.some(r => r.includes('要你做或看'))).toBe(false)
    expect(initial.buttons.filter(k => k.startsWith('look:') || k.startsWith('dismiss:'))).toEqual([])

    // Viewer `show` records the `給你看` look card via `recordShowLook`
    const invBefore = w.invalidates
    const out = await show(eng, { kind: 'path', path: 'docs/plan.md', start: null, end: null })
    expect(out.ok).toBe(true)
    expect(w.invalidates).toBeGreaterThan(invBefore)
    expect(w.runs.length).toBe(1)
    expect(w.runs[0]).toContain('open')
    expect(w.runs[0]).toContain('--kind')
    expect(w.runs[0]).toContain('look')
    expect(w.runs[0]).toContain('給你看：plan.md（repo）')
    expect(w.runs[0]).toContain('--attach')
    expect(w.runs[0]).toContain('docs/plan.md')

    await advance(w, 5000)
    const afterShow = await readDecidePane($, surface)
    expect(afterShow.rows.some(r => /^▾ 要你做或看  1 ─+$/.test(r))).toBe(true)
    expect(afterShow.rows.some(r => r.includes('▲ 給你看：plan.md（repo）') && r.includes('[ 關閉 ]'))).toBe(true)
    expect(afterShow.buttons).toContain('look:d-look0001')
    expect(afterShow.buttons).toContain('dismiss:d-look0001')

    // Unrelated update 1: fresh envelope spend/counts, fresh context %, and a republished model.json with an unrelated decision card
    const nextPublished = new Date(w.nowMs).toISOString()
    w.files[LIVE + '/runs/' + KEY + '--' + ROOT + '.json'] = j(envelope({
      published_at: nextPublished,
      observed_at: nextPublished,
      host_today_usd: 4.5,
      host_today_as_of: nextPublished,
      sessions: { [SID]: { session_usd: 0.85, as_of: nextPublished } },
    }))
    w.files[LIVE + '/context/' + SID + '.json'] = j(context(52, nextPublished))
    w.files[W_MODEL] = j(jobModel({
      published_at: nextPublished,
      needs_decision: true,
      decisions: [{ id: 'd-dec0001', question: '要採用哪個方案？', options: [OPT('甲'), OPT('乙')] }],
    }))
    await advance(w, 5000)

    const afterUnrelated = await readDecidePane($, surface)
    expect(afterUnrelated.head.join(' ')).toContain('$4.50')
    expect(afterUnrelated.head.join(' ')).toContain('ctx 52%')
    expect(afterUnrelated.rows.some(r => r.includes('要採用哪個方案？'))).toBe(true)
    expect(afterUnrelated.rows.some(r => r.includes('▲ 給你看：plan.md（repo）') && r.includes('[ 關閉 ]'))).toBe(true)
    expect(afterUnrelated.buttons).toContain('look:d-look0001')
    expect(afterUnrelated.buttons).toContain('dismiss:d-look0001')

    // Reopening the `給你看` row opens the viewer window without recording a duplicate row, and it stays present
    const opensBeforeReopen = w.opens.length
    const paneForReopen = await paneOn($, surface, 'decide')
    await paneForReopen.press({ key: 'look:d-look0001' })
    await paneForReopen.unmount()
    expect(w.opens.length).toBe(opensBeforeReopen + 1)
    expect(w.opens[w.opens.length - 1]).toEqual({ id: 'autopilot-viewer', title: 'docs/plan.md' })
    expect(w.runs.filter(r => r[2] === 'open').length, 'reopen must not record a second look card').toBe(1)

    const stillThere = await readDecidePane($, surface)
    expect(stillThere.rows.filter(r => r.includes('給你看：plan.md（repo）')).length).toBe(1)

    // Dismissing the `給你看` row closes it in the durable store and removes it from the pane model (while unrelated cards stay)
    const paneForDismiss = await paneOn($, surface, 'decide')
    await paneForDismiss.press({ key: 'dismiss:d-look0001' })
    await paneForDismiss.unmount()

    expect(w.runs.some(r => r[2] === 'close' && r.includes('--id') && r.includes('d-look0001'))).toBe(true)
    const afterDismiss = await readDecidePane($, surface)
    expect(afterDismiss.rows.some(r => r.includes('給你看：plan.md（repo）'))).toBe(false)
    expect(afterDismiss.rows.some(r => r.includes('要你做或看'))).toBe(false)
    expect(afterDismiss.buttons.filter(k => k.includes('d-look0001'))).toEqual([])
    expect(afterDismiss.rows.some(r => r.includes('要採用哪個方案？')), 'unrelated decision card stays').toBe(true)

    // Even if a stale model.json still lists the dismissed look id on the next tick, it stays gone
    const stalePublished = new Date(w.nowMs).toISOString()
    w.files[LIVE + '/runs/' + KEY + '--' + ROOT + '.json'] = j(envelope({ published_at: stalePublished, observed_at: stalePublished }))
    w.files[W_MODEL] = j(jobModel({
      published_at: stalePublished,
      needs_decision: true,
      decisions: [{ id: 'd-look0001', question: '給你看：plan.md（repo）', kind: 'look', options: [] }],
    }))
    await advance(w, 5000)

    const afterStaleModel = await readDecidePane($, surface)
    expect(afterStaleModel.rows.some(r => r.includes('給你看'))).toBe(false)
    expect(afterStaleModel.rows.some(r => r.includes('目前沒有待你回答的問題'))).toBe(true)
  })
}

test('pane-attach 1 negative control: skipping recordShowLook omits 給你看, and skipping dismiss/closed filtering leaves 給你看 behind', async () => {
  const zh = makeT('zh-TW')
  // Diff show via recordShowLook also records `給你看：diff HEAD~1（repo）`
  const wFiles = baseFiles()
  const w: World = {
    files: wFiles,
    scriptExists: false, // negative control 1a: simulate skipping recordShowLook
    seq: 0,
    nowMs: NOW_FRESH,
    opens: [],
    closes: [],
    toasts: [],
    invalidates: 0,
    runs: [],
    env: { HOME, AUTOPILOT_LOCALE: 'zh-TW' },
    clock: undefined as never,
  }
  const eng = pluginEngine(w)
  await recordShowLook(eng, { kind: 'diff', args: ['HEAD~1'] })
  expect(w.runs.length, 'control: when recordShowLook is skipped, no look entry is written').toBe(0)

  // Enable the script: recordShowLook writes `給你看：diff HEAD~1（repo）`
  w.scriptExists = true
  await recordShowLook(eng, { kind: 'diff', args: ['HEAD~1'] })
  expect(w.runs.length).toBe(1)
  const storeTexts = () =>
    Object.entries(w.files)
      .filter(([p]) => p.startsWith(DECISIONS_DIR + '/') && p.endsWith('.json'))
      .map(([, text]) => text)
  expect(storeTexts().length).toBe(1)
  const durableOpen = readDurableDecisionFiles(storeTexts(), { project_key: KEY, repo_identity: 'git-common-dir:' + REPO + '/.git' }, NOW_FRESH)
  const realLines = decideTabLines(snapOf(mergeDurableDecisions([], durableOpen, {})), ctxOf(zh, 76, viewOf()))
  expect(textsOf(realLines).some(l => l.includes('給你看：diff HEAD~1（repo）'))).toBe(true)

  // Negative control 1b: dropping durable.open from mergeDurableDecisions turns the `給你看` presence check red (false)
  const droppedDurable = decideTabLines(snapOf(mergeDurableDecisions([], { open: [], closedIds: durableOpen.closedIds }, {})), ctxOf(zh, 76, viewOf()))
  expect(textsOf(droppedDurable).some(l => l.includes('給你看：diff HEAD~1（repo）'))).toBe(false)

  // Dismiss in durable store: real merge removes `d-look0001`, while a broken merge ignoring closedIds/dismissed leaves it behind
  runDecisionCli(w, ['node', PLUGIN_ROOT + '/scripts/open-decision.js', 'close', '--id', 'd-look0001'])
  const durableClosed = readDurableDecisionFiles(storeTexts(), { project_key: KEY, repo_identity: 'git-common-dir:' + REPO + '/.git' }, NOW_FRESH)
  const staleBase = durableOpen.open
  const realAfterDismiss = decideTabLines(snapOf(mergeDurableDecisions(staleBase, durableClosed, { 'd-look0001': NOW_FRESH })), ctxOf(zh, 76, viewOf()))
  expect(textsOf(realAfterDismiss).some(l => l.includes('給你看：diff HEAD~1（repo）'))).toBe(false)

  const brokenAfterDismiss = decideTabLines(snapOf(mergeDurableDecisions(staleBase, { open: [], closedIds: new Set() }, {})), ctxOf(zh, 76, viewOf()))
  expect(textsOf(brokenAfterDismiss).some(l => l.includes('給你看：diff HEAD~1（repo）')), 'control: without closedIds/dismissed filtering, dismissed look row stays').toBe(true)
})

// ============================================================================
// 2. `--attach`: pressable/clickable element for both a local file path and an https URL
// ============================================================================

test('pane-attach 2 pure: a card opened with --attach carries show:<path> press segments for local paths and href segments for https URLs across locales', () => {
  const rawStore = j(durableStore([
    {
      id: 'd-att-dec',
      question: '請確認規格與 PR',
      status: 'open',
      kind: 'decide',
      opened_at: PUBLISHED,
      options: [OPT('核准'), OPT('退回')],
      attachments: [
        'docs/spec.md:15',
        'src/app.ts',
        'logs/run.log:end',
        'https://example.com/pr/42',
        'http://localhost:3000/review',
        'javascript:alert(1)',
        'http://example.com/plain',
        'file:///etc/hosts',
      ],
    },
    {
      id: 'd-att-step',
      question: '請檢查部署報告',
      status: 'open',
      kind: 'step',
      opened_at: PUBLISHED,
      attachments: ['docs/plan.md', 'https://example.com/run/99'],
    },
  ]))
  const durable = readDurableDecisionFiles([rawStore], { project_key: KEY, repo_identity: 'git-common-dir:' + REPO + '/.git' }, NOW_FRESH)
  expect(durable.open.length).toBe(2)

  for (const [loc, t] of LOCALES) {
    const ls = decideTabLines(snapOf(durable.open), ctxOf(t, 76, viewOf()))
    expect(violations(ls, 76, t), 'design invariants in ' + loc).toEqual([])

    const presses = pressIdsOf(ls)
    expect(presses, loc + ': local file path with line').toContain('show:docs/spec.md:15')
    expect(presses, loc + ': plain local file path').toContain('show:src/app.ts')
    expect(presses, loc + ': local file path with :end').toContain('show:logs/run.log:end')
    expect(presses, loc + ': step card local file path').toContain('show:docs/plan.md')

    const hrefs = hrefsOf(ls)
    expect(hrefs, loc + ': decision card https URL').toContain('https://example.com/pr/42')
    expect(hrefs, loc + ': localhost http URL').toContain('http://localhost:3000/review')
    expect(hrefs, loc + ': step card https URL').toContain('https://example.com/run/99')

    const localSeg = ls.flatMap(l => l.segs ?? []).find(s => s.press === 'show:docs/spec.md:15')
    const httpsSeg = ls.flatMap(l => l.segs ?? []).find(s => s.href === 'https://example.com/pr/42')
    expect(localSeg?.color, loc + ': local attachment press uses action palette').toBe(ui.PALETTE.action)
    expect(httpsSeg?.color, loc + ': https attachment href uses action palette').toBe(ui.PALETTE.action)

    // Disallowed URI schemes must be inert dim text (neither press nor href)
    for (const blocked of ['javascript:alert(1)', 'http://example.com/plain', 'file:///etc/hosts']) {
      expect(presses.some(p => p.includes(blocked)), loc + ': no press for ' + blocked).toBe(false)
      expect(hrefs, loc + ': no href for ' + blocked).not.toContain(blocked)
      const row = ls.find(l => l.text.includes(blocked))
      expect(row !== undefined, loc + ': inert text still visible for ' + blocked).toBe(true)
      const seg = row?.segs?.find(s => s.text.includes(blocked))
      expect(seg?.dim, loc + ': blocked scheme is dim: ' + blocked).toBe(true)
      expect(seg?.press).toBeUndefined()
      expect(seg?.href).toBeUndefined()
    }
  }

  // Negative control 2: stripping attachments (simulating skipping cardAttachRows) removes both show: press and https href
  const zh = makeT('zh-TW')
  const withoutAttach = durable.open.map(d => ({ ...d, attachments: [] }))
  const stripped = decideTabLines(snapOf(withoutAttach), ctxOf(zh, 76, viewOf()))
  expect(pressIdsOf(stripped).filter(p => p.startsWith('show:'))).toEqual([])
  expect(hrefsOf(stripped)).toEqual([])
})

for (const surface of SURFACES) {
  test('pane-attach 2 mounted: a card opened with --attach renders a pressable Button for a local file path and a clickable Link for an https URL (' + surface + ')', async ($, on) => {
    const storeFile = DECISIONS_DIR + '/' + KEY + '--' + ROOT + '.json'
    const files = baseFiles({
      [storeFile]: j(durableStore([
        {
          id: 'd-att0001',
          question: '請確認規格與 PR',
          status: 'open',
          kind: 'decide',
          opened_at: PUBLISHED,
          options: [OPT('核准'), OPT('退回')],
          attachments: ['docs/spec.md:15', 'https://example.com/pr/42', 'javascript:alert(1)'],
        },
      ])),
    })
    const w = world(on, files)
    await $.session.start({ surface, cwd: CWD })

    const drawn = await readDecidePane($, surface)
    expect(drawn.rows.some(r => r.startsWith('  附件      docs/spec.md:15'))).toBe(true)
    expect(drawn.rows.some(r => r.includes('https://example.com/pr/42'))).toBe(true)
    expect(drawn.buttons).toContain('show:docs/spec.md:15')
    expect(drawn.links).toEqual([{ href: 'https://example.com/pr/42', label: 'https://example.com/pr/42' }])
    expect(drawn.buttons.some(k => k.includes('javascript:'))).toBe(false)
    expect(drawn.links.some(l => l.href.includes('javascript:'))).toBe(false)

    // Pressing the local file attachment Button opens the viewer window on that file
    const pane = await paneOn($, surface, 'decide')
    await pane.press({ key: 'show:docs/spec.md:15' })
    await pane.unmount()
    expect(w.opens.some(o => o.id === 'autopilot-viewer' && o.title === 'docs/spec.md')).toBe(true)

    // Negative control: a card without `--attach` renders neither a `show:` Button nor a Link
    w.files[storeFile] = j(durableStore([
      {
        id: 'd-att0001',
        question: '請確認規格與 PR',
        status: 'open',
        kind: 'decide',
        opened_at: PUBLISHED,
        options: [OPT('核准'), OPT('退回')],
        attachments: [],
      },
    ]))
    const nextPublished = new Date(w.nowMs + 5000).toISOString()
    w.files[LIVE + '/runs/' + KEY + '--' + ROOT + '.json'] = j(envelope({ published_at: nextPublished, observed_at: nextPublished }))
    await advance(w, 5000)

    const noAttach = await readDecidePane($, surface)
    expect(noAttach.buttons.filter(k => k.startsWith('show:'))).toEqual([])
    expect(noAttach.links).toEqual([])
  })
}

// ============================================================================
// 3. Section routing: step card (operator step / look) -> `要你做或看`, decision card -> `要你決定`
// ============================================================================

test('pane-attach 3 pure: step cards and look cards land in 要你做或看 while decision cards land in 要你決定, across locales and negative control', () => {
  const decCardA = dec('d-dec-a', '要採用哪個方案？', { kind: 'decide', options: [OPT('甲'), OPT('乙')] })
  const decCardB = dec('d-dec-b', '要不要保留舊快取？', { kind: null, options: [OPT('保留'), OPT('刪除')] })
  const stepCard = dec('d-step-1', '請到瀏覽器完成登入', {
    kind: 'step',
    blocks: '部署流水線',
    attachments: ['https://example.com/login'],
  })
  const lookCard = dec('d-look-1', '給你看：diff HEAD~1（repo）', {
    kind: 'look',
    look_target: { kind: 'diff', args: ['HEAD~1'] },
  })

  expect(isStepCard(decCardA)).toBe(false)
  expect(isStepCard(decCardB)).toBe(false)
  expect(isStepCard(stepCard)).toBe(true)
  expect(isStepCard(lookCard)).toBe(true)

  // Step/look cards never participate in decision reply lines or prompt-fill answers
  const withNotes = { ...NO_DECIDE, notes: { 'd-step-1': '已完成', 'd-look-1': '看過了', 'd-dec-a': '選甲' } }
  expect(decideOpen(stepCard, withNotes)).toBe(false)
  expect(decideOpen(lookCard, withNotes)).toBe(false)
  expect(decideLine(stepCard, withNotes)).toBeNull()
  expect(decideLine(lookCard, withNotes)).toBeNull()
  expect(decideFillText(stepCard, withNotes)).toBeNull()
  expect(decideFillText(lookCard, withNotes)).toBeNull()
  expect(decideOpen(decCardA, withNotes)).toBe(true)

  for (const [loc, t] of LOCALES) {
    const ls = decideTabLines(snapOf([decCardA, stepCard, decCardB, lookCard]), ctxOf(t, 76, viewOf()))
    expect(violations(ls, 76, t), 'design invariants in ' + loc).toEqual([])

    const body = ls.filter(l => l.bar !== true)
    const bars = ls.filter(l => l.bar === true)
    const decideTitle = t('decide.title')
    const stepsTitle = t('decide.steps_title')
    const decideAt = body.findIndex(l => l.kind === 'header' && l.text.includes(decideTitle))
    const stepsAt = body.findIndex(l => l.kind === 'header' && l.text.includes(stepsTitle))
    expect(decideAt, loc + ': 要你決定 header first').toBe(0)
    expect(stepsAt, loc + ': 要你做或看 header after 要你決定').toBeGreaterThan(decideAt)

    const decideSlice = body.slice(decideAt, stepsAt)
    const stepsSlice = body.slice(stepsAt)
    const decideText = textsOf(decideSlice).join('\n')
    const stepsText = textsOf(stepsSlice).join('\n')

    expect(decideSlice[0].text).toContain(decideTitle + '  2 ')
    expect(decideText).toContain('▲ 1. 要採用哪個方案？')
    expect(decideText).toContain('▲ 2. 要不要保留舊快取？')
    expect(decideText).not.toContain('請到瀏覽器完成登入')
    expect(decideText).not.toContain('給你看：diff HEAD~1（repo）')
    expect(decideSlice.filter(l => l.kind !== 'blank').every(l => l.fact === 'decide.cards')).toBe(true)

    expect(stepsSlice[0].text).toContain(stepsTitle + '  2 ')
    expect(stepsText).toContain('▲ 1. 請到瀏覽器完成登入')
    expect(stepsText).toContain('▲ 給你看：diff HEAD~1（repo）')
    expect(stepsText).not.toContain('要採用哪個方案？')
    expect(stepsText).not.toContain('要不要保留舊快取？')
    expect(stepsSlice.filter(l => l.kind !== 'blank').every(l => l.fact === 'decide.steps')).toBe(true)
    expect(stepsSlice.some(l => l.field !== undefined), loc + ': step/look cards never render Input fields').toBe(false)
    expect(pressIdsOf(stepsSlice)).toEqual(['dismiss:d-step-1', 'look:d-look-1', 'dismiss:d-look-1'])

    // Send bar counts ONLY the 2 decision cards, never the step/look cards
    expect(bars.length).toBe(1)
    expect(bars[0].text).toContain(t('decide.submit', { n: 0, total: 2 }))

    // When ONLY step/look cards are pending: 要你決定 shows its empty message, 要你做或看 lists the step/look cards, and no send bar is emitted
    const stepsOnly = decideTabLines(snapOf([stepCard, lookCard]), ctxOf(t, 76, viewOf()))
    expect(violations(stepsOnly, 76, t), 'steps-only invariants in ' + loc).toEqual([])
    expect(stepsOnly.some(l => l.bar === true)).toBe(false)
    const sTexts = textsOf(stepsOnly)
    const emptyIdx = sTexts.findIndex(x => x.includes(t('decide.none')))
    const sHeadIdx = sTexts.findIndex(x => x.includes(stepsTitle + '  2 '))
    expect(emptyIdx).toBeGreaterThan(0)
    expect(sHeadIdx).toBeGreaterThan(emptyIdx)
  }

  // Negative control 3: misrouting a step card as `decide` puts it under `要你決定`, drops `要你做或看` count, and inflates the send bar denominator
  const zh = makeT('zh-TW')
  const misroutedStep: LiveDecision = { ...stepCard, kind: 'decide' }
  const broken = decideTabLines(snapOf([decCardA, misroutedStep]), ctxOf(zh, 76, viewOf()))
  const brokenTexts = textsOf(broken)
  expect(brokenTexts.some(x => x.includes('要你做或看')), 'control: misrouted step card disappears from 要你做或看').toBe(false)
  expect(brokenTexts[0]).toContain('要你決定  2 ')
  expect(brokenTexts.some(x => x.includes('▲ 2. 請到瀏覽器完成登入')), 'control: misrouted step card lands in 要你決定').toBe(true)
  expect(brokenTexts[brokenTexts.length - 1]).toContain('送出（已答 0/2）')
})

for (const surface of SURFACES) {
  test('pane-attach 3 mounted: mounted Pane places decision cards in 要你決定 and operator step + look cards in 要你做或看 (' + surface + ')', async ($, on) => {
    const storeFile = DECISIONS_DIR + '/' + KEY + '--' + ROOT + '.json'
    const files = baseFiles({
      [storeFile]: j(durableStore([
        {
          id: 'd-dec-m1',
          question: '要採用哪個方案？',
          status: 'open',
          kind: 'decide',
          opened_at: PUBLISHED,
          options: [OPT('甲'), OPT('乙')],
        },
        {
          id: 'd-step-m1',
          question: '請到瀏覽器完成登入',
          status: 'open',
          kind: 'step',
          blocks: '部署流水線',
          opened_at: PUBLISHED,
          attachments: ['https://example.com/login'],
        },
        {
          id: 'd-look-m1',
          question: '給你看：plan.md（repo）',
          status: 'open',
          kind: 'look',
          opened_at: PUBLISHED,
          look_target: { kind: 'path', path: 'docs/plan.md', start: null, end: null },
        },
      ])),
    })
    world(on, files)
    await $.session.start({ surface, cwd: CWD })

    const drawn = await readDecidePane($, surface)
    const decideHeaderAt = drawn.rows.findIndex(r => /^▾ 要你決定  1 ─+$/.test(r))
    const decCardAt = drawn.rows.findIndex(r => r === '▲ 1. 要採用哪個方案？')
    const stepsHeaderAt = drawn.rows.findIndex(r => /^▾ 要你做或看  2 ─+$/.test(r))
    const stepCardAt = drawn.rows.findIndex(r => r === '▲ 1. 請到瀏覽器完成登入')
    const lookCardAt = drawn.rows.findIndex(r => r.includes('▲ 給你看：plan.md（repo）') && r.includes('[ 關閉 ]'))

    expect(decideHeaderAt).toBe(0)
    expect(decCardAt).toBeGreaterThan(decideHeaderAt)
    expect(stepsHeaderAt).toBeGreaterThan(decCardAt)
    expect(stepCardAt).toBeGreaterThan(stepsHeaderAt)
    expect(lookCardAt).toBeGreaterThan(stepCardAt)
    expect(drawn.rows[drawn.rows.length - 1]).toBe('  [ 送出（已答 0/1） ]  答案會貼進這個對話送出')

    expect(drawn.buttons).toContain('opt:d-dec-m1:0')
    expect(drawn.buttons).toContain('opt:d-dec-m1:1')
    expect(drawn.buttons).toContain('dismiss:d-step-m1')
    expect(drawn.buttons).toContain('look:d-look-m1')
    expect(drawn.buttons).toContain('dismiss:d-look-m1')
    expect(drawn.links).toEqual([{ href: 'https://example.com/login', label: 'https://example.com/login' }])
    expect(drawn.inputs).toEqual(['note:d-dec-m1'])
  })
}
