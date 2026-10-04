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

const hhmm = (iso: string) => {
  const d = new Date(Date.parse(iso))
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

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
      row({ run_id: 'r2', started_at: '2026-10-04T09:55:00.000Z', fact_at: '2026-10-04T09:55:00.000Z', stall: true }),
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

async function bandText($: any, surface: (typeof SURFACES)[number], columns = 120) {
  const ui = await $.ui.mount({ plugin: 'autopilot', surface, component: 'AbovePrompt', props: BAND_PROPS, viewport: { columns, rows: 50, isFullscreen: true } })
  const el = await ui.find({ type: 'Text' }) // the band is one Text (a key prop is not kept on a Text)
  const text = el ? el.text : undefined
  await ui.unmount()
  return text as string | undefined
}

const FRESH_TEXT = () => 'running 2 · oldest ' + hhmm('2026-10-04T09:50:00.000Z') + ' · stalled 1 (telemetry) · last rc 0 · $0.42 / host $3.10 · ctx 37%'

for (const surface of SURFACES) {
  test('band: fresh envelope via the session marker, every number from the envelope / context file (' + surface + ')', async ($, on) => {
    world(on, base())
    await start($, surface)
    expect(await bandText($, surface)).toBe(FRESH_TEXT())
  })

  test('band: two sessions of one repo each show their own sid cost and ctx (' + surface + ')', async ($, on) => {
    const w = world(on, base(), NOW_FRESH, SID_B)
    await start($, surface)
    const text = await bandText($, surface)
    expect(text).toContain('$9.99 / host $3.10')
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
    const text = await bandText($, surface)
    expect(text).toContain('$— / host $—')
    expect(text).toContain('ctx —')
    expect(text).not.toContain('$0')
    expect(text).not.toContain('ctx 0')
  })

  test('band: a context file older than 120 s is absent, not stale data (' + surface + ')', async ($, on) => {
    const files = base()
    files[LIVE + '/context/' + SID_A + '.json'] = j(context(37, '2026-10-04T09:50:00.000Z'))
    world(on, files)
    await start($, surface)
    expect(await bandText($, surface)).toContain('ctx —')
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
    expect(text).toContain('running 2') // KEY's project envelope (no root), not OTHER_KEY's (missing => would be unavailable)
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
    const text = await bandText($, surface)
    expect(text).toContain('running 2')
    expect(text).toContain('$— / host $3.10')
    expect(text).toContain('ctx —')
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
    expect(await bandText($, surface)).toContain('running 2') // fresh only because published_at moved
  })

  test('band: scope mismatch is a missing file; the SSD copy is the fallback; both gone is unavailable (' + surface + ')', async ($, on) => {
    const files = base()
    files[LIVE + '/runs/' + KEY + '--' + ROOT + '.json'] = j(envelope({}, ROOT, OTHER_KEY)) // wrong project_key at our path
    files[AHOME + '/review/' + KEY + '/live/runs.' + KEY + '--' + ROOT + '.json'] = j(envelope({ host_today_usd: 7.5 }))
    const w = world(on, files)
    await start($, surface)
    expect(await bandText($, surface)).toContain('host $7.50') // served from the SSD copy
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
    expect(await bandText($, surface)).toContain('host $1.25')
  })

  test('band: counts come from the envelope, not from the rows (' + surface + ')', async ($, on) => {
    const files = base()
    files[LIVE + '/runs/' + KEY + '--' + ROOT + '.json'] = j(envelope({ counts: { confirmed_live: 5, exited: 0, unknown: 0, fresh_bound_s: 30 } }))
    world(on, files)
    await start($, surface)
    expect(await bandText($, surface)).toContain('running 5')
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
