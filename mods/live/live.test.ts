// P1W SCOPE (the band follows the campaign an /l5-/l6 session launched: marker `campaign_roots` + the marker root are read as one set,
//   live counts / stall rows / proxy decisions summed, frozen progress + phase from the newest campaign root that has them; 12 cases x terminal + desktop):
// RED before the change (146 tests incl. 11 SCOPE cases x2): 128 pass / 18 fail: run-w/land/scope-mod-red.txt. GREEN: 148 pass / 0 fail (the 12th case, a decision awaited under a campaign root, was added after a mutation survivor). Mutation controls: run-w/land/scope-mut-mod-*.txt.
// P1W FOREMAN (the band reads the foreman sidecar's stamp rows: an un-ended agent quiet < 180 s = 進行中 工頭在跑, >= 180 s = 疑似卡住 工頭 N 分沒有動作; ended / over-TTL / unstamped ignored; precedence; 2 cases x terminal + desktop):
// RED before the change: see run-w/land/foreman-mod-red.txt. Mutation controls: run-w/land/mut-foreman-*.txt.
// P1W TURN (the band knows a turn is in progress: <live>/turn/<sid>.json active -> 進行中 with 「回合進行中（N 分）」, ended / absent -> 待命, stale (> 24h) ignored; one case x terminal + desktop):
// RED at 2e84fd03 (114 tests): see run-w/land/turn-mod-red.txt. Mutation controls: run-w/land/mut-turn-*.txt.
// P1W GATEFIX (a task in progress is 進行中; 完成待驗收 needs no live run; one new case x terminal + desktop, the W3a tasks case's first line 待命 -> 進行中):
// RED at 2160351c (112 tests): 108 pass / 4 fail (2 cases x 2 surfaces). GREEN: 114 pass / 0 fail. Mutation controls (run-w/land/mut-*.txt): task not running (4 red),
//   completion ignores a live run (8 red), a task in progress outranks completion (2 red); each restored.
// P1W ELAPSED (start = bound receipt, else tasks first_created_at, else marker started_at, else earliest run, else an em dash; one case x terminal + desktop):
// RED at w/int5 2fbd2b87 (112 tests): 110 pass / 2 fail (the ELAPSED case x 2). GREEN: 112 pass / 0 fail (the W3a tasks case's 10m became 30m: the old rule's assertion).
// ELAPSED mutation controls: run-w/elapsed/mut-*.txt.
// P1W W3a (the mod reads tasks, attention, phase, decisions sidecar, foreman sidecar, sources manifest, receipts; 21 cases + 1 traversal case x terminal + desktop):
// RED at e227528e+C1..C3b (64 tests): 64 pass / 42 fail (all 21 W3a cases x 2). GREEN: 108 pass / 0 fail (incl. the root-traversal case).
// W3a mutation controls (each red, then reverted; run-w/w3a/mut-*.txt): attention not decide / idle attention is decide / stale flag ignored /
//   stale under a day shown / idle append missing / tasks-done ignored / empty tasks is done / done ignores acceptance / tasks progress overrides
//   model / no dim / sid not sanitised / campaign ignores receipt / latest receipt / file-level root unbound ignored / receipt root ignored /
//   traversal guard off / session tasks start ignored / marker start ignored / decisions project scope off / root scope off / zero decisions shown /
//   writers label constant / next-pick still labelled / undocumented dropped / veto without id / root ledger path / foreman stale not dim /
//   foreman absent silent / foreman scope off / manifest scope off / phase-only-phase / progress-only-progress / model manifest fallback off /
//   disabled counts as wired / tasks hint without manifest / tasks not-wired silent / attention not-wired silent / ctx not-wired ignored /
//   manifest beats data / line-2 tail dropped / pane stale suffix dropped / attention section dropped.
// P1c C3b-M (job phase from the job model's `phase.label`; fifth verdict word 待命 for idle; run with `claude plugin test <wrapper>`):
// RED at 48be3ecd (64 tests): 56 pass / 8 fail (4 cases x terminal + desktop): (fail) verdict 待命 ..., (fail) phase: the job model phase label is shown ..., (fail) verdict precedence
//   (the idle step), (fail) verdict 完成待驗收 (its 'none' cases now expect ['待命'] instead of no word). GREEN: 64 pass / 0 fail.
// C3b mutation controls (each red, then reverted): idle not last / idle over running / old glyph / wrong reason / idle bold /
//   phase ignored / code shown instead of label / bare string accepted / empty label accepted / process phase shown.
// P1c C3 (band redesign: verdict word, project, phase, elapsed, progress; cost and context in the pane header):
// RED at 2279e6d0 (C2 implementation, this suite's C3 cases + the C2 cases rewritten for the new band, 62 tests):
//   24 pass / 38 fail (19 cases x terminal + desktop), e.g.
//   (fail) verdict 要你決定: the loudest word, wins over a stalled run, reason is the decision question
//   (fail) verdict precedence: needs_decision > stalled > waiting acceptance > running
//   (fail) progress: frozen shows the percent and the done/total; unfrozen shows "n done*", dim, never a percent
//   (fail) project: short name from scope.repo_identity, hex8 of the project key for any odd shape
//   (fail) pane: when a decision is awaited it is the first section, built from the model decision; the Link stays
// GREEN: 62 pass / 0 fail. C3 mutation controls (applied to the loaded copy, each turned the suite red, then reverted):
//   needs_decision never wins, stalled beats waiting only when not waiting, waiting ignores acceptance / frozen /
//   done = total, no asterisk, percent without frozen, unknown progress shown as 0, no dim, process phase shown as
//   phase, bare repo named, elapsed without minutes, elapsed from the latest start, cost in the band, stall age min
//   instead of max, decision not bold, decision section after the gate rows.
// RED at 2680228c (empty register.ts, 38 tests, `claude plugin test <wrapper>`):
//   (fail) band: fresh envelope via the session marker, every number from the envelope / context file (terminal)
//     HooksError: $.ui.mount: no implementation for ui.render
//   (fail) pane: fullscreen at 160 columns opens once; table, gate table, review link; no Image (terminal)
//   (fail) toast: one on an execution-axis change, one on an acceptance-axis change, none when nothing changed (terminal)
//   (fail) lifecycle: one timer however often session.start fires; /clear keeps it; exit cancels it
//     AssertionError: Expected: 1 / Received: 0
//    0 pass / 38 fail / Ran 38 tests across 1 file
// GREEN: 38 pass / 0 fail. Mutation controls (each applied to the loaded copy, suite went red, then reverted):
//   stale check off, scope check off, 144-column guard off, isFullscreen guard off, borrowed sid cost, context age
//   check off, marker expiry off, /clear cancels the timer, no timer guard, toast on first snapshot, SSD fallback
//   off, missing cost shown as $0.00, plain startsWith instead of a path-boundary prefix.
// mods plan P1c — the `live` mod. Run through a throwaway wrapper plugin named `autopilot`
// (the name D2 loads it under; $.state refs are owner-checked):
//   claude plugin test <wrapper>      (wrapper/hooks/hooks.json modules -> ../mods/live/register.ts)
// The test kit has no fs, so every file the mod reads is served by bottom `on('fs.*')` hooks over an
// in-memory tree; a missing file makes the bottom hook throw, which the mod sees as a rejected read.
import type { On } from 'claude-code'
import { test, expect, mock } from 'claude-code/testing'
import { readQc, qcChip, readReview, reviewSlot, displayWidth, truncateToWidth, layoutBand, readMarker, readResidue, readStageWalk, bandSlots, slotUnit, slotPosition, slotDispatch, slotDecisions, slotSpend, slotHygiene, slotReview, readLoadSource, spendLines } from './model'
import type { Slot } from './model'

const SURFACES = ['terminal', 'desktop'] as const

const HOME = '/home/t'
const AHOME = HOME + '/.autopilot'
const LIVE = '/dev/shm/live-1'
const KEY = 'a1b2c3d4e5f60718'
const OTHER_KEY = '0f0e0d0c0b0a0908'
const ROOT = 'root-1'
const SID_A = 'sid-aaaa'
const SID_B = 'sid-bbbb'
const CWD = '/work/repo/sub'
const PUBLISHED = '2026-10-04T10:00:00.000Z'
const NOW_FRESH = Date.parse('2026-10-04T10:00:30.000Z')
const NOW_STALE = Date.parse('2026-10-04T10:03:30.000Z') // 210 s after published_at, valid_for_s 180

type Tree = Record<string, string>
const j = (v: unknown) => JSON.stringify(v)

function row(over: Record<string, unknown>) {
  return {
    run_id: 'r1', role: 'implementer', runner: 'codex', model: 'gpt', root_run_id: ROOT,
    started_at: '2026-10-04T09:50:00.000Z', fact_at: '2026-10-04T09:50:00.000Z', elapsed_s: 600,
    phase: 'running', alive: true, probe_age_s: 5, stall: false, rc: null, final_status: null,
    ...over,
  }
}

function envelope(over: Record<string, unknown> = {}, rootRunId: string | null = ROOT, key = KEY) {
  return {
    schema: 'autopilot.runs-live/1',
    scope: { project_key: key, repo_identity: 'git-common-dir:/work/repo/.git', root_run_id: rootRunId },
    published_at: PUBLISHED, observed_at: PUBLISHED, valid_for_s: 180, writer: null,
    runs: [
      row({ run_id: 'r1' }),
      row({ run_id: 'r2', started_at: '2026-10-04T09:55:00.000Z', fact_at: '2026-10-04T09:55:00.000Z', stall: true, last_event_age_s: 240 }),
      row({ run_id: 'r3', phase: 'exited', alive: false, rc: 0, final_status: 'done', fact_at: '2026-10-04T09:58:00.000Z' }),
    ],
    counts: { confirmed_live: 2, exited: 1, unknown: 0, fresh_bound_s: 30 },
    sessions: { [SID_A]: { session_usd: 0.42, as_of: PUBLISHED }, [SID_B]: { session_usd: 9.99, as_of: PUBLISHED } },
    host_today_usd: 3.1, host_today_as_of: PUBLISHED,
    ...over,
  }
}

function context(pct: number, writtenAt = '2026-10-04T10:00:20.000Z') {
  return { schema_version: 1, written_at: writtenAt, context_window: { used_percentage: pct } }
}

function model(over: Record<string, unknown> = {}) {
  return {
    schema: 'review-job-model/1', job: ROOT, date: '2026-10-04', project: KEY, root_run_id: ROOT, published_at: PUBLISHED,
    axes: { execution: { running: 2, exited: 1, unknown: 0 }, acceptance: 'unknown', can_close: null },
    conclusion: '驗收結論：尚未產生', needs_decision: false, decision: null, progress: null,
    gates: [{ phase: 'plan', generation: 1, verdict: 'PASS', status: 'LIVE GATE · 未綁定候選' }],
    ...over,
  }
}

// The standard healthy world: pointer, marker for SID_A, project + root envelopes, context files, review server info.
function base(): Tree {
  const t: Tree = {}
  t[AHOME + '/live-pointer.json'] = j({ schema: 'autopilot.live-pointer/1', live_base: LIVE, autopilot_home: AHOME, written_at: PUBLISHED })
  t[AHOME + '/session-mode/' + SID_A + '.json'] = j({ session_id: SID_A, level: 'l5', project_key: KEY, root_run_id: ROOT, expires_at: '2026-10-05T10:00:00.000Z' })
  t[AHOME + '/session-mode/' + SID_B + '.json'] = j({ session_id: SID_B, level: 'l5', project_key: KEY, root_run_id: ROOT, expires_at: '2026-10-05T10:00:00.000Z' })
  t[LIVE + '/runs/' + KEY + '--' + ROOT + '.json'] = j(envelope())
  t[LIVE + '/runs/' + KEY + '.json'] = j(envelope({}, null))
  t[LIVE + '/context/' + SID_A + '.json'] = j(context(37))
  t[LIVE + '/context/' + SID_B + '.json'] = j(context(88))
  return t
}

type World = {
  files: Tree
  sid: { value: string }
  cwdReal: { value: string }
  toasts: string[]
  panes: string[]
  opens: { id: string; title?: string; focus?: true; closeOnEscape?: true }[]
  writes: string[]
  reads: string[]
  lists: string[]
  clock: ReturnType<typeof mock.clock>
}

