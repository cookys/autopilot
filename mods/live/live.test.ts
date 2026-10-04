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
  opens: { id: string; title?: string }[]
  writes: string[]
  reads: string[]
  clock: ReturnType<typeof mock.clock>
}

// Registers the bottom hooks (what the engine would answer) for one test.
function world(on: On, files: Tree, nowMs = NOW_FRESH, sid = SID_A): World {
  const w: World = { files, sid: { value: sid }, cwdReal: { value: CWD }, toasts: [], opens: [], writes: [], reads: [], clock: undefined as never }
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
  on('ui.open', ($, e) => { w.opens.push({ id: e.id, title: e.title }); return { value: { isPlaced: true } } })
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

// The drawn band: line 1 is the row of Texts, line 2 (when present) the reason Text; a state band is one Text.
async function bandParts($: any, surface: (typeof SURFACES)[number], columns = 120) {
  const ui = await $.ui.mount({ plugin: 'autopilot', surface, component: 'AbovePrompt', props: BAND_PROPS, viewport: { columns, rows: 50, isFullscreen: true } })
  const tree = (await ui.drawn()) as Node
  await ui.unmount()
  const first = (tree.children || [])[0] as Node | undefined
  if (tree.type === 'Box' && first && first.type === 'Box') {
    const cells = walkTexts(first)
    return { line1: cells.map(textOf).join(''), line2: (tree.children || []).slice(1).map(c => textOf(c as Node)).join('') || undefined, last: cells[cells.length - 1], tree }
  }
  const cells = walkTexts(tree)
  return { line1: cells.map(textOf).join('\n'), line2: undefined, last: cells[cells.length - 1], tree }
}

// text a test greps: line 1, then the reason on its own line
async function bandText($: any, surface: (typeof SURFACES)[number], columns = 120) {
  const p = await bandParts($, surface, columns)
  return p.line2 === undefined ? p.line1 : p.line1 + '\n' + p.line2
}

async function paneParts($: any, surface: (typeof SURFACES)[number]) {
  const pane = await $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-live', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
  const tree = (await pane.drawn()) as Node
  const link = await pane.find({ type: 'Link' })
  await pane.unmount()
  return { texts: walkTexts(tree).map(textOf), href: link?.props.href as string | undefined, tree }
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
    await band.unmount()
    const pane = await $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-live', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
    expect((await pane.find({ type: 'Text', text: 'r1' }))).toBeDefined()
    expect((await pane.find({ type: 'Text', text: 'r3' }))).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'execution status, not progress' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'plan' })).toBeDefined() // gate table row from model.json
    const link = await pane.find({ type: 'Link' })
    expect(link?.props.href).toBe('http://localhost:9123/' + KEY + '/2026-10-04/' + ROOT + '/current/')
    expect(JSON.stringify(await pane.drawn())).not.toContain('"Image"')
    await pane.unmount()
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
    const pane = await $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-live', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
    expect((await pane.find({ type: 'Link' }))?.props.href).toBe('http://localhost:8787/' + KEY + '/2026-10-04/' + ROOT + '/current/')
    await pane.unmount()
  })

  test('pane: without a job page the link goes to the project index, and states render as text (' + surface + ')', async ($, on) => {
    const files = base()
    const w = world(on, files)
    await start($, surface)
    const pane = await $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-live', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
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
  const VERDICTS = ['要你決定', '疑似卡住', '完成待驗收', '進行中']
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
    const lead = walkTexts(p.tree)[0] as Node
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
      expect(verdictsIn(t), why).toEqual([])
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

  test('phase: no human phase in the job model, so an em dash; the process phase is never shown as a phase (' + surface + ')', async ($, on) => {
    const files = base() // rows carry phase "running" / "exited"
    put(files, null, { progress: { frozen: true, percent: 62.5, done: 5, total: 8 } })
    world(on, files)
    await start($, surface)
    const p = await bandParts($, surface)
    const phase = p.line1.split(' · ')[1]
    expect(phase).toBe('—')
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
    let pane = await paneParts($, surface)
    expect(pane.texts[0]).toBe('session $0.42 · host $3.10 · ctx 37%') // the header row stays on top
    expect(pane.texts[1]).toBe('要你決定')
    expect(pane.texts[2]).toBe('要合併 plan 還是拆開？')
    expect(pane.texts[3]).toBe('1. 合併 — 一次驗收')
    expect(pane.texts[4]).toBe('2. 拆開 — 兩次驗收')
    const dispatchAt = pane.texts.findIndex(t => t.includes('execution status, not progress'))
    expect(dispatchAt).toBeGreaterThan(4) // the table comes after, and is still there
    expect(pane.texts.some(t => t.includes('gates'))).toBe(true)
    expect(pane.href).toBe('http://localhost:8787/' + KEY + '/2026-10-04/' + ROOT + '/current/')
    // fields that do not exist are not shown: a question with no options, then no decision at all
    put(w.files, null, { needs_decision: true, decision: { question: '只有問題', options: [], not_authorized: null } })
    await w.clock.advance(5000)
    pane = await paneParts($, surface)
    expect(pane.texts.slice(1, 3)).toEqual(['要你決定', '只有問題'])
    expect(pane.texts[3]).not.toMatch(/^\d\. /)
    put(w.files, null, { needs_decision: false, decision: null })
    await w.clock.advance(5000)
    pane = await paneParts($, surface)
    expect(pane.texts).not.toContain('要你決定')
    expect(pane.texts[1]).toContain('execution status, not progress')
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
