// mods/live/pane-poll.test.ts — the console / seat-quota polls run on the real tick (register.ts liveTick -> fleetTick), whatever page the pane shows and with the pane closed.
// Regression (codeforge, feat/pane-batch2 046c8dc62 vs batch1 r4 083cf2e91): with a recording fake `fleet`, batch2 ran only `fleet tasks`; `fleet console --json` and
// `fleet seats --quota --json` were never run, so every framed page drew 「待決 ? 張（無來源：沒有 console 快照）」 and 「花費 ✗ 無來源：fleet seats --quota 還沒有結果」.
// Root cause: fleetTick / consoleTick gated both polls on `consoleOn` (a repo with .claude/console.json mode program), while batch2 draws the framed pages (which read
// both sources) in EVERY session. The world below has NO console.json, like the codeforge repro: red before the fix, green after.
// The last case (console.json present) is the positive control: the recorder sees the calls when the old gate is open, so a green run is not a deaf recorder.
// Run through `bash mods/live/run-tests.sh`.
import type { EngineInterface, On } from 'claude-code'
import { test, expect, mock } from 'claude-code/testing'
import { frameKey } from './register'
import { seatQuota } from './pages/now'

const SURFACE = 'terminal'
const HOME = '/fake/home'
const AHOME = HOME + '/.autopilot'
const LIVE = '/fake/live'
const REPO = '/work/repo'
const CWD = REPO + '/sub'
const KEY = '0000000000000001'
const ROOT = 'root-1'
const SID = 'sid-aaaa'
const PUBLISHED = '2026-10-04T10:00:00.000Z'
const NOW_FRESH = Date.parse('2026-10-04T10:00:30.000Z')
const PANE_ID = 'autopilot-live'
const TICK_MS = 5000
const TICKS = 3 // "within a few ticks": the first tick runs both (the feeds' 60 s throttle starts empty); three leave room for a slow first one

type Tree = Record<string, string>
const j = (v: unknown): string => JSON.stringify(v)

function envelope(rootRunId: string | null) {
  return {
    schema: 'autopilot.runs-live/1',
    scope: { project_key: KEY, repo_identity: 'git-common-dir:' + REPO + '/.git', root_run_id: rootRunId },
    published_at: PUBLISHED, observed_at: PUBLISHED, valid_for_s: 180, writer: null,
    runs: [{ run_id: 'r1', role: 'implementer', runner: 'codex', model: 'gpt', root_run_id: ROOT, started_at: '2026-10-04T09:50:00.000Z', fact_at: '2026-10-04T09:50:00.000Z', elapsed_s: 600, phase: 'running', alive: true, probe_age_s: 5, stall: false, rc: null, final_status: null }],
    counts: { confirmed_live: 1, exited: 0, unknown: 0, fresh_bound_s: 30 },
    sessions: { [SID]: { session_usd: 0.42, as_of: PUBLISHED } },
    host_today_usd: 3.1, host_today_as_of: PUBLISHED,
  }
}

function baseFiles(extra: Tree = {}): Tree {
  return {
    [AHOME + '/live-pointer.json']: j({ schema: 'autopilot.live-pointer/1', live_base: LIVE, autopilot_home: AHOME, written_at: PUBLISHED }),
    [AHOME + '/session-mode/' + SID + '.json']: j({ session_id: SID, level: 'l5', project_key: KEY, root_run_id: ROOT, expires_at: '2026-10-05T10:00:00.000Z' }),
    [LIVE + '/runs/' + KEY + '--' + ROOT + '.json']: j(envelope(ROOT)),
    [LIVE + '/runs/' + KEY + '.json']: j(envelope(null)),
    [LIVE + '/context/' + SID + '.json']: j({ schema_version: 1, written_at: '2026-10-04T10:00:20.000Z', context_window: { used_percentage: 37 } }),
    [REPO + '/.git/HEAD']: 'ref: refs/heads/main\n', // the repo root: findConsoleConfig stops here and reads .claude/console.json (absent unless `extra` puts it there)
    ...extra,
  }
}

type World = { files: Tree; runs: string[][]; panes: string[]; clock: ReturnType<typeof mock.clock> }

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
  if (p === CWD || p === REPO || Object.keys(files).some(k => k.startsWith(prefix))) return { kind: 'dir' as const, isLink: false as const, size: 0, mtimeMs: 0, realPath: resolve ? p : undefined }
  throw new Error('ENOENT ' + p)
}