// Registers the bottom hooks (what the engine would answer) for one test.
function world(on: On, files: Tree, nowMs = NOW_FRESH, sid = SID_A): World {
  const w: World = { files, sid: { value: sid }, cwdReal: { value: CWD }, toasts: [], panes: [], opens: [], writes: [], reads: [], lists: [], clock: undefined as never }
  w.clock = mock.clock(on, { now: nowMs })
  mock.env(on, { HOME })
  on('fs.read', ($, e) => {
    w.reads.push(e.path)
    const t = w.files[e.path]
    if (t === undefined) throw new Error('ENOENT ' + e.path)
    return { value: t }
  })
  on('fs.exists', ($, e) => ({ value: w.files[e.path] !== undefined }))
  on('fs.write', ($, e) => { w.writes.push(e.path); return { value: undefined } })
  on('fs.list', ($, e) => {
    w.lists.push(e.path)
    const prefix = e.path.replace(/\/$/, '') + '/'
    const seen = new Map<string, 'file' | 'dir'>()
    for (const p of Object.keys(w.files)) {
      if (!p.startsWith(prefix)) continue
      const rest = p.slice(prefix.length)
      const slash = rest.indexOf('/')
      if (slash === -1) seen.set(rest, 'file')
      else if (!seen.has(rest.slice(0, slash))) seen.set(rest.slice(0, slash), 'dir')
    }
    if (seen.size === 0) throw new Error('ENOENT ' + e.path)
    return { value: [...seen].map(([name, kind]) => ({ name, kind, size: 1, mtimeMs: 0, isLink: false })) }
  })
  on('fs.stat', ($, e) => ({
    value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false, realPath: e.resolve ? (e.path === CWD ? w.cwdReal.value : e.path) : undefined },
  }))
  on('session.id', () => ({ value: w.sid.value }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.root', () => ({ value: '/work/repo' }))
  on('session.start', () => ({ cwd: CWD }))
  on('session.end', () => ({ sessionId: w.sid.value }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', ($, e) => { w.toasts.push(e.text); return { value: undefined } })
  on('ui.open', ($, e) => { w.opens.push({ id: e.id, title: e.title, focus: e.focus, closeOnEscape: e.closeOnEscape }); if (!w.panes.includes(e.id)) w.panes.push(e.id); return { value: { isPlaced: true } } })
  on('ui.close', ($, e) => { w.panes = w.panes.filter(id => id !== e.id); return { value: undefined } })
  on('ui.panes', () => ({ value: w.panes.map(id => ({ id, title: 'Autopilot', isShown: true, isFocused: false, isPlaced: true })) }))
  return w
}

const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 5 }, view: { agentId: undefined } }
const PANE_PROPS = { title: 'Dispatch', isFocused: false, bodyColumns: 120, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: { agentId: undefined } }

async function start($: any, surface: string) {
  await $.session.start({ surface, cwd: CWD })
}

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const textOf = (n: Node): string => (n.children || []).map(c => (typeof c === 'string' ? c : textOf(c as Node))).join('')
function walkTexts(n: Node, out: Node[] = []): Node[] {
  if (n.type === 'Text') out.push(n)
  else for (const c of n.children || []) if (typeof c !== 'string') walkTexts(c as Node, out)
  return out
}

// P7: the band is ONE line (see the "P7 band" cases below); the verdict row, the project / phase / elapsed / progress and the reason
// moved to the panel's Now tab. This helper keeps the old semantic cases reading the same strings from there: line1 = the Now tab's
// verdict row, line2 = its reason line; a non-ok state (no project, stale, ...) has no Now row, so line1 is the band's reason text.
async function bandParts($: any, surface: (typeof SURFACES)[number], columns = 120) {
  const pane = await paneOn($, surface, 'now')
  const tree = (await pane.drawn()) as Node
  await pane.unmount()
  const kids = (tree.children || []) as Node[]
  const head = kids[2]
  if (head && head.type === 'Box') {
    // P7 Now tab: row = `<verdict> <project> · <elapsed>`; progress and phase are their own lines (phase is absent when the marker produced it: it is the position line)
    const row = walkTexts(head).map(textOf).join('')
    const texts = kids.map(k => textOf(k))
    const progressNode = kids.find(k => textOf(k).startsWith('progress  ')) as Node
    const progress = textOf(progressNode).slice('progress  '.length)
    const phaseLine = texts.find(t => t.startsWith('phase  '))
    const phase = phaseLine === undefined ? '—' : phaseLine.slice('phase  '.length)
    const cut = row.lastIndexOf(' · ')
    // summary: the pre-P7 row shape, rebuilt from the new pieces, so the semantic cases keep asserting verdict / project / phase / elapsed / progress
    const summary = row.slice(0, cut) + ' · ' + phase + ' · ' + row.slice(cut + 3) + ' · ' + progress
    return { line1: summary, row, line2: textOf(kids[3]) || undefined, last: progressNode, tree }
  }
  const line = await bandLine($, surface, columns)
  const cells = walkTexts(line.tree)
  return { line1: textOf(cells[0]).replace(/ │ $/, ''), line2: undefined, last: cells[0], tree }
}

// the real band (AbovePrompt): its drawn tree, the full line (Texts + the ⓘ label) and the ⓘ Button node
async function bandLine($: any, surface: (typeof SURFACES)[number], columns = 120) {
  const ui = await $.ui.mount({ plugin: 'autopilot', surface, component: 'AbovePrompt', props: { ...BAND_PROPS, bodyColumns: columns }, viewport: { columns: Math.max(columns, 20), rows: 50, isFullscreen: true } })
  const tree = (await ui.drawn()) as Node
  const info = await ui.find({ type: 'Button' })
  await ui.unmount()
  const texts = walkTexts(tree).map(textOf).join('')
  return { tree, text: texts + (info ? labelOf(info as Node) : ''), info: info as Node | undefined }
}
const labelOf = (n: Node): string => (typeof n.props?.label === 'string' ? (n.props.label as string) : textOf(n))

// text a test greps: line 1, then the reason on its own line
async function bandText($: any, surface: (typeof SURFACES)[number], columns = 120) {
  const p = await bandParts($, surface, columns)
  return p.line2 === undefined ? p.line1 : p.line1 + '\n' + p.line2
}

// the pane on one tab (default: Dispatch, where the rows / gates / tasks / foreman live); the press only sets the tab and invalidates, the host then draws again (a fresh mount here)
async function paneParts($: any, surface: (typeof SURFACES)[number], tab: string = 'dispatch') {
  const mountPane = () => $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-live', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
  const first = await mountPane()
  await first.press({ key: tab })
  await first.unmount()
  const pane = await mountPane()
  const tree = (await pane.drawn()) as Node
  const link = await pane.find({ type: 'Link' })
  await pane.unmount()
  return { texts: walkTexts(tree).map(textOf), href: link?.props.href as string | undefined, tree }
}

// a mounted pane on one tab (the caller unmounts it)
async function paneOn($: any, surface: (typeof SURFACES)[number], tab: string) {
  const mountPane = () => $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-live', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
  const first = await mountPane()
  await first.press({ key: tab })
  await first.unmount()
  return mountPane()
}

const paneHeader = async ($: any, surface: (typeof SURFACES)[number]) => (await paneParts($, surface)).texts[0] as string

// base() world: confirmed_live 2, one row with stall:true (last_event_age_s 240), earliest start 09:50:00, now 10:00:30
const FRESH_LINE1 = '⏸ 疑似卡住 repo · — · 10m · —'
const FRESH_LINE2 = '最久的派工 4m 沒有輸出'
const FRESH_TEXT = () => FRESH_LINE1 + '\n' + FRESH_LINE2
const FOUND = '疑似卡住 repo' // "the project envelope was found" marker

for (const surface of SURFACES) {
  test('band: fresh envelope via the session marker, project / phase / elapsed / progress from the envelope (' + surface + ')', async ($, on) => {
    world(on, base())
    await start($, surface)
    expect(await bandText($, surface)).toBe(FRESH_TEXT())
    expect((await paneHeader($, surface))).toBe('session $0.42 · host $3.10 · ctx 37%')
  })

  test('band: two sessions of one repo each show their own sid cost and ctx (' + surface + ')', async ($, on) => {
    const w = world(on, base(), NOW_FRESH, SID_B)
    await start($, surface)
    const text = await paneHeader($, surface)
    expect(text).toContain('session $9.99 · host $3.10')
    expect(text).toContain('ctx 88%')
    expect(text).not.toContain('$0.42')
    expect(text).not.toContain('ctx 37%')
    expect(w.reads.filter(p => p.includes(SID_A))).toEqual([]) // never read the other sid's context/marker
  })

  test('band: missing context file and missing session row show an em dash, never 0 (' + surface + ')', async ($, on) => {
    const files = base()
    delete files[LIVE + '/context/' + SID_A + '.json']
    files[LIVE + '/runs/' + KEY + '--' + ROOT + '.json'] = j(envelope({ sessions: {}, host_today_usd: null, host_today_as_of: null }))
    world(on, files)
    await start($, surface)
    const text = await paneHeader($, surface)
    expect(text).toBe('session $— · host $— · ctx —')
    expect(text).not.toContain('$0')
    expect(text).not.toContain('ctx 0')
  })

  test('band: a context file older than 120 s is absent, not stale data (' + surface + ')', async ($, on) => {
    const files = base()
    files[LIVE + '/context/' + SID_A + '.json'] = j(context(37, '2026-10-04T09:50:00.000Z'))
    world(on, files)
    await start($, surface)
    expect(await paneHeader($, surface)).toContain('ctx —')
  })

  test('band: no pointer / unreadable pointer (' + surface + ')', async ($, on) => {
    const files = base()
    delete files[AHOME + '/live-pointer.json']
    const w = world(on, files)
    await start($, surface)
    expect(await bandText($, surface)).toContain('no pointer')
    w.files[AHOME + '/live-pointer.json'] = '{not json'
    await w.clock.advance(5000)
    expect(await bandText($, surface)).toContain('unreadable')
  })

  test('band: no marker and no paths prefix means no project; the longest paths prefix wins (' + surface + ')', async ($, on) => {
    const files = base()
    delete files[AHOME + '/session-mode/' + SID_A + '.json']
    const w = world(on, files)
    await start($, surface)
    expect(await bandText($, surface)).toContain('no project')
    // two projects, nested worktrees: the deeper prefix wins; a sibling path that merely shares a string prefix does not match
    files[LIVE + '/runs/paths/' + OTHER_KEY + '.json'] = j({ '/work': { project_key: OTHER_KEY, repo_identity: 'x' } })
    files[LIVE + '/runs/paths/' + KEY + '.json'] = j({ '/work/repo': { project_key: KEY, repo_identity: 'y' }, '/work/repo-sibling': { project_key: OTHER_KEY, repo_identity: 'x' } })
    w.cwdReal.value = '/work/repo/sub'
    await w.clock.advance(5000)
    const text = await bandText($, surface)
    expect(text).toContain(FOUND) // KEY's project envelope (no root), not OTHER_KEY's (missing => would be unavailable)
    // /work/repo2 shares a string prefix with /work/repo but is not inside it: only the /work entry (OTHER_KEY) matches
    w.cwdReal.value = '/work/repo2/sub'
    w.files[LIVE + '/runs/paths/' + KEY + '.json'] = j({ '/work/repo': { project_key: KEY, repo_identity: 'y' } })
    await w.clock.advance(5000)
    expect(await bandText($, surface)).toContain('--project ' + OTHER_KEY)
  })

  test('band: after /clear the sid changes, the old marker is gone and the cwd route takes over (' + surface + ')', async ($, on) => {
    const files = base()
    files[LIVE + '/runs/paths/' + KEY + '.json'] = j({ '/work/repo': { project_key: KEY, repo_identity: 'y' } })
    const w = world(on, files)
    await start($, surface)
    expect(await bandText($, surface)).toBe(FRESH_TEXT())
    w.sid.value = 'sid-after-clear' // no marker, no context, no session row for it
    await $.session.end({ reason: 'clear', sessionId: SID_A, resume: {} } as never)
    await w.clock.advance(5000) // the timer must have survived the clear
    expect(await bandText($, surface)).toContain(FOUND)
    expect(await paneHeader($, surface)).toBe('session $— · host $3.10 · ctx —')
  })

  test('band: an expired marker is ignored (' + surface + ')', async ($, on) => {
    const files = base()
    files[AHOME + '/session-mode/' + SID_A + '.json'] = j({ session_id: SID_A, project_key: KEY, root_run_id: ROOT, expires_at: '2026-10-04T09:00:00.000Z' })
    world(on, files)
    await start($, surface)
    expect(await bandText($, surface)).toContain('no project')
  })

  test('band: stale after valid_for_s; a re-read never makes an old envelope fresh (' + surface + ')', async ($, on) => {
    const w = world(on, base(), NOW_STALE)
    await start($, surface)
    expect(await bandText($, surface)).toContain('stale')
    await w.clock.advance(5000)
    await w.clock.advance(5000)
    expect(await bandText($, surface)).toContain('stale')
    w.files[LIVE + '/runs/' + KEY + '--' + ROOT + '.json'] = j(envelope({ published_at: '2026-10-04T10:03:20.000Z' }))
    await w.clock.advance(5000)
    expect(await bandText($, surface)).toContain(FOUND) // fresh only because published_at moved
  })

  test('band: scope mismatch is a missing file; the SSD copy is the fallback; both gone is unavailable (' + surface + ')', async ($, on) => {
    const files = base()
    files[LIVE + '/runs/' + KEY + '--' + ROOT + '.json'] = j(envelope({}, ROOT, OTHER_KEY)) // wrong project_key at our path
    files[AHOME + '/review/' + KEY + '/live/runs.' + KEY + '--' + ROOT + '.json'] = j(envelope({ host_today_usd: 7.5 }))
    const w = world(on, files)
    await start($, surface)
    expect(await paneHeader($, surface)).toContain('host $7.50') // served from the SSD copy
    delete w.files[AHOME + '/review/' + KEY + '/live/runs.' + KEY + '--' + ROOT + '.json']
    await w.clock.advance(5000)
    expect(await bandText($, surface)).toContain('unavailable · run: autopilot status runs --watch --project ' + KEY)
    w.files[LIVE + '/runs/' + KEY + '--' + ROOT + '.json'] = j(envelope({}, 'some-other-root')) // wrong root
    await w.clock.advance(5000)
    expect(await bandText($, surface)).toContain('unavailable')
  })

  test('band: a malformed envelope is unreadable and never throws (' + surface + ')', async ($, on) => {
    const files = base()
    files[LIVE + '/runs/' + KEY + '--' + ROOT + '.json'] = '{"schema": '
    world(on, files)
    await start($, surface)
    expect(await bandText($, surface)).toContain('unreadable')
  })

  test('band: no root in the marker reads the project-level envelope (' + surface + ')', async ($, on) => {
    const files = base()
    files[AHOME + '/session-mode/' + SID_A + '.json'] = j({ session_id: SID_A, project_key: KEY, root_run_id: null, expires_at: '2026-10-05T10:00:00.000Z' })
    delete files[LIVE + '/runs/' + KEY + '--' + ROOT + '.json']
    files[LIVE + '/runs/' + KEY + '.json'] = j(envelope({ host_today_usd: 1.25 }, null))
    world(on, files)
    await start($, surface)
    expect(await paneHeader($, surface)).toContain('host $1.25')
  })

  test('PLAINROOT band: a plain marker (level null) carrying a job root reads that root scope, not the project scope (' + surface + ')', async ($, on) => {
    const files = base()
    const PLAIN_ROOT = 'job-1790000000-ab12cd34'
    files[AHOME + '/session-mode/' + SID_A + '.json'] = j({ session_id: SID_A, level: null, project_key: KEY, root_run_id: PLAIN_ROOT, started_at: '2026-10-04T09:00:00.000Z', expires_at: '2026-10-05T10:00:00.000Z' })
    delete files[LIVE + '/runs/' + KEY + '--' + ROOT + '.json']
    files[LIVE + '/runs/' + KEY + '.json'] = j(envelope({ host_today_usd: 7.77 }, null))
    files[LIVE + '/runs/' + KEY + '--' + PLAIN_ROOT + '.json'] = j(envelope({ host_today_usd: 1.25, runs: [], counts: { confirmed_live: 0, exited: 0, unknown: 0, fresh_bound_s: 30 } }, PLAIN_ROOT))
    world(on, files)
    await start($, surface)
    const header = await paneHeader($, surface)
    expect(header).toContain('host $1.25')
    expect(header).not.toContain('7.77')
  })

  test('band: the running count comes from the envelope counts, not from the rows (' + surface + ')', async ($, on) => {
    const files = base()
    files[LIVE + '/runs/' + KEY + '--' + ROOT + '.json'] = j(envelope({ runs: [row({ run_id: 'r1' })], counts: { confirmed_live: 5, exited: 0, unknown: 0, fresh_bound_s: 30 } }))
    world(on, files)
    await start($, surface)
    const text = await bandText($, surface)
    expect(text).toContain('進行中')
    expect(text).toContain('5 個派工在跑')
  })

  test('pane: fullscreen at 160 columns opens once; table, gate table, review link; no Image (' + surface + ')', async ($, on) => {
    const files = base()
    files[LIVE + '/review/server.json'] = j({ pid: 1, port: 9123, root: AHOME + '/review', started_at: PUBLISHED })
    files[AHOME + '/review/' + KEY + '/2026-10-04/' + ROOT + '/current/model.json'] = j(model())
    const w = world(on, files)
    await start($, surface)
    const band = await $.ui.mount({ plugin: 'autopilot', surface, component: 'AbovePrompt', props: BAND_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
    await w.clock.advance(5000)
    await w.clock.advance(5000)
    expect(w.opens.length).toBe(1)
    expect(w.opens[0]?.id).toBe('autopilot-live')
    // the unasked auto-open must never take the keyboard (it would steal the prompt)
    expect(w.opens[0]?.focus).toBeUndefined()
    expect(w.opens[0]?.closeOnEscape).toBeUndefined()
    await band.unmount()
    const pane = await paneOn($, surface, 'dispatch')
    expect((await pane.find({ type: 'Text', text: 'r1' }))).toBeDefined()
    expect((await pane.find({ type: 'Text', text: 'r3' }))).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'execution status, not progress' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'plan' })).toBeDefined() // gate table row from model.json
    const link = await pane.find({ type: 'Link' })
    expect(link?.props.href).toBe('http://localhost:9123/' + KEY + '/2026-10-04/' + ROOT + '/current/')
    expect(JSON.stringify(await pane.drawn())).not.toContain('"Image"')
    await pane.unmount()
  })

  // stage-graph P7d: the Review tab (plan-review state + the latest hetero-review-loop round, published by the watcher as <live>/runs/<key>.review.json)
  const reviewFact = (over: Record<string, unknown> = {}) => ({
    schema: 'autopilot.review/1', project_key: KEY, published_at: PUBLISHED,
    plan: {
      logical_plan_id: 'plan-x', generation: 2, max_generations: 2, terminal: false, verdict: 'CONDITIONAL',
      seats: [{ id: 'sol_chair', family: 'openai', status: 'STOP' }, { id: 'grok_deep', family: 'xai', status: 'CONDITIONAL' }], updated_at: PUBLISHED,
    },
    code: {
      phase: 'p7d', generation: 3, base: '1111111122222222', head: 'aaaaaaaabbbbbbbb', converged: false, at: PUBLISHED,
      seats: [{ id: 's0', family: 'minimax', status: 'reviewed', verdict: 'FIX-THEN-SHIP' }],
    },
    ...over,
  })
  const reviewTab = async ($: any, w: World, label = 'review') => {
    const pane = await $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-live', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
    await pane.press({ key: label })
    await pane.unmount()
    // the press only sets the tab and invalidates; the host then draws the pane again, which is a fresh mount here
    const again = await $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-live', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
    const tree = (await again.drawn()) as Node
    await again.unmount()
    return walkTexts(tree).map(textOf)
  }

  test('P7d review tab: plan-review generation, seats and verdict, and the latest code-review round render (' + surface + ')', async ($, on) => {
    const files = base()
    files[LIVE + '/runs/' + KEY + '.review.json'] = j(reviewFact())
    const w = world(on, files)
    await start($, surface)
    const texts = await reviewTab($, w)
    expect(texts).toContain('plan review · plan-x · gen 2/2 · active · CONDITIONAL')
    expect(texts).toContain('  sol_chair · openai · STOP')
    expect(texts).toContain('  grok_deep · xai · CONDITIONAL')
    expect(texts).toContain('code review · p7d · R3 · 11111111..aaaaaaaa · open')
    expect(texts).toContain('  s0 · minimax · reviewed · FIX-THEN-SHIP')
    expect(texts).not.toContain('no data · no review published')
    expect(texts.some(t => t.includes(' r1 ') || t.startsWith('r1'))).toBe(false) // the dispatch table is the other tab
  })

  test('P7d review tab: a terminal plan review and a converged round are worded as such (' + surface + ')', async ($, on) => {
    const files = base()
    files[LIVE + '/runs/' + KEY + '.review.json'] = j(reviewFact({
      plan: { logical_plan_id: 'plan-y', generation: 1, max_generations: 2, terminal: true, verdict: 'GO', seats: [], updated_at: PUBLISHED },
      code: { phase: 'p1', generation: 1, base: null, head: null, converged: true, at: PUBLISHED, seats: [] },
    }))
    const w = world(on, files)
    await start($, surface)
    const texts = await reviewTab($, w)
    expect(texts).toContain('plan review · plan-y · gen 1/2 · terminal · GO')
    expect(texts).toContain('  no seat verdicts yet')
    expect(texts).toContain('code review · p1 · R1 · —..— · converged')
  })

  test('P7d review tab: no review file is "no review"; a file of another project or schema is no review either (' + surface + ')', async ($, on) => {
    const files = base()
    const w = world(on, files)
    await start($, surface)
    expect(await reviewTab($, w)).toContain('no data · no review published')
    w.files[LIVE + '/runs/' + KEY + '.review.json'] = j(reviewFact({ project_key: OTHER_KEY }))
    await w.clock.advance(5000)
    expect(await reviewTab($, w)).toContain('no data · no review published')
    w.files[LIVE + '/runs/' + KEY + '.review.json'] = j(reviewFact({ schema: 'autopilot.review/9' }))
    await w.clock.advance(5000)
    expect(await reviewTab($, w)).toContain('no data · no review published')
  })

  if (surface === 'terminal') {
    test('P7d model: the band review slot is R<n> ⟲ (code round first, else plan generation); no review = no slot', () => {
      const fact = (over: Record<string, unknown>) => readReview(JSON.stringify({ schema: 'autopilot.review/1', project_key: KEY, ...over }), KEY)
      const plan = { logical_plan_id: 'p', generation: 2, max_generations: 2, terminal: false, verdict: null, seats: [], updated_at: null }
      const code = { phase: 'x', generation: 4, base: null, head: null, converged: false, at: null, seats: [] }
      expect(reviewSlot(fact({ plan, code }))).toBe('R4 ⟲')
      expect(reviewSlot(fact({ plan }))).toBe('R2 ⟲')
      expect(reviewSlot(fact({ code }))).toBe('R4 ⟲')
      expect(reviewSlot(null)).toBe(null)
      expect(fact({})).toBe(null)
      expect(readReview(JSON.stringify({ schema: 'autopilot.review/1', project_key: OTHER_KEY, plan }), KEY)).toBe(null)
      expect(readReview('{not json', KEY)).toBe(null)
    })
  }

  test('P7d review tab: the dispatch tab holds the rows (the default is Now) and the tab strip is Buttons, not Text (' + surface + ')', async ($, on) => {
    const files = base()
    files[LIVE + '/runs/' + KEY + '.review.json'] = j(reviewFact())
    const w = world(on, files)
    await start($, surface)
    const parts = await paneParts($, surface)
    expect(parts.texts).not.toContain('no data · no review published')
    expect(parts.texts.some(t => t.startsWith('plan review'))).toBe(false)
    expect(parts.texts.some(t => t.startsWith('r1'))).toBe(true)
    expect(JSON.stringify(parts.tree)).toContain('"Button"')
  })

  test('pane: 100 columns never opens a pane; no server.json falls back to port 8787 (' + surface + ')', async ($, on) => {
    const files = base()
    files[AHOME + '/review/' + KEY + '/2026-10-04/' + ROOT + '/current/model.json'] = j(model())
    const w = world(on, files)
    await start($, surface)
    const band = await $.ui.mount({ plugin: 'autopilot', surface, component: 'AbovePrompt', props: BAND_PROPS, viewport: { columns: 100, rows: 50, isFullscreen: true } })
    await w.clock.advance(5000)
    await w.clock.advance(5000)
    expect(w.opens.length).toBe(0)
    await band.unmount()
    // not fullscreen at 200 columns: still no pane
    const band2 = await $.ui.mount({ plugin: 'autopilot', surface, component: 'AbovePrompt', props: BAND_PROPS, viewport: { columns: 200, rows: 50, isFullscreen: false } })
    await w.clock.advance(5000)
    expect(w.opens.length).toBe(0)
    await band2.unmount()
    const pane = await paneOn($, surface, 'dispatch')
    expect((await pane.find({ type: 'Link' }))?.props.href).toBe('http://localhost:8787/' + KEY + '/2026-10-04/' + ROOT + '/current/')
    await pane.unmount()
  })

  test('pane: without a job page the link goes to the project index, and states render as text (' + surface + ')', async ($, on) => {
    const files = base()
    const w = world(on, files)
    await start($, surface)
    const pane = await paneOn($, surface, 'dispatch')
    expect((await pane.find({ type: 'Link' }))?.props.href).toBe('http://localhost:8787/' + KEY + '/')
    await pane.unmount()
    delete w.files[LIVE + '/runs/' + KEY + '--' + ROOT + '.json']
    await w.clock.advance(5000)
    const pane2 = await $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-live', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
    expect(await pane2.find({ type: 'Text', text: 'unavailable' })).toBeDefined()
    expect(await pane2.find({ type: 'Link' })).toBeUndefined()
    await pane2.unmount()
  })

  test('toast: one on an execution-axis change, one on an acceptance-axis change, none when nothing changed (' + surface + ')', async ($, on) => {
    const files = base()
    files[AHOME + '/review/' + KEY + '/2026-10-04/' + ROOT + '/current/model.json'] = j(model())
    const w = world(on, files)
    await start($, surface)
    expect(w.toasts).toEqual([]) // first snapshot: nothing to compare with
    await w.clock.advance(5000)
    expect(w.toasts).toEqual([]) // unchanged
    w.files[LIVE + '/runs/' + KEY + '--' + ROOT + '.json'] = j(envelope({ counts: { confirmed_live: 1, exited: 2, unknown: 0, fresh_bound_s: 30 }, published_at: '2026-10-04T10:00:25.000Z' }))
    await w.clock.advance(5000)
    expect(w.toasts.length).toBe(1)
    expect(w.toasts[0]).toContain('execution axis')
    expect(w.toasts[0]).toContain('RUNNING 2→1')
    expect(w.toasts[0]).toContain('EXITED 1→2')
    w.files[AHOME + '/review/' + KEY + '/2026-10-04/' + ROOT + '/current/model.json'] = j(model({ axes: { execution: { running: 1, exited: 2, unknown: 0 }, acceptance: 'accepted', can_close: true } }))
    await w.clock.advance(5000)
    expect(w.toasts.length).toBe(2)
    expect(w.toasts[1]).toContain('acceptance axis')
    expect(w.toasts[1]).toContain('PENDING → ACCEPTED')
    await w.clock.advance(5000)
    expect(w.toasts.length).toBe(2) // no repeat
  })

  test('toast: execution and acceptance changes in one tick are two toasts, one per axis (' + surface + ')', async ($, on) => {
    const files = base()
    files[AHOME + '/review/' + KEY + '/2026-10-04/' + ROOT + '/current/model.json'] = j(model())
    const w = world(on, files)
    await start($, surface)
    w.files[LIVE + '/runs/' + KEY + '--' + ROOT + '.json'] = j(envelope({ counts: { confirmed_live: 0, exited: 3, unknown: 0, fresh_bound_s: 30 }, published_at: '2026-10-04T10:00:25.000Z' }))
    w.files[AHOME + '/review/' + KEY + '/2026-10-04/' + ROOT + '/current/model.json'] = j(model({ axes: { execution: { running: 0, exited: 3, unknown: 0 }, acceptance: 'rejected', can_close: false } }))
    await w.clock.advance(5000)
    expect(w.toasts.length).toBe(2)
    expect(w.toasts.filter(t => t.includes('execution axis')).length).toBe(1)
    expect(w.toasts.filter(t => t.includes('acceptance axis')).length).toBe(1)
  })

  // ---- mods P1c C3: the band answers project / phase / elapsed / progress with a verdict word ----
  const ENV_PATH = LIVE + '/runs/' + KEY + '--' + ROOT + '.json'
  const MODEL_PATH = AHOME + '/review/' + KEY + '/2026-10-04/' + ROOT + '/current/model.json'
  const VERDICTS = ['要你決定', '疑似卡住', '完成待驗收', '進行中', '待命']
  const verdictsIn = (t: string) => VERDICTS.filter(v => t.includes(v))
  const quietCounts = (live: number) => ({ confirmed_live: live, exited: 1, unknown: 0, fresh_bound_s: 30 })
  const exitedRow = () => row({ run_id: 'r9', phase: 'exited', alive: false, rc: 0, final_status: 'done' })
  const DECISION = { question: '要合併 plan 還是拆開？', options: [{ label: '合併', consequence: '一次驗收' }, { label: '拆開', consequence: '兩次驗收' }], not_authorized: null }
  const FROZEN_DONE = { frozen: true, percent: 100, done: 8, total: 8 }
  // everything the four verdicts are made of lives in two files; this puts both in place
  const put = (files: Tree, env: Record<string, unknown> | null, mdl: Record<string, unknown> | null) => {
    if (env) files[ENV_PATH] = j(envelope(env))
    if (mdl) files[MODEL_PATH] = j(model(mdl))
  }

  test('verdict 要你決定: the loudest word, wins over a stalled run, reason is the decision question (' + surface + ')', async ($, on) => {
    const files = base() // base() has a stalled row
    put(files, null, { needs_decision: true, decision: DECISION })
    world(on, files)
    await start($, surface)
    const p = await bandParts($, surface)
    expect(p.line1).toBe('▲ 要你決定 repo · — · 10m · —')
    expect(p.line2).toBe('要合併 plan 還是拆開？')
    const lead = walkTexts(p.tree).find(n => /^[▲⏸✓●◌]/.test(textOf(n))) as Node
    expect(lead.props?.bold).toBe(true) // the word is drawn loud, not dim
    expect(lead.props?.dimColor).not.toBe(true)
  })

  test('verdict 疑似卡住: from the envelope stall flag; the reason names the quietest dispatch in minutes (' + surface + ')', async ($, on) => {
    const files = base()
    put(files, { runs: [row({ run_id: 'r1' }), row({ run_id: 'r2', stall: true, last_event_age_s: 600 }), row({ run_id: 'r3', stall: true, last_event_age_s: 1800 })] }, null)
    const w = world(on, files)
    await start($, surface)
    let p = await bandParts($, surface)
    expect(p.line1.startsWith('⏸ 疑似卡住 repo')).toBe(true)
    expect(p.line2).toBe('最久的派工 30m 沒有輸出')
    put(w.files, { runs: [row({ run_id: 'r1', stall: true })] }, null) // no age published: say what is known, no number
    await w.clock.advance(5000)
    p = await bandParts($, surface)
    expect(p.line2).toBe('有 1 個派工疑似沒有輸出')
  })

  test('verdict 完成待驗收: nothing live, progress frozen at done = total, acceptance not yet decided (' + surface + ')', async ($, on) => {
    const files = base()
    put(files, { runs: [exitedRow()], counts: quietCounts(0) }, { progress: FROZEN_DONE })
    const w = world(on, files)
    await start($, surface)
    const p = await bandParts($, surface)
    expect(p.line1).toBe('✓ 完成待驗收 repo · — · 10m · 100%（8/8）')
    expect(p.line2).toBe('驗收結論尚未出')
    const none = async (why: string) => {
      await w.clock.advance(5000)
      const t = await bandText($, surface)
      expect(verdictsIn(t), why).toEqual(['待命'])
    }
    put(w.files, null, { progress: FROZEN_DONE, axes: { execution: { running: 0, exited: 1, unknown: 0 }, acceptance: 'accepted', can_close: true } })
    await none('accepted is not waiting')
    put(w.files, null, { progress: FROZEN_DONE, axes: { execution: { running: 0, exited: 1, unknown: 0 }, acceptance: 'rejected', can_close: false } })
    await none('rejected is not waiting')
    put(w.files, null, { progress: { frozen: false, percent: null, done: 8, total: null } })
    await none('an unfrozen denominator is never "complete"')
    put(w.files, null, { progress: { frozen: false, percent: null, done: 8, total: 8 } })
    await none('an unfrozen flag is never "complete", whatever the counts say')
    put(w.files, null, { progress: { frozen: true, percent: 62.5, done: 5, total: 8 } })
    await none('done < total is not complete')
    w.files[MODEL_PATH] = j(model({ progress: FROZEN_DONE }))
    put(w.files, { runs: [row({ run_id: 'r1' })], counts: quietCounts(1) }, null)
    await w.clock.advance(5000)
    expect((await bandText($, surface))).toContain('進行中') // something is live again
    expect(verdictsIn(await bandText($, surface))).toEqual(['進行中'])
  })

  test('verdict 進行中: confirmed-live runs and nothing louder (' + surface + ')', async ($, on) => {
    const files = base()
    put(files, { runs: [row({ run_id: 'r1' }), row({ run_id: 'r2' })], counts: quietCounts(2) }, null)
    world(on, files)
    await start($, surface)
    const p = await bandParts($, surface)
    expect(p.line1).toBe('● 進行中 repo · — · 10m · —')
    expect(p.line2).toBe('2 個派工在跑')
  })

  test('verdict precedence: needs_decision > stalled > waiting acceptance > running (' + surface + ')', async ($, on) => {
    const files = base()
    // every condition holds at once: a decision is pending, a row stalls, nothing live, frozen complete, acceptance open
    put(files, { runs: [row({ run_id: 'r2', stall: true, last_event_age_s: 300 })], counts: quietCounts(0) }, { needs_decision: true, decision: DECISION, progress: FROZEN_DONE })
    const w = world(on, files)
    await start($, surface)
    expect(verdictsIn(await bandText($, surface))).toEqual(['要你決定'])
    put(w.files, null, { needs_decision: false, decision: null, progress: FROZEN_DONE }) // the decision is gone
    await w.clock.advance(5000)
    expect(verdictsIn(await bandText($, surface))).toEqual(['疑似卡住'])
    put(w.files, { runs: [exitedRow()], counts: quietCounts(0) }, null) // the stall is gone
    await w.clock.advance(5000)
    expect(verdictsIn(await bandText($, surface))).toEqual(['完成待驗收'])
    put(w.files, { runs: [row({ run_id: 'r1' })], counts: quietCounts(1) }, null) // a run is live
    await w.clock.advance(5000)
    expect(verdictsIn(await bandText($, surface))).toEqual(['進行中'])
    put(w.files, { runs: [exitedRow()], counts: quietCounts(0) }, { progress: null }) // nothing live, awaited or complete
    await w.clock.advance(5000)
    expect(verdictsIn(await bandText($, surface))).toEqual(['待命']) // the idle word comes last
  })

  test('verdict 待命: nothing live, nothing awaited, not frozen-complete; the fifth word, last in precedence (' + surface + ')', async ($, on) => {
    const files = base()
    put(files, { runs: [exitedRow()], counts: quietCounts(0) }, { progress: { frozen: true, percent: 62.5, done: 5, total: 8 } })
    const w = world(on, files)
    await start($, surface)
    const p = await bandParts($, surface)
    expect(p.line1).toBe('◌ 待命 repo · — · 10m · 62.5%（5/8）')
    expect(p.line2).toBe('沒有派工在跑')
    expect(p.line1).not.toContain('○')
    const lead = walkTexts(p.tree).find(n => /^[▲⏸✓●◌]/.test(textOf(n))) as Node
    expect(lead.props?.bold).not.toBe(true) // idle is drawn plain
    // no job page at all: still the idle word, with an em dash progress
    delete w.files[MODEL_PATH]
    await w.clock.advance(5000)
    expect((await bandParts($, surface)).line1).toBe('◌ 待命 repo · — · 10m · —')
    // every other word beats it, one at a time
    put(w.files, { runs: [row({ run_id: 'r1' })], counts: quietCounts(1) }, null)
    await w.clock.advance(5000)
    expect(verdictsIn(await bandText($, surface))).toEqual(['進行中'])
    put(w.files, { runs: [row({ run_id: 'r2', stall: true })], counts: quietCounts(0) }, null)
    await w.clock.advance(5000)
    expect(verdictsIn(await bandText($, surface))).toEqual(['疑似卡住'])
    put(w.files, { runs: [exitedRow()], counts: quietCounts(0) }, { needs_decision: true, decision: DECISION })
    await w.clock.advance(5000)
    expect(verdictsIn(await bandText($, surface))).toEqual(['要你決定'])
    put(w.files, null, { needs_decision: false, decision: null, progress: FROZEN_DONE })
    await w.clock.advance(5000)
    expect(verdictsIn(await bandText($, surface))).toEqual(['完成待驗收'])
  })

  test('progress: frozen shows the percent and the done/total; unfrozen shows "n done*", dim, never a percent (' + surface + ')', async ($, on) => {
    const files = base()
    put(files, null, { progress: { frozen: true, percent: 62.5, done: 5, total: 8 } })
    const w = world(on, files)
    await start($, surface)
    let p = await bandParts($, surface)
    expect(p.line1.endsWith('· 62.5%（5/8）')).toBe(true)
    expect(p.last?.props?.dimColor).not.toBe(true)
    put(w.files, null, { progress: { frozen: false, percent: null, done: 3, total: null } })
    await w.clock.advance(5000)
    p = await bandParts($, surface)
    expect(p.line1.endsWith('· 3 done*')).toBe(true)
    expect(p.line1).not.toContain('%')
    expect(p.last?.props?.dimColor).toBe(true)
    // a percent that arrives next to an unfrozen flag is not shown either
    put(w.files, null, { progress: { frozen: false, percent: 37.5, done: 3, total: 8 } })
    await w.clock.advance(5000)
    p = await bandParts($, surface)
    expect(p.line1.endsWith('· 3 done*')).toBe(true)
    expect(p.line1).not.toContain('%')
    expect(p.last?.props?.dimColor).toBe(true)
    // a frozen flag without a usable percent / total is not trusted: the percent is not invented
    put(w.files, null, { progress: { frozen: true, percent: null, done: 3, total: null } })
    await w.clock.advance(5000)
    p = await bandParts($, surface)
    expect(p.line1).not.toContain('%')
    expect(p.line1.endsWith('· 3 done*')).toBe(true)
  })

  test('progress: no job model, no progress, or no count is an em dash, never 0 and never a percent (' + surface + ')', async ($, on) => {
    const files = base() // no model.json
    const w = world(on, files)
    await start($, surface)
    let p = await bandParts($, surface)
    expect(p.line1.endsWith('· —')).toBe(true)
    expect(p.line1).not.toContain('%')
    put(w.files, null, { progress: null })
    await w.clock.advance(5000)
    p = await bandParts($, surface)
    expect(p.line1.endsWith('· —')).toBe(true)
    put(w.files, null, { progress: { frozen: false, percent: null, done: null, total: null } })
    await w.clock.advance(5000)
    p = await bandParts($, surface)
    expect(p.line1.endsWith('· —')).toBe(true)
    expect(p.line1).not.toMatch(/ 0( |$)/)
    expect(p.line1).not.toContain('*')
  })

  test('phase: the job model phase label is shown; absent or malformed is an em dash; the process phase is never shown (' + surface + ')', async ($, on) => {
    const files = base() // rows carry phase "running" / "exited"
    put(files, null, { progress: { frozen: true, percent: 62.5, done: 5, total: 8 } })
    const w = world(on, files)
    await start($, surface)
    let p = await bandParts($, surface)
    expect(p.line1.split(' · ')[1]).toBe('—') // no phase field: an em dash
    expect(p.line1).not.toMatch(/running|exited/)
    const shown = async (phase: unknown) => {
      put(w.files, null, { progress: { frozen: true, percent: 62.5, done: 5, total: 8 }, phase })
      await w.clock.advance(5000)
      return (await bandParts($, surface)).line1.split(' · ')[1]
    }
    expect(await shown({ code: 'REVIEWING', label: '審查', source: 'campaign' })).toBe('審查')
    expect(await shown({ code: 'c', label: '做 c', source: 'deliverable' })).toBe('做 c')
    expect(await shown(null)).toBe('—')
    expect(await shown('審查')).toBe('—') // a bare string is not the published shape
    expect(await shown({ code: 'X' })).toBe('—') // no label
    expect(await shown({ label: 5 })).toBe('—') // label is not a string
    expect(await shown({ label: '' })).toBe('—')
    p = await bandParts($, surface)
    expect(p.line1).not.toMatch(/running|exited/)
  })

  test('project: short name from scope.repo_identity, hex8 of the project key for any odd shape (' + surface + ')', async ($, on) => {
    const cases: [string | null, string][] = [
      ['git-common-dir:/work/repo/.git', 'repo'],
      ['git-common-dir:/home/u/projects/autopilot/.git', 'autopilot'], // a linked worktree reports its main repo's common dir
      ['git-common-dir:/work/repo/.git/', 'repo'],
      ['git-common-dir:/srv/git/bare-repo.git', KEY.slice(0, 8)], // bare repo: no ".git" directory segment
      ['git-common-dir:/work/repo/.git/worktrees/wt', KEY.slice(0, 8)],
      ['git-common-dir:/.git', KEY.slice(0, 8)],
      ['/work/repo', KEY.slice(0, 8)], // no prefix
      ['', KEY.slice(0, 8)],
      [null, KEY.slice(0, 8)],
    ]
    const w = world(on, base())
    await start($, surface)
    for (const [identity, want] of cases) {
      w.files[ENV_PATH] = j(envelope({ scope: { project_key: KEY, repo_identity: identity, root_run_id: ROOT } }))
      await w.clock.advance(5000)
      const p = await bandParts($, surface)
      expect(p.line1.split(' · ')[0], String(identity)).toBe('⏸ 疑似卡住 ' + want)
    }
  })

  test('elapsed: now minus the earliest start in the scope, 38m / 2h14m / 1d3h, an em dash when no run has a start (' + surface + ')', async ($, on) => {
    const ago = (s: number) => new Date(NOW_FRESH - s * 1000).toISOString()
    const at = (s: number) => row({ run_id: 'r' + s, started_at: ago(s), fact_at: ago(s) })
    const cases: [unknown[], string][] = [
      [[at(38 * 60)], '38m'],
      [[at(2 * 3600 + 14 * 60 + 5)], '2h14m'],
      [[at(27 * 3600 + 59)], '1d3h'],
      [[at(59 * 60 + 5)], '59m'],
      [[at(3600)], '1h0m'],
      [[at(5)], '0m'],
      [[at(600), at(2 * 3600 + 14 * 60), at(1200)], '2h14m'], // the earliest one, whatever the order
      [[row({ run_id: 'x', started_at: null, fact_at: null })], '—'],
      [[], '—'],
    ]
    const w = world(on, base())
    await start($, surface)
    for (const [runs, want] of cases) {
      w.files[ENV_PATH] = j(envelope({ runs, counts: quietCounts(1) }))
      await w.clock.advance(5000)
      const p = await bandParts($, surface)
      // the mocked clock moved 5 s per case: compare on the minute grid the cases were built for
      expect(p.line1.split(' · ')[2], JSON.stringify(runs).slice(0, 60)).toBe(want)
    }
  })

  test('cost and context moved to the pane header and are not in the band (' + surface + ')', async ($, on) => {
    world(on, base())
    await start($, surface)
    const text = await bandText($, surface)
    expect(text).not.toMatch(/\$|ctx|host|session/)
    const pane = await paneParts($, surface)
    expect(pane.texts[0]).toBe('session $0.42 · host $3.10 · ctx 37%')
  })

  test('pane: when a decision is awaited it is the first section, built from the model decision; the Link stays (' + surface + ')', async ($, on) => {
    const files = base()
    put(files, null, { needs_decision: true, decision: DECISION })
    const w = world(on, files)
    await start($, surface)
    let pane = await paneParts($, surface, 'now')
    expect(pane.texts[0]).toBe('session $0.42 · host $3.10 · ctx 37%') // the header row stays on top
    const at = pane.texts.indexOf('要你決定') // P7: the awaited decision moved from the Dispatch tab to Now
    expect(at).toBeGreaterThan(0)
    expect(pane.texts.slice(at, at + 4)).toEqual(['要你決定', '要合併 plan 還是拆開？', '1. 合併 — 一次驗收', '2. 拆開 — 兩次驗收'])
    const disp = await paneParts($, surface, 'dispatch') // the table is still there, on its own tab, and so is the Link
    expect(disp.texts.some(t => t.includes('execution status, not progress'))).toBe(true)
    expect(disp.texts.some(t => t.includes('gates'))).toBe(true)
    expect(disp.texts).not.toContain('要你決定')
    expect(disp.href).toBe('http://localhost:8787/' + KEY + '/2026-10-04/' + ROOT + '/current/')
    // fields that do not exist are not shown: a question with no options, then no decision at all
    put(w.files, null, { needs_decision: true, decision: { question: '只有問題', options: [], not_authorized: null } })
    await w.clock.advance(5000)
    pane = await paneParts($, surface, 'now')
    const at2 = pane.texts.indexOf('要你決定')
    expect(pane.texts.slice(at2, at2 + 2)).toEqual(['要你決定', '只有問題'])
    expect(pane.texts[at2 + 2]).not.toMatch(/^\d\. /)
    put(w.files, null, { needs_decision: false, decision: null })
    await w.clock.advance(5000)
    pane = await paneParts($, surface, 'now')
    expect(pane.texts).not.toContain('要你決定')
  })
}

// ---- mods P1W W3a: the mod reads every wired source (tasks, attention, phase, decisions sidecar, foreman, manifest) ----
const DECISION_W = { question: '要合併 plan 還是拆開？', options: [{ label: '合併', consequence: '一次驗收' }, { label: '拆開', consequence: '兩次驗收' }], not_authorized: null }
const SID_RAW = 'sid/with:odd chars'
const SID_FILE = 'sid_with_odd_chars' // sanitizeSessionId: every scalar outside [A-Za-z0-9_-] becomes one "_"
const SCOPE_KEY = KEY + '--' + ROOT
const P_TASKS = (sid = SID_A) => LIVE + '/tasks/' + sid + '.json'
const P_TURN = (sid = SID_A) => LIVE + '/turn/' + sid + '.json'
const P_TURN_EFF = (sid = SID_A) => LIVE + '/turn-effective/' + sid + '.json'
const P_ATT = (sid = SID_A) => LIVE + '/attention/' + sid + '.json'
const P_DEC = LIVE + '/runs/' + SCOPE_KEY + '.decisions.json'
const P_FOREMAN = LIVE + '/runs/' + SCOPE_KEY + '.foreman.json'
const P_SOURCES = LIVE + '/runs/sources/' + SCOPE_KEY + '.json'
const W_MODEL = AHOME + '/review/' + KEY + '/2026-10-04/' + ROOT + '/current/model.json'
const W_ENV = LIVE + '/runs/' + SCOPE_KEY + '.json'
const COMMON = '/work/repo/.git'