// the engine below the mod; the fake `fleet` records every argv it is asked to run and fails each one (exit 1, no output), as a host without a fleet bus would
function world(on: On, files: Tree): World {
  const w: World = { files, runs: [], panes: [], clock: undefined as never }
  w.clock = mock.clock(on, { now: NOW_FRESH })
  on('env.get', (_$, e) => ({ value: ({ HOME, AUTOPILOT_LOCALE: 'zh-TW' } as Record<string, string>)[e.name] }))
  on('fs.read', (_$, e) => {
    const t = w.files[e.path]
    if (t === undefined) throw new Error('ENOENT ' + e.path)
    return { value: t }
  })
  on('fs.exists', (_$, e) => ({ value: w.files[e.path] !== undefined }))
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
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', (_$, e) => { if (!w.panes.includes(e.id)) w.panes.push(e.id); return { value: { isPlaced: true } } })
  on('ui.close', (_$, e) => { w.panes = w.panes.filter(id => id !== e.id); return { value: undefined } })
  on('ui.panes', () => ({ value: w.panes.map(id => ({ id, title: 'Autopilot', isShown: true, isFocused: false, isPlaced: true })) }))
  on('process.run', (_$, e) => {
    w.runs.push([...e.argv])
    return { value: { exitCode: 1, stdout: '', stderr: 'fake fleet: no bus', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return w
}

// frameKey only needs a redraw call from the engine it is handed (panePagePress); the page state it sets is the loaded mod's own (same module instance as the hooks)
const keyEngine = { ui: { invalidate: () => undefined } } as unknown as EngineInterface

// the framed pane (no legacyTabs: the batch2 pane every session draws)
const PANE_PROPS = { title: 'Autopilot', isFocused: false, bodyColumns: 120, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: { agentId: undefined } }
const mountPane = ($: any) => $.ui.mount({ plugin: 'autopilot', surface: SURFACE, component: 'Pane', requestId: PANE_ID, props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
async function drawPane($: any, errors: string[], at: string): Promise<void> {
  try {
    const pane = await mountPane($)
    await pane.drawn()
    await pane.unmount()
  } catch (e) {
    errors.push(at + ': ' + (e instanceof Error ? e.message : String(e)))
  }
}

const isConsoleRun = (a: string[]): boolean => a.join(' ').endsWith('fleet console --json') // plain, or behind `env FLEET_CONSOLE_INGEST_FROM=...`
const isSeatsRun = (a: string[]): boolean => a.join(' ') === 'fleet seats --quota --json'
const isTasksRun = (a: string[]): boolean => a[0] === 'fleet' && a[1] === 'tasks'

async function runTicks($: any, w: World, page: string | null): Promise<{ console: number; seats: number; tasks: number; drawErrors: string[] }> {
  const drawErrors: string[] = []
  for (let i = 0; i < TICKS; i++) {
    await w.clock.advance(TICK_MS)
    if (page !== null) await drawPane($, drawErrors, page + ' tick ' + (i + 1))
  }
  const got = { console: w.runs.filter(isConsoleRun).length, seats: w.runs.filter(isSeatsRun).length, tasks: w.runs.filter(isTasksRun).length, drawErrors }
  // a real exit cancels the mod's 5 s timer (register.ts session.end), so the next case's session.start arms a timer on ITS clock
  try { await $.session.end({ reason: 'exit' }) } catch (_e) { /* a kit that cannot end the session: the next start still runs */ }
  return got
}

// the start of a case: an empty seat-feed throttle (module state shared by every test in this file, as a fresh session would have) and the session started
async function begin($: any): Promise<void> {
  seatQuota.reset()
  await $.session.start({ surface: SURFACE, cwd: CWD })
}

const PAGES_OPEN = ['now', 'decide', 'fleet', 'quota', 'dispatch', 'hygiene', 'review', 'spend'] as const

for (const page of PAGES_OPEN) {
  test('pane-poll: pane open on ' + page + ', no console.json: `fleet console --json` and `fleet seats --quota --json` each run within ' + TICKS + ' ticks', async ($, on) => {
    const w = world(on, baseFiles())
    await begin($)
    w.panes.push(PANE_ID) // the pane is open: $.ui.panes() lists it, as after the i or /live-pane
    await frameKey(keyEngine, { kind: 'page', to: page })
    const errors: string[] = []
    await drawPane($, errors, page + ' before the first tick')
    const got = await runTicks($, w, page)
    expect(got.tasks, page + ': control: the tick ran (fleet tasks) ' + j(w.runs)).toBeGreaterThan(0)
    expect(got.console, page + ': fleet console --json runs ' + j(w.runs)).toBeGreaterThan(0)
    expect(got.seats, page + ': fleet seats --quota --json runs ' + j(w.runs)).toBeGreaterThan(0)
    expect([...errors, ...got.drawErrors], page + ': the page draws without throwing').toEqual([])
  })
}

test('pane-poll: pane closed, no console.json: `fleet console --json` and `fleet seats --quota --json` each run within ' + TICKS + ' ticks', async ($, on) => {
  const w = world(on, baseFiles())
  await begin($)
  const got = await runTicks($, w, null)
  expect(w.panes, 'the pane was never opened').toEqual([])
  expect(got.tasks, 'control: the tick ran (fleet tasks) ' + j(w.runs)).toBeGreaterThan(0)
  expect(got.console, 'fleet console --json runs ' + j(w.runs)).toBeGreaterThan(0)
  expect(got.seats, 'fleet seats --quota --json runs ' + j(w.runs)).toBeGreaterThan(0)
})

test('pane-poll positive control: with .claude/console.json mode program the recorder sees both polls (pane closed), so a green case above is not a deaf recorder', async ($, on) => {
  const w = world(on, baseFiles({ [REPO + '/.claude/console.json']: j({ schema: 'autopilot.console/1', mode: 'program' }) }))
  await begin($)
  const got = await runTicks($, w, null)
  expect(got.console, 'console mode: fleet console --json runs ' + j(w.runs)).toBeGreaterThan(0)
  expect(got.seats, 'console mode: fleet seats --quota --json runs ' + j(w.runs)).toBeGreaterThan(0)
})