function tasksFile(over: Record<string, unknown> = {}, sid = SID_A) {
  return {
    schema: 'autopilot.session-tasks/1', session_id: sid, cwd: CWD, project_key: KEY, updated_at: '2026-10-04T10:00:10.000Z',
    first_created_at: '2026-10-04T09:30:00.000Z',
    tasks: [{ id: '1', subject: '寫測試', status: 'completed', started_seq: 1 }, { id: '2', subject: '接線', status: 'in_progress', started_seq: 2 }, { id: '3', subject: '收尾', status: 'pending', started_seq: null }],
    counts: { total: 3, completed: 1, in_progress: 1 }, current: { id: '2', subject: '接線' },
    ...over,
  }
}
const allDone = () => tasksFile({
  tasks: [{ id: '1', subject: 'a', status: 'completed', started_seq: 1 }, { id: '2', subject: 'b', status: 'completed', started_seq: 2 }],
  counts: { total: 2, completed: 2, in_progress: 0 }, current: null,
})
function turn(state: string, over: Record<string, unknown> = {}, sid = SID_A) {
  return { schema: 'autopilot.session-turn/1', session_id: sid, state, since: '2026-10-04T09:57:30.000Z', project_key: KEY, root_run_id: null, ...over }
}
function attention(kind: string, over: Record<string, unknown> = {}, sid = SID_A) {
  return { schema: 'autopilot.attention/1', session_id: sid, project_key: KEY, kind, tool_name: kind === 'permission' ? 'Bash' : null, summary: kind === 'idle' ? 'waiting for your input' : 'Bash: rm -rf build', since: '2026-10-04T09:55:30.000Z', updated_at: '2026-10-04T09:55:30.000Z', ...over }
}
function decisionsSidecar(over: Record<string, unknown> = {}, scope: Record<string, unknown> = {}) {
  return {
    schema: 'autopilot.decisions-sidecar/1', scope: { project_key: KEY, repo_identity: 'git-common-dir:' + COMMON, root_run_id: ROOT, ...scope },
    rows: [
      { round: 1, decision: '先拆 plan 再實作', irreversible: false, at: '2026-10-04T09:40:00.000Z', writer: 'engine', kind: 'decision', decision_id: 'd-1', source: 'ledger_default' },
      { round: 2, decision: '刪掉舊分支', irreversible: true, at: '2026-10-04T09:45:00.000Z', writer: 'engine', kind: 'decision', decision_id: 'd-2', source: 'ledger_root' },
    ],
    count: 2, irreversible_count: 1, writers_wired: ['engine', 'next-pick'], undocumented_dispatches: 0, ...over,
  }
}
function foremanSidecar(over: Record<string, unknown> = {}, scope: Record<string, unknown> = {}) {
  return {
    schema: 'autopilot.foreman-activity/1', scope: { project_key: KEY, repo_identity: 'git-common-dir:' + COMMON, root_run_id: ROOT, ...scope },
    binding: 'session', stall_s: 600,
    agents: [
      { agent_id: 'a1', description: '修 parser', label: 'running', last_activity_at: '2026-10-04T10:00:00.000Z', age_s: 30, stale: false, source: 'context_tasks', session_id: SID_A, binding: 'session' },
      { agent_id: 'a2', description: null, label: 'last tool: Bash', last_activity_at: '2026-10-04T09:40:00.000Z', age_s: 1230, stale: true, source: 'stamp', session_id: SID_A, binding: 'session' },
    ],
    stage: 'implement', stage_source: 'run_ledger:tmp', stage_at: '2026-10-04T09:59:00.000Z', stage_age_s: 90, ...over,
  }
}
type SrcState = Record<string, { installed: boolean; enabled: boolean }>
const ALL_ON: SrcState = Object.fromEntries(['tasks', 'attention', 'decision', 'ledger_engine', 'ledger_depth0', 'stage', 'compare', 'task_status_input', 'context', 'progress'].map(k => [k, { installed: true, enabled: true }]))
function manifest(over: SrcState = {}, scope: Record<string, unknown> = {}) {
  const sources: Record<string, unknown> = {}
  for (const [k, v] of Object.entries({ ...ALL_ON, ...over })) sources[k] = { ...v, how: 'x' }
  return { schema: 'autopilot.sources/1', scope: { project_key: KEY, root_run_id: ROOT, ...scope }, sources }
}
const OFF = { installed: false, enabled: false }
const REC = (root: string, issued: string, top: Record<string, unknown> = {}) => ({
  root_run_id: root, controller: { progress_receipts: [{ artifact_type: 'controller_progress_receipt', root_run_id: root, issued_at: issued, generation: 1 }] }, ...top,
})
const VERDICTS5 = ['要你決定', '疑似卡住', '完成待驗收', '進行中', '待命']
const verdicts = (t: string) => VERDICTS5.filter(v => t.includes(v))
const quiet = (live: number) => ({ confirmed_live: live, exited: 1, unknown: 0, fresh_bound_s: 30 })
const exitedRun = () => row({ run_id: 'r9', phase: 'exited', alive: false, rc: 0, final_status: 'done' })
const quietWorld = (): Tree => { const f = base(); f[W_ENV] = j(envelope({ runs: [exitedRun()], counts: quiet(0) })); return f }

for (const surface of SURFACES) {
  test('W3a attention: permission / question is 要你決定 over a stalled run; idle is not; the age comes from since (' + surface + ')', async ($, on) => {
    const files = base() // base() has a stalled row
    files[P_ATT()] = j(attention('permission'))
    const w = world(on, files)
    await start($, surface)
    let p = await bandParts($, surface)
    expect(p.line1).toBe('▲ 要你決定 repo · — · 10m · —')
    expect(p.line2).toBe('等你批准：Bash: rm -rf build（等了 5 分）')
    files[P_ATT()] = j(attention('question', { tool_name: 'AskUserQuestion', summary: '要拆開嗎？' }))
    await w.clock.advance(5000)
    p = await bandParts($, surface)
    expect(p.line2).toBe('等你回答：要拆開嗎？（等了 5 分）')
    // idle never means 要你決定: the stalled run speaks again
    files[P_ATT()] = j(attention('idle'))
    await w.clock.advance(5000)
    expect(verdicts(await bandText($, surface))).toEqual(['疑似卡住'])
    // another session's attention file never reaches this band
    delete files[P_ATT()]
    files[P_ATT(SID_B)] = j(attention('permission', {}, SID_B))
    await w.clock.advance(5000)
    expect(verdicts(await bandText($, surface))).toEqual(['疑似卡住'])
    // a file of a different schema is absent
    files[P_ATT()] = j({ ...attention('permission'), schema: 'other/1' })
    await w.clock.advance(5000)
    expect(verdicts(await bandText($, surface))).toEqual(['疑似卡住'])
  })

  test('W3a attention: an idle session in a quiet world is 待命 with 停在等你指示 N 分 appended; a live run keeps 進行中 without it (' + surface + ')', async ($, on) => {
    const files = quietWorld()
    files[P_ATT()] = j(attention('idle', { since: '2026-10-04T09:57:30.000Z' }))
    const w = world(on, files)
    await start($, surface)
    const p = await bandParts($, surface)
    expect(p.line1).toBe('◌ 待命 repo · — · 10m · —')
    expect(p.line2).toBe('沒有派工在跑 · 停在等你指示 3 分')
    files[W_ENV] = j(envelope({ runs: [row({ run_id: 'r1' })], counts: quiet(1) }))
    await w.clock.advance(5000)
    expect((await bandParts($, surface)).line2).toBe('1 個派工在跑')
  })

  test('GATEFIX 進行中: a session task in_progress is 進行中 with no run; 待命 only with no live run and no task in progress; 完成待驗收 needs no live run (' + surface + ')', async ($, on) => {
    const files = quietWorld()
    files[P_TASKS()] = j(tasksFile()) // 1 in_progress, no live run
    const w = world(on, files)
    await start($, surface)
    let p = await bandParts($, surface)
    expect(p.line1.startsWith('● 進行中 repo')).toBe(true)
    expect(p.line2).toBe('任務進行中：接線')
    // the idle attention (turn ended) does not turn an in-progress task into 待命: the ruling is task in_progress OR a live run
    files[P_ATT()] = j(attention('idle'))
    await w.clock.advance(5000)
    expect(verdicts(await bandText($, surface))).toEqual(['進行中'])
    delete files[P_ATT()]
    // a live run: still 進行中, the reason names the run
    files[W_ENV] = j(envelope({ runs: [row({ run_id: 'r1' })], counts: quiet(1) }))
    await w.clock.advance(5000)
    expect((await bandParts($, surface)).line2).toBe('1 個派工在跑')
    files[W_ENV] = j(envelope({ runs: [exitedRun()], counts: quiet(0) }))
    // pending only (nothing started): 待命
    files[P_TASKS()] = j(tasksFile({ tasks: [{ id: '1', subject: 'a', status: 'pending', started_seq: null }], counts: { total: 1, completed: 0, in_progress: 0 }, current: null }))
    await w.clock.advance(5000)
    expect(verdicts(await bandText($, surface))).toEqual(['待命'])
    // every task completed and a live run in scope: 進行中, not 完成待驗收 (same for a frozen done = total)
    files[P_TASKS()] = j(allDone())
    files[W_ENV] = j(envelope({ runs: [row({ run_id: 'r1' })], counts: quiet(1) }))
    await w.clock.advance(5000)
    expect(verdicts(await bandText($, surface))).toEqual(['進行中'])
    files[P_TASKS()] = j(tasksFile({ tasks: [], counts: { total: 0, completed: 0, in_progress: 0 }, current: null }))
    files[W_MODEL] = j(model({ progress: { frozen: true, percent: 100, done: 8, total: 8 } }))
    await w.clock.advance(5000)
    expect(verdicts(await bandText($, surface))).toEqual(['進行中'])
    // the live run ends: now it is complete and waiting
    files[W_ENV] = j(envelope({ runs: [exitedRun()], counts: quiet(0) }))
    await w.clock.advance(5000)
    expect(verdicts(await bandText($, surface))).toEqual(['完成待驗收'])
    // an in-progress task never outranks complete-and-waiting (precedence 完成待驗收 > 進行中)
    files[P_TASKS()] = j(tasksFile())
    await w.clock.advance(5000)
    expect(verdicts(await bandText($, surface))).toEqual(['完成待驗收'])
  })

  test('TURN: an active turn is 進行中 with 回合進行中（N 分）; ended or no file is 待命; permission outranks it; a stale or foreign file is ignored (' + surface + ')', async ($, on) => {
    const files = quietWorld()
    const w = world(on, files)
    await start($, surface)
    expect(verdicts(await bandText($, surface))).toEqual(['待命']) // no turn file, nothing going on
    files[P_TURN()] = j(turn('active')) // since 09:57:30, now 10:00:30 -> 3 min
    await w.clock.advance(5000)
    let p = await bandParts($, surface)
    expect(p.line1.startsWith('● 進行中 repo')).toBe(true)
    expect(p.line2).toBe('回合進行中（3 分）')
    files[P_TURN()] = j(turn('ended'))
    await w.clock.advance(5000)
    expect(verdicts(await bandText($, surface))).toEqual(['待命'])
    // an active turn with a task in progress: the task names itself; with a live run the run does
    files[P_TURN()] = j(turn('active'))
    files[P_TASKS()] = j(tasksFile())
    await w.clock.advance(5000)
    expect((await bandParts($, surface)).line2).toBe('任務進行中：接線')
    delete files[P_TASKS()]
    files[W_ENV] = j(envelope({ runs: [row({ run_id: 'r1' })], counts: quiet(1) }))
    await w.clock.advance(5000)
    expect((await bandParts($, surface)).line2).toBe('1 個派工在跑')
    files[W_ENV] = j(envelope({ runs: [exitedRun()], counts: quiet(0) }))
    // permission attention outranks an active turn (precedence unchanged)
    files[P_ATT()] = j(attention('permission'))
    await w.clock.advance(5000)
    p = await bandParts($, surface)
    expect(verdicts(await bandText($, surface))).toEqual(['要你決定'])
    delete files[P_ATT()]
    // an idle attention (written after Stop) with an active turn: the later prompt makes it 進行中 without the idle suffix
    files[P_ATT()] = j(attention('idle'))
    await w.clock.advance(5000)
    p = await bandParts($, surface)
    expect(p.line2).toBe('回合進行中（3 分）')
    delete files[P_ATT()]
    // stale (older than the 24 h marker TTL): ignored -> 待命
    files[P_TURN()] = j(turn('active', { since: '2026-10-03T09:00:00.000Z' }))
    await w.clock.advance(5000)
    expect(verdicts(await bandText($, surface))).toEqual(['待命'])
    // another session's file / another schema / bad state: absent
    files[P_TURN()] = j(turn('active', {}, SID_B))
    await w.clock.advance(5000)
    expect(verdicts(await bandText($, surface))).toEqual(['待命'])
    files[P_TURN()] = j({ ...turn('active'), schema: 'other/1' })
    await w.clock.advance(5000)
    expect(verdicts(await bandText($, surface))).toEqual(['待命'])
    files[P_TURN()] = j(turn('weird'))
    await w.clock.advance(5000)
    expect(verdicts(await bandText($, surface))).toEqual(['待命'])
    files[P_TURN(SID_B)] = j(turn('active', {}, SID_B))
    await w.clock.advance(5000)
    expect(verdicts(await bandText($, surface))).toEqual(['待命'])
  })

  test('GATEFIX2: an interrupted turn (watcher-owned turn-effective file, same since) reads 待命; a new turn, a foreign or malformed file does not (' + surface + ')', async ($, on) => {
    const files = quietWorld()
    const w = world(on, files)
    await start($, surface)
    const T = turn('active')
    const eff = (over: Record<string, unknown> = {}) => j({ schema: 'autopilot.session-turn-effective/1', session_id: SID_A, state: 'ended', reason: 'interrupted', turn_since: T.since, ...over })
    files[P_TURN()] = j(T)
    await w.clock.advance(5000)
    expect((await bandParts($, surface)).line2).toBe('回合進行中（3 分）')
    files[P_TURN_EFF()] = eff()
    await w.clock.advance(5000)
    expect(verdicts(await bandText($, surface))).toEqual(['待命'])
    // the user typed again: the hook's new active turn (new since) wins before the watcher cleans up
    files[P_TURN()] = j(turn('active', { since: '2026-10-04T10:00:00.000Z' }))
    await w.clock.advance(5000)
    expect((await bandParts($, surface)).line1.startsWith('● 進行中 repo')).toBe(true)
    files[P_TURN()] = j(T)
    files[P_TURN_EFF()] = eff({ session_id: SID_B })
    await w.clock.advance(5000)
    expect(verdicts(await bandText($, surface))).toEqual(['進行中'])
    files[P_TURN_EFF()] = eff({ schema: 'other/1' })
    await w.clock.advance(5000)
    expect(verdicts(await bandText($, surface))).toEqual(['進行中'])
    files[P_TURN_EFF()] = eff({ state: 'active' })
    await w.clock.advance(5000)
    expect(verdicts(await bandText($, surface))).toEqual(['進行中'])
    files[P_TURN_EFF()] = '{not json'
    await w.clock.advance(5000)
    expect(verdicts(await bandText($, surface))).toEqual(['進行中'])
  })

  test('W3a attention in the pane: the awaited thing is listed before the dispatch table (' + surface + ')', async ($, on) => {
    const files = base()
    files[P_ATT()] = j(attention('permission'))
    world(on, files)
    await start($, surface)
    const pane = await paneParts($, surface, 'now')
    const at = pane.texts.indexOf('要你決定') // P7: the attention lines moved from the Dispatch tab to Now
    expect(at).toBeGreaterThan(0)
    expect(pane.texts[at + 1]).toBe('等你批准：Bash: rm -rf build（等了 5 分）')
    expect((await paneParts($, surface, 'dispatch')).texts).not.toContain('要你決定')
  })

  test('W3a decision age: a stale open decision shows 已等 N 天 in band and pane; a fresh one does not (' + surface + ')', async ($, on) => {
    const files = base()
    files[W_MODEL] = j(model({ needs_decision: true, decision: { ...DECISION_W, stale: true, age_s: 3 * 86400 + 5 } }))
    const w = world(on, files)
    await start($, surface)
    expect((await bandParts($, surface)).line2).toBe('要合併 plan 還是拆開？（已等 3 天）')
    expect((await paneParts($, surface, 'now')).texts).toContain('要合併 plan 還是拆開？（已等 3 天）')
    files[W_MODEL] = j(model({ needs_decision: true, decision: { ...DECISION_W, stale: false, age_s: 40 } }))
    await w.clock.advance(5000)
    expect((await bandParts($, surface)).line2).toBe('要合併 plan 還是拆開？')
    files[W_MODEL] = j(model({ needs_decision: true, decision: { ...DECISION_W, stale: true, age_s: 3600 } })) // stale but under a day
    await w.clock.advance(5000)
    expect((await bandParts($, surface)).line2).toBe('要合併 plan 還是拆開？')
  })

  test('W3a tasks: counts feed an unfrozen progress, the pane lists them, all completed is 完成待驗收, a frozen model progress wins (' + surface + ')', async ($, on) => {
    const files = quietWorld()
    files[P_TASKS()] = j(tasksFile())
    const w = world(on, files)
    await start($, surface)
    let p = await bandParts($, surface)
    expect(p.line1).toBe('● 進行中 repo · — · 30m · 1 done*') // GATEFIX: a task in progress is 進行中 (was 待命); root scope with tasks and no receipt: tasks first_created_at (09:30), progress unfrozen
    const last = p.last as Node
    expect(last.props?.dimColor).toBe(true)
    const pane = await paneParts($, surface)
    expect(pane.texts).toContain('任務 1/3 完成 · 進行中 1')
    expect(pane.texts).toContain('目前：接線')
    expect(pane.texts).toContain('[x] 寫測試')
    files[P_TASKS()] = j(allDone())
    await w.clock.advance(5000)
    p = await bandParts($, surface)
    expect(p.line1).toBe('✓ 完成待驗收 repo · — · 30m · 2 done*')
    expect(p.line2).toBe('任務 2/2 都完成，等你驗收')
    // a live run beats "tasks all done"
    files[W_ENV] = j(envelope({ runs: [row({ run_id: 'r1' })], counts: quiet(1) }))
    await w.clock.advance(5000)
    expect(verdicts(await bandText($, surface))).toEqual(['進行中'])
    // acceptance already decided is not waiting
    files[W_ENV] = j(envelope({ runs: [exitedRun()], counts: quiet(0) }))
    files[W_MODEL] = j(model({ axes: { execution: { running: 0, exited: 1, unknown: 0 }, acceptance: 'accepted', can_close: true } }))
    await w.clock.advance(5000)
    expect(verdicts(await bandText($, surface))).toEqual(['待命'])
    // an empty task list is not "all done", and a frozen job progress wins over the task counts
    files[P_TASKS()] = j(tasksFile({ tasks: [], counts: { total: 0, completed: 0, in_progress: 0 }, current: null }))
    files[W_MODEL] = j(model())
    await w.clock.advance(5000)
    expect(verdicts(await bandText($, surface))).toEqual(['待命'])
    expect((await bandParts($, surface)).line1.endsWith('· —')).toBe(true)
    expect((await paneParts($, surface)).texts).toContain('沒有任務')
    files[P_TASKS()] = j(tasksFile())
    files[W_MODEL] = j(model({ progress: { frozen: true, percent: 62.5, done: 5, total: 8 } }))
    await w.clock.advance(5000)
    expect((await bandParts($, surface)).line1.endsWith('62.5%（5/8）')).toBe(true)
  })

  test('W3a tasks: the file is found under the sanitised session id; another session\'s file and a wrong schema are ignored (' + surface + ')', async ($, on) => {
    const files = quietWorld()
    files[AHOME + '/session-mode/' + SID_RAW + '.json'] = j({ session_id: SID_RAW, level: null, project_key: KEY, root_run_id: ROOT, expires_at: '2026-10-05T10:00:00.000Z' })
    files[P_TASKS(SID_FILE)] = j(tasksFile({}, SID_RAW))
    files[P_TASKS(SID_A)] = j(tasksFile({ counts: { total: 9, completed: 7, in_progress: 0 } }))
    files[LIVE + '/context/' + SID_FILE + '.json'] = j(context(55))
    const w = world(on, files, NOW_FRESH, SID_RAW)
    await start($, surface)
    expect((await bandParts($, surface)).line1.endsWith('1 done*')).toBe(true)
    expect(await paneHeader($, surface)).toContain('ctx 55%') // the context file name is sanitised too
    files[P_TASKS(SID_FILE)] = j({ ...tasksFile({}, SID_RAW), schema: 'other/1' })
    // wrong schema: the file is absent, so no manifest means no task section at all
    await w.clock.advance(5000)
    expect((await paneParts($, surface)).texts.some(x => x.includes('任務'))).toBe(false)
    expect((await bandParts($, surface)).line1.endsWith('· —')).toBe(true)
  })

  test('W3a elapsed: campaign = earliest progress receipt bound to the root; session = tasks first_created_at, else marker started_at, else the earliest run (' + surface + ')', async ($, on) => {
    const files = quietWorld()
    const dir = COMMON + '/autopilot/work-orders/' + ROOT + '/'
    files[dir + 'n2-a1.json'] = j(REC('other-root', '2026-10-04T08:00:00.000Z', { root_run_id: undefined })) // a foreign receipt inside a file with no file-level root: the receipt's own root decides
    files[dir + 'n3-a1.json'] = j(REC(ROOT, '2026-10-04T07:00:00.000Z', { root_run_id: 'other-root' })) // file-level root differs: unbound as a whole
    files[dir + 'n4-a1.json'] = '{not json'
    const w = world(on, files)
    await start($, surface)
    expect((await bandParts($, surface)).line1).toBe('◌ 待命 repo · — · 10m · —') // no receipt is bound to this root: the earliest run start (09:50)
    files[dir + 'n1-a1.json'] = j(REC(ROOT, '2026-10-04T09:10:00.000Z', {}))
    files[dir + 'n1-a2.json'] = j(REC(ROOT, '2026-10-04T09:20:00.000Z', {}))
    await w.clock.advance(5000)
    expect((await bandParts($, surface)).line1).toBe('◌ 待命 repo · — · 50m · —') // earliest bound receipt 09:10
    // session scope (the marker has no root; the project-level envelope is read)
    files[AHOME + '/session-mode/' + SID_A + '.json'] = j({ session_id: SID_A, level: null, project_key: KEY, root_run_id: null, started_at: '2026-10-04T09:00:00.000Z', expires_at: '2026-10-05T10:00:00.000Z' })
    files[LIVE + '/runs/' + KEY + '.json'] = j(envelope({ runs: [exitedRun()], counts: quiet(0) }, null))
    files[P_TASKS()] = j(tasksFile())
    await w.clock.advance(5000)
    expect((await bandParts($, surface)).line1.split(' · ')[2]).toBe('30m') // tasks first_created_at 09:30
    delete files[P_TASKS()]
    await w.clock.advance(5000)
    expect((await bandParts($, surface)).line1.split(' · ')[2]).toBe('1h0m') // marker started_at 09:00
    files[AHOME + '/session-mode/' + SID_A + '.json'] = j({ session_id: SID_A, level: null, project_key: KEY, root_run_id: null, expires_at: '2026-10-05T10:00:00.000Z' })
    await w.clock.advance(5000)
    expect((await bandParts($, surface)).line1.split(' · ')[2]).toBe('10m') // earliest run
  })

  test('ELAPSED: a session with a root (plain or fresh l3/l4) starts at tasks first_created_at, else marker started_at; a bound receipt wins over an older marker; nothing at all is an em dash (' + surface + ')', async ($, on) => {
    const R = 'job-1790000000-ab12cd34'
    const files = base()
    const marker = (extra: Record<string, unknown>, level: string | null = null) =>
      j({ session_id: SID_A, level, project_key: KEY, root_run_id: R, expires_at: '2026-10-05T10:00:00.000Z', ...extra })
    delete files[LIVE + '/runs/' + KEY + '--' + ROOT + '.json']
    files[LIVE + '/runs/' + KEY + '--' + R + '.json'] = j(envelope({ runs: [], counts: { confirmed_live: 0, exited: 0, unknown: 0, fresh_bound_s: 30 } }, R))
    files[AHOME + '/session-mode/' + SID_A + '.json'] = marker({ started_at: '2026-10-04T09:00:00.000Z' })
    files[P_TASKS()] = j(tasksFile())
    const w = world(on, files)
    await start($, surface)
    const elapsed = async () => (await bandParts($, surface)).line1.split(' · ')[2]
    expect(await elapsed()).toBe('30m') // root, no runs, no receipt: tasks first_created_at 09:30 (not an em dash)
    delete files[P_TASKS()]
    await w.clock.advance(5000)
    expect(await elapsed()).toBe('1h0m') // no tasks: marker started_at 09:00
    files[AHOME + '/session-mode/' + SID_A + '.json'] = marker({ started_at: '2026-10-04T09:00:00.000Z' }, 'l4')
    await w.clock.advance(5000)
    expect(await elapsed()).toBe('1h0m') // a fresh /l4 marker with a root and no dispatch behaves the same
    const dir = COMMON + '/autopilot/work-orders/' + R + '/'
    files[dir + 'n1-a1.json'] = j(REC(R, '2026-10-04T09:10:00.000Z', {}))
    files[P_TASKS()] = j(tasksFile())
    await w.clock.advance(5000)
    expect(await elapsed()).toBe('50m') // campaign: the bound receipt (09:10) beats both the older marker (09:00) and the tasks (09:30)
    delete files[dir + 'n1-a1.json']
    delete files[P_TASKS()]
    const R2 = 'job-1790000001-ee55ff66' // a new root: a found receipt is cached per root, so the empty case needs its own
    files[LIVE + '/runs/' + KEY + '--' + R2 + '.json'] = j(envelope({ runs: [], counts: { confirmed_live: 0, exited: 0, unknown: 0, fresh_bound_s: 30 } }, R2))
    files[AHOME + '/session-mode/' + SID_A + '.json'] = j({ session_id: SID_A, level: null, project_key: KEY, root_run_id: R2, expires_at: '2026-10-05T10:00:00.000Z' })
    await w.clock.advance(5000)
    expect(await elapsed()).toBe('—') // no receipt, no tasks, no marker start, no run
  })

  test('W3a elapsed: a root that is not a plain segment (traversal, spaces) never reaches the work-orders path (' + surface + ')', async ($, on) => {
    const evil = 'bad root'
    const files = quietWorld()
    files[AHOME + '/session-mode/' + SID_A + '.json'] = j({ session_id: SID_A, level: 'l5', project_key: KEY, root_run_id: evil, expires_at: '2026-10-05T10:00:00.000Z' })
    files[LIVE + '/runs/' + KEY + '--bad_root.json'] = j(envelope({ runs: [exitedRun()], counts: quiet(0) }, evil))
    files[COMMON + '/autopilot/work-orders/' + evil + '/n1-a1.json'] = j(REC(evil, '2026-10-04T08:00:00.000Z', {}))
    const w = world(on, files)
    await start($, surface)
    expect((await bandParts($, surface)).line1).toBe('◌ 待命 repo · — · 10m · —') // the 08:00 receipt behind the traversal is never read
    expect(w.reads.concat(w.lists).some(p => p.includes('work-orders'))).toBe(false)
  })

  test('W3a marker contract: a plain session (level null) still resolves its scope (' + surface + ')', async ($, on) => {
    const files = base()
    files[AHOME + '/session-mode/' + SID_A + '.json'] = j({ session_id: SID_A, level: null, project_key: KEY, root_run_id: null, started_at: '2026-10-04T09:40:00.000Z', size: 'M', stage: 'code-review', stage_set_at: PUBLISHED, expires_at: '2026-10-05T10:00:00.000Z' })
    world(on, files)
    await start($, surface)
    const text = await bandText($, surface)
    expect(text).toContain(FOUND)
    expect(text.split('\n')[0]?.split(' · ')[2]).toBe('20m')
  })

  test('W3a decisions sidecar: line 2 carries 代你決定 m 件（k 件不可逆）, only when non-zero (' + surface + ')', async ($, on) => {
    const files = quietWorld()
    files[P_DEC] = j(decisionsSidecar())
    const w = world(on, files)
    await start($, surface)
    expect((await bandParts($, surface)).line2).toBe('沒有派工在跑 · 代你決定 2 件（1 件不可逆）')
    files[P_DEC] = j(decisionsSidecar({ count: 0, irreversible_count: 0, rows: [] }))
    await w.clock.advance(5000)
    expect((await bandParts($, surface)).line2).toBe('沒有派工在跑')
    files[P_DEC] = j(decisionsSidecar({ count: 1, irreversible_count: 0, rows: [] }))
    await w.clock.advance(5000)
    expect((await bandParts($, surface)).line2).toBe('沒有派工在跑 · 代你決定 1 件（0 件不可逆）')
  })

  test('W3a decisions sidecar: 僅自動裁決 is worded from the actual writers_wired list; no depth-0 writer = label (' + surface + ')', async ($, on) => {
    const files = quietWorld()
    files[P_DEC] = j(decisionsSidecar({ writers_wired: ['engine'] }))
    const w = world(on, files)
    await start($, surface)
    expect((await bandParts($, surface)).line2).toBe('沒有派工在跑 · 代你決定 2 件（1 件不可逆） · 僅 engine 自動裁決')
    files[P_DEC] = j(decisionsSidecar({ writers_wired: [] }))
    await w.clock.advance(5000)
    expect((await bandParts($, surface)).line2).toBe('沒有派工在跑 · 代你決定 2 件（1 件不可逆） · 決策寫入端未接')
    files[P_DEC] = j(decisionsSidecar({ writers_wired: ['next-pick'] }))
    await w.clock.advance(5000)
    expect((await bandParts($, surface)).line2).toBe('沒有派工在跑 · 代你決定 2 件（1 件不可逆）') // a depth-0 writer is wired: no label
    files[P_DEC] = j(decisionsSidecar({ writers_wired: ['engine', 'next-pick'] }))
    await w.clock.advance(5000)
    expect((await bandParts($, surface)).line2).toBe('沒有派工在跑 · 代你決定 2 件（1 件不可逆）')
  })

  test('W3a decisions sidecar: undocumented dispatches are counted on line 2, on their own or after the decisions (' + surface + ')', async ($, on) => {
    const files = quietWorld()
    files[P_DEC] = j(decisionsSidecar({ count: 0, irreversible_count: 0, rows: [], undocumented_dispatches: 3 }))
    const w = world(on, files)
    await start($, surface)
    expect((await bandParts($, surface)).line2).toBe('沒有派工在跑 · 3 件派工無決策紀錄')
    files[P_DEC] = j(decisionsSidecar({ undocumented_dispatches: 3 }))
    await w.clock.advance(5000)
    expect((await bandParts($, surface)).line2).toBe('沒有派工在跑 · 代你決定 2 件（1 件不可逆） · 3 件派工無決策紀錄')
  })

  test('W3a decisions pane: one row per decision with the real veto command; no id means no veto (' + surface + ')', async ($, on) => {
    const files = quietWorld()
    const rows = decisionsSidecar().rows as Record<string, unknown>[]
    files[P_DEC] = j(decisionsSidecar({ rows: [...rows, { round: 3, decision: '沒有編號的決定', irreversible: false, at: '2026-10-04T09:50:00.000Z', writer: 'engine', kind: 'pick', decision_id: null, source: 'ledger_default' }], count: 3 }))
    world(on, files)
    await start($, surface)
    const t = (await paneParts($, surface, 'decisions')).texts // P7: the proxy-decision rows moved to the Decisions tab
    expect(t).toContain('代你決定 3 件（1 件不可逆）')
    expect(t.some(x => x.includes('先拆 plan 再實作') && x.includes('d-1') && x.includes(' · 可逆 · '))).toBe(true)
    expect(t.some(x => x.includes('刪掉舊分支') && x.includes('不可逆'))).toBe(true)
    expect(t).toContain('  veto: decision-ledger.js veto --ledger ' + COMMON + '/autopilot/ledger/decisions.jsonl --id d-1')
    expect(t).toContain('  veto: decision-ledger.js veto --ledger ' + COMMON + '/autopilot/work-orders/' + ROOT + '/decision-ledger.jsonl --id d-2')
    const noId = t.findIndex(x => x.includes('沒有編號的決定'))
    expect(noId).toBeGreaterThan(0)
    expect(t[noId + 1]).toBe('  （沒有 decision_id，無法 veto）')
  })

  test('W3a decisions sources: both ledger writers not installed and no sidecar = 來源未接 in the pane; installed = nothing (' + surface + ')', async ($, on) => {
    const files = quietWorld()
    files[P_SOURCES] = j(manifest({ ledger_engine: OFF, ledger_depth0: OFF }))
    const w = world(on, files)
    await start($, surface)
    expect((await paneParts($, surface, 'decisions')).texts).toContain('代你決定：來源未接')
    expect((await bandParts($, surface)).line2).toBe('沒有派工在跑')
    files[P_SOURCES] = j(manifest({ ledger_engine: OFF })) // one writer installed: wired, currently empty
    await w.clock.advance(5000)
    expect((await paneParts($, surface, 'decisions')).texts.some(x => x.startsWith('代你決定'))).toBe(false)
  })

  test('W3a foreman: rows with description, label and age; stale rows dim; binding stated; stage line (' + surface + ')', async ($, on) => {
    const files = base()
    files[P_FOREMAN] = j(foremanSidecar())
    world(on, files)
    await start($, surface)
    const pane = await paneParts($, surface)
    const t = pane.texts
    expect(t).toContain('工頭活動（依 session 綁定：同一 session 的多個工作會看到同一批）')
    expect(t).toContain('修 parser · running · 30s 前')
    expect(t).toContain('a2 · last tool: Bash · 20m 前 · 久未動')
    expect(t).toContain('階段 implement · 1m 前（run_ledger:tmp）')
    const nodes = walkTexts(pane.tree)
    expect(nodes.find(n => textOf(n) === 'a2 · last tool: Bash · 20m 前 · 久未動')?.props?.dimColor).toBe(true)
    expect(nodes.find(n => textOf(n) === '修 parser · running · 30s 前')?.props?.dimColor).not.toBe(true)
  })

  test('W3a foreman: an absent sidecar reads 工頭狀態：來源未接 (' + surface + ')', async ($, on) => {
    world(on, base())
    await start($, surface)
    expect((await paneParts($, surface)).texts).toContain('工頭狀態：來源未接')
  })

  test('FOREMAN: an un-ended stamped agent quiet < 180 s is 進行中 (工頭在跑), >= 180 s is 疑似卡住 (工頭 N 分沒有動作); ended, over-TTL or unstamped rows are ignored (' + surface + ')', async ($, on) => {
    const files = quietWorld()
    const w = world(on, files)
    let t = NOW_FRESH // the mock clock moves 5 s per tick(); agent times are written relative to it
    const tick = async () => { await w.clock.advance(5000); t += 5000 }
    const ago = (s: number) => new Date(t + 5000 - s * 1000).toISOString() // the age the NEXT tick() read sees
    const agent = (over: Record<string, unknown> = {}) => ({ agent_id: 'f1', description: '修 parser', label: 'last tool: Bash', last_activity_at: ago(30), age_s: 30, stale: false, stamped: true, ended_at: null, source: 'stamp', session_id: SID_A, binding: 'session', ...over })
    const put = (...rows: Record<string, unknown>[]) => { files[P_FOREMAN] = j(foremanSidecar({ agents: rows })) }
    await start($, surface)
    expect(verdicts(await bandText($, surface))).toEqual(['待命'])
    put(agent()) // 30 s quiet
    await tick()
    let p = await bandParts($, surface)
    expect(p.line1.startsWith('● 進行中 repo')).toBe(true)
    expect(p.line2).toBe('工頭在跑：修 parser（0 分前有動作）')
    put(agent({ description: null, label: 'last tool: Edit', last_activity_at: ago(120) })) // 120 s, no description: the label
    await tick()
    expect((await bandParts($, surface)).line2).toBe('工頭在跑：last tool: Edit（2 分前有動作）')
    put(agent({ last_activity_at: ago(179) })) // 179 s: still running
    await tick()
    expect(verdicts(await bandText($, surface))).toEqual(['進行中'])
    put(agent({ last_activity_at: ago(180) })) // exactly 180 s: stalled
    await tick()
    p = await bandParts($, surface)
    expect(p.line1.startsWith('⏸ 疑似卡住 repo')).toBe(true)
    expect(p.line2).toBe('工頭 3 分沒有動作')
    put(agent({ last_activity_at: ago(600) }), agent({ agent_id: 'f2', last_activity_at: ago(300) })) // the quietest sets the age (10 min)
    await tick()
    expect((await bandParts($, surface)).line2).toBe('工頭 10 分沒有動作')
    put(agent({ last_activity_at: ago(600) }), agent({ agent_id: 'f2' })) // one stalled + one fresh: stalled wins
    await tick()
    expect(verdicts(await bandText($, surface))).toEqual(['疑似卡住'])
    // ended -> ignored (待命); over the 24 h marker TTL -> ignored; not a stamp row (context_tasks) -> ignored
    put(agent({ ended_at: ago(10) }), agent({ agent_id: 'f2', last_activity_at: ago(400), ended_at: ago(300) }))
    await tick()
    expect(verdicts(await bandText($, surface))).toEqual(['待命'])
    put(agent({ last_activity_at: ago(25 * 3600) }))
    await tick()
    expect(verdicts(await bandText($, surface))).toEqual(['待命'])
    put(agent({ stamped: false, source: 'context_tasks' }), agent({ agent_id: 'f3', stamped: undefined, last_activity_at: ago(1200) }))
    await tick()
    expect(verdicts(await bandText($, surface))).toEqual(['待命'])
    // a sidecar of another scope / no sidecar: nothing
    files[P_FOREMAN] = j(foremanSidecar({ agents: [agent()] }, { project_key: OTHER_KEY }))
    await tick()
    expect(verdicts(await bandText($, surface))).toEqual(['待命'])
  })

  test('FOREMAN precedence: 要你決定 > the dispatch stall > the foreman stall > 完成待驗收 > 進行中; a fresh foreman blocks 完成待驗收, a live dispatch run names itself first (' + surface + ')', async ($, on) => {
    const files = quietWorld()
    const w = world(on, files)
    let t = NOW_FRESH // the mock clock moves 5 s per tick(); agent times are written relative to it
    const tick = async () => { await w.clock.advance(5000); t += 5000 }
    const ago = (s: number) => new Date(t + 5000 - s * 1000).toISOString() // the age the NEXT tick() read sees
    const agent = (over: Record<string, unknown> = {}) => ({ agent_id: 'f1', description: '修 parser', label: null, last_activity_at: ago(30), age_s: 30, stale: false, stamped: true, ended_at: null, source: 'stamp', session_id: SID_A, binding: 'session', ...over })
    const stalledAgent = agent({ last_activity_at: ago(600) })
    await start($, surface)
    // every task done: a fresh foreman is still working, so not 完成待驗收
    files[P_TASKS()] = j(allDone())
    await tick()
    expect(verdicts(await bandText($, surface))).toEqual(['完成待驗收'])
    files[P_FOREMAN] = j(foremanSidecar({ agents: [agent()] }))
    await tick()
    let p = await bandParts($, surface)
    expect(p.line1.startsWith('● 進行中 repo')).toBe(true)
    expect(p.line2).toBe('工頭在跑：修 parser（0 分前有動作）')
    // the foreman is ended: complete-and-waiting again
    files[P_FOREMAN] = j(foremanSidecar({ agents: [agent({ ended_at: ago(5) })] }))
    await tick()
    expect(verdicts(await bandText($, surface))).toEqual(['完成待驗收'])
    // a stalled foreman outranks complete-and-waiting
    files[P_FOREMAN] = j(foremanSidecar({ agents: [stalledAgent] }))
    await tick()
    expect(verdicts(await bandText($, surface))).toEqual(['疑似卡住'])
    // a stalled dispatch run's reason comes before the foreman's
    delete files[P_TASKS()]
    files[W_ENV] = j(envelope({ runs: [row({ run_id: 'r1', stall: true, last_event_age_s: 240 })], counts: quiet(1) }))
    await tick()
    expect((await bandParts($, surface)).line2).toBe('最久的派工 4m 沒有輸出')
    // permission attention outranks everything
    files[P_ATT()] = j(attention('permission'))
    await tick()
    expect(verdicts(await bandText($, surface))).toEqual(['要你決定'])
    delete files[P_ATT()]
    // a live (not stalled) run names itself before a fresh foreman
    files[W_ENV] = j(envelope({ runs: [row({ run_id: 'r1' })], counts: quiet(1) }))
    files[P_FOREMAN] = j(foremanSidecar({ agents: [agent()] }))
    await tick()
    expect((await bandParts($, surface)).line2).toBe('1 個派工在跑')
    // a fresh foreman names itself before a task in progress and an active turn
    files[W_ENV] = j(envelope({ runs: [exitedRun()], counts: quiet(0) }))
    files[P_TASKS()] = j(tasksFile())
    files[P_TURN()] = j(turn('active'))
    await tick()
    p = await bandParts($, surface)
    expect(p.line2).toBe('工頭在跑：修 parser（0 分前有動作）')
  })

  test('W3a scope guards: a sidecar at the right path with another project / root is an absent file (' + surface + ')', async ($, on) => {
    const files = quietWorld()
    files[P_DEC] = j(decisionsSidecar({}, { project_key: OTHER_KEY }))
    files[P_FOREMAN] = j(foremanSidecar({}, { project_key: OTHER_KEY }))
    files[P_SOURCES] = j(manifest({ ledger_engine: OFF, ledger_depth0: OFF, tasks: OFF }, { project_key: OTHER_KEY }))
    const w = world(on, files)
    await start($, surface)
    expect((await bandParts($, surface)).line2).toBe('沒有派工在跑')
    const both = async () => [...(await paneParts($, surface, 'dispatch')).texts, ...(await paneParts($, surface, 'decisions')).texts]
    let t = await both()
    expect(t.some(x => x.startsWith('代你決定'))).toBe(false)
    expect(t).toContain('工頭狀態：來源未接') // the foreign foreman rows are not shown
    expect(t.some(x => x.includes('修 parser'))).toBe(false)
    expect(t.some(x => x.includes('來源未接') && x !== '工頭狀態：來源未接')).toBe(false) // the foreign manifest is not obeyed
    files[P_DEC] = j(decisionsSidecar({}, { root_run_id: 'other-root' }))
    files[P_FOREMAN] = j(foremanSidecar({}, { root_run_id: 'other-root' }))
    await w.clock.advance(5000)
    t = await both()
    expect((await bandParts($, surface)).line2).toBe('沒有派工在跑')
    expect(t.some(x => x.includes('修 parser'))).toBe(false)
    files[P_DEC] = j({ ...decisionsSidecar(), schema: 'other/1' })
    await w.clock.advance(5000)
    expect((await bandParts($, surface)).line2).toBe('沒有派工在跑')
  })

  test('W3a sources manifest: phase / progress slots read 來源未接 only when no writer for them is live; no manifest = an em dash (' + surface + ')', async ($, on) => {
    const files = quietWorld()
    files[P_SOURCES] = j(manifest({ stage: OFF, progress: OFF, task_status_input: OFF, tasks: OFF }))
    const w = world(on, files)
    await start($, surface)
    expect((await bandParts($, surface)).line1).toBe('◌ 待命 repo · 來源未接 · 10m · 來源未接')
    files[P_SOURCES] = j(manifest({ stage: OFF, task_status_input: OFF })) // the campaign progress receipt writer still feeds the phase
    await w.clock.advance(5000)
    expect((await bandParts($, surface)).line1).toBe('◌ 待命 repo · — · 10m · —')
    files[P_SOURCES] = j(manifest({ progress: OFF, tasks: { installed: true, enabled: false } })) // installed but switched off = not wired
    await w.clock.advance(5000)
    expect((await bandParts($, surface)).line1).toBe('◌ 待命 repo · — · 10m · 來源未接')
    files[P_SOURCES] = j(manifest({ progress: OFF })) // the task hook still feeds the progress slot: wired, empty
    await w.clock.advance(5000)
    expect((await bandParts($, surface)).line1).toBe('◌ 待命 repo · — · 10m · —')
    delete files[P_SOURCES]
    await w.clock.advance(5000)
    expect((await bandParts($, surface)).line1).toBe('◌ 待命 repo · — · 10m · —')
    // data beats the manifest: a phase / progress the model really carries is shown even when the manifest says not installed
    files[P_SOURCES] = j(manifest({ stage: OFF, progress: OFF, task_status_input: OFF, tasks: OFF }))
    files[W_MODEL] = j(model({ phase: { code: 'IMPLEMENTING', label: '實作', source: 'campaign' }, progress: { frozen: true, percent: 50, done: 4, total: 8 } }))
    await w.clock.advance(5000)
    expect((await bandParts($, surface)).line1).toBe('◌ 待命 repo · 實作 · 10m · 50%（4/8）')
  })

  test('W3a sources manifest: the model\'s own sources_manifest is the fallback when the sidecar file is absent (' + surface + ')', async ($, on) => {
    const files = quietWorld()
    files[W_MODEL] = j(model({ sources_manifest: manifest({ stage: OFF, progress: OFF, task_status_input: OFF, tasks: OFF }) }))
    world(on, files)
    await start($, surface)
    expect((await bandParts($, surface)).line1).toBe('◌ 待命 repo · 來源未接 · 10m · 來源未接')
  })

  test('W3a tasks pane: no file + writer installed = 任務工具未開 with the env hint; not installed = 來源未接; no manifest = silent (' + surface + ')', async ($, on) => {
    const files = quietWorld()
    const w = world(on, files)
    await start($, surface)
    let t = (await paneParts($, surface)).texts
    expect(t.some(x => x.includes('任務'))).toBe(false)
    files[P_SOURCES] = j(manifest())
    await w.clock.advance(5000)
    t = (await paneParts($, surface)).texts
    expect(t).toContain('任務工具未開 · 設 CLAUDE_CODE_ENABLE_TODO_TOOLS=1 後才會記錄任務')
    files[P_SOURCES] = j(manifest({ tasks: OFF }))
    await w.clock.advance(5000)
    t = (await paneParts($, surface)).texts
    expect(t).toContain('任務：來源未接')
    expect(t.some(x => x.includes('CLAUDE_CODE_ENABLE_TODO_TOOLS'))).toBe(false)
    // a file that exists is shown whatever the manifest says
    files[P_TASKS()] = j(tasksFile())
    await w.clock.advance(5000)
    t = (await paneParts($, surface)).texts
    expect(t).toContain('任務 1/3 完成 · 進行中 1')
    expect(t).not.toContain('任務：來源未接')
  })

  test('W3a attention source not installed: the pane says so, the band stays silent (' + surface + ')', async ($, on) => {
    const files = quietWorld()
    files[P_SOURCES] = j(manifest({ attention: OFF }))
    world(on, files)
    await start($, surface)
    expect((await paneParts($, surface)).texts).toContain('等待狀態：來源未接')
    expect(verdicts(await bandText($, surface))).toEqual(['待命'])
  })

  test('W3a context header: not installed + no file = 來源未接; installed + unknown window (W2f shape) = an em dash; observed percent shown (' + surface + ')', async ($, on) => {
    const files = base()
    delete files[LIVE + '/context/' + SID_A + '.json']
    files[P_SOURCES] = j(manifest({ context: OFF }))
    const w = world(on, files)
    await start($, surface)
    expect(await paneHeader($, surface)).toBe('session $0.42 · host $3.10 · ctx 來源未接')
    files[P_SOURCES] = j(manifest())
    files[LIVE + '/context/' + SID_A + '.json'] = j({ schema_version: 1, session_id: SID_A, written_at: '2026-10-04T10:00:20.000Z', writer: 'context-budget', window_source: 'unknown', model: {}, context_window: { context_window_size: null, used_percentage: null, total_input_tokens: 90000, current_usage: {} } })
    await w.clock.advance(5000)
    expect(await paneHeader($, surface)).toBe('session $0.42 · host $3.10 · ctx —')
    files[LIVE + '/context/' + SID_A + '.json'] = j({ schema_version: 1, session_id: SID_A, written_at: '2026-10-04T10:00:20.000Z', writer: 'context-budget', window_source: 'observed', model: {}, context_window: { context_window_size: 1000000, used_percentage: 9, total_input_tokens: 90000, current_usage: {} } })
    await w.clock.advance(5000)
    expect(await paneHeader($, surface)).toBe('session $0.42 · host $3.10 · ctx 9%')
    // data beats the manifest
    files[P_SOURCES] = j(manifest({ context: OFF }))
    await w.clock.advance(5000)
    expect(await paneHeader($, surface)).toBe('session $0.42 · host $3.10 · ctx 9%')
  })
}

test('lifecycle: one timer however often session.start fires; /clear keeps it; exit cancels it', async ($, on) => {
  const w = world(on, base())
  await start($, 'terminal')
  await start($, 'terminal') // a hot reload re-fires session.start
  const envPath = LIVE + '/runs/' + KEY + '--' + ROOT + '.json'
  const count = () => w.reads.filter(p => p === envPath).length
  const before = count()
  await w.clock.advance(5000)
  expect(count() - before).toBe(1) // exactly one tick per 5 s
  await $.session.end({ reason: 'clear', sessionId: SID_A, resume: {} } as never)
  const afterClear = count()
  await w.clock.advance(5000)
  expect(count() - afterClear).toBe(1) // /clear does not stop it
  await $.session.end({ reason: 'prompt_input_exit', sessionId: SID_A, resume: {} } as never)
  const afterExit = count()
  await w.clock.advance(15000)
  expect(count() - afterExit).toBe(0)
})

test('read-only: the mod never writes a file', async ($, on) => {
  const files = base()
  files[AHOME + '/review/' + KEY + '/2026-10-04/' + ROOT + '/current/model.json'] = j(model())
  const w = world(on, files)
  await start($, 'terminal')
  const band = await $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
  await w.clock.advance(20000)
  await band.unmount()
  expect(w.writes).toEqual([])
})

// ---- P1W SCOPE: the session's band follows the campaigns it launched ----
const CAMP = 'mission-1'
const CAMP0 = 'mission-0'
const campEnvPath = (r: string) => LIVE + '/runs/' + KEY + '--' + r + '.json'
const jobEnvPath = campEnvPath(ROOT)
const modelPathOf = (r: string) => AHOME + '/review/' + KEY + '/2026-10-04/' + r + '/current/model.json'
const scopeQuiet = { confirmed_live: 0, exited: 0, unknown: 0, fresh_bound_s: 30 }
const counts = (live: number) => ({ confirmed_live: live, exited: 0, unknown: 0, fresh_bound_s: 30 })
const liveRows = (n: number, prefix: string) => Array.from({ length: n }, (_x, i) => row({ run_id: prefix + i, root_run_id: prefix }))
const FROZEN8 = { frozen: true, percent: 100, done: 8, total: 8 }
const markerWith = (roots: unknown) => j({ session_id: SID_A, level: 'l5', project_key: KEY, root_run_id: ROOT, expires_at: '2026-10-05T10:00:00.000Z', campaign_roots: roots })
const scopeDecisions = (root: string, count: number, irreversible: number, undocumented = 0) => j({
  schema: 'autopilot.decisions-sidecar/1', scope: { project_key: KEY, repo_identity: 'git-common-dir:/work/repo/.git', root_run_id: root },
  count, irreversible_count: irreversible, undocumented_dispatches: undocumented, writers_wired: ['next-pick'],
  rows: Array.from({ length: count }, (_x, i) => ({ round: 1, decision: 'd' + root + i, irreversible: i < irreversible, writer: 'next-pick', decision_id: 'id-' + root + '-' + i, source: 'ledger_root' })),
})

// A session whose marker names one campaign root. The job root is scopeQuiet by default; the campaign root is whatever the test puts.
function campaignWorld(campaignEnv: Record<string, unknown> | null, roots: unknown = [CAMP], jobEnv: Record<string, unknown> = { runs: [], counts: scopeQuiet }): Tree {
  const files = base()
  files[AHOME + '/session-mode/' + SID_A + '.json'] = markerWith(roots)
  files[jobEnvPath] = j(envelope(jobEnv, ROOT))
  if (campaignEnv !== null) files[campEnvPath(CAMP)] = j(envelope(campaignEnv, CAMP))
  return files
}
const scopeVerdicts = (t: string) => ['要你決定', '疑似卡住', '完成待驗收', '進行中', '待命'].filter(v => t.includes(v))

for (const surface of SURFACES) {
  test('SCOPE: a live run under the campaign root reads 進行中 although the job root is quiet (' + surface + ')', async ($, on) => {
    world(on, campaignWorld({ runs: liveRows(2, CAMP), counts: counts(2) }))
    await start($, surface)
    const p = await bandParts($, surface)
    expect(p.line1.startsWith('● 進行中 repo')).toBe(true)
    expect(p.line2).toBe('2 個派工在跑')
  })

  test('SCOPE: live counts are summed across the root set (job root 1 + campaign 2) (' + surface + ')', async ($, on) => {
    world(on, campaignWorld({ runs: liveRows(2, CAMP), counts: counts(2) }, [CAMP], { runs: liveRows(1, ROOT), counts: counts(1) }))
    await start($, surface)
    expect((await bandParts($, surface)).line2).toBe('3 個派工在跑')
    expect((await paneParts($, surface)).texts.join('\n')).toContain(CAMP + '0') // the pane lists the campaign's runs too
  })

  test('SCOPE: campaign terminal (frozen done = total, no live run anywhere) reads 完成待驗收 with the frozen progress (' + surface + ')', async ($, on) => {
    const files = campaignWorld({ runs: [], counts: scopeQuiet })
    files[modelPathOf(CAMP)] = j(model({ root_run_id: CAMP, job: CAMP, progress: FROZEN8, phase: { code: 'TERMINAL_READY', label: '收尾', source: 'campaign' } }))
    world(on, files)
    await start($, surface)
    const p = await bandParts($, surface)
    expect(p.line1.startsWith('✓ 完成待驗收 repo · 收尾 · ')).toBe(true)
    expect(p.line1.endsWith('100%（8/8）')).toBe(true)
    expect(p.line2).toBe('驗收結論尚未出')
  })

  test('SCOPE: depth-0\'s own review under the JOB root after the campaign is terminal reads 進行中, then 完成待驗收 again (' + surface + ')', async ($, on) => {
    const files = campaignWorld({ runs: [], counts: scopeQuiet }, [CAMP], { runs: liveRows(1, ROOT), counts: counts(1) })
    files[modelPathOf(CAMP)] = j(model({ root_run_id: CAMP, job: CAMP, progress: FROZEN8 }))
    const w = world(on, files)
    await start($, surface)
    expect(scopeVerdicts(await bandText($, surface))).toEqual(['進行中'])
    w.files[jobEnvPath] = j(envelope({ runs: [], counts: scopeQuiet, published_at: '2026-10-04T10:00:25.000Z' }, ROOT))
    w.files[campEnvPath(CAMP)] = j(envelope({ runs: [], counts: scopeQuiet, published_at: '2026-10-04T10:00:25.000Z' }, CAMP))
    await w.clock.advance(5000)
    expect(scopeVerdicts(await bandText($, surface))).toEqual(['完成待驗收'])
  })

  test('SCOPE: a stalled run under the campaign root reads 疑似卡住 (' + surface + ')', async ($, on) => {
    world(on, campaignWorld({ runs: [row({ run_id: 'c1', root_run_id: CAMP, stall: true, last_event_age_s: 300 })], counts: counts(1) }))
    await start($, surface)
    const p = await bandParts($, surface)
    expect(p.line1.startsWith('⏸ 疑似卡住 repo')).toBe(true)
    expect(p.line2).toBe('最久的派工 5m 沒有輸出')
  })

  test('SCOPE: proxy decisions are summed across the root set (' + surface + ')', async ($, on) => {
    const files = campaignWorld({ runs: liveRows(1, CAMP), counts: counts(1) })
    files[LIVE + '/runs/' + KEY + '--' + ROOT + '.decisions.json'] = scopeDecisions(ROOT, 1, 0)
    files[LIVE + '/runs/' + KEY + '--' + CAMP + '.decisions.json'] = scopeDecisions(CAMP, 2, 1, 3)
    world(on, files)
    await start($, surface)
    expect((await bandParts($, surface)).line2).toBe('1 個派工在跑 · 代你決定 3 件（1 件不可逆） · 3 件派工無決策紀錄')
  })

  test('SCOPE: progress and phase come from the NEWEST campaign root that has them (' + surface + ')', async ($, on) => {
    const files = campaignWorld({ runs: [], counts: scopeQuiet }, [CAMP0, CAMP])
    files[campEnvPath(CAMP0)] = j(envelope({ runs: [], counts: scopeQuiet }, CAMP0))
    files[modelPathOf(CAMP0)] = j(model({ root_run_id: CAMP0, job: CAMP0, progress: { frozen: true, percent: 50, done: 4, total: 8 }, phase: { code: 'IMPLEMENTING', label: '實作', source: 'campaign' } }))
    files[modelPathOf(CAMP)] = j(model({ root_run_id: CAMP, job: CAMP, progress: { frozen: true, percent: 62.5, done: 5, total: 8 }, phase: { code: 'REVIEWING', label: '審查', source: 'campaign' } }))
    const w = world(on, files)
    await start($, surface)
    let p = await bandParts($, surface)
    expect(p.line1).toContain(' · 審查 · ')
    expect(p.line1.endsWith('62.5%（5/8）')).toBe(true)
    // the newest has no phase / progress yet: the older campaign's are the ones shown, never an em dash
    w.files[modelPathOf(CAMP)] = j(model({ root_run_id: CAMP, job: CAMP, progress: null, phase: null }))
    await w.clock.advance(5000)
    p = await bandParts($, surface)
    expect(p.line1).toContain(' · 實作 · ')
    expect(p.line1.endsWith('50%（4/8）')).toBe(true)
  })

  test('SCOPE: a missing or stale envelope of one root never hides the others (' + surface + ')', async ($, on) => {
    // campaign envelope absent: the job root still speaks (base world has a stalled run)
    const files = base()
    files[AHOME + '/session-mode/' + SID_A + '.json'] = markerWith([CAMP])
    const w = world(on, files)
    await start($, surface)
    expect(await bandText($, surface)).toBe(FRESH_TEXT())
    // job root envelope absent, campaign fresh: the campaign speaks
    delete w.files[jobEnvPath]
    delete w.files[LIVE + '/runs/' + KEY + '.json']
    w.files[campEnvPath(CAMP)] = j(envelope({ runs: liveRows(2, CAMP), counts: counts(2), published_at: '2026-10-04T10:00:25.000Z' }, CAMP))
    await w.clock.advance(5000)
    expect((await bandParts($, surface)).line2).toBe('2 個派工在跑')
    // campaign stale (5 live runs published long ago), job root fresh and scopeQuiet: the stale one contributes nothing
    w.files[jobEnvPath] = j(envelope({ runs: [], counts: scopeQuiet, published_at: '2026-10-04T10:00:28.000Z' }, ROOT))
    w.files[campEnvPath(CAMP)] = j(envelope({ runs: liveRows(5, CAMP), counts: counts(5), published_at: '2026-10-04T09:00:00.000Z' }, CAMP))
    await w.clock.advance(5000)
    expect(scopeVerdicts(await bandText($, surface))).toEqual(['待命'])
  })

  test('SCOPE: every root of the set stale reads stale, none found reads unavailable (' + surface + ')', async ($, on) => {
    const w = world(on, campaignWorld({ runs: [], counts: scopeQuiet }), NOW_STALE)
    await start($, surface)
    expect(await bandText($, surface)).toContain('stale')
    for (const k of Object.keys(w.files)) if (k.startsWith(LIVE + '/runs/' + KEY)) delete w.files[k]
    await w.clock.advance(5000)
    expect(await bandText($, surface)).toContain('unavailable')
  })

  test('SCOPE: unsafe or non-string campaign roots are never turned into a path; a duplicate of the marker root is read once (' + surface + ')', async ($, on) => {
    const files = campaignWorld(null, ['../../etc/passwd', 42, '', ROOT, 'a/b'])
    const w = world(on, files)
    await start($, surface)
    expect(w.reads.some(p => p.includes('..') || p.includes('passwd') || p.includes('a/b'))).toBe(false)
    expect(w.reads.filter(p => p === jobEnvPath).length).toBe(1)
  })

  test('SCOPE: a decision awaited under the campaign root reads 要你決定 with its question (' + surface + ')', async ($, on) => {
    const files = campaignWorld({ runs: liveRows(1, CAMP), counts: counts(1) })
    files[modelPathOf(ROOT)] = j(model())
    files[modelPathOf(CAMP)] = j(model({ root_run_id: CAMP, job: CAMP, needs_decision: true, decision: { question: '要合併 campaign 分支嗎？', options: [{ label: '合併', consequence: '進 develop' }], stale: false, age_s: 5 } }))
    world(on, files)
    await start($, surface)
    const p = await bandParts($, surface)
    expect(p.line1.startsWith('▲ 要你決定 repo')).toBe(true)
    expect(p.line2).toBe('要合併 campaign 分支嗎？')
  })

  test('SCOPE: a marker without campaign_roots reads exactly the marker root, as before (' + surface + ')', async ($, on) => {
    const files = base()
    files[campEnvPath(CAMP)] = j(envelope({ runs: liveRows(9, CAMP), counts: counts(9) }, CAMP))
    const w = world(on, files)
    await start($, surface)
    expect(await bandText($, surface)).toBe(FRESH_TEXT())
    expect(w.reads.includes(campEnvPath(CAMP))).toBe(false)
  })

  test('SCOPE: a campaign root of the set sets the elapsed start from its own progress receipt (' + surface + ')', async ($, on) => {
    const files = campaignWorld({ runs: liveRows(1, CAMP), counts: counts(1) })
    files[COMMON + '/autopilot/work-orders/' + CAMP + '/n1-a1.json'] = j({
      artifact_type: 'work_order', root_run_id: CAMP, controller: { progress_receipts: [{ artifact_type: 'controller_progress_receipt', root_run_id: CAMP, issued_at: '2026-10-04T08:00:30.000Z' }] },
    })
    world(on, files)
    await start($, surface)
    expect((await bandParts($, surface)).line1).toContain(' · 2h0m · ')
  })
}

// ---- P1W SCOPE2 (gate run l5h): the marker names the Mission root AND the campaign's ICC id; the frozen progress lives under the ICC id ----
const ICC = 'campaign-v1-' + '3d'.repeat(32)
function l5hWorld(missionEnv: Record<string, unknown>, iccEnv: Record<string, unknown>): Tree {
  const files = campaignWorld(missionEnv, [CAMP, ICC])
  files[campEnvPath(ICC)] = j(envelope(iccEnv, ICC))
  // the Mission root has no receipts (its job model carries no progress); the ICC root's job model carries the frozen done = total
  files[modelPathOf(CAMP)] = j(model({ root_run_id: CAMP, job: CAMP, progress: null, phase: null }))
  files[modelPathOf(ICC)] = j(model({ root_run_id: ICC, job: ICC, progress: FROZEN8, phase: { code: 'TERMINAL_READY', label: '收尾', source: 'campaign' } }))
  return files
}
for (const surface of SURFACES) {
  test('SCOPE2: l5h shape, terminal (Mission root without receipts + ICC root with frozen 8/8, no live run) reads 完成待驗收 (' + surface + ')', async ($, on) => {
    world(on, l5hWorld({ runs: [], counts: scopeQuiet }, { runs: [], counts: scopeQuiet }))
    await start($, surface)
    const p = await bandParts($, surface)
    expect(p.line1.startsWith('✓ 完成待驗收 repo · 收尾 · ')).toBe(true)
    expect(p.line1.endsWith('100%（8/8）')).toBe(true)
  })

  test('SCOPE2: l5h shape, a live run under the Mission root or under the ICC root reads 進行中 (' + surface + ')', async ($, on) => {
    const w = world(on, l5hWorld({ runs: liveRows(1, CAMP), counts: counts(1) }, { runs: [], counts: scopeQuiet }))
    await start($, surface)
    expect(scopeVerdicts(await bandText($, surface))).toEqual(['進行中'])
    w.files[campEnvPath(CAMP)] = j(envelope({ runs: [], counts: scopeQuiet, published_at: '2026-10-04T10:00:25.000Z' }, CAMP))
    w.files[campEnvPath(ICC)] = j(envelope({ runs: liveRows(1, ICC), counts: counts(1), published_at: '2026-10-04T10:00:25.000Z' }, ICC))
    await w.clock.advance(5000)
    expect(scopeVerdicts(await bandText($, surface))).toEqual(['進行中'])
  })

  test('SCOPE2: with only the Mission root bound (the pre-SCOPE2 marker) the frozen progress is not found and the band reads 待命 (' + surface + ')', async ($, on) => {
    const files = l5hWorld({ runs: [], counts: scopeQuiet }, { runs: [], counts: scopeQuiet })
    files[AHOME + '/session-mode/' + SID_A + '.json'] = markerWith([CAMP])
    world(on, files)
    await start($, surface)
    expect(scopeVerdicts(await bandText($, surface))).toEqual(['待命'])
  })
}

// ---- stage-graph P7c: the QC chip of the review slot (model level; the band renders it in P7) ----
const qcFact = (over: Record<string, unknown> = {}, scope: Record<string, unknown> = {}) => ({
  schema: 'autopilot.qc-status/1', scope: { project_key: KEY, repo_identity: 'git-common-dir:' + COMMON, root_run_id: null, ...scope },
  state: 'owed', range: 'abc..HEAD', protected_files_count: 2, evidence: null, mode: 'block', checked_at: '2026-10-04T10:00:00.000Z', ...over,
})
const QC_WANT = { project_key: KEY, root_run_id: ROOT }
test('P7c: qc fact -> chip: ok = QC ✓, owed = QC owed, not_needed / unknown / absent = no chip', async () => {
  expect(qcChip(readQc(JSON.stringify(qcFact({ state: 'ok', evidence: 'trailer' })), QC_WANT))).toBe('QC ✓')
  expect(qcChip(readQc(JSON.stringify(qcFact({ state: 'owed' })), QC_WANT))).toBe('QC owed')
  expect(qcChip(readQc(JSON.stringify(qcFact({ state: 'not_needed', protected_files_count: 0 })), QC_WANT))).toBe(null)
  expect(qcChip(readQc(JSON.stringify(qcFact({ state: 'unknown', range: null })), QC_WANT))).toBe(null)
  expect(qcChip(readQc(null, QC_WANT))).toBe(null)
})
test('P7c: qc fact of another project, another schema, a bad state or broken JSON is absent', async () => {
  expect(readQc(JSON.stringify(qcFact({}, { project_key: OTHER_KEY })), QC_WANT)).toBe(null)
  expect(readQc(JSON.stringify(qcFact({ schema: 'autopilot.qc-status/2' })), QC_WANT)).toBe(null)
  expect(readQc(JSON.stringify(qcFact({ state: 'maybe' })), QC_WANT)).toBe(null)
  expect(readQc('{nope', QC_WANT)).toBe(null)
  expect(readQc(JSON.stringify(qcFact({ state: 'ok', evidence: 'trailer' })), QC_WANT)).toEqual({ state: 'ok', range: 'abc..HEAD', protected_files_count: 2, evidence: 'trailer' })
})
// P7a advisory bridge: the hooks append {id, kind, severity, text, at} rows to <live>/advisories/<sid>.jsonl; the mod toasts each new
// row of THIS session once, text unchanged, and counts them for a band chip. RED before advisories.ts + pollAdvisories existed.
const ADV_PATH = (sid: string) => LIVE + '/advisories/' + sid + '.jsonl'
const advRow = (id: string, text: string, at = '2026-10-04T10:00:10.000Z', kind = 'cost-tracker') => j({ id, kind, severity: 'warn', text, at })
for (const surface of SURFACES) {
  test('advisory bridge: each new row of this session is one toast with the unchanged text, never repeated (' + surface + ')', async ($, on) => {
    const files = base()
    files[ADV_PATH(SID_A)] = advRow('a1', 'cost-tracker: session s has read 1,100 cache tokens — unchanged text') + '\n'
    const w = world(on, files)
    await start($, surface)
    expect(w.toasts).toEqual(['cost-tracker: session s has read 1,100 cache tokens — unchanged text'])
    await w.clock.advance(5000)
    expect(w.toasts.length).toBe(1) // seen: no repeat
    w.files[ADV_PATH(SID_A)] += advRow('a2', 'Context budget T1: second', '2026-10-04T10:00:40.000Z', 'context-budget-t1') + '\n' + 'not json\n'
    await w.clock.advance(5000)
    expect(w.toasts).toEqual(['cost-tracker: session s has read 1,100 cache tokens — unchanged text', 'Context budget T1: second'])
  })

  test('advisory bridge: another session\'s file is never read, a row older than 5 minutes at first read is history (' + surface + ')', async ($, on) => {
    const files = base()
    files[ADV_PATH(SID_B)] = advRow('b1', 'OTHER SESSION') + '\n'
    files[ADV_PATH(SID_A)] = advRow('old1', 'OLD HISTORY', '2026-10-04T09:30:00.000Z') + '\n' + advRow('new1', 'FRESH') + '\n'
    const w = world(on, files)
    await start($, surface)
    expect(w.toasts).toEqual(['FRESH'])
    expect(w.reads.filter(p => p === ADV_PATH(SID_B))).toEqual([])
  })

  test('advisory bridge: no advisories file is silence, and the mod writes nothing (' + surface + ')', async ($, on) => {
    const w = world(on, base())
    await start($, surface)
    await w.clock.advance(5000)
    expect(w.toasts).toEqual([])
    expect(w.writes).toEqual([])
  })
}

// ==================== stage-graph P7: the one-line band (contract ②) and the eight-tab panel ====================
// RED before the change (the two-line band): every "P7 band" / "P7 panel" case below fails (no slot, no ⓘ, no Legend / Graph / Spend / Hygiene tabs).
const THEME = ['claude', 'warning', 'error', 'success', 'suggestion', 'inactive', 'subtle']

// the rich world: a marker with the §2.9 fields, review + qc, decisions with a ladder rung, brain spend 120.4 / 150, load source + residue, a stage walk
function richWorld(): Tree {
  const files = base()
  files[AHOME + '/session-mode/' + SID_A + '.json'] = j({
    session_id: SID_A, level: 'l5', project_key: KEY, root_run_id: ROOT, expires_at: '2026-10-05T10:00:00.000Z',
    size: 'M', urgent: true, bug: false, high_risk: false, stage: 'implement', stage_set_at: '2026-10-04T09:57:30.000Z',
    unit: { kind: 'deliverable', index: 3, total: 5, label: 'band' }, review_families: ['openai', 'xai'],
  })
  files[LIVE + '/runs/' + KEY + '--' + ROOT + '.json'] = j(envelope({ host_today_brain_usd: 120.4, brain_cap_usd: 150 }))
  files[LIVE + '/runs/' + KEY + '.review.json'] = j({
    schema: 'autopilot.review/1', project_key: KEY, published_at: PUBLISHED,
    plan: { logical_plan_id: 'plan-x', generation: 2, max_generations: 2, terminal: false, verdict: 'CONDITIONAL', seats: [{ id: 'sol_chair', family: 'openai', status: 'STOP' }], updated_at: PUBLISHED },
    code: { phase: 'p7', generation: 3, base: '1111111122222222', head: 'aaaaaaaabbbbbbbb', converged: false, at: PUBLISHED, seats: [{ id: 's0', family: 'minimax', status: 'reviewed', verdict: 'FIX-THEN-SHIP' }] },
  })
  files[LIVE + '/runs/' + KEY + '.qc.json'] = j({ schema: 'autopilot.qc-status/1', scope: { project_key: KEY, root_run_id: null }, state: 'ok', range: '1111111122222222..aaaaaaaabbbbbbbb', protected_files_count: 2, evidence: 'trailer' })
  files[LIVE + '/runs/' + KEY + '--' + ROOT + '.decisions.json'] = j({
    schema: 'autopilot.decisions-sidecar/1', scope: { project_key: KEY, repo_identity: 'git-common-dir:/work/repo/.git', root_run_id: ROOT },
    count: 3, irreversible_count: 1, undocumented_dispatches: 1, writers_wired: ['engine', 'next-pick'], rows: [],
    ladder: { rung: 'U2', at: '2026-10-04T09:55:30.000Z' },
  })
  files[LIVE + '/load-source.json'] = j({
    schema: 'autopilot.load-source/1', checked_at: PUBLISHED, plugin_version: '2.37.0', source: 'dev', source_basis: 'dev_link', marketplace: 'directory',
    behind_upstream: 3, flags: [], stale_cache_dirs: [],
  })
  files[LIVE + '/runs/' + KEY + '.residue.json'] = j({ schema: 'autopilot.residue/1', project_key: KEY, at: PUBLISHED, reapable_worktrees: 2, by_class: { 'clean-integrated': 1, 'missing-dir': 1 }, source: 'repo-residue-sweep scan',
    needs_human_count: 2, needs_human_bytes: 3 * 1048576, auto_ran_at: '2026-10-04T07:00:30.000Z', auto_removed_count: 2, auto_archived_count: 1,
    needs_human: [
      { kind: 'worktree', path: '/home/u/proj/.claude/worktrees/hands-x', class: 'dirty', age_days: 4.2, bytes: 2097152, reason: 'failure', command: 'git -C /home/u/proj worktree remove --force /home/u/proj/.claude/worktrees/hands-x' },
      { kind: 'branch', branch: 'feature/old', class: 'unintegrated-branch', age_days: 20, bytes: null, reason: null, command: 'git branch -D feature/old' },
    ] })
  files[LIVE + '/stage/' + SID_A + '.json'] = j({
    schema: 'autopilot.stage-walk/1', sid: SID_A, size: 'M', urgent: true, bug: false, high_risk: false, units: 5,
    nodes: ['spec', 'plan', 'implement', 'verify', 'finish'], walk: ['spec', 'plan', 'implement', 'verify', 'finish'], entry: 'spec', terminal: 'finish',
    unit_kind: 'deliverable', current: 'implement', stage_set_at: '2026-10-04T09:57:30.000Z', at: PUBLISHED,
  })
  return files
}

const RICH_209 = '⏸ 疑似卡住 │ M!·l5 ▸ implement ◷3m │ ▰▰▰▱▱ 3/5 ·2族 │ ⚙2 ⏸1 │ R3 ⟲ · QC ✓ │ ◆3 ?1 U2 │ $120/150 │ dev ↓3 · wt 2 │ ⓘ'
const RICH_WIDTHS: [number, string][] = [
  [209, RICH_209],
  [160, RICH_209],
  [159, '⏸ 疑似卡住 │ M!·l5 ▸ implement ◷3m │ ▰▰▰▱▱ 3/5 ·2族 │ ⚙2 ⏸1 │ R3 ⟲ · QC ✓ │ ◆3 ?1 U2 │ $120/150 │ ⓘ'],
  [140, '⏸ 疑似卡住 │ M!·l5 ▸ implement ◷3m │ ▰▰▰▱▱ 3/5 ·2族 │ ⚙2 ⏸1 │ R3 ⟲ · QC ✓ │ ◆3 ?1 U2 │ $120/150 │ ⓘ'],
  [139, '⏸ 疑似卡住 │ M!·l5 ▸ implement ◷3m │ ▰▰▰▱▱ 3/5 ·2族 │ ⚙2 ⏸1 │ R3 ⟲ · QC ✓ │ ⓘ'],
  [120, '⏸ 疑似卡住 │ M!·l5 ▸ implement ◷3m │ ▰▰▰▱▱ 3/5 ·2族 │ ⚙2 ⏸1 │ R3 ⟲ · QC ✓ │ ⓘ'],
  [119, '⏸ 疑似卡住 │ M!·l5 ▸ implement │ ▰▰▰▱▱ 3/5 ·2族 │ ⚙2 ⏸1 │ ⓘ'],
  [80, '⏸ 疑似卡住 │ M!·l5 ▸ implement │ ▰▰▰▱▱ 3/5 ·2族 │ ⚙2 ⏸1 │ ⓘ'],
  [79, '⏸ 疑似卡住 │ ▰▰▰▱▱ │ ⚙2 ⏸1 │ ⓘ'],
  [60, '⏸ 疑似卡住 │ ▰▰▰▱▱ │ ⚙2 ⏸1 │ ⓘ'],
]

type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
function walkAll(n: Drawn, out: Drawn[] = []): Drawn[] {
  out.push(n)
  for (const c of n.children || []) if (typeof c !== 'string') walkAll(c as Drawn, out)
  return out
}
// every drawn node uses theme keys as text colour only: no backgroundColor, no inverse, no raw colour
function expectThemeOnly(tree: Drawn) {
  for (const n of walkAll(tree)) {
    const p = n.props || {}
    expect(p.backgroundColor).toBeUndefined()
    expect(p.inverse).toBeUndefined()
    if (p.color !== undefined) expect(THEME).toContain(p.color as string)
  }
}
const joined = (texts: string[]) => texts.join('')

for (const surface of SURFACES) {
  test('P7 band: one line; the rich fixture draws every slot at 209 columns, in priority order (' + surface + ')', async ($, on) => {
    world(on, richWorld())
    await start($, surface)
    const line = await bandLine($, surface, 209)
    expect(line.text).toBe(RICH_209)
    expect(displayWidth(line.text)).toBeLessThanOrEqual(209)
    // one line: a Box row whose children are Texts and the ⓘ Button, no column and no second row
    const tree = line.tree as Drawn
    expect(tree.type).toBe('Box')
    expect((tree.children || []).every(c => typeof c !== 'string' && ((c as Drawn).type === 'Text' || (c as Drawn).type === 'Button'))).toBe(true)
  })

  for (const [cols, expected] of RICH_WIDTHS) {
    test('P7 band: width table at ' + cols + ' columns draws exactly the expected line (' + surface + ')', async ($, on) => {
      world(on, richWorld())
      await start($, surface)
      const line = await bandLine($, surface, cols)
      expect(line.text).toBe(expected)
      expect(displayWidth(line.text)).toBeLessThanOrEqual(cols)
      expect(line.info).toBeDefined() // the ⓘ is there at every width
    })
  }

  test('P7 band: each slot has its theme key (text colour only) (' + surface + ')', async ($, on) => {
    world(on, richWorld())
    await start($, surface)
    const line = await bandLine($, surface, 209)
    const colored = walkTexts(line.tree).map(n => [textOf(n), n.props?.color as string | undefined] as const)
    const colorOf = (t: string) => colored.find(([x]) => x === t)?.[1]
    expect(colorOf('⏸ 疑似卡住')).toBe('error') // verdict
    expect(colorOf('implement')).toBe('claude') // position: the stage
    expect(colorOf('M!·l5 ▸ ')).toBeUndefined() // the rest of the position is the default colour
    expect(colorOf('▰▰')).toBe('success') // unit bar: done cells
    expect(colored.filter(([x]) => x === '▰')[0]?.[1]).toBe('claude') // the current cell
    expect(colorOf('▱▱')).toBe('inactive') // cells to come
    expect(colorOf('⚙2')).toBeUndefined()
    expect(colorOf(' ⏸1')).toBe('error') // stalled
    expect(colorOf('QC ✓')).toBe('success')
    expect(colorOf('◆3')).toBe('claude')
    expect(colorOf('?1')).toBe('inactive')
    expect(colorOf('U2')).toBeUndefined()
    expect(colorOf('$120/150')).toBe('warning') // 80.3 % of the cap
    expect(colored.filter(([x]) => x === ' │ ').every(([, c]) => c === 'subtle')).toBe(true)
    expectThemeOnly(line.tree as Drawn)
  })

  test('P7 band: an empty slot is skipped with no doubled separator; a bare world is verdict + dispatch + ⓘ (' + surface + ')', async ($, on) => {
    world(on, base())
    await start($, surface)
    const text = (await bandLine($, surface, 209)).text
    expect(text).toBe('⏸ 疑似卡住 │ ⚙2 ⏸1 │ ⓘ')
    expect(text).not.toContain('│  │')
  })

  test('P7 band: the ⓘ is a plain Button with autoFocus and no hotkey; pressing it opens the pane on the Legend tab (' + surface + ')', async ($, on) => {
    const w = world(on, richWorld())
    await start($, surface)
    for (const cols of [209, 119, 60]) {
      const ui = await $.ui.mount({ plugin: 'autopilot', surface, component: 'AbovePrompt', props: { ...BAND_PROPS, bodyColumns: cols }, viewport: { columns: cols, rows: 50, isFullscreen: true } })
      const info = (await ui.find({ type: 'Button' })) as Drawn
      expect(info.props?.plain).toBe(true)
      expect(info.props?.autoFocus).toBe(true)
      expect(info.props?.hotkey).toBeUndefined()
      expect(JSON.stringify(info)).toContain('ⓘ')
      await ui.unmount()
    }
    const ui = await $.ui.mount({ plugin: 'autopilot', surface, component: 'AbovePrompt', props: BAND_PROPS, viewport: { columns: 120, rows: 50, isFullscreen: true } })
    await ui.press({ key: 'info' })
    await ui.unmount()
    expect(w.opens.map(o => o.id)).toEqual(['autopilot-live'])
    // a keyboard press opens the pane WITH the keyboard and Escape-to-close
    expect(w.opens[0]?.focus).toBe(true)
    expect(w.opens[0]?.closeOnEscape).toBe(true)
    const pane = await $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-live', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
    const texts = walkTexts((await pane.drawn()) as Node).map(textOf)
    // the keyboard lands on the open tab's button, so Enter acts at once (the ring does not start on nothing)
    const tabButtons = (await pane.findAll({ type: 'Button' })) as Drawn[]
    expect(tabButtons.length).toBe(8)
    expect(tabButtons.filter(b => b.props?.autoFocus === true).length).toBe(1)
    await pane.unmount()
    expect(texts.some(t => t.startsWith('圖例'))).toBe(true) // the Legend tab, not Now
    expect(texts.some(t => t.startsWith('session $'))).toBe(false)
  })

  test('P7 band: the info press cycles tabs while the pane is open; closed it opens on Legend (' + surface + ')', async ($, on) => {
    const w = world(on, richWorld())
    await start($, surface)
    const band = () => $.ui.mount({ plugin: 'autopilot', surface, component: 'AbovePrompt', props: BAND_PROPS, viewport: { columns: 120, rows: 50, isFullscreen: true } })
    const shownTab = async () => {
      const pane = await $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-live', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
      const tab = (await pane.findAll({ type: 'Button' }) as Drawn[]).find(b => b.props?.autoFocus === true)?.props?.key
      await pane.unmount()
      return tab
    }
    const press = async () => { const ui = await band(); await ui.press({ key: 'info' }); await ui.unmount() }
    await press() // closed -> Legend
    expect(await shownTab()).toBe('legend')
    await press()
    expect(await shownTab()).toBe('now')
    await press()
    expect(await shownTab()).toBe('graph')
    // a mouse click on a tab, then the press continues from the clicked tab
    const pane = await $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-live', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
    await pane.press({ key: 'review' })
    await pane.unmount()
    await press()
    expect(await shownTab()).toBe('decisions')
    for (const want of ['spend', 'hygiene', 'legend', 'now']) { await press(); expect(await shownTab()).toBe(want) } // wraps after Hygiene
    // closed again (Escape / the person closes it): the next press is Legend, not the tab after Now
    w.panes = []
    await press()
    expect(await shownTab()).toBe('legend')
  })

  test('P7 band: a non-ok snapshot is one dim line `<reason> │ ⓘ`, the reason cut to fit (' + surface + ')', async ($, on) => {
    const files = base()
    delete files[LIVE + '/runs/' + KEY + '--' + ROOT + '.json']
    delete files[LIVE + '/runs/' + KEY + '.json']
    world(on, files)
    await start($, surface)
    const wide = await bandLine($, surface, 209)
    expect(wide.text).toBe('unavailable · run: autopilot status runs --watch --project ' + KEY + ' │ ⓘ')
    expect(walkTexts(wide.tree)[0].props?.dimColor).toBe(true)
    const narrow = await bandLine($, surface, 40)
    expect(displayWidth(narrow.text)).toBeLessThanOrEqual(40)
    expect(narrow.text.endsWith('… │ ⓘ')).toBe(true)
    expect(narrow.info).toBeDefined()
  })

  test('P7 band: the former second line is gone; the reason, attention and awaited decision are on the Now tab (' + surface + ')', async ($, on) => {
    const files = richWorld()
    files[AHOME + '/review/' + KEY + '/2026-10-04/' + ROOT + '/current/model.json'] = j(model({ needs_decision: true, decision: { question: '要合併 plan 還是拆開？', options: [{ label: '合併', consequence: '一次驗收' }], not_authorized: null } }))
    world(on, files)
    await start($, surface)
    const band = await bandLine($, surface, 209)
    expect(band.text).not.toContain('要合併 plan 還是拆開？')
    expect(band.text.includes('\n')).toBe(false)
    const now = (await paneParts($, surface, 'now')).texts
    expect(now).toContain('要合併 plan 還是拆開？')
  })

  test('P7 panel: the tab strip is eight Buttons in contract order (' + surface + ')', async ($, on) => {
    world(on, richWorld())
    await start($, surface)
    const pane = await $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-live', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
    const buttons = walkAll((await pane.drawn()) as Drawn).filter(n => n.type === 'Button').map(n => n.props?.key as string)
    await pane.unmount()
    expect(buttons).toEqual(['legend', 'now', 'graph', 'dispatch', 'review', 'decisions', 'spend', 'hygiene'])
  })

  test('P7 panel: every tab renders its fixture facts, theme colours only (' + surface + ')', async ($, on) => {
    world(on, richWorld())
    await start($, surface)
    const tab = async (id: string) => paneParts($, surface, id)
    const legend = await tab('legend')
    expect(legend.texts[0]).toContain('圖例')
    for (const glyph of ['▲ 要你決定', '⏸ 疑似卡住', '✓ 完成待驗收', '● 進行中', '◌ 待命', '⚙2', '⟲', 'QC owed', '◆3', '?1', '$120/150', 'wt 2', 'ⓘ']) expect(joined(legend.texts)).toContain(glyph)
    expectThemeOnly(legend.tree as Drawn)

    const now = await tab('now')
    expect(now.texts[0]).toBe('session $0.42 · host $3.10 · ctx 37%')
    expect(joined(now.texts)).toContain('position  M!·l5 ▸ implement ◷3m')
    expect(joined(now.texts)).toContain('unit  ▰▰▰▱▱ 3/5 ·2族 band (deliverable)')
    expect(now.texts.some(t => t.startsWith('最久的派工 4m 沒有輸出'))).toBe(true) // the reason moved here from the second band line
    expectThemeOnly(now.tree as Drawn)

    const graph = await tab('graph')
    expect(graph.texts).toContain('M · urgent · 5 units · unit kind deliverable')
    expect(joined(graph.texts)).toContain('⊢ spec → plan → implement → verify → finish ⊣')
    const nodeColors = Object.fromEntries(walkTexts(graph.tree).map(n => [textOf(n), n.props?.color]))
    expect(nodeColors['⊢ spec']).toBe('success')
    expect(nodeColors['plan']).toBe('success')
    expect(nodeColors['implement']).toBe('claude')
    expect(nodeColors['verify']).toBe('subtle')
    expect(nodeColors['finish ⊣']).toBe('subtle')
    expect(graph.texts).toContain('entry spec · terminal finish · now implement')
    expectThemeOnly(graph.tree as Drawn)

    const dispatch = await tab('dispatch')
    expect(dispatch.texts.some(t => t.startsWith('r1 · implementer'))).toBe(true)

    const review = await tab('review')
    expect(review.texts).toContain('code review · p7 · R3 · 11111111..aaaaaaaa · open')
    expect(review.texts).toContain('QC · ok · range 11111111..aaaaaaaa · 2 protected file(s) · evidence trailer')
    expectThemeOnly(review.tree as Drawn)

    const decisions = await tab('decisions')
    expect(decisions.texts).toContain('代你決定 3 件（1 件不可逆）')
    expect(decisions.texts).toContain('1 件派工無決策紀錄')
    expect(decisions.texts).toContain('ladder · U2 · 2026-10-04T09:55:30.000Z · 5m ago')

    const spend = await tab('spend')
    expect(spend.texts).toContain('session $0.42')
    expect(spend.texts).toContain('host today (all tiers) $3.10')
    expect(spend.texts).toContain('host today (brain tier) $120.40 / $150.00 · 80 %')
    expect(spend.texts).toContain('cost fuse · warn')
    expectThemeOnly(spend.tree as Drawn)

    const hygiene = await tab('hygiene')
    expect(hygiene.texts).toContain('load source · dev ↓3')
    expect(hygiene.texts.some(t => t.includes('plugin 2.37.0 · source dev · marketplace directory · behind upstream 3'))).toBe(true)
    expect(hygiene.texts).toContain('2 need you · 3 MB · auto 3h0m ago: −2 wt, 1 branches archived')
    expect(hygiene.texts).toContain('worktree …/worktrees/hands-x · dirty · 4d · 2 MB · failure')
    expect(hygiene.texts).toContain('  git -C /home/u/proj worktree remove --force /home/u/proj/.claude/worktrees/hands-x')
    expect(hygiene.texts).toContain('branch feature/old · unintegrated-branch · 20d · —')
    expectThemeOnly(hygiene.tree as Drawn)
  })

  test('P7 panel: a missing fact is an explicit "no data" line, never an empty tab (' + surface + ')', async ($, on) => {
    world(on, base())
    await start($, surface)
    const ndata = async (id: string) => (await paneParts($, surface, id)).texts.filter(t => t.startsWith('no data'))
    expect(await ndata('now')).toEqual(['no data · no stage recorded for this session', 'no data · no unit recorded'])
    expect(await ndata('graph')).toEqual(['no data · no stage walk published for this session'])
    expect(await ndata('review')).toEqual(['no data · no review published', 'no data · no QC status published'])
    expect(await ndata('decisions')).toEqual(['no data · no decisions sidecar published'])
    expect(await ndata('spend')).toEqual(['no data · brain-tier spend today is not published'])
    expect(await ndata('hygiene')).toEqual(['no data · no load source published', 'no data · no worktree residue published'])
    for (const id of ['legend', 'now', 'graph', 'dispatch', 'review', 'decisions', 'spend', 'hygiene']) {
      expect((await paneParts($, surface, id)).texts.length).toBeGreaterThan(1) // never just the header
    }
  })

  test('P7 panel: the cost fuse mode comes from the config file; a value outside block / warn / off is warn (' + surface + ')', async ($, on) => {
    const files = richWorld()
    files[AHOME + '/config.json'] = j({ cost_fuse: { mode: 'block' } })
    const w = world(on, files)
    await start($, surface)
    expect((await paneParts($, surface, 'spend')).texts).toContain('cost fuse · block')
    files[AHOME + '/config.json'] = j({ cost_fuse: { mode: 'loud' } })
    await w.clock.advance(5000)
    expect((await paneParts($, surface, 'spend')).texts).toContain('cost fuse · warn')
  })

  test('P7 panel: no drawn node on the band or any tab uses backgroundColor, inverse or a non-theme colour (' + surface + ')', async ($, on) => {
    const files = richWorld()
    files[LIVE + '/runs/' + KEY + '--' + ROOT + '.json'] = j(envelope({ host_today_brain_usd: 160, brain_cap_usd: 150 })) // spend at error
    world(on, files)
    await start($, surface)
    for (const cols of [209, 139, 79]) expectThemeOnly((await bandLine($, surface, cols)).tree as Drawn)
    for (const id of ['legend', 'now', 'graph', 'dispatch', 'review', 'decisions', 'spend', 'hygiene']) expectThemeOnly((await paneParts($, surface, id)).tree as Drawn)
    expect(walkTexts((await bandLine($, surface, 209)).tree).find(n => textOf(n) === '$160/150')?.props?.color).toBe('error')
  })
}

test('P7 model: displayWidth counts East Asian wide as 2, combining as 0 and the band glyphs as 1', () => {
  expect(displayWidth('abc')).toBe(3)
  expect(displayWidth('要你決定')).toBe(8)
  expect(displayWidth('族')).toBe(2)
  expect(displayWidth('Ａ')).toBe(2) // fullwidth latin
  expect(displayWidth('é')).toBe(1) // combining acute
  expect(displayWidth('▲⏸✓●◌▸◷▰▱⚙◆⟲ⓘ│')).toBe(14)
  expect(displayWidth('')).toBe(0)
  expect(truncateToWidth('要你決定要你決定', 7)).toBe('要你決…')
  expect(displayWidth(truncateToWidth('要你決定要你決定', 7))).toBeLessThanOrEqual(7)
  expect(truncateToWidth('short', 10)).toBe('short')
  expect(truncateToWidth('abcdef', 4)).toBe('abc…')
})

test('P7 model: marker §2.9 fields are parsed, a wrong type reads as absent', () => {
  const m = readMarker({ size: 'L', urgent: true, level: 'l6', stage: 'verify', stage_set_at: '2026-10-04T09:00:00.000Z', unit: { kind: 'phase', index: 2, total: 4, label: 'x' }, review_families: ['a', 'b', 3] })
  expect(m).toEqual({ size: 'L', urgent: true, bug: false, high_risk: false, level: 'l6', stage: 'verify', stage_set_at_ms: Date.parse('2026-10-04T09:00:00.000Z'), unit: { kind: 'phase', index: 2, total: 4, label: 'x' }, review_families: ['a', 'b'] })
  const bad = readMarker({ size: 'HUGE', urgent: 'yes', level: 5, stage: '', stage_set_at: 'x', unit: { kind: 'phase', index: 0, total: 4 }, review_families: 'a' })
  expect(bad).toEqual({ size: null, urgent: false, bug: false, high_risk: false, level: null, stage: null, stage_set_at_ms: null, unit: null, review_families: [] })
  expect(readMarker(null)).toBeNull()
})

test('P7 model: slot texts and theme keys', () => {
  const NOW = Date.parse('2026-10-04T10:00:30.000Z')
  const mk = (over: Record<string, unknown>) => readMarker({ size: 'M', level: 'l5', stage: 'implement', stage_set_at: '2026-10-04T09:57:30.000Z', ...over })
  const text = (s: Slot | null) => (s === null ? null : s.segs.map(g => g.text).join(''))
  // position: size[!]·level ▸ stage ◷age; level omitted when null; no stage = no slot
  expect(text(slotPosition(mk({}), NOW))).toBe('M·l5 ▸ implement ◷3m')
  expect(text(slotPosition(mk({ urgent: true, level: null }), NOW))).toBe('M! ▸ implement ◷3m')
  expect(text(slotPosition(mk({ stage_set_at: undefined }), NOW))).toBe('M·l5 ▸ implement')
  expect(slotPosition(mk({ stage: null }), NOW)).toBeNull()
  expect(slotPosition(null, NOW)).toBeNull()
  expect(slotPosition(mk({}), NOW)?.segs.find(g => g.tag === 'stage')?.color).toBe('claude')
  // unit: bar + k/N + 族; N > 10 scales to 10 cells; no unit = no slot
  const u = (index: number, total: number, fam: string[] = []) => slotUnit(mk({ unit: { kind: 'deliverable', index, total, label: '' }, review_families: fam }))
  expect(text(u(1, 3))).toBe('▰▱▱ 1/3')
  expect(text(u(3, 3, ['a']))).toBe('▰▰▰ 3/3 ·1族')
  expect(u(2, 4)?.segs.map(g => [g.text, g.color])).toEqual([['▰', 'success'], ['▰', 'claude'], ['▱▱', 'inactive'], [' 2/4', undefined]])
  expect(text(u(7, 20))).toBe('▰▰▰▰▰▰▰▱▱▱ 7/20'.replace('▰▰▰▰▰▰▰▱▱▱', '▰▰▰▰▱▱▱▱▱▱')) // ceil(7*10/20) = 4th cell
  expect(slotUnit(mk({ unit: null }))).toBeNull()
  // dispatch: zero counts omitted
  expect(text(slotDispatch(2, 1))).toBe('⚙2 ⏸1')
  expect(text(slotDispatch(0, 1))).toBe('⏸1')
  expect(text(slotDispatch(3, 0))).toBe('⚙3')
  expect(slotDispatch(0, 0)).toBeNull()
  // review: R<n> ⟲ · QC; QC alone has no leading separator
  const rv = readReview(JSON.stringify({ schema: 'autopilot.review/1', project_key: KEY, code: { generation: 4, seats: [] } }), KEY)
  const qc = (state: string) => readQc(JSON.stringify({ schema: 'autopilot.qc-status/1', scope: { project_key: KEY, root_run_id: null }, state }), { project_key: KEY, root_run_id: null })
  expect(text(slotReview(rv, qc('owed')))).toBe('R4 ⟲ · QC owed')
  expect(slotReview(rv, qc('owed'))?.segs[2]?.color).toBe('warning')
  expect(text(slotReview(null, qc('ok')))).toBe('QC ✓')
  expect(text(slotReview(rv, qc('not_needed')))).toBe('R4 ⟲')
  expect(slotReview(null, qc('unknown'))).toBeNull()
  // decisions
  const dv = (over: Record<string, unknown>) => ({ rows: [], count: 0, irreversible: 0, writers: [], undocumented: 0, identity: null, root: null, ladder: null, ...over }) as never
  expect(text(slotDecisions(dv({ count: 2, undocumented: 1, ladder: { rung: 'U3', at: 'x' } })))).toBe('◆2 ?1 U3')
  expect(text(slotDecisions(dv({ undocumented: 4 })))).toBe('?4')
  expect(slotDecisions(dv({}))).toBeNull()
  expect(slotDecisions(null)).toBeNull()
  // spend: integers; warning from 80 %, error from 100 %
  const colorOf = (brain: number) => slotSpend({ brain, cap: 150 })?.segs[0].color
  expect(text(slotSpend({ brain: 119.6, cap: 150 }))).toBe('$120/150')
  expect(colorOf(119)).toBeUndefined()
  expect(colorOf(120)).toBe('warning')
  expect(colorOf(149)).toBe('warning')
  expect(colorOf(150)).toBe('error')
  expect(slotSpend(null)).toBeNull()
  // hygiene: chip + wt n (n > 0 only)
  const ls = (over: Record<string, unknown> = {}) => readLoadSource(JSON.stringify({ schema: 'autopilot.load-source/1', source: 'dev', marketplace: 'directory', behind_upstream: 0, flags: [], stale_cache_dirs: [], ...over }))
  const rs = (n: number) => readResidue(JSON.stringify({ schema: 'autopilot.residue/1', project_key: KEY, reapable_worktrees: 9, by_class: {}, needs_human_count: n }), KEY)
  expect(text(slotHygiene(ls(), readResidue(JSON.stringify({ schema: 'autopilot.residue/1', project_key: KEY, reapable_worktrees: 5, by_class: {} }), KEY)))).toBe('dev') // reapable alone draws nothing: auto-reap clears it, needs_human_count is the number
  expect(text(slotHygiene(ls(), rs(2)))).toBe('dev · wt 2')
  expect(text(slotHygiene(ls(), rs(0)))).toBe('dev')
  expect(text(slotHygiene(null, rs(3)))).toBe('wt 3')
  expect(slotHygiene(ls({ flags: ['marketplace_not_directory'] }), null)?.segs[0].color).toBe('warning')
  expect(slotHygiene(null, rs(0))).toBeNull()
  // an older fact without the needs_human fields reads as 0 / [] (no wt segment, no rows); the list is capped at 20
  const old = readResidue(JSON.stringify({ schema: 'autopilot.residue/1', project_key: KEY, reapable_worktrees: 4, by_class: {} }), KEY)
  expect(old?.needs_human_count).toBe(0)
  expect(old?.needs_human).toEqual([])
  const many = readResidue(JSON.stringify({ schema: 'autopilot.residue/1', project_key: KEY, reapable_worktrees: 0, by_class: {}, needs_human_count: 25, needs_human: Array.from({ length: 25 }, (_, i) => ({ kind: 'branch', branch: 'b' + i, class: 'x', age_days: 1, bytes: null, reason: null, command: 'c' })) }), KEY)
  expect(many?.needs_human.length).toBe(20)
  expect(readResidue(JSON.stringify({ schema: 'autopilot.residue/1', project_key: OTHER_KEY, reapable_worktrees: 1 }), KEY)).toBeNull()
  expect(readStageWalk(JSON.stringify({ schema: 'autopilot.stage-walk/1', sid: 'other', walk: ['a'] }), SID_A)).toBeNull()
})

test('P7 model: the stage text is cut with … when the line still does not fit, never the verdict or the ⓘ', () => {
  const slots = bandSlots({
    verdict: { mark: '●', word: '進行中', key: 'suggestion' }, marker: readMarker({ size: 'M', level: 'l5', stage: 'implement-' + 'x'.repeat(70), stage_set_at: '2026-10-04T09:57:30.000Z' }),
    live: 1, stalled: 0, review: null, qc: null, decisions: null, spend: null, loadSource: null, residue: null, nowMs: Date.parse('2026-10-04T10:00:30.000Z'),
  })
  const line = layoutBand(slots, 90)
  expect(displayWidth(line.text)).toBeLessThanOrEqual(90)
  expect(displayWidth(line.text)).toBeGreaterThanOrEqual(88) // cut as little as needed
  expect(line.text.startsWith('● 進行中 │ M·l5 ▸ implement')).toBe(true)
  expect(line.text.endsWith('… │ ⚙1 │ ⓘ')).toBe(true)
  expect(layoutBand(slots, 209).text).toBe('● 進行中 │ M·l5 ▸ implement-' + 'x'.repeat(70) + ' ◷3m │ ⚙1 │ ⓘ')
})

// ---- P7 review round 1 fixes ----
for (const surface of SURFACES) {
  test('P7 fix A: the band slot and the Spend tab judge the raw ratio: 119.6/150 plain, 120/150 warning, 150/150 error (' + surface + ')', async ($, on) => {
    const files = richWorld()
    const w = world(on, files)
    await start($, surface)
    const spendNode = async (brain: number) => {
      files[LIVE + '/runs/' + KEY + '--' + ROOT + '.json'] = j(envelope({ host_today_brain_usd: brain, brain_cap_usd: 150 }))
      await w.clock.advance(5000)
      const band = walkTexts((await bandLine($, surface, 209)).tree).find(n => textOf(n).startsWith('$') && textOf(n).includes('/150'))
      const tab = walkTexts((await paneParts($, surface, 'spend')).tree).find(n => textOf(n).startsWith('host today (brain tier)'))
      return [band?.props?.color, tab?.props?.color, textOf(tab as Node)] as const
    }
    const a = await spendNode(119.6) // rounds to 80 % in the old Spend tab but is below 0.8 of the cap
    expect(a[0]).toBeUndefined()
    expect(a[1]).toBeUndefined()
    expect(a[2]).toBe('host today (brain tier) $119.60 / $150.00 · 80 %')
    const b = await spendNode(120)
    expect([b[0], b[1]]).toEqual(['warning', 'warning'])
    const c = await spendNode(150)
    expect([c[0], c[1]]).toEqual(['error', 'error'])
  })

  for (const cols of [40, 30, 20, 12]) {
    test('P7 fix B: at ' + cols + ' columns the ⓘ and the verdict glyph survive and the line fits (' + surface + ')', async ($, on) => {
      world(on, richWorld())
      await start($, surface)
      const line = await bandLine($, surface, cols)
      expect(line.text.endsWith('ⓘ')).toBe(true)
      expect(line.text.startsWith('⏸')).toBe(true)
      expect(displayWidth(line.text)).toBeLessThanOrEqual(cols)
      expect(line.info).toBeDefined()
    })
  }

  test('P7 fix B: below the table the unit bar goes first, then the stalled count, then the live count, then the verdict word (' + surface + ')', async ($, on) => {
    world(on, richWorld())
    await start($, surface)
    const at = async (n: number) => (await bandLine($, surface, n)).text
    expect(await at(30)).toBe('⏸ 疑似卡住 │ ▰▰▰▱▱ │ ⚙2 ⏸1 │ ⓘ') // exactly fits
    expect(await at(29)).toBe('⏸ 疑似卡住 │ ⚙2 ⏸1 │ ⓘ') // bar first
    expect(await at(21)).toBe('⏸ 疑似卡住 │ ⚙2 │ ⓘ') // then the stalled count
    expect(await at(18)).toBe('⏸ 疑似卡住 │ ⓘ') // then the live count
    expect(await at(12)).toBe('⏸ 疑似… │ ⓘ')
  })

  test('P7 fix C: the Now tab row is verdict + project + elapsed, the stage is drawn once, progress is its own line (' + surface + ')', async ($, on) => {
    world(on, richWorld())
    await start($, surface)
    const now = await paneParts($, surface, 'now')
    const p = await bandParts($, surface)
    expect(p.row).toBe('⏸ 疑似卡住 repo · 10m')
    expect(now.texts.filter(t => t === 'implement').length).toBe(1) // position only; the old row repeated the stage
    expect(now.texts).toContain('progress  —')
    const verdict = walkTexts(now.tree).find(n => textOf(n) === '⏸ 疑似卡住')
    expect(verdict?.props?.color).toBe('error')
  })
}

test('P7 fix D: a level with no valid size has no leading ·', () => {
  const NOW = Date.parse('2026-10-04T10:00:30.000Z')
  const text = (m: Record<string, unknown>) => slotPosition(readMarker({ stage: 'implement', stage_set_at: '2026-10-04T09:57:30.000Z', ...m }), NOW)?.segs.map(g => g.text).join('')
  expect(text({ level: 'l5' })).toBe('l5 ▸ implement ◷3m')
  expect(text({ size: 'HUGE', level: 'l5', urgent: true })).toBe('l5 ▸ implement ◷3m')
  expect(text({ size: 'S', level: 'l4' })).toBe('S·l4 ▸ implement ◷3m')
  expect(text({})).toBe('▸ implement ◷3m')
})
