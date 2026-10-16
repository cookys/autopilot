// TUI v2 (2026-10-10, owner-approved redesign + i18n): the band is groups joined by ` │ ` (dispatch + review share one), the wide band carries the stage walk,
//   a 10-cell spend bar and the verdict reason, `⚑N` replaces `wt N`, `QC▲` / `QC✓` replace `QC owed` / `QC ✓`; the panel is six tabs (Now Dispatch Review Spend
//   Hygiene ?) with badges, the active one bold on a `subtle` background; every word comes from mods/live/locales/{en,zh-TW}.json. This suite pins the locale to
//   zh-TW through AUTOPILOT_LOCALE (`world(...)` default; `worldEn` for the English table), so the verdict words the older cases assert are the zh-TW words.
//   Run: `bash mods/live/run-tests.sh` (gen-locales.js --check first).
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
//   (fail) progress: frozen shows the percent and the done/total; unfrozen shows "n done" plus the dim 沒有固定總數, never a percent or a star
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
import { readQc, qcChip, readReview, reviewSlot, displayWidth, truncateToWidth, layoutBand, readMarker, readResidue, readStageWalk, bandSlots, slotUnit, slotPosition, slotDispatch, slotDecisions, slotSpend, slotHygiene, slotReview, readLoadSource, PANE_TABS, verdictOf, wrapLines, bandView, readSpendHistory, hourlySpend, sparkText, SPARK_BARS, INJECTED_PREFIXES, RECENT_EXPANDED_LINES, collapsedPrompt, groupRecent, makeRecentTracker, redactSecrets, scanBackground, lastOutputLine, NO_SECTIONS, readQuota, readAccount, slotQuota, slotTab, slotUnfolds, SECTION, proxySegments } from './model'
import { reviewTabLines, legendLines, hygieneTabLines, dispatchLines, spendTabLines, recentLines } from './tabs'
import type { SessionMsg, QuotaWindow, AccountSnap } from './model'
import { makeT, resolveLocale, localeFromLanguage } from './i18n'
import { EN, ZH_TW } from './locales'
import type { Slot } from './model'
import { paneRows, runAgedOut, runEndedMs, runSubject } from './model'
import * as ui from './ui'

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
    conclusion: '驗收結論：尚未產生', needs_decision: false, decisions: [], progress: null,
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
  stats: Record<string, { size: number; mtimeMs: number }> // $.fs.stat of a file (a background command's output); any other path stats as a directory
  toasts: string[]
  panes: string[]
  opens: { id: string; title?: string; focus?: true; closeOnEscape?: true }[]
  panesThrow: boolean // $.ui.panes() rejects (the engine cannot list panes)
  panesGate: Promise<void> | null // $.ui.panes() does not answer until this settles
  openGate: Promise<void> | null // $.ui.open does not resolve (and the pane is not listed) until this settles
  writes: string[]
  reads: string[]
  lists: string[]
  statErrors: Record<string, string> // $.fs.stat rejects with this message (the engine passes a message only, no `code`)
  existsThrows: Set<string> // $.fs.exists rejects for these paths
  env: Record<string, string> // what $.env.get answers; a test may change it between ticks
  clock: ReturnType<typeof mock.clock>
}

// the English table: state texts, toasts and the English-only cases
const worldEn = (on: On, files: Tree, nowMs = NOW_FRESH, sid = SID_A) => world(on, files, nowMs, sid, 'en')

// Registers the bottom hooks (what the engine would answer) for one test.
function world(on: On, files: Tree, nowMs = NOW_FRESH, sid = SID_A, locale: 'en' | 'zh-TW' | null = 'zh-TW', env: Record<string, string> = {}): World {
  const w: World = { files, sid: { value: sid }, cwdReal: { value: CWD }, stats: {}, toasts: [], panes: [], opens: [], panesThrow: false, panesGate: null, openGate: null, writes: [], reads: [], lists: [], statErrors: {}, existsThrows: new Set(), env: { HOME, ...(locale === null ? {} : { AUTOPILOT_LOCALE: locale }), ...env }, clock: undefined as never }
  w.clock = mock.clock(on, { now: nowMs })
  // the suite pins zh-TW: the band words these cases assert are the zh-TW table's. Answered here rather than by mock.env, which keeps
  // its own copy, so a test can change a variable between ticks
  on('env.get', ($, e) => ({ value: w.env[e.name] }))
  on('fs.read', ($, e) => {
    w.reads.push(e.path)
    const t = w.files[e.path]
    if (t === undefined) throw new Error('ENOENT ' + e.path)
    return { value: t }
  })
  on('fs.exists', ($, e) => {
    if (w.existsThrows.has(e.path)) throw new Error('EIO: i/o error, access')
    return { value: w.files[e.path] !== undefined }
  })
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
  on('fs.stat', ($, e) => {
    if (w.statErrors[e.path] !== undefined) throw new Error(w.statErrors[e.path])
    return statOf(e)
  })
  const statOf = (e: { path: string; resolve?: boolean }) => (w.stats[e.path] !== undefined ? { value: { kind: 'file' as const, ...w.stats[e.path], isLink: false } } : {
    value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false, realPath: e.resolve ? (e.path === CWD ? w.cwdReal.value : e.path) : undefined },
  })
  on('session.id', () => ({ value: w.sid.value }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.root', () => ({ value: '/work/repo' }))
  on('session.start', () => ({ cwd: CWD }))
  on('session.end', () => ({ sessionId: w.sid.value }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', ($, e) => { w.toasts.push(e.text); return { value: undefined } })
  on('ui.open', async ($, e) => {
    w.opens.push({ id: e.id, title: e.title, focus: e.focus, closeOnEscape: e.closeOnEscape })
    if (w.openGate !== null) await w.openGate
    if (!w.panes.includes(e.id)) w.panes.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => { w.panes = w.panes.filter(id => id !== e.id); return { value: undefined } })
  on('ui.panes', async () => { if (w.panesGate !== null) await w.panesGate; if (w.panesThrow) throw new Error('engine cannot list panes'); return { value: w.panes.map(id => ({ id, title: 'Autopilot', isShown: true, isFocused: false, isPlaced: true })) } })
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
  const kids = (tree.children || []) as Node[] // [0] = the tab strip, then the Now tab's lines
  const head = kids[1]
  // P5: a snapshot that is not ok also draws its state text as a Box of segments, so the Now branch is taken only when kids[1] reads as the verdict header
  const heroOf = (n: Node): string => walkTexts(n).map(textOf).join('').replace(/ {3,}(工作階段|session) .*$/, '')
  if (head && head.type === 'Box' && /^(.+?) {2}(.+?)(?: · (?:已進行 (\S+)|(\S+) since start))?$/.test(heroOf(head))) {
    // TUI v2 Now tab: hero = `<verdict>  <project> · <since elapsed>`; the reason is its own dim line; progress and phase are key/value rows
    // (phase is absent when the marker produced it: it is the stage row)
    // P4: kids[1] is the global verdict header (pane.tsx draws it on every tab); its right end carries the spend / ctx metrics, which paneHeader reads
    const hero = walkTexts(head).map(textOf).join('').replace(/ {3,}(工作階段|session) .*$/, '')
    const hm = /^(.+?) {2}(.+?)(?: · (?:已進行 (\S+)|(\S+) since start))?$/.exec(hero) as RegExpExecArray
    const row = hm[1] + ' ' + hm[2] + ' · ' + (hm[3] ?? hm[4] ?? '—')
    const texts = kids.map(k => textOf(k))
    const progressNode = kids.find(k => /^(進度|progress)\s/.test(textOf(k))) as Node
    const progressRaw = textOf(progressNode).replace(/^(進度|progress)\s+/, '')
    const noTotal = / · (沒有固定總數|no fixed total)$/.test(progressRaw) // the dim tail 現況 adds when the total is not frozen (§3.5); the cases below keep asserting the figure itself
    const progress = progressRaw.replace(/ · (沒有固定總數|no fixed total)$/, '')
    const phaseLine = texts.find(t => /^(目前|phase)\s/.test(t))
    const phase = phaseLine === undefined ? '—' : phaseLine.replace(/^(目前|phase)\s+/, '')
    const cut = row.lastIndexOf(' · ')
    // summary: the pre-P7 row shape, rebuilt from the new pieces, so the semantic cases keep asserting verdict / project / phase / elapsed / progress
    const summary = row.slice(0, cut) + ' · ' + phase + ' · ' + row.slice(cut + 3) + ' · ' + progress
    // the reason: the first row of 要你處理 when it asks something (decide / stalled / waiting), else the 原因 row of 位置 (running / idle)
    const needs = texts.findIndex(x => /^▾ (要你處理|Needs you)/.test(x))
    const first = needs >= 0 ? texts[needs + 1] : undefined
    const kvReason = texts.find(x => /^(原因|reason)\s/.test(x))
    const reason = kvReason !== undefined ? kvReason.replace(/^(原因|reason)\s+/, '').trimEnd()
      : first !== undefined && !first.startsWith('—') ? first.replace(/^\S+ /, '').replace(/\s+[▸▾]$/, '').trimEnd() : undefined
    return { line1: summary, row, noTotal, progressRaw, line2: reason, last: walkTexts(progressNode).pop() as Node, tree }
  }
  const line = await bandLine($, surface, columns)
  const cells = walkTexts(line.tree)
  return { line1: textOf(cells[0]).replace(/ │ $/, ''), line2: undefined, noTotal: false, progressRaw: '', last: cells[0], tree }
}

// the real band (AbovePrompt): its drawn tree, the full line (Texts + the ⓘ label) and the ⓘ Button node
async function bandLine($: any, surface: (typeof SURFACES)[number], columns = 120) {
  const ui = await $.ui.mount({ plugin: 'autopilot', surface, component: 'AbovePrompt', props: { ...BAND_PROPS, bodyColumns: columns }, viewport: { columns: Math.max(columns, 20), rows: 50, isFullscreen: true } })
  const tree = (await ui.drawn()) as Node
  const info = ((await ui.findAll({ type: 'Button' })) as Node[]).find(b => b.props?.key === 'info') // the slots are Buttons too: the ⓘ is the one keyed info
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
async function paneParts($: any, surface: (typeof SURFACES)[number], tab: string = 'dispatch', bodyColumns: number = PANE_PROPS.bodyColumns, scroll: { offset: number; bodyRows: number } = PANE_PROPS.scroll) {
  const mountPane = () => $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-live', props: { ...PANE_PROPS, bodyColumns, scroll }, viewport: { columns: 160, rows: 50, isFullscreen: true } })
  const first = await mountPane()
  await first.press({ key: tab })
  await first.unmount()
  const pane = await mountPane()
  const tree = (await pane.drawn()) as Node
  const link = await pane.find({ type: 'Link' })
  await pane.unmount()
  return { texts: rowsOf(tree), head: headOf(tree), href: link?.props.href as string | undefined, tree }
}

// the lines of a pane: every child of the pane's column Box after the tab strip (child 0), one string per line. P4: pane.tsx draws the global header (verdict
// line, the metrics when narrow, one blank) on every tab, so `rowsOf` is the tab's own body (its first row is the first section; a 'b' + index key counts from
// there) and `headOf` is the header. A pane with no snapshot has no header (no blank row), so its body starts at 0.
const allRows = (tree: Node): string[] => ((tree.children || []) as Node[]).slice(1).map(k => textOf(k))
const headEnd = (rows: string[]): number => rows.findIndex(r => r.trim() === '') + 1 // the blank is drawn as a one-cell Text (an empty Text takes no row)
const rowsOf = (tree: Node): string[] => { const r = allRows(tree); return r.slice(headEnd(r)) }
const headOf = (tree: Node): string[] => { const r = allRows(tree); return r.slice(0, headEnd(r)) }
// the tab strip: one entry per tab, `[label, badge]` as drawn
const fullText = (n: Node): string => (n.type === 'Button' && typeof n.props?.label === 'string' ? (n.props.label as string) : (n.children || []).map(c => (typeof c === 'string' ? c : fullText(c as Node))).join(''))
const stripOf = (tree: Node): string => fullText(((tree.children || []) as Node[])[0]).replace(/\s*[─━]+$/, '') // without the baseline rule

// the drawn Text of one tab's name in the strip (its colour and weight say whether the tab needs the owner)
const tabName = (tree: Node, id: string): Drawn => walkAll(tree as never).find(n => n.type === 'Button' && n.props?.key === id && n.props?.key !== 'next') ? (walkAll(walkAll(tree as never).find(n => n.type === 'Button' && n.props?.key === id) as Drawn).find(n => n.type === 'Text') as Drawn) : ({} as Drawn)

// a mounted pane on one tab (the caller unmounts it)
async function paneOn($: any, surface: (typeof SURFACES)[number], tab: string) {
  const mountPane = () => $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-live', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
  const first = await mountPane()
  await first.press({ key: tab })
  await first.unmount()
  return mountPane()
}

// P1: press the first line of a tab for which `want` holds (its toggle button is keyed 'b' + the line index); returns the line that was pressed
async function pressRow($: any, surface: (typeof SURFACES)[number], tab: string, want: (line: string) => boolean): Promise<string> {
  const at = (await paneParts($, surface, tab)).texts.findIndex(want)
  if (at < 0) throw new Error('pressRow: no line to press on ' + tab)
  const pane = await paneOn($, surface, tab)
  const line = rowsOf((await pane.drawn()) as Node)[at]
  await pane.press({ key: 'b' + at })
  await pane.unmount()
  return line
}

// P4: the 最近對話 section starts folded; press its heading once so the groups are drawn (the fold persists across mounts)
const openRecent = ($: any, surface: (typeof SURFACES)[number] = 'terminal') => pressRow($, surface, 'now', l => /^▸ (Recent conversation|最近對話)/.test(l))

// the metrics of the global header (P4: pane.tsx draws it on every tab; the first row is the verdict line, the metrics sit at its right end or, when narrow, on the next row):
// `session … · host … · ctx …`, or the state text of a non-ok snapshot
const paneHeader = async ($: any, surface: (typeof SURFACES)[number]) => {
  const rows = (await paneParts($, surface)).head
  const row = rows.find(l => /ctx/.test(l)) ?? (rows[0] as string)
  const at = Math.min(...['工作階段', 'session'].map(k => row.indexOf(k)).filter(i => i >= 0), row.length)
  return row.slice(at === row.length ? 0 : at).trimEnd()
}

// base() world: confirmed_live 2, one row with stall:true (last_event_age_s 240), earliest start 09:50:00, now 10:00:30
const FRESH_LINE1 = '⊘ 疑似卡住 repo · — · 10m · —'
const FRESH_LINE2 = '最久的派工 4m 沒有輸出'
const FRESH_TEXT = () => FRESH_LINE1 + '\n' + FRESH_LINE2
const FOUND = 'Stalled repo' // "the project envelope was found" marker (asserted in the en table: the state-text cases run in en)

for (const surface of SURFACES) {
  test('band: fresh envelope via the session marker, project / phase / elapsed / progress from the envelope (' + surface + ')', async ($, on) => {
    world(on, base())
    await start($, surface)
    expect(await bandText($, surface)).toBe(FRESH_TEXT())
    expect((await paneHeader($, surface))).toBe('工作階段 $0.42 · 本機今日 $3.10 · ctx 37%')
  })

  test('band: two sessions of one repo each show their own sid cost and ctx (' + surface + ')', async ($, on) => {
    const w = world(on, base(), NOW_FRESH, SID_B)
    await start($, surface)
    const text = await paneHeader($, surface)
    expect(text).toContain('工作階段 $9.99 · 本機今日 $3.10')
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
    expect(text).toBe('工作階段 $— · 本機今日 $— · ctx —')
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
    const w = worldEn(on, files)
    await start($, surface)
    expect(await bandText($, surface)).toContain('no pointer')
    w.files[AHOME + '/live-pointer.json'] = '{not json'
    await w.clock.advance(5000)
    expect(await bandText($, surface)).toContain('unreadable')
  })

  test('band: no marker and no paths prefix means no project; the longest paths prefix wins (' + surface + ')', async ($, on) => {
    const files = base()
    delete files[AHOME + '/session-mode/' + SID_A + '.json']
    const w = worldEn(on, files)
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
    expect(await bandText($, surface)).toContain('疑似卡住 repo')
    expect(await paneHeader($, surface)).toBe('工作階段 $— · 本機今日 $3.10 · ctx —')
  })

  test('band: an expired marker is ignored (' + surface + ')', async ($, on) => {
    const files = base()
    files[AHOME + '/session-mode/' + SID_A + '.json'] = j({ session_id: SID_A, project_key: KEY, root_run_id: ROOT, expires_at: '2026-10-04T09:00:00.000Z' })
    worldEn(on, files)
    await start($, surface)
    expect(await bandText($, surface)).toContain('no project')
  })

  // residue band reminder without a watcher scope: wt N read straight from <git-common-dir>/autopilot-residue-auto.json
  test('band: no project still shows wt N from the repo\'s own reap --auto result (' + surface + ')', async ($, on) => {
    const files = base()
    delete files[AHOME + '/session-mode/' + SID_A + '.json']
    const auto = (n: number) => j({ schema: 'autopilot.residue-auto/1', ran_at: '2026-10-04T09:00:00.000Z', needs_human: [], needs_human_count: n, needs_human_bytes: 0 })
    files['/work/repo/.git/HEAD'] = 'ref: refs/heads/main\n'
    files['/work/repo/.git/autopilot-residue-auto.json'] = auto(3)
    const w = worldEn(on, files)
    await start($, surface)
    expect(await bandText($, surface)).toContain('no project · ⚑3 · run:')
    expect(await paneHeader($, surface)).toContain('⚑3')
    // zero, a foreign schema or a malformed file: the plain no-project line, no wt
    w.files['/work/repo/.git/autopilot-residue-auto.json'] = auto(0)
    await w.clock.advance(5000)
    expect(await bandText($, surface)).not.toContain('⚑')
    w.files['/work/repo/.git/autopilot-residue-auto.json'] = j({ schema: 'other/1', needs_human_count: 9 })
    await w.clock.advance(5000)
    expect(await bandText($, surface)).not.toContain('⚑')
    w.files['/work/repo/.git/autopilot-residue-auto.json'] = '{not json'
    await w.clock.advance(5000)
    expect(await bandText($, surface)).toContain('no project')
    // a linked worktree: .git is a file naming <common>/worktrees/<name>
    delete w.files['/work/repo/.git/autopilot-residue-auto.json']; delete w.files['/work/repo/.git/HEAD']
    w.files['/work/repo/.git'] = 'gitdir: /main/.git/worktrees/wt1\n'
    w.files['/main/.git/autopilot-residue-auto.json'] = auto(2)
    await w.clock.advance(5000)
    expect(await bandText($, surface)).toContain('no project · ⚑2 · run:')
    // a scoped project is unaffected: the envelope band, not the no-project line
    w.files[LIVE + '/runs/paths/' + KEY + '.json'] = j({ '/work/repo': { project_key: KEY, repo_identity: 'y' } })
    await w.clock.advance(5000)
    expect(await bandText($, surface)).toContain(FOUND)
  })

  test('band: wt N stops at the first .git; relative gitfiles, submodules and a worktrees-named parent resolve (' + surface + ')', async ($, on) => {
    const files = base()
    delete files[AHOME + '/session-mode/' + SID_A + '.json']
    const auto = (n: number) => j({ schema: 'autopilot.residue-auto/1', ran_at: '2026-10-04T09:00:00.000Z', needs_human: [], needs_human_count: n, needs_human_bytes: 0 })
    // a nested repo (cwd /work/repo/sub) with no result file, under a parent repo that has one: 0, the parent is never borrowed
    files['/work/.git/HEAD'] = 'ref: refs/heads/main\n'
    files['/work/.git/autopilot-residue-auto.json'] = auto(7)
    files['/work/repo/.git/HEAD'] = 'ref: refs/heads/main\n'
    const w = worldEn(on, files)
    await start($, surface)
    expect(await bandText($, surface)).not.toContain('⚑')
    // an unresolvable gitfile at the first .git also answers 0, not the parent's 7
    delete w.files['/work/repo/.git/HEAD']
    w.files['/work/repo/.git'] = 'gitdir: /nowhere/.git/worktrees/x\n'
    await w.clock.advance(5000)
    expect(await bandText($, surface)).not.toContain('⚑')
    // an empty or unparseable gitfile is still the first .git: 0, never the parent's 7
    for (const junk of ['', 'garbage\n']) {
      w.files['/work/repo/.git'] = junk
      await w.clock.advance(5000)
      expect(await bandText($, surface)).not.toContain('⚑')
    }
    // a relative submodule gitfile reads the submodule's own result file
    w.files['/work/repo/.git'] = 'gitdir: ../.git/modules/sub\n'
    w.files['/work/.git/modules/sub/autopilot-residue-auto.json'] = auto(4)
    await w.clock.advance(5000)
    expect(await bandText($, surface)).toContain('no project · ⚑4 · run:')
    // a linked worktree: commondir is preferred, relative to the gitdir
    w.files['/work/repo/.git'] = 'gitdir: /main/.git/worktrees/wt1\n'
    w.files['/main/.git/worktrees/wt1/commondir'] = '../..\n'
    w.files['/main/.git/autopilot-residue-auto.json'] = auto(5)
    await w.clock.advance(5000)
    expect(await bandText($, surface)).toContain('no project · ⚑5 · run:')
    // a main repo under a directory named `worktrees` (no commondir file): the cut is at the last /worktrees/ of the gitdir only
    delete w.files['/main/.git/worktrees/wt1/commondir']
    w.files['/work/repo/.git'] = 'gitdir: /srv/worktrees/proj/.git/worktrees/wt9\n'
    w.files['/srv/worktrees/proj/.git/autopilot-residue-auto.json'] = auto(6)
    await w.clock.advance(5000)
    expect(await bandText($, surface)).toContain('no project · ⚑6 · run:')
  })

  test('band: stale after valid_for_s; a re-read never makes an old envelope fresh (' + surface + ')', async ($, on) => {
    const w = worldEn(on, base(), NOW_STALE)
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
    const w = worldEn(on, files)
    await start($, surface)
    expect(await paneHeader($, surface)).toContain('host today $7.50') // served from the SSD copy
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
    worldEn(on, files)
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
    expect(await paneHeader($, surface)).toContain('本機今日 $1.25')
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
    expect(header).toContain('本機今日 $1.25')
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
    const rows = rowsOf((await pane.drawn()) as Node)
    // the run table: one row per run, the state a glyph (r1 live, r2 stalled, r3 exited rc 0)
    const r1 = rows.find(t => t.includes(' r1 ')) as string
    const r2 = rows.find(t => t.includes(' r2 ')) as string
    const r3 = rows.find(t => t.includes(' r3 ')) as string
    expect(r1).toContain('implementer')
    expect(r1).toContain('codex / gpt')
    expect(r1).toContain('● 執行')
    expect(r2).toContain('⊘ 疑似卡住')
    expect(r3).toContain('✓ 完成') // the exited run (rc 0) is in the finished table, drawn as a state word, never as `rc 0`
    expect(rows.some(t => t.includes('這是執行狀態，不是進度'))).toBe(true)
    expect(rows.some(t => t.startsWith('審查 ›'))).toBe(true) // 派工 carries a pointer to 審查, the same row 現況 draws, no gate verdict (design plan §2.6 rule 3)
    expect(rows.some(t => t.includes('審查關卡') || t.includes('審查回執'))).toBe(false) // the job page's receipt count is not a second review story
    expect(rows.some(t => t.includes('PASS'))).toBe(false)
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
    return rowsOf(tree)
  }

  test('P7d review tab: plan-review generation, seats and verdict, and the latest code-review round render (' + surface + ')', async ($, on) => {
    const files = base()
    files[LIVE + '/runs/' + KEY + '.review.json'] = j(reviewFact())
    const w = worldEn(on, files)
    await start($, surface)
    const texts = await reviewTab($, w)
    const has = (...parts: string[]) => texts.some(t => parts.every(p => t.includes(p)))
    expect(has('Plan review', '△ to fix')).toBe(true)
    expect(has('plan', 'plan-x', '△ to fix')).toBe(true)
    expect(has('round', '▰▰', 'R2 of 2')).toBe(true)
    expect(has('△ to fix', 'sol_chair', 'openai')).toBe(true)
    expect(has('△ to fix', 'grok_deep', 'xai')).toBe(true)
    expect(has('Code review', '△ to fix')).toBe(true)
    expect(has('round', 'R3', '11111111..aaaaaaaa', 'p7d')).toBe(true)
    expect(has('△ to fix', 's0', 'minimax')).toBe(true)
    for (const raw of ['FIX-THEN-SHIP', 'CONDITIONAL', 'STOP']) expect(texts.some(t => t.includes(raw))).toBe(false) // a raw verdict word is only in the opened seat (I7)
    expect(texts.some(t => t.includes('no data · no review published'))).toBe(false)
    expect(texts.some(t => t.includes(' r1 '))).toBe(false) // the dispatch table is the other tab
  })

  test('P7d review tab: a terminal plan review and a converged round are worded as such (' + surface + ')', async ($, on) => {
    const files = base()
    files[LIVE + '/runs/' + KEY + '.review.json'] = j(reviewFact({
      plan: { logical_plan_id: 'plan-y', generation: 1, max_generations: 2, terminal: true, verdict: 'READY', seats: [], updated_at: PUBLISHED },
      code: { phase: 'p1', generation: 1, base: null, head: null, converged: true, at: PUBLISHED, seats: [] },
    }))
    const w = worldEn(on, files)
    await start($, surface)
    const texts = await reviewTab($, w)
    const has = (...parts: string[]) => texts.some(t => parts.every(p => t.includes(p)))
    expect(has('Plan review', '✓ done')).toBe(true)
    expect(has('plan', 'plan-y', '✓ done')).toBe(true)
    expect(has('round', 'R1 of 2')).toBe(true)
    expect(has('Code review', '✓ done')).toBe(true)
    expect(has('round', 'R1', 'p1')).toBe(true)
    expect(texts.filter(t => t === 'seats       — no seats').length).toBe(2) // both sections say it, in the same words
  })

  test('P7d review tab: no review file is "no review"; a file of another project or schema is no review either (' + surface + ')', async ($, on) => {
    const files = base()
    const w = worldEn(on, files)
    await start($, surface)
    expect(await reviewTab($, w)).toContain('— no review published')
    w.files[LIVE + '/runs/' + KEY + '.review.json'] = j(reviewFact({ project_key: OTHER_KEY }))
    await w.clock.advance(5000)
    expect(await reviewTab($, w)).toContain('— no review published')
    w.files[LIVE + '/runs/' + KEY + '.review.json'] = j(reviewFact({ schema: 'autopilot.review/9' }))
    await w.clock.advance(5000)
    expect(await reviewTab($, w)).toContain('— no review published')
  })

  // P1 (live-pane plan §7): the first mounted toggles. I18 = the opened row adds its own detail and a second press restores the default render; I19 = a header press flips its fold
  test('P1 I18 seat toggle: pressing a seat opens its verdict and status, pressing again restores the default render (' + surface + ')', async ($, on) => {
    const files = base()
    files[LIVE + '/runs/' + KEY + '.review.json'] = j(reviewFact())
    worldEn(on, files)
    await start($, surface)
    const closed = (await paneParts($, surface, 'review')).texts
    expect(closed.some(t => t.includes('s0') && t.includes('minimax') && t.trimEnd().endsWith('▸'))).toBe(true)
    expect(closed.some(t => t.includes('FIX-THEN-SHIP'))).toBe(false)
    await pressRow($, surface, 'review', t => t.includes('s0') && t.includes('minimax'))
    const opened = (await paneParts($, surface, 'review')).texts
    expect(opened.some(t => t.includes('s0') && t.includes('minimax') && t.trimEnd().endsWith('▾'))).toBe(true)
    expect(opened.length).toBe(closed.length + 1)
    expect(opened.some(t => t.includes('FIX-THEN-SHIP') && t.includes('reviewed'))).toBe(true) // the raw words live in the detail only
    expect(opened.filter(t => t.includes('FIX-THEN-SHIP')).length).toBe(1)
    await pressRow($, surface, 'review', t => t.includes('s0') && t.includes('minimax'))
    expect((await paneParts($, surface, 'review')).texts).toEqual(closed)
  })

  test('P1 I19 header fold: a press flips its section, a second press restores it; a stale plan review starts folded and a fresh one open (' + surface + ')', async ($, on) => {
    const files = base()
    files[LIVE + '/runs/' + KEY + '.review.json'] = j(reviewFact())
    const w = worldEn(on, files)
    await start($, surface)
    const first = (await paneParts($, surface, 'review')).texts
    expect(first.some(t => t.startsWith('▾ Plan review'))).toBe(true) // fresh: open
    expect(first.some(t => t.startsWith('▾ Code review'))).toBe(true)
    await pressRow($, surface, 'review', t => t.startsWith('▾ Code review'))
    const folded = (await paneParts($, surface, 'review')).texts
    expect(folded.some(t => t.startsWith('▸ Code review'))).toBe(true)
    expect(folded.some(t => t.startsWith('round       R3'))).toBe(false)
    expect(folded.some(t => t.includes('s0') && t.includes('minimax'))).toBe(false)
    expect(folded.some(t => t.startsWith('▾ Plan review'))).toBe(true) // the other sections are untouched
    await pressRow($, surface, 'review', t => t.startsWith('▸ Code review'))
    expect((await paneParts($, surface, 'review')).texts).toEqual(first)
    // the same plan review, 2 days old (F2; inside F6, so still a section): its section starts folded, and a press opens it
    files[LIVE + '/runs/' + KEY + '.review.json'] = j(reviewFact({ plan: { ...(reviewFact().plan as object), updated_at: '2026-10-02T10:00:00.000Z' } }))
    await w.clock.advance(5000)
    const stale = (await paneParts($, surface, 'review')).texts
    expect(stale.some(t => t.startsWith('▸ Plan review'))).toBe(true)
    expect(stale.some(t => t.includes('sol_chair'))).toBe(false)
    await pressRow($, surface, 'review', t => t.startsWith('▸ Plan review'))
    const open = (await paneParts($, surface, 'review')).texts
    expect(open.some(t => t.startsWith('▾ Plan review'))).toBe(true)
    expect(open.some(t => t.includes('sol_chair'))).toBe(true)
  })

  test('P1 I18 more: with more than 5 decisions the rest sit behind one more row; a press shows all, a second press restores (' + surface + ')', async ($, on) => {
    const files = quietWorld()
    const mk = (i: number) => ({ round: i, decision: '決定 ' + i, irreversible: false, at: '2026-10-04T09:4' + (i % 10) + ':00.000Z', writer: 'engine', kind: 'decision', decision_id: 'd-' + i, source: 'ledger_default' })
    files[P_DEC] = j(decisionsSidecar({ rows: [1, 2, 3, 4, 5, 6, 7].map(mk), count: 7, irreversible_count: 0 }))
    world(on, files)
    await start($, surface)
    const rowsOfDec = (texts: string[]) => texts.filter(t => /^◦ d-\d/.test(t))
    const closed = (await paneParts($, surface, 'review')).texts
    expect(rowsOfDec(closed).length).toBe(5)
    expect(closed.filter(t => t === '  ▸ 還有 2 件決定').length).toBe(1)
    await pressRow($, surface, 'review', t => t === '  ▸ 還有 2 件決定')
    const all = (await paneParts($, surface, 'review')).texts
    expect(rowsOfDec(all).length).toBe(7)
    expect(all).toContain('  ▾ 收起')
    await pressRow($, surface, 'review', t => t === '  ▾ 收起')
    expect((await paneParts($, surface, 'review')).texts).toEqual(closed)
  })

  test('P1 I23 golden: the Review tab at 76 columns with the first decision and the first seat opened (' + surface + ')', async ($, on) => {
    const files = quietWorld()
    files[LIVE + '/runs/' + KEY + '.review.json'] = j(reviewFact())
    files[P_DEC] = j(decisionsSidecar())
    world(on, files)
    await start($, surface)
    await pressRow($, surface, 'review', t => t.includes('d-1') && t.includes('先拆 plan 再實作'))
    await pressRow($, surface, 'review', t => t.includes('s0') && t.includes('minimax'))
    expect((await paneParts($, surface, 'review', 76)).texts).toEqual([
      "▾ 程式碼審查  △ 待修 ──────────────────────────────────────────────────────",
      "輪次        R3 · 11111111..aaaaaaaa · p7d",
      "席位        ",
      "            △ 待修  s0 · minimax                                          ▾",
      "              └ FIX-THEN-SHIP · reviewed",
      "▾ 推送前檢查 ──────────────────────────────────────────────────────────────",
      "— 沒有推送前檢查的狀態",
      "▾ 我替你決定的事  2 件 · 1 件不可逆 ───────────────────────────────────────",
      "◦ d-2  刪掉舊分支                                                         ▸",
      "◦ d-1  可逆 · engine                                                      ▾",
      "  └ 先拆 plan 再實作",
      "  $ decision-ledger.js veto --ledger /work/repo/.git/autopilot/ledger/",
      "    decisions.jsonl --id d-1",
      "▾ 計畫審查  △ 待修 ────────────────────────────────────────────────────────",
      "計畫        plan-x · △ 待修",
      "輪次        ▰▰  R2／上限 2",
      "席位        ",
      "            △ 待修  sol_chair · openai                                    ▸",
      "            △ 待修  grok_deep · xai                                       ▸",
    ])
  })

  if (surface === 'terminal') {
    test('P7d model: the band review slot is ↺ R<n> (code round first, else plan generation); no review = no slot', () => {
      const fact = (over: Record<string, unknown>) => readReview(JSON.stringify({ schema: 'autopilot.review/1', project_key: KEY, ...over }), KEY)
      const plan = { logical_plan_id: 'p', generation: 2, max_generations: 2, terminal: false, verdict: null, seats: [], updated_at: null }
      const code = { phase: 'x', generation: 4, base: null, head: null, converged: false, at: null, seats: [] }
      expect(reviewSlot(fact({ plan, code }))).toBe('↺ R4')
      expect(reviewSlot(fact({ plan }))).toBe('↺ R2')
      expect(reviewSlot(fact({ code }))).toBe('↺ R4')
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
    expect(parts.texts).not.toContain('— no review published')
    expect(parts.texts.some(t => t.includes('Plan review'))).toBe(false)
    expect(parts.texts.some(t => t.includes(' r1 '))).toBe(true)
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
    const w = worldEn(on, files)
    await start($, surface)
    const pane = await paneOn($, surface, 'dispatch')
    expect((await pane.find({ type: 'Link' }))?.props.href).toBe('http://localhost:8787/' + KEY + '/')
    await pane.unmount()
    delete w.files[LIVE + '/runs/' + KEY + '--' + ROOT + '.json']
    await w.clock.advance(5000)
    const pane2 = await $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-live', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
    expect(allRows((await pane2.drawn()) as Node).some(t => t.startsWith('unavailable'))).toBe(true)
    expect(await pane2.find({ type: 'Link' })).toBeUndefined()
    await pane2.unmount()
  })

  test('toast: one on an execution-axis change, one on an acceptance-axis change, none when nothing changed (' + surface + ')', async ($, on) => {
    const files = base()
    files[AHOME + '/review/' + KEY + '/2026-10-04/' + ROOT + '/current/model.json'] = j(model())
    const w = worldEn(on, files)
    await start($, surface)
    expect(w.toasts).toEqual([]) // first snapshot: nothing to compare with
    await w.clock.advance(5000)
    expect(w.toasts).toEqual([]) // unchanged
    w.files[LIVE + '/runs/' + KEY + '--' + ROOT + '.json'] = j(envelope({ counts: { confirmed_live: 1, exited: 2, unknown: 0, fresh_bound_s: 30 }, published_at: '2026-10-04T10:00:25.000Z' }))
    await w.clock.advance(5000)
    expect(w.toasts.length).toBe(1)
    expect(w.toasts[0]).toContain('execution axis')
    expect(w.toasts[0]).toContain('RUNNING 2 to 1')
    expect(w.toasts[0]).toContain('EXITED 1 to 2')
    w.files[AHOME + '/review/' + KEY + '/2026-10-04/' + ROOT + '/current/model.json'] = j(model({ axes: { execution: { running: 1, exited: 2, unknown: 0 }, acceptance: 'accepted', can_close: true } }))
    await w.clock.advance(5000)
    expect(w.toasts.length).toBe(2)
    expect(w.toasts[1]).toContain('acceptance axis')
    expect(w.toasts[1]).toContain('PENDING to ACCEPTED')
    await w.clock.advance(5000)
    expect(w.toasts.length).toBe(2) // no repeat
  })

  test('toast: execution and acceptance changes in one tick are two toasts, one per axis (' + surface + ')', async ($, on) => {
    const files = base()
    files[AHOME + '/review/' + KEY + '/2026-10-04/' + ROOT + '/current/model.json'] = j(model())
    const w = worldEn(on, files)
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
  const DECISION = { question: '要合併 plan 還是拆開？', options: [{ label: '合併', description: '一次驗收' }, { label: '拆開', description: '兩次驗收' }] }
  const FROZEN_DONE = { frozen: true, percent: 100, done: 8, total: 8 }
  // everything the four verdicts are made of lives in two files; this puts both in place
  const put = (files: Tree, env: Record<string, unknown> | null, mdl: Record<string, unknown> | null) => {
    if (env) files[ENV_PATH] = j(envelope(env))
    if (mdl) files[MODEL_PATH] = j(model(mdl))
  }

  test('verdict 要你決定: the loudest word, wins over a stalled run, reason is the decision question (' + surface + ')', async ($, on) => {
    const files = base() // base() has a stalled row
    put(files, null, { needs_decision: true, decisions: [DECISION] })
    world(on, files)
    await start($, surface)
    const p = await bandParts($, surface)
    expect(p.line1).toBe('▲ 要你決定 repo · — · 10m · —')
    expect(p.line2).toMatch(/^待決議事項 1 件\s+待決 ›$/) // the Now tab keeps one row that points at 待決; the question itself is on that tab and in the wide band
    expect((await paneParts($, surface, 'decide')).texts[1]).toBe('▲ 1. 要合併 plan 還是拆開？')
    const lead = walkTexts(p.tree).find(n => textOf(n) === '要你決定') as Node // the verdict word (the tab strip's badges also start with a state glyph)
    expect(lead.props?.bold).toBe(true) // the word is drawn loud, not dim
    expect(lead.props?.dimColor).not.toBe(true)
  })

  test('verdict 疑似卡住: from the envelope stall flag; the reason names the quietest dispatch in minutes (' + surface + ')', async ($, on) => {
    const files = base()
    put(files, { runs: [row({ run_id: 'r1' }), row({ run_id: 'r2', stall: true, last_event_age_s: 600 }), row({ run_id: 'r3', stall: true, last_event_age_s: 1800 })] }, null)
    const w = world(on, files)
    await start($, surface)
    let p = await bandParts($, surface)
    expect(p.line1.startsWith('⊘ 疑似卡住 repo')).toBe(true)
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
    put(files, { runs: [row({ run_id: 'r2', stall: true, last_event_age_s: 300 })], counts: quietCounts(0) }, { needs_decision: true, decisions: [DECISION], progress: FROZEN_DONE })
    const w = world(on, files)
    await start($, surface)
    expect(verdictsIn(await bandText($, surface))).toEqual(['要你決定'])
    put(w.files, null, { needs_decision: false, decisions: [], progress: FROZEN_DONE }) // the decision is gone
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
    const lead = walkTexts(p.tree).find(n => textOf(n) === '待命') as Node // the verdict word (the tab strip's badges also start with a state glyph)
    expect(lead.props?.bold).toBe(true) // P4: the global header draws every verdict glyph bold (§2.2)
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
    put(w.files, { runs: [exitedRow()], counts: quietCounts(0) }, { needs_decision: true, decisions: [DECISION] })
    await w.clock.advance(5000)
    expect(verdictsIn(await bandText($, surface))).toEqual(['要你決定'])
    put(w.files, null, { needs_decision: false, decisions: [], progress: FROZEN_DONE })
    await w.clock.advance(5000)
    expect(verdictsIn(await bandText($, surface))).toEqual(['完成待驗收'])
  })

  test('progress: frozen shows the percent and the done/total; unfrozen shows "n done" plus the dim 沒有固定總數, never a percent or a star (' + surface + ')', async ($, on) => {
    const files = base()
    put(files, null, { progress: { frozen: true, percent: 62.5, done: 5, total: 8 } })
    const w = world(on, files)
    await start($, surface)
    let p = await bandParts($, surface)
    expect(p.line1.endsWith('· 62.5%（5/8）')).toBe(true)
    expect(p.last?.props?.dimColor).not.toBe(true)
    expect(p.noTotal).toBe(false) // a frozen total is a percent with no 「沒有固定總數」 tail
    expect(p.progressRaw).toBe('62.5%（5/8）')
    put(w.files, null, { progress: { frozen: false, percent: null, done: 3, total: null } })
    await w.clock.advance(5000)
    p = await bandParts($, surface)
    expect(p.line1.endsWith('· 已完成 3 項')).toBe(true)
    expect(p.line1).not.toContain('%')
    expect(p.last?.props?.dimColor).toBe(true)
    expect(p.progressRaw).toBe('已完成 3 項 · 沒有固定總數') // §3.5: never `N*`; the missing total is said in words, dim
    expect(p.noTotal).toBe(true)
    // a percent that arrives next to an unfrozen flag is not shown either
    put(w.files, null, { progress: { frozen: false, percent: 37.5, done: 3, total: 8 } })
    await w.clock.advance(5000)
    p = await bandParts($, surface)
    expect(p.line1.endsWith('· 已完成 3 項')).toBe(true)
    expect(p.line1).not.toContain('%')
    expect(p.last?.props?.dimColor).toBe(true)
    expect(p.noTotal).toBe(true)
    // a frozen flag without a usable percent / total is not trusted: the percent is not invented
    put(w.files, null, { progress: { frozen: true, percent: null, done: 3, total: null } })
    await w.clock.advance(5000)
    p = await bandParts($, surface)
    expect(p.line1).not.toContain('%')
    expect(p.line1.endsWith('· 已完成 3 項')).toBe(true)
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
      expect(p.line1.split(' · ')[0], String(identity)).toBe('⊘ 疑似卡住 ' + want)
    }
  })

  test('elapsed: now minus the earliest start in the scope, 38m / 2h14m / 1d03h, an em dash when no run has a start (' + surface + ')', async ($, on) => {
    const ago = (s: number) => new Date(NOW_FRESH - s * 1000).toISOString()
    const at = (s: number) => row({ run_id: 'r' + s, started_at: ago(s), fact_at: ago(s) })
    const cases: [unknown[], string][] = [
      [[at(38 * 60)], '38m'],
      [[at(2 * 3600 + 14 * 60 + 5)], '2h14m'],
      [[at(27 * 3600 + 59)], '1d03h'],
      [[at(24 * 3600 + 5)], '1d00h'], // the hour is padded like the minute (the 1d0h shot finding)
      [[at(59 * 60 + 5)], '59m'],
      [[at(3600)], '1h00m'],
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
    expect(await paneHeader($, surface)).toBe('工作階段 $0.42 · 本機今日 $3.10 · ctx 37%')
  })

  test('pane: when a decision is awaited it is the first section, built from the model decision; the Link stays (' + surface + ')', async ($, on) => {
    const files = base()
    put(files, null, { needs_decision: true, decisions: [DECISION] })
    const w = world(on, files)
    await start($, surface)
    let pane = await paneParts($, surface, 'now')
    expect(pane.head[0]).toContain('▲ 要你決定') // the global header's verdict line (verdict · project · since) is drawn above the tab body
    expect(await paneHeader($, surface)).toBe('工作階段 $0.42 · 本機今日 $3.10 · ctx 37%') // and carries the spend / ctx metrics
    const rule = pane.texts.findIndex(t => t.startsWith('▾ 要你處理')) // the awaited decision is the first section (before "where you are")
    expect(rule).toBe(0)
    expect(rule).toBeLessThan(pane.texts.findIndex(t => t.startsWith('▾ 位置'))) // a foldable section, open by default
    expect(pane.texts[rule + 1]).toMatch(/^▲ 待決議事項 1 件\s+待決 ›$/) // one row that points at the 待決 tab (the whole question is not repeated here)
    expect(pane.texts[rule]).toMatch(/要你處理\s+1\s/) // the section title counts what awaits you as a plain number (no ▲, no colour)
    expect(pane.texts.some(t => t.startsWith('▾ 待決議事項'))).toBe(false) // the old block that spread every question over this tab is gone
    expect(pane.texts.some(t => t.includes('要合併 plan 還是拆開？'))).toBe(false)
    const cards = (await paneParts($, surface, 'decide')).texts
    expect(cards[1]).toBe('▲ 1. 要合併 plan 還是拆開？')
    expect(cards).toContain('  選項      [ ] 合併  [ ] 拆開') // the options are one row of Buttons; the one-line description of an option shows once it is picked
    const disp = await paneParts($, surface, 'dispatch') // the table is still there, on its own tab, and so is the Link
    expect(disp.texts.some(t => t.includes('這是執行狀態，不是進度'))).toBe(true)
    expect(disp.texts.some(t => t.startsWith('審查 ›'))).toBe(true) // the former 審查關卡 section is one pointer row to 審查
    expect(disp.texts.some(t => t.includes('要合併 plan 還是拆開？'))).toBe(false)
    expect(disp.href).toBe('http://localhost:8787/' + KEY + '/2026-10-04/' + ROOT + '/current/')
    // fields that do not exist are not shown: a question with no options, then no decision at all
    put(w.files, null, { needs_decision: true, decisions: [{ question: '只有問題', options: [] }] })
    await w.clock.advance(5000)
    pane = await paneParts($, surface, 'now')
    expect(pane.texts.some(t => /^▲ 待決議事項 1 件/.test(t))).toBe(true)
    const cards2 = (await paneParts($, surface, 'decide')).texts
    expect(cards2[1]).toBe('▲ 1. 只有問題')
    expect(cards2.some(t => t.includes('[ ]'))).toBe(false) // a question without options draws no option row
    put(w.files, null, { needs_decision: false, decisions: [] })
    await w.clock.advance(5000)
    pane = await paneParts($, surface, 'now')
    expect(pane.texts.some(t => t.includes('只有問題'))).toBe(false)
    expect(pane.texts[0].startsWith('▾ 要你處理')).toBe(true) // the section stays (the stalled reason is its item now)
  })
}

// ---- mods P1W W3a: the mod reads every wired source (tasks, attention, phase, decisions sidecar, foreman, manifest) ----
const DECISION_W = { question: '要合併 plan 還是拆開？', options: [{ label: '合併', description: '一次驗收' }, { label: '拆開', description: '兩次驗收' }] }
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

  test('W3a attention in the pane: the awaited thing is listed in the Needs-you section of Now, not on Dispatch (' + surface + ')', async ($, on) => {
    const files = base()
    files[P_ATT()] = j(attention('permission'))
    world(on, files)
    await start($, surface)
    const pane = await paneParts($, surface, 'now')
    const at = pane.texts.findIndex(t => t.startsWith('▾ 要你處理'))
    expect(at).toBe(0)
    expect(pane.texts[at + 1]).toBe('▲ 等你批准：Bash: rm -rf build（等了 5 分）')
    expect((await paneParts($, surface, 'dispatch')).texts.some(t => t.includes('等你批准'))).toBe(false)
  })

  test('W3a decision age: a stale open decision shows 已等 N 天 in band and pane; a fresh one does not (' + surface + ')', async ($, on) => {
    const files = base()
    files[W_MODEL] = j(model({ needs_decision: true, decisions: [{ ...DECISION_W, stale: true, age_s: 3 * 86400 + 5 }] }))
    const w = world(on, files)
    await start($, surface)
    expect((await bandLine($, surface, 209)).text).toContain('要合併 plan 還是拆開？（已等 3 天）')
    expect((await paneParts($, surface, 'decide')).texts.some(t => /^▲ 1\. 要合併 plan 還是拆開？（已等 3 天）$/.test(t))).toBe(true)
    files[W_MODEL] = j(model({ needs_decision: true, decisions: [{ ...DECISION_W, stale: false, age_s: 40 }] }))
    await w.clock.advance(5000)
    expect((await bandLine($, surface, 209)).text).not.toContain('已等')
    expect((await paneParts($, surface, 'decide')).texts[1]).toBe('▲ 1. 要合併 plan 還是拆開？')
    files[W_MODEL] = j(model({ needs_decision: true, decisions: [{ ...DECISION_W, stale: true, age_s: 3600 }] })) // stale but under a day
    await w.clock.advance(5000)
    expect((await bandLine($, surface, 209)).text).not.toContain('已等')
  })

  test('BL-0163 orphan: an orphaned open decision says the asker session ended in band and pane, a live one does not, and it is never dropped (' + surface + ')', async ($, on) => {
    const files = base()
    files[W_MODEL] = j(model({ needs_decision: true, decisions: [{ ...DECISION_W, orphaned: true, stale: false, age_s: 40 }] }))
    const w = world(on, files)
    await start($, surface)
    expect((await bandLine($, surface, 209)).text).toContain('要合併 plan 還是拆開？（提問的 session 已結束）')
    expect((await paneParts($, surface, 'decide')).texts[1]).toBe('▲ 1. 要合併 plan 還是拆開？（提問的 session 已結束）')
    files[W_MODEL] = j(model({ needs_decision: true, decisions: [{ ...DECISION_W, orphaned: false, stale: false, age_s: 40 }] }))
    await w.clock.advance(5000)
    expect((await bandLine($, surface, 209)).text).not.toContain('提問的 session 已結束')
  })

  test('W3a tasks: counts feed an unfrozen progress, the pane lists them, all completed is 完成待驗收, a frozen model progress wins (' + surface + ')', async ($, on) => {
    const files = quietWorld()
    files[P_TASKS()] = j(tasksFile())
    const w = world(on, files)
    await start($, surface)
    let p = await bandParts($, surface)
    expect(p.line1).toBe('● 進行中 repo · — · 30m · 已完成 1 項') // GATEFIX: a task in progress is 進行中 (was 待命); root scope with tasks and no receipt: tasks first_created_at (09:30), progress unfrozen
    const last = p.last as Node
    expect(last.props?.dimColor).toBe(true)
    const pane = await paneParts($, surface, 'now')
    expect(pane.texts.some(t => t.startsWith('▾ 任務  1/3'))).toBe(true) // the section chip counts completed / total
    expect(pane.texts).toContain('● 執行中  接線') // unfinished only, the one in progress first
    expect(pane.texts).toContain('○ 未開始  收尾')
    expect(pane.texts.some(t => t.includes('寫測試'))).toBe(false) // the completed task leaves the list (P4: 任務 shows unfinished only)
    expect(pane.texts.some(t => t.includes('1 項已完成'))).toBe(true) // and sits behind one bare `more`
    files[P_TASKS()] = j(allDone())
    await w.clock.advance(5000)
    p = await bandParts($, surface)
    expect(p.line1).toBe('✓ 完成待驗收 repo · — · 30m · 已完成 2 項')
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
    expect((await paneParts($, surface, 'now')).texts.some(x => x.includes('沒有任務'))).toBe(true)
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
    expect((await bandParts($, surface)).line1.endsWith('已完成 1 項')).toBe(true)
    expect(await paneHeader($, surface)).toContain('ctx 55%') // the context file name is sanitised too
    files[P_TASKS(SID_FILE)] = j({ ...tasksFile({}, SID_RAW), schema: 'other/1' })
    // wrong schema: the file is absent, so no manifest means no task section at all
    await w.clock.advance(5000)
    expect((await paneParts($, surface, 'now')).texts.some(x => x.includes('任務'))).toBe(false)
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
    expect((await bandParts($, surface)).line1.split(' · ')[2]).toBe('1h00m') // marker started_at 09:00
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
    expect(await elapsed()).toBe('1h00m') // no tasks: marker started_at 09:00
    files[AHOME + '/session-mode/' + SID_A + '.json'] = marker({ started_at: '2026-10-04T09:00:00.000Z' }, 'l4')
    await w.clock.advance(5000)
    expect(await elapsed()).toBe('1h00m') // a fresh /l4 marker with a root and no dispatch behaves the same
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
    expect(text).toContain('疑似卡住 repo')
    expect(text.split('\n')[0]?.split(' · ')[2]).toBe('20m')
  })

  test('W3a decisions sidecar: the count and the irreversible count sit in the Review tab header chip, only when non-zero; Now carries no decisions line (P4: the owner tab is 審查) (' + surface + ')', async ($, on) => {
    const files = quietWorld()
    files[P_DEC] = j(decisionsSidecar())
    const w = world(on, files)
    await start($, surface)
    const chip = async () => (await paneParts($, surface, 'review')).texts.find(x => x.startsWith('▾ 我替你決定的事'))
    expect(await chip()).toContain('2 件 · 1 件不可逆')
    expect((await bandParts($, surface)).line2).toBe('沒有派工在跑') // 現況 never repeats the count
    files[P_DEC] = j(decisionsSidecar({ count: 0, irreversible_count: 0, rows: [] }))
    await w.clock.advance(5000)
    expect(await chip()).not.toContain('件 ·')
    files[P_DEC] = j(decisionsSidecar({ count: 1, irreversible_count: 0, rows: [] }))
    await w.clock.advance(5000)
    expect(await chip()).toContain('1 件 · 0 件不可逆')
  })

  test('W3a decisions sidecar: 僅自動裁決 is worded from the actual writers_wired list; no depth-0 writer = label (pure: the band reason keeps the tail; no tab draws it) (' + surface + ')', () => {
    const view = (writers: string[]) => ({ rows: [], count: 2, irreversible: 1, undocumented: 0, writers, ladder: null, identity: null, root: null }) as never
    expect(proxySegments(view(['engine']), makeT('zh-TW'))).toEqual(['替你決定 2 件（1 件不可逆）', '僅 engine 自動裁決'])
    expect(proxySegments(view([]), makeT('zh-TW'))).toEqual(['替你決定 2 件（1 件不可逆）', '決策寫入端未接'])
    expect(proxySegments(view(['next-pick']), makeT('zh-TW'))).toEqual(['替你決定 2 件（1 件不可逆）']) // a depth-0 writer is wired: no label
    expect(proxySegments(view(['engine', 'next-pick']), makeT('zh-TW'))).toEqual(['替你決定 2 件（1 件不可逆）'])
  })

  test('W3a decisions sidecar: undocumented dispatches are counted on the Review tab, on their own or after the decisions (' + surface + ')', async ($, on) => {
    const files = quietWorld()
    files[P_DEC] = j(decisionsSidecar({ count: 0, irreversible_count: 0, rows: [], undocumented_dispatches: 3 }))
    const w = world(on, files)
    await start($, surface)
    expect((await paneParts($, surface, 'review')).texts.some(x => x.startsWith('沒寫理由') && x.includes('3 次派工'))).toBe(true)
    files[P_DEC] = j(decisionsSidecar({ undocumented_dispatches: 3 }))
    await w.clock.advance(5000)
    const t = (await paneParts($, surface, 'review')).texts
    expect(t.some(x => x.startsWith('▾ 我替你決定的事') && x.includes('2 件 · 1 件不可逆'))).toBe(true)
    expect(t.some(x => x.startsWith('沒寫理由') && x.includes('3 次派工'))).toBe(true)
  })

  test('W3a decisions pane: one row per decision with the real veto command; no id means no veto (' + surface + ')', async ($, on) => {
    const files = quietWorld()
    const rows = decisionsSidecar().rows as Record<string, unknown>[]
    files[P_DEC] = j(decisionsSidecar({ rows: [...rows, { round: 3, decision: '沒有編號的決定', irreversible: false, at: '2026-10-04T09:50:00.000Z', writer: 'engine', kind: 'pick', decision_id: null, source: 'ledger_default' }], count: 3 }))
    world(on, files)
    await start($, surface)
    const t0 = (await paneParts($, surface, 'review')).texts // TUI v2: the proxy-decision rows live in the Review tab
    expect(t0.some(x => x.startsWith('▾ 我替你決定的事') && x.includes('3 件 · 1 件不可逆'))).toBe(true)
    expect(t0.some(x => x.includes('d-1') && x.includes('先拆 plan 再實作'))).toBe(true)
    expect(t0.some(x => x.includes('d-2') && x.includes('刪掉舊分支'))).toBe(true)
    expect(t0.some(x => x.includes('veto'))).toBe(false) // closed rows carry no command (I18: the default render is the summary)
    await pressRow($, surface, 'review', x => x.includes('d-1') && x.includes('先拆 plan 再實作'))
    const t1 = (await paneParts($, surface, 'review')).texts
    expect(t1.some(x => x.startsWith('◦ d-1  可逆 · engine') && x.trimEnd().endsWith('▾'))).toBe(true)
    expect(t1).toContain('  └ 先拆 plan 再實作')
    expect(t1).toContain('  $ decision-ledger.js veto --ledger ' + COMMON + '/autopilot/ledger/decisions.jsonl --id d-1')
    expect(t1.filter(x => x.includes('veto')).length).toBe(1) // only the opened row shows its command
    await pressRow($, surface, 'review', x => x.includes('d-2') && x.includes('刪掉舊分支'))
    const t2 = (await paneParts($, surface, 'review')).texts
    expect(t2).toContain('  $ decision-ledger.js veto --ledger ' + COMMON + '/autopilot/work-orders/' + ROOT + '/decision-ledger.jsonl --id d-2')
    expect(t2.some(x => x.startsWith('◦ d-2  不可逆'))).toBe(true)
    await pressRow($, surface, 'review', x => x.includes('沒有編號的決定'))
    const t3 = (await paneParts($, surface, 'review')).texts
    const noId = t3.findIndex(x => x.includes('沒有編號的決定') || x.startsWith('◦ —'))
    expect(noId).toBeGreaterThan(0)
    expect(t3.slice(noId, noId + 4).join('\n')).toContain('沒有 decision_id，無法 veto')
    await pressRow($, surface, 'review', x => x.startsWith('◦ d-1')) // pressing again restores the default render
    expect((await paneParts($, surface, 'review')).texts.filter(x => x.includes('decision-ledger.js veto')).length).toBe(1)
  })

  test('W3a decisions sources: both ledger writers not installed and no sidecar = 來源未接 in the pane; installed = nothing (' + surface + ')', async ($, on) => {
    const files = quietWorld()
    files[P_SOURCES] = j(manifest({ ledger_engine: OFF, ledger_depth0: OFF }))
    const w = world(on, files)
    await start($, surface)
    expect((await paneParts($, surface, 'review')).texts).toContain('— 替你決定的事：來源未接')
    expect((await bandParts($, surface)).line2).toBe('沒有派工在跑')
    files[P_SOURCES] = j(manifest({ ledger_engine: OFF })) // one writer installed: wired, currently empty
    await w.clock.advance(5000)
    expect((await paneParts($, surface, 'review')).texts.some(x => x.includes('來源未接'))).toBe(false)
  })

  test('W3a foreman: rows with description, label and age; stale rows dim; binding stated; stage line (' + surface + ')', async ($, on) => {
    const files = base()
    files[P_FOREMAN] = j(foremanSidecar())
    world(on, files)
    await start($, surface)
    const pane = await paneParts($, surface)
    const t = pane.texts
    expect(t).toContain('  工頭活動（依工作階段綁定：同一工作階段的多個工作會看到同一批）')
    expect(t).toContain('● 執行中  修 parser · running · 30s 前')
    expect(t).toContain('◌ 已停    a2 · last tool: Bash · 20m 前 · 久未動')
    expect(t).toContain('  階段 implement · 1m 前（run_ledger:tmp）')
    const nodes = walkTexts(pane.tree) // P4: a stale row is the `stopped` state, drawn in its own colour, not a hand-dimmed line
    expect(nodes.find(n => textOf(n) === '◌')?.props?.color).not.toBe(nodes.find(n => textOf(n) === '●')?.props?.color)
  })

  test('W3a foreman: an absent sidecar is idle and draws nothing; never 工頭狀態：來源未接 (the watcher deletes the file when no agent and no stage are live) (' + surface + ')', async ($, on) => {
    world(on, base())
    await start($, surface)
    const texts = (await paneParts($, surface, 'dispatch')).texts
    expect(texts.some(x => x.includes('工頭'))).toBe(false)
    expect(texts.some(x => x.includes('來源未接'))).toBe(false)
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
    expect(p.line1.startsWith('⊘ 疑似卡住 repo')).toBe(true)
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
    const both = async () => [...(await paneParts($, surface, 'dispatch')).texts, ...(await paneParts($, surface, 'review')).texts]
    let t = await both()
    expect(t.some(x => x.startsWith('◦ '))).toBe(false) // no decision rows from the foreign sidecar
    expect(t.some(x => x.includes('工頭'))).toBe(false) // the foreign foreman rows are not shown: an absent sidecar is idle
    expect(t.some(x => x.includes('修 parser'))).toBe(false)
    expect(t.some(x => x.includes('來源未接'))).toBe(false) // the foreign manifest is not obeyed
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
    let t = (await paneParts($, surface, 'now')).texts
    expect(t.some(x => x.includes('任務'))).toBe(false)
    files[P_SOURCES] = j(manifest())
    await w.clock.advance(5000)
    t = (await paneParts($, surface, 'now')).texts
    expect(t).toContain('— 任務工具未開 · 設 CLAUDE_CODE_ENABLE_TODO_TOOLS=1 後才會記錄任務')
    files[P_SOURCES] = j(manifest({ tasks: OFF }))
    await w.clock.advance(5000)
    t = (await paneParts($, surface, 'now')).texts
    expect(t).toContain('— 任務：來源未接')
    expect(t.some(x => x.includes('CLAUDE_CODE_ENABLE_TODO_TOOLS'))).toBe(false)
    // a file that exists is shown whatever the manifest says
    files[P_TASKS()] = j(tasksFile())
    await w.clock.advance(5000)
    t = (await paneParts($, surface, 'now')).texts
    expect(t.some(x => x.startsWith('▾ 任務  1/3'))).toBe(true)
    expect(t).not.toContain('— 任務：來源未接')
  })

  test('W3a attention source not installed: the pane says so, the band stays silent (' + surface + ')', async ($, on) => {
    const files = quietWorld()
    files[P_SOURCES] = j(manifest({ attention: OFF }))
    world(on, files)
    await start($, surface)
    expect((await paneParts($, surface, 'now')).texts.some(x => /^等待 +.*來源未接/.test(x))).toBe(true) // P4: a 等待 row of 位置 (was a hand-built line on Dispatch)
    expect(verdicts(await bandText($, surface))).toEqual(['待命'])
  })

  test('W3a context header: not installed + no file = 來源未接; installed + unknown window (W2f shape) = an em dash; observed percent shown (' + surface + ')', async ($, on) => {
    const files = base()
    delete files[LIVE + '/context/' + SID_A + '.json']
    files[P_SOURCES] = j(manifest({ context: OFF }))
    const w = world(on, files)
    await start($, surface)
    expect(await paneHeader($, surface)).toBe('工作階段 $0.42 · 本機今日 $3.10 · ctx 來源未接')
    files[P_SOURCES] = j(manifest())
    files[LIVE + '/context/' + SID_A + '.json'] = j({ schema_version: 1, session_id: SID_A, written_at: '2026-10-04T10:00:20.000Z', writer: 'context-budget', window_source: 'unknown', model: {}, context_window: { context_window_size: null, used_percentage: null, total_input_tokens: 90000, current_usage: {} } })
    await w.clock.advance(5000)
    expect(await paneHeader($, surface)).toBe('工作階段 $0.42 · 本機今日 $3.10 · ctx —')
    files[LIVE + '/context/' + SID_A + '.json'] = j({ schema_version: 1, session_id: SID_A, written_at: '2026-10-04T10:00:20.000Z', writer: 'context-budget', window_source: 'observed', model: {}, context_window: { context_window_size: 1000000, used_percentage: 9, total_input_tokens: 90000, current_usage: {} } })
    await w.clock.advance(5000)
    expect(await paneHeader($, surface)).toBe('工作階段 $0.42 · 本機今日 $3.10 · ctx 9%')
    // data beats the manifest
    files[P_SOURCES] = j(manifest({ context: OFF }))
    await w.clock.advance(5000)
    expect(await paneHeader($, surface)).toBe('工作階段 $0.42 · 本機今日 $3.10 · ctx 9%')
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
    expect(p.line1.startsWith('⊘ 疑似卡住 repo')).toBe(true)
    expect(p.line2).toBe('最久的派工 5m 沒有輸出')
  })

  test('SCOPE: proxy decisions are summed across the root set (' + surface + ')', async ($, on) => {
    const files = campaignWorld({ runs: liveRows(1, CAMP), counts: counts(1) })
    files[LIVE + '/runs/' + KEY + '--' + ROOT + '.decisions.json'] = scopeDecisions(ROOT, 1, 0)
    files[LIVE + '/runs/' + KEY + '--' + CAMP + '.decisions.json'] = scopeDecisions(CAMP, 2, 1, 3)
    world(on, files)
    await start($, surface)
    const review = (await paneParts($, surface, 'review')).texts // P4: the sums sit on the owner tab, not on 現況
    expect((await bandParts($, surface)).line2).toBe('1 個派工在跑')
    expect(review.some(x => x.startsWith('▾ 我替你決定的事') && x.includes('3 件 · 1 件不可逆'))).toBe(true)
    expect(review.some(x => x.startsWith('沒寫理由') && x.includes('3 次派工'))).toBe(true)
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
    const w = worldEn(on, campaignWorld({ runs: [], counts: scopeQuiet }), NOW_STALE)
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
    files[modelPathOf(CAMP)] = j(model({ root_run_id: CAMP, job: CAMP, needs_decision: true, decisions: [{ question: '要合併 campaign 分支嗎？', options: [{ label: '合併', description: '進 develop' }], stale: false, age_s: 5 }] }))
    world(on, files)
    await start($, surface)
    const p = await bandParts($, surface)
    expect(p.line1.startsWith('▲ 要你決定 repo')).toBe(true)
    expect((await bandLine($, surface, 209)).text).toContain('要合併 campaign 分支嗎？')
    expect((await paneParts($, surface, 'decide')).texts[1]).toBe('▲ 1. 要合併 campaign 分支嗎？')
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
    expect((await bandParts($, surface)).line1).toContain(' · 2h00m · ')
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
test('P7c: qc fact -> chip: ok = QC✓, owed = QC▲, not_needed / unknown / absent = no chip', async () => {
  expect(qcChip(readQc(JSON.stringify(qcFact({ state: 'ok', evidence: 'trailer' })), QC_WANT))).toBe('QC✓')
  expect(qcChip(readQc(JSON.stringify(qcFact({ state: 'owed' })), QC_WANT))).toBe('QC▲')
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
const THEME = ['claude', 'warning', 'error', 'success', 'suggestion', 'inactive', 'subtle', 'merged']

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
    needs_human_count: 3, needs_human_bytes: 4 * 1048576, auto_ran_at: '2026-10-04T07:00:30.000Z', auto_removed_count: 2, auto_archived_count: 1,
    needs_human: [
      { kind: 'worktree', path: '/home/u/proj/.claude/worktrees/hands-x', class: 'dirty', age_days: 4.2, bytes: 2097152, reason: 'failure', command: 'git -C /home/u/proj worktree remove --force /home/u/proj/.claude/worktrees/hands-x' },
      { kind: 'branch', branch: 'feature/old', class: 'unintegrated-branch', age_days: 20, bytes: null, reason: null, command: 'git branch -D feature/old' },
      { kind: 'worktree', path: '/home/u/proj/.claude/worktrees/hands-old', class: 'clean-integrated', age_days: 9, bytes: 1048576, reason: 'HEAD is an ancestor of the integration ref', command: 'git -C /home/u/proj worktree remove /home/u/proj/.claude/worktrees/hands-old' },
    ] })
  files[LIVE + '/stage/' + SID_A + '.json'] = j({
    schema: 'autopilot.stage-walk/1', sid: SID_A, size: 'M', urgent: true, bug: false, high_risk: false, units: 5,
    nodes: ['spec', 'plan', 'implement', 'verify', 'finish'], walk: ['spec', 'plan', 'implement', 'verify', 'finish'], entry: 'spec', terminal: 'finish',
    unit_kind: 'deliverable', current: 'implement', stage_set_at: '2026-10-04T09:57:30.000Z', at: PUBLISHED,
  })
  return files
}

// TUI v2 grammar: groups separated by ` │ `, items inside a group by a space; the wide band carries the stage walk, a 10-cell spend bar + %, the verdict's reason
const RICH_209 = '⊘ 疑似卡住 最久的派工 4m 沒有輸出 │ M!·l5 ✓─✓─◐─○─○ implement ◷3m │ ▰▰▰▱▱ 3/5 ·2族 │ ●2 ⊘1 ↺ R3 QC✓ │ ◆3 ?1 U2 │ $120 ▰▰▰▰▰▰▰▰▱▱ 80% │ dev↓3 ⚑2 │ ⓘ '
const RICH_MID = '⊘ 疑似卡住 │ M!·l5·implement │ ▰▰▰▱▱ 3/5 │ ●2 ⊘1 ↺ R3 QC✓ │ $120 ▰▰▰▰▱ │ ⚑2 │ ⓘ '
const RICH_SMALL = '⊘ 疑似卡住 │ ▰▰▰▱▱ │ ●2 ⊘1 QC✓ │ $▰▰▱ │ ⚑2 │ ⓘ '
const RICH_NARROW = '⊘ 疑似卡住 │ ●2 ⊘1 │ ⚑2 │ ⓘ '
const RICH_WIDTHS: [number, string][] = [
  [209, RICH_209],
  [160, RICH_209],
  [159, RICH_MID],
  [140, RICH_MID],
  [139, RICH_MID],
  [120, RICH_MID],
  [119, RICH_SMALL],
  [80, RICH_SMALL],
  [79, RICH_NARROW],
  [60, RICH_NARROW],
]

type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
function walkAll(n: Drawn, out: Drawn[] = []): Drawn[] {
  out.push(n)
  for (const c of n.children || []) if (typeof c !== 'string') walkAll(c as Drawn, out)
  return out
}
// every drawn node uses theme keys as text colour only: no backgroundColor, no inverse, no raw colour
// (P5: the panel's active tab is a bold name with a `claude` `━` under it; no background anywhere, so the second argument is kept only for the callers' sake)
function expectThemeOnly(tree: Drawn, _allowTabBackground = false) {
  for (const n of walkAll(tree)) {
    const p = n.props || {}
    expect(p.backgroundColor).toBeUndefined()
    expect(p.inverse).toBeUndefined()
    if (p.color !== undefined) expect(THEME).toContain(p.color as string)
  }
}
const joined = (texts: string[]) => texts.join('')

// the tab showing (owner 2026-10-16: its name is bold default text, or attention bold when it needs the owner, so no colour tells it apart from a
// needing tab): the one strip Button that starts at the column where the baseline's `━` run starts. The strip Buttons come first in draw order
// (the `next` chip, then the tabs), each followed by a one-cell gap; the baseline is the first Text made only of `─` / `━`, its leading `─` run as
// wide as everything left of the active label.
async function activeKeyOf(p: any): Promise<string | undefined> {
  const texts = (await p.findAll({ type: 'Text' })) as Drawn[]
  const rule = texts.map(n => textOf(n as Node)).filter(x => x !== '' && /^[─━]+$/u.test(x))
  const at = rule.findIndex(x => x.startsWith('━'))
  if (at < 0) return undefined
  const markAt = rule.slice(0, at).reduce((w, x) => w + displayWidth(x), 0)
  let x = 0
  for (const b of (await p.findAll({ type: 'Button' })) as Drawn[]) {
    if (b.props?.key !== 'next' && x === markAt) return b.props?.key as string
    x += displayWidth(fullText(b as Node)) + 1 // fullText: the `next` chip may carry its glyph as a label prop
    if (x > markAt) return undefined
  }
  return undefined
}

async function shownTabOf($: any, surface: any) {
  const pane = await $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-live', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
  const tab = (await activeKeyOf(pane))
  await pane.unmount()
  return tab
}

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
    const colored = walkTexts(line.tree).map(n => [textOf(n), n.props?.color as string | undefined, n.props?.dimColor as boolean | undefined] as const)
    const colorOf = (t: string) => colored.find(([x]) => x === t)?.[1]
    const dimOf = (t: string) => colored.find(([x]) => x === t)?.[2]
    expect(colorOf('⊘ 疑似卡住')).toBe('error') // verdict
    expect(dimOf(' 最久的派工 4m 沒有輸出')).toBe(true) // the reason phrase is a dim hint
    expect(colorOf('implement')).toBe('claude') // the stage: you are here
    expect(colorOf('M!·l5 ')).toBeUndefined() // the rest of the position is the default colour
    expect(colored.filter(([x]) => x === '✓').map(([, c]) => c)).toEqual(['success', 'success', 'success']) // walk: two done nodes drawn as ✓ (not ●), then the QC mark
    expect(colorOf('◐')).toBe('claude') // the current node
    expect(colorOf('○')).toBe('inactive') // nodes to come
    expect(colorOf('─')).toBe('subtle') // links are chrome
    expect(colorOf('▰▰')).toBe('success') // unit bar: done cells
    expect(colored.filter(([x]) => x === '▰')[0]?.[1]).toBe('claude') // the current cell
    expect(colorOf('▱▱')).toBe('inactive') // cells to come
    expect(colorOf('●2')).toBe('suggestion') // running: the band draws the same blue as the pane's ●
    expect(colorOf(' ⊘1')).toBe('error') // stalled
    expect(colorOf('QC')).toBeUndefined() // the label stays default text, the mark carries the colour
    expect(dimOf('↺ ')).toBe(true)
    expect(colorOf('◆3')).toBeUndefined() // claude is reserved for "you are here"
    expect(colorOf('?1')).toBe('inactive')
    expect(colorOf('U2')).toBeUndefined()
    expect(colorOf('120')).toBe('warning') // 80.3 % of the cap: the amount, then the bar in the same state colour
    expect(colorOf('▰▰▰▰▰▰▰▰')).toBe('warning')
    expect(dimOf('80%')).toBe(true)
    expect(colorOf('⚑')).toBe('warning') // the owner reminder: the mark is yellow, the number stays default text
    expect(colored.some(([x, c]) => x === '2' && c === undefined)).toBe(true)
    expect(dimOf('↓3')).toBe(true)
    expect(colored.filter(([x]) => x === ' │ ').every(([, c]) => c === 'subtle')).toBe(true)
    expect(colored.every(([x, c]) => c !== 'claude' || x === 'implement' || x === '◐' || x === '▰')).toBe(true) // claude is only "you are here"
    expect(line.tree && walkTexts(line.tree).some(n => n.props?.bold === true && textOf(n) !== '⊘ 疑似卡住')).toBe(false) // bold: the verdict word only
    expectThemeOnly(line.tree as Drawn)
  })

  test('P7 band: an empty slot is skipped with no doubled separator; a bare world is verdict + dispatch + ⓘ (' + surface + ')', async ($, on) => {
    world(on, base())
    await start($, surface)
    const text = (await bandLine($, surface, 209)).text
    expect(text).toBe('⊘ 疑似卡住 最久的派工 4m 沒有輸出 │ ●2 ⊘1 │ ⓘ ')
    expect(text).not.toContain('│  │')
    expect((await bandLine($, surface, 119)).text).toBe('⊘ 疑似卡住 │ ●2 ⊘1 │ ⓘ ') // the reason phrase is for wide bands only
  })

  test('P7 band: the ⓘ is a plain Button with autoFocus and no hotkey; pressing it opens the pane on the Now tab (' + surface + ')', async ($, on) => {
    const w = world(on, richWorld())
    await start($, surface)
    for (const cols of [209, 119, 60]) {
      const ui = await $.ui.mount({ plugin: 'autopilot', surface, component: 'AbovePrompt', props: { ...BAND_PROPS, bodyColumns: cols }, viewport: { columns: cols, rows: 50, isFullscreen: true } })
      const buttons = (await ui.findAll({ type: 'Button' })) as Drawn[]
      const info = buttons.find(b => b.props?.key === 'info') as Drawn
      expect(info.props?.plain).toBe(true)
      expect(info.props?.autoFocus).toBe(true)
      expect(info.props?.hotkey).toBeUndefined()
      expect(JSON.stringify(info)).toContain('ⓘ')
      expect(buttons.filter(b => b.props?.autoFocus === true).map(b => b.props?.key)).toEqual(['info']) // the slots never take the keyboard's first stop
      expect(buttons[buttons.length - 1]).toBe(info) // and it is still the last control on the line
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
    const texts = allRows((await pane.drawn()) as Node)
    // the keyboard lands on the first-drawn `›` next-tab chip, whose Enter steps on (never on the active tab's own button: that Enter is a no-op)
    const tabButtons = (await pane.findAll({ type: 'Button' })) as Drawn[]
    expect(tabButtons.filter(b => b.props?.key === 'next' || (PANE_TABS as readonly string[]).includes(b.props?.key as string)).length).toBe(8) // the section headings are Buttons too
    expect(tabButtons.filter(b => b.props?.autoFocus === true).map(b => b.props?.key)).toEqual(['next'])
    expect(tabButtons[0].props?.key).toBe('next')
    await pane.unmount()
    expect(texts[0]).toContain('⊘ 疑似卡住') // the Now tab: its hero row, then the dim header
    expect(texts[0]).toContain('工作階段 $') // and the spend / ctx metrics on its right (P4: one global header)
    expect(texts.some(t => t.startsWith('▾ 狀態 ') || t.startsWith('▾ 符號 '))).toBe(false) // not the legend
  })

  test('P8 band: the ⓘ label is two cells, so the right half of a glyph the terminal draws wide is still the Button (' + surface + ')', async ($, on) => {
    world(on, richWorld())
    await start($, surface)
    // ⓘ (U+24D8) is East Asian Width Ambiguous: counted one cell here, drawn two by a CJK-locale terminal; a one-cell Button left its right half dead
    const line = await bandLine($, surface, 209)
    const label = labelOf(line.info as Node)
    expect(label).toBe('ⓘ ')
    expect(displayWidth(label)).toBe(2)
    expect(displayWidth(line.text)).toBeLessThanOrEqual(209)
  })

  test('P8 band: every slot is a plain Button keyed by its slot id, holding only its own text (' + surface + ')', async ($, on) => {
    world(on, richWorld())
    await start($, surface)
    const cases: [number, string[]][] = [
      [209, ['verdict', 'position', 'unit', 'dispatch', 'review', 'decisions', 'spend', 'hygiene', 'info']],
      [60, ['verdict', 'dispatch', 'hygiene', 'info']],
    ]
    for (const [cols, keys] of cases) {
      const ui = await $.ui.mount({ plugin: 'autopilot', surface, component: 'AbovePrompt', props: { ...BAND_PROPS, bodyColumns: cols }, viewport: { columns: cols, rows: 50, isFullscreen: true } })
      const buttons = (await ui.findAll({ type: 'Button' })) as Drawn[]
      await ui.unmount()
      expect(buttons.map(b => b.props?.key)).toEqual(keys)
      for (const b of buttons) {
        expect(b.props?.plain).toBe(true)
        expect(b.props?.hotkey).toBeUndefined()
        if (b.props?.key !== 'info') expect(textOf(b as Node)).not.toContain('│') // the separators sit between Buttons, never inside one
      }
    }
    const slotText = async (key: string) => {
      const ui = await $.ui.mount({ plugin: 'autopilot', surface, component: 'AbovePrompt', props: { ...BAND_PROPS, bodyColumns: 209 }, viewport: { columns: 209, rows: 50, isFullscreen: true } })
      const b = ((await ui.findAll({ type: 'Button' })) as Drawn[]).find(x => x.props?.key === key) as Node
      await ui.unmount()
      return textOf(b)
    }
    expect(await slotText('verdict')).toBe('⊘ 疑似卡住 最久的派工 4m 沒有輸出') // the reason phrase presses as the verdict
    expect(await slotText('decisions')).toBe('◆3 ?1 U2')
    expect(await slotText('spend')).toBe('$120 ▰▰▰▰▰▰▰▰▱▱ 80%')
  })

  test('P8 band: pressing a slot opens the pane, with the keyboard, on the tab that explains it (' + surface + ')', async ($, on) => {
    const w = world(on, richWorld())
    await start($, surface)
    const pairs: [string, string][] = [['dispatch', 'dispatch'], ['decisions', 'review'], ['spend', 'spend'], ['hygiene', 'hygiene'], ['review', 'review'], ['unit', 'now'], ['verdict', 'now'], ['position', 'now']]
    for (const [slot, tab] of pairs) {
      const band = await $.ui.mount({ plugin: 'autopilot', surface, component: 'AbovePrompt', props: { ...BAND_PROPS, bodyColumns: 209 }, viewport: { columns: 209, rows: 50, isFullscreen: true } })
      await band.press({ key: slot })
      await band.unmount()
      const pane = await $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-live', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
      const active = (await activeKeyOf(pane))
      await pane.unmount()
      expect([slot, active]).toEqual([slot, tab])
    }
    expect(w.opens.length).toBe(pairs.length)
    expect(w.opens.every(o => o.id === 'autopilot-live' && o.focus === true && o.closeOnEscape === true)).toBe(true)
  })

  test('P8 band: pressing the position slot opens a folded 位置 section (' + surface + ')', async ($, on) => {
    world(on, richWorld())
    await start($, surface)
    const mountPane = () => $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-live', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
    const first = await mountPane()
    await first.press({ key: 'now' })
    await first.unmount()
    const rowsNow = async () => { const p = await mountPane(); const r = rowsOf((await p.drawn()) as Node); await p.unmount(); return r }
    const at = (await rowsNow()).findIndex(r => r.startsWith('▾ 位置'))
    expect(at).toBeGreaterThanOrEqual(0)
    const fold = await mountPane()
    await fold.press({ key: 'b' + at })
    await fold.unmount()
    expect((await rowsNow())[at].startsWith('▸ 位置')).toBe(true)
    const band = await $.ui.mount({ plugin: 'autopilot', surface, component: 'AbovePrompt', props: { ...BAND_PROPS, bodyColumns: 209 }, viewport: { columns: 209, rows: 50, isFullscreen: true } })
    await band.press({ key: 'position' })
    await band.unmount()
    expect((await rowsNow())[at].startsWith('▾ 位置')).toBe(true)
  })

  test('P8 band: a slot pressed while an ⓘ press is still opening wins, and the next ⓘ steps on from the slot\'s tab (' + surface + ')', async ($, on) => {
    const w = world(on, richWorld())
    await start($, surface)
    let release: () => void = () => {}
    w.openGate = new Promise<void>(r => { release = r })
    const band = () => $.ui.mount({ plugin: 'autopilot', surface, component: 'AbovePrompt', props: BAND_PROPS, viewport: { columns: 120, rows: 50, isFullscreen: true } })
    const a = await band()
    const pa = a.press({ key: 'info' }) // parked on the gate
    const b = await band()
    const pb = b.press({ key: 'dispatch' })
    await new Promise(r => setTimeout(r, 20))
    release()
    await Promise.all([pa, pb])
    await a.unmount()
    await b.unmount()
    const activeTab = async () => {
      const pane = await $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-live', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
      const tab = (await activeKeyOf(pane))
      await pane.unmount()
      return tab
    }
    expect(await activeTab()).toBe('dispatch') // the stale ⓘ press did not drag it back to Now
    w.openGate = null
    const c = await band()
    await c.press({ key: 'info' })
    await c.unmount()
    expect(await activeTab()).toBe('review') // one step on from Dispatch
  })

  test('P7 band: the info press cycles the seven tabs while the pane is open; closed it opens on Now (' + surface + ')', async ($, on) => {
    const w = world(on, richWorld())
    await start($, surface)
    const band = () => $.ui.mount({ plugin: 'autopilot', surface, component: 'AbovePrompt', props: BAND_PROPS, viewport: { columns: 120, rows: 50, isFullscreen: true } })
    const shownTab = async () => {
      const pane = await $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-live', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
      const tab = (await activeKeyOf(pane))
      await pane.unmount()
      return tab
    }
    const press = async () => { const ui = await band(); await ui.press({ key: 'info' }); await ui.unmount() }
    expect([...PANE_TABS]).toEqual(['now', 'decide', 'dispatch', 'review', 'spend', 'hygiene', 'legend'])
    await press() // closed -> Now
    expect(await shownTab()).toBe('now')
    await press()
    expect(await shownTab()).toBe('decide')
    await press()
    expect(await shownTab()).toBe('dispatch')
    await press()
    expect(await shownTab()).toBe('review')
    // a mouse click on another tab, then the press continues from the clicked tab
    const pane = await $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-live', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
    await pane.press({ key: 'spend' })
    await pane.unmount()
    expect(await shownTab()).toBe('spend')
    await press()
    expect(await shownTab()).toBe('hygiene')
    for (const want of ['legend', 'now', 'decide']) { await press(); expect(await shownTab()).toBe(want) } // the ? legend is last; the ring wraps to Now
    // closed again (Escape / the person closes it): the next press is Now, not the tab after Dispatch
    w.panes = []
    await press()
    expect(await shownTab()).toBe('now')
  })

  // Real machine 2026-10-10 (120 columns): Ctrl+x Tab can land the ring on the pane's active tab Button, where Enter pressed the tab it already showed.
  // The first-drawn Button is now the `›` next-tab chip and it alone carries autoFocus.
  const paneTabs = async ($: any, surface: any) => $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-live', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })

  test('keyboard: Enter on the › chip (where the ring lands) steps through all seven tabs and wraps, whatever tab shows (' + surface + ')', async ($, on) => {
    const w = world(on, richWorld())
    await start($, surface)
    for (const want of ['decide', 'dispatch', 'review', 'spend', 'hygiene', 'legend', 'now', 'decide']) {
      const pane = await paneTabs($, surface)
      await pane.press({ key: 'next' })
      await pane.unmount()
      expect(await shownTabOf($, surface)).toBe(want)
    }
  })

  test('mouse / arrows: a press on a tab Button selects that tab, also the one already showing (' + surface + ')', async ($, on) => {
    const w = world(on, richWorld())
    await start($, surface)
    const pane = await paneTabs($, surface)
    await pane.press({ key: 'hygiene' })
    await pane.press({ key: 'hygiene' }) // the showing tab: unchanged, as before (no step on)
    await pane.unmount()
    expect(await shownTabOf($, surface)).toBe('hygiene')
  })

  test('keyboard: › and the ⓘ share one order: a ⓘ press after a › press continues from the tab showing (' + surface + ')', async ($, on) => {
    const w = world(on, richWorld())
    await start($, surface)
    const band = await $.ui.mount({ plugin: 'autopilot', surface, component: 'AbovePrompt', props: BAND_PROPS, viewport: { columns: 120, rows: 50, isFullscreen: true } })
    await band.press({ key: 'info' }) // closed -> Now
    const pane = await paneTabs($, surface)
    await pane.press({ key: 'next' }) // -> Decide
    await pane.press({ key: 'next' }) // -> Dispatch
    await pane.press({ key: 'next' }) // -> Review
    await pane.unmount()
    await band.press({ key: 'info' }) // the pane is open: the next tab
    await band.unmount()
    expect(await shownTabOf($, surface)).toBe('spend')
    expect(w.panes).toEqual(['autopilot-live'])
  })

  test('keyboard: a tab press switches the tab even when the pane does not hold the keys, so the ring move is refused (' + surface + ')', async ($, on) => {
    const w = world(on, richWorld())
    await start($, surface)
    const pane = await paneTabs($, surface)
    await pane.press({ key: 'review' })
    await pane.unmount()
    expect(await shownTabOf($, surface)).toBe('review')
  })

  test('P7 band: $.ui.panes() throwing reads as closed: the press opens the panel on Now and does not break the band (' + surface + ')', async ($, on) => {
    const w = world(on, richWorld())
    await start($, surface)
    w.panesThrow = true
    const band = () => $.ui.mount({ plugin: 'autopilot', surface, component: 'AbovePrompt', props: BAND_PROPS, viewport: { columns: 120, rows: 50, isFullscreen: true } })
    const shownTab = async () => {
      const pane = await $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-live', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
      const tab = (await activeKeyOf(pane))
      await pane.unmount()
      return tab
    }
    for (let i = 0; i < 2; i += 1) { // without a pane list every press is "closed": Now each time, never a throw
      const ui = await band()
      await ui.press({ key: 'info' })
      await ui.unmount()
      expect(await shownTab()).toBe('now')
    }
    expect(w.opens.length).toBe(2)
    expect(w.opens.every(o => o.id === 'autopilot-live' && o.focus === true)).toBe(true)
    expect((await bandLine($, surface, 209)).info).toBeDefined() // the band still draws
  })

  test('P7 band: a second press before $.ui.open resolves moves on to the next tab, it does not reopen Now (' + surface + ')', async ($, on) => {
    const w = world(on, richWorld())
    await start($, surface)
    let release: () => void = () => {}
    w.openGate = new Promise<void>(r => { release = r })
    const band = () => $.ui.mount({ plugin: 'autopilot', surface, component: 'AbovePrompt', props: BAND_PROPS, viewport: { columns: 120, rows: 50, isFullscreen: true } })
    const first = await band()
    const firstPress = first.press({ key: 'info' }) // the open is parked on the gate: the pane is not listed yet
    const second = await band()
    const secondPress = second.press({ key: 'info' })
    await new Promise(r => setTimeout(r, 20))
    release()
    await Promise.all([firstPress, secondPress])
    await first.unmount()
    await second.unmount()
    const pane = await $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-live', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
    const tab = (await activeKeyOf(pane))
    await pane.unmount()
    expect(tab).toBe('decide') // Now (first press) then Decide (second press)
  })

  test('P7 band: a second press while $.ui.panes() is still pending moves on to the next tab, not Now (' + surface + ')', async ($, on) => {
    const w = world(on, richWorld())
    await start($, surface)
    let release: () => void = () => {}
    w.panesGate = new Promise<void>(r => { release = r })
    const a = await $.ui.mount({ plugin: 'autopilot', surface, component: 'AbovePrompt', props: BAND_PROPS, viewport: { columns: 120, rows: 50, isFullscreen: true } })
    const pa = a.press({ key: 'info' })
    const b = await $.ui.mount({ plugin: 'autopilot', surface, component: 'AbovePrompt', props: BAND_PROPS, viewport: { columns: 120, rows: 50, isFullscreen: true } })
    const pb = b.press({ key: 'info' })
    const c = await $.ui.mount({ plugin: 'autopilot', surface, component: 'AbovePrompt', props: BAND_PROPS, viewport: { columns: 120, rows: 50, isFullscreen: true } })
    const pc = c.press({ key: 'info' })
    await new Promise(r => setTimeout(r, 20))
    release()
    await Promise.all([pa, pb, pc])
    await a.unmount(); await b.unmount(); await c.unmount()
    expect(await shownTabOf($, surface)).toBe('dispatch') // closed -> Now, then Decide, then Dispatch
  })

  test('P7 band: a session.start during a pending press does not break later double presses (' + surface + ')', async ($, on) => {
    const w = world(on, richWorld())
    await start($, surface)
    let release: () => void = () => {}
    w.openGate = new Promise<void>(r => { release = r })
    const a = await $.ui.mount({ plugin: 'autopilot', surface, component: 'AbovePrompt', props: BAND_PROPS, viewport: { columns: 120, rows: 50, isFullscreen: true } })
    const pa = a.press({ key: 'info' }) // parked on the open gate
    await new Promise(r => setTimeout(r, 20))
    await start($, surface) // session.start resets the press state while that press is in flight
    release()
    await pa
    await a.unmount()
    w.openGate = null
    w.panes = [] // the person closed it
    let release2: () => void = () => {}
    w.panesGate = new Promise<void>(r => { release2 = r })
    const b = await $.ui.mount({ plugin: 'autopilot', surface, component: 'AbovePrompt', props: BAND_PROPS, viewport: { columns: 120, rows: 50, isFullscreen: true } })
    const pb = b.press({ key: 'info' })
    const c = await $.ui.mount({ plugin: 'autopilot', surface, component: 'AbovePrompt', props: BAND_PROPS, viewport: { columns: 120, rows: 50, isFullscreen: true } })
    const pc = c.press({ key: 'info' })
    await new Promise(r => setTimeout(r, 20))
    release2()
    await Promise.all([pb, pc])
    await b.unmount(); await c.unmount()
    expect(await shownTabOf($, surface)).toBe('decide') // Now, then Decide
  })

  test('P7 band: a non-ok snapshot is one dim line `<reason> │ ⓘ`, the reason cut to fit (' + surface + ')', async ($, on) => {
    const files = base()
    delete files[LIVE + '/runs/' + KEY + '--' + ROOT + '.json']
    delete files[LIVE + '/runs/' + KEY + '.json']
    worldEn(on, files)
    await start($, surface)
    const wide = await bandLine($, surface, 209)
    expect(wide.text).toBe('unavailable · run: autopilot status runs --watch --project ' + KEY + ' │ ⓘ ')
    expect(walkTexts(wide.tree)[0].props?.dimColor).toBe(true)
    const narrow = await bandLine($, surface, 40)
    expect(displayWidth(narrow.text)).toBeLessThanOrEqual(40)
    expect(narrow.text.endsWith('… │ ⓘ ')).toBe(true)
    expect(narrow.info).toBeDefined()
  })

  test('P7 band: the former second line is gone; the awaited decision is a clipped reason on the wide band and whole on the Now tab (' + surface + ')', async ($, on) => {
    const files = richWorld()
    files[AHOME + '/review/' + KEY + '/2026-10-04/' + ROOT + '/current/model.json'] = j(model({ needs_decision: true, decisions: [{ question: '要合併 plan 還是拆開？', options: [{ label: '合併', description: '一次驗收' }] }] }))
    world(on, files)
    await start($, surface)
    const band = await bandLine($, surface, 209)
    expect(band.text.startsWith('▲ 要你決定 要合併 plan 還是拆開？ │ ')).toBe(true) // the reason phrase: wide bands only
    expect(band.text.includes('\n')).toBe(false)
    expect((await bandLine($, surface, 159)).text).not.toContain('要合併 plan 還是拆開？')
    const now = (await paneParts($, surface, 'now')).texts
    expect(now.some(t => /^▲ 待決議事項 1 件\s+待決 ›$/.test(t))).toBe(true) // the Now tab points at 待決
    const cards = (await paneParts($, surface, 'decide')).texts
    expect(cards[1]).toBe('▲ 1. 要合併 plan 還是拆開？') // whole on the 待決 tab, options included
    expect(cards).toContain('  選項      [ ] 合併') // this question has one option
  })

  test('P7 panel: the tab strip is seven Buttons in contract order, the active one bold, with badges (' + surface + ')', async ($, on) => {
    world(on, richWorld())
    await start($, surface)
    const pane = await $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-live', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
    const tree = (await pane.drawn()) as Drawn
    const buttons = walkAll(tree).filter(n => n.type === 'Button').map(n => n.props?.key as string).filter(k => !/^[bg]\d+$/.test(k)) // the body's toggle lines (and the summary rows' goto Buttons) (section headings, recent groups) are Buttons too
    expect(buttons).toEqual(['next', 'now', 'decide', 'dispatch', 'review', 'spend', 'hygiene', 'legend']) // the › chip first (it carries the autoFocus), then the seven tabs in contract order
    // the strip (child 0): zh labels, a badge per tab that holds something for the owner: ●N live runs, ⚑N residue (QC is ok here, so no ▲ on Review)
    const strip = stripOf(tree as Node)
    expect(strip).toContain('現況')
    expect(strip).toContain('待決')
    expect(strip).toContain('派工')
    expect(strip).toContain('審查')
    expect(strip).toContain('用量')
    expect(strip).toContain('殘留')
    expect(strip.trim().endsWith('?')).toBe(true)
    expect(strip).not.toMatch(/[▲●⚑]/) // no symbol badge anywhere in the strip
    // names only: 殘留 needs the owner (2 worktrees) and is warning bold; 派工 has 2 live runs and is plain dim; 待決 has nothing pending here and is plain dim
    const nameNode = (id: string) => tabName(tree as Node, id)
    expect(nameNode('hygiene').props?.color).toBe('warning')
    expect(nameNode('hygiene').props?.bold).toBe(true)
    for (const id of ['dispatch', 'decide', 'spend']) { expect(nameNode(id).props?.color, id).toBeUndefined(); expect(nameNode(id).props?.bold, id).not.toBe(true) }
    expect(strip).not.toMatch(/殘留 \d/) // variant A: colour only, no number
    // the active tab (Now) is bold default text with a `claude` `━` run in the rule under it; the inactive ones are dim; nothing carries a background (§8 Q1, 2026-10-16)
    const stripNodes = walkAll(((tree.children || [])[0]) as Drawn)
    expect(stripNodes.filter(n => n.props?.backgroundColor !== undefined).length).toBe(0)
    const boldNodes = stripNodes.filter(n => n.type === 'Text' && n.props?.bold === true)
    expect(boldNodes.some(n => textOf(n as Node).includes('現況') && n.props?.color === undefined)).toBe(true)
    expect(stripNodes.some(n => n.type === 'Text' && n.props?.color === 'claude' && !textOf(n as Node).includes('━'))).toBe(false) // claude only on the ━ run
    expect(boldNodes.some(n => textOf(n as Node).includes('派工'))).toBe(false)
    expect(fullText(((tree.children || []) as Node[])[0])).toContain('━')
    await pane.unmount()
  })

  test('P7 panel: tab names: Review, Hygiene and Decide go warning bold when they need the owner, Dispatch never does, no symbol anywhere (' + surface + ')', async ($, on) => {
    const files = richWorld()
    files[LIVE + '/runs/' + KEY + '.qc.json'] = j({ schema: 'autopilot.qc-status/1', scope: { project_key: KEY, root_run_id: null }, state: 'owed', range: null, protected_files_count: 1, evidence: null })
    const w = world(on, files)
    await start($, surface)
    const tree0 = async () => (await paneParts($, surface, 'now')).tree
    const loud = (tree: Node, id: string) => { const p = tabName(tree, id).props; return p?.color === 'warning' && p?.bold === true }
    const owed = await tree0()
    expect(loud(owed, 'review'), 'QC owed marks Review').toBe(true)
    expect(loud(owed, 'hygiene'), 'residue marks Hygiene').toBe(true)
    expect(loud(owed, 'dispatch'), 'a live dispatch marks nothing').toBe(false)
    expect(stripOf(owed)).not.toMatch(/[▲●⚑]/)
    delete w.files[LIVE + '/runs/' + KEY + '.qc.json']
    delete w.files[LIVE + '/runs/' + KEY + '.residue.json']
    await w.clock.advance(5000)
    // the rich world's plugin source is behind upstream: the 外掛來源 row shows ▲, so 殘留 stays marked with no residue at all
    expect(loud(await tree0(), 'hygiene'), 'a load source behind upstream marks Hygiene').toBe(true)
    w.files[LIVE + '/load-source.json'] = j({ schema: 'autopilot.load-source/1', checked_at: PUBLISHED, plugin_version: '2.37.0', source: 'dev', source_basis: 'dev_link', marketplace: 'directory', behind_upstream: 0, flags: [], stale_cache_dirs: [] })
    await w.clock.advance(5000)
    const quiet = await tree0()
    for (const id of ['review', 'hygiene', 'dispatch', 'decide']) expect(loud(quiet, id), id + ' with nothing to do is not marked').toBe(false)
    expect(stripOf(quiet)).not.toMatch(/[▲●⚑]/)
  })

  test('P7 panel: every tab renders its fixture facts, theme colours only (' + surface + ')', async ($, on) => {
    world(on, richWorld())
    await start($, surface)
    const tab = async (id: string) => paneParts($, surface, id)
    const has = (texts: string[], ...parts: string[]) => { const ok = texts.some(t => parts.every(p => t.includes(p))); if (!ok) throw new Error('no line has: ' + parts.join(' | ')); return ok }
    const legend = await tab('legend')
    expect(legend.texts[0]).toContain('狀態') // the generated `?` tab (I15) opens on its states section
    for (const id of ui.STATE_IDS) expect(joined(legend.texts)).toContain(ui.STATES[id].glyph + ' ' + makeT('zh-TW')('ui.state.' + id)) // every state glyph with its word
    for (const k of ['open', 'folded', 'goto', 'bullet', 'detail', 'command', 'tabMark', 'behind'] as const) expect(joined(legend.texts)).toContain(ui.GLYPHS.structure[k])
    expect(legend.texts.some(t => t.includes('Ctrl+x Tab'))).toBe(true)
    expectThemeOnly(legend.tree as Drawn, true)

    const now = await tab('now')
    expect(now.head[0]).toContain('⊘ 疑似卡住  repo')
    expect(now.head.join('\n')).toContain('工作階段 $0.42 · 本機今日 $3.10 · ctx 37%')
    expect(has(now.texts, '階段', 'implement', '已在此階段 3m', 'M!·l5')).toBe(true)
    expect(has(now.texts, '單元', '▰▰▰▱▱ 3/5', 'band (deliverable)', '2 個審查家族')).toBe(true)
    const walk = now.texts.find(t => t.includes('◐')) as string // the stage-walk diagram: five nodes, the third is the current one
    expect(walk.match(/[✓◐○]/g)?.join('')).toBe('✓✓◐○○')
    expect(now.texts.some(t => t.includes('實作') && !t.includes('◐') && !t.includes('階段') && !t.includes('⊘'))).toBe(true) // the label row under the diagram (stage ids are translated labels)
    expect(has(now.texts, '派工 ›', '2 個執行中', '1 個疑似卡住')).toBe(true)
    expect(has(now.texts, '審查 ›', '待修', '程式碼審查 R3', '1 席待修')).toBe(true)
    expect(now.texts[1]).toBe('⊘ 疑似卡住  最久的派工 4m 沒有輸出') // the verdict reason is the first item of 要你處理 (P4); its state differs from the chip's, so it says the word
    expectThemeOnly(now.tree as Drawn, true)

    const dispatch = await tab('dispatch')
    expect(has(dispatch.texts, ' r1 ', 'implementer', '● 執行')).toBe(true)
    expect(has(dispatch.texts, '▾ 執行中', '⊘ 2')).toBe(true) // the section chip: the worst state of the two live rows (one is stalled) and their count
    expect(has(dispatch.texts, '▾ 已完成', '✓ 1')).toBe(true)

    const review = await tab('review')
    expect(has(review.texts, '程式碼審查', '△ 待修')).toBe(true)
    expect(has(review.texts, '輪次', 'R3', '11111111..aaaaaaaa', 'p7')).toBe(true)
    expect(has(review.texts, '△ 待修', 's0', 'minimax')).toBe(true)
    expect(has(review.texts, '推送前檢查', '✓ 完成')).toBe(true)
    expect(has(review.texts, '範圍', '2 個受保護檔案', '11111111..aaaaaaaa')).toBe(true)
    expect(has(review.texts, '我替你決定的事', '3 件 · 1 件不可逆')).toBe(true)
    expect(has(review.texts, '沒寫理由', '1 次派工')).toBe(true)
    expect(has(review.texts, '卡關升級', '▰▰▰▱▱▱', 'U2', 'U0 ─ U5', '5m 前')).toBe(true)
    expect(has(review.texts, '計畫審查', '△ 待修')).toBe(true)
    expectThemeOnly(review.tree as Drawn, true)

    const spend = await tab('spend')
    expect(has(spend.texts, '▾ 額度', '接近上限')).toBe(true)
    expect(has(spend.texts, 'brain 今日', '80%', '$120.40 / $150.00')).toBe(true)
    expect(has(spend.texts, 'brain 到 80% 開始提醒', '保險絲只提醒、不擋')).toBe(true)
    expect(has(spend.texts, '本機', '$3.10', '所有層')).toBe(true)
    expect(has(spend.head, '工作階段', '$0.42')).toBe(true) // the session total is the header projection (P4)
    expectThemeOnly(spend.tree as Drawn, true)

    const hygiene = await tab('hygiene')
    // §12.7: two sections (what needs you, what can simply be cleared), each entry its name, its reason and its command; the cleanable one is not in the 2 that need you
    expect(has(hygiene.texts, '▾ 要你處理', ' 2 ', '3.0 MB')).toBe(true)
    expect(has(hygiene.texts, '▲ hands-x', '4d04h', '2.0 MB')).toBe(true)
    expect(has(hygiene.texts, '有沒提交的檔案，先看內容再決定要不要刪')).toBe(true)
    expect(has(hygiene.texts, '▲ feature/old', '20d')).toBe(true)
    expect(has(hygiene.texts, '分支還沒合併；確定不要了才刪')).toBe(true)
    expect(has(hygiene.texts, '▾ 可以直接清掉', ' 1 ', '1.0 MB')).toBe(true)
    expect(has(hygiene.texts, '◦ hands-old', '9d', '1.0 MB')).toBe(true)
    expect(has(hygiene.texts, '已合併，可以刪')).toBe(true)
    expect(hygiene.texts.some(t => t.includes('worktree remove /home/u/proj/.claude/worktrees/hands-old') || t.includes('hands-old')), 'the command of the cleanable entry').toBe(true)
    expect(has(hygiene.texts, '上次', '3h00m 前', '刪了 2 個 worktree、封存 1 條分支')).toBe(true)
    expect(has(hygiene.texts, '▾ 外掛來源')).toBe(true)
    expect(hygiene.texts.find(t => t.includes('▾ 外掛來源')), 'the source header carries no state chip').not.toContain('要你處理')
    expect(has(hygiene.texts, '▲ 開發目錄', 'v2.37.0')).toBe(true)
    expect(has(hygiene.texts, '落後遠端 3 個提交')).toBe(true)
    expectThemeOnly(hygiene.tree as Drawn, true)
  })

  test('P7 panel: a missing fact is an explicit "no data" line, never an empty tab (' + surface + ')', async ($, on) => {
    worldEn(on, base())
    await start($, surface)
    const ndata = async (id: string) => (await paneParts($, surface, id)).texts.filter(t => t.replace(/^— /, '').startsWith('no data'))
    expect((await paneParts($, surface, 'now')).texts).toContain('— this session has no stage or unit recorded') // one Position line (P4)
    expect((await paneParts($, surface, 'review')).texts.filter(t => t.startsWith('— no '))).toEqual(['— no review published', '— no pre-push check status published', '— no decisions sidecar published'])
    expect(await ndata('spend')).toEqual(['— no data · brain-tier spend today is not published'])
    expect(await ndata('hygiene')).toEqual(['— no data · no worktree residue published', '— no data · no automatic cleanup record published', '— no data · no load source published']) // one empty line per section, in SECTION_ORDER
    for (const id of ['now', 'dispatch', 'review', 'spend', 'hygiene', 'legend']) {
      expect((await paneParts($, surface, id)).texts.length).toBeGreaterThan(1) // never just the header
    }
  })

  test('P7 panel: the cost fuse mode comes from the config file; a value outside block / warn / off is warn (' + surface + ')', async ($, on) => {
    const files = richWorld()
    files[AHOME + '/config.json'] = j({ cost_fuse: { mode: 'block' } })
    const w = worldEn(on, files)
    await start($, surface)
    const fuse = async () => (await paneParts($, surface, 'spend')).texts.find(t => t.includes('fuse:')) as string
    expect(await fuse()).toContain('fuse: blocks at the cap')
    files[AHOME + '/config.json'] = j({ cost_fuse: { mode: 'loud' } })
    await w.clock.advance(5000)
    expect(await fuse()).toContain('fuse: warns, never blocks')
  })

  test('P7 panel: no drawn node uses inverse or a non-theme colour; the only background is the active tab, `subtle`, and the band has none (' + surface + ')', async ($, on) => {
    const files = richWorld()
    files[LIVE + '/runs/' + KEY + '--' + ROOT + '.json'] = j(envelope({ host_today_brain_usd: 160, brain_cap_usd: 150 })) // spend at error
    world(on, files)
    await start($, surface)
    for (const cols of [209, 139, 79]) expectThemeOnly((await bandLine($, surface, cols)).tree as Drawn)
    for (const id of ['now', 'dispatch', 'review', 'spend', 'hygiene', 'legend']) expectThemeOnly((await paneParts($, surface, id)).tree as Drawn, true)
    expect(walkTexts((await bandLine($, surface, 209)).tree).find(n => textOf(n) === '160')?.props?.color).toBe('error')
  })
}

test('P7 model: displayWidth counts East Asian wide as 2, combining as 0 and the band glyphs as 1', () => {
  expect(displayWidth('abc')).toBe(3)
  expect(displayWidth('要你決定')).toBe(8)
  expect(displayWidth('族')).toBe(2)
  expect(displayWidth('Ａ')).toBe(2) // fullwidth latin
  expect(displayWidth('é')).toBe(1) // combining acute
  expect(displayWidth('▲⊘✓●◌▸◷▰▱●◆↺ⓘ│')).toBe(14)
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
  // position: size[!]·level·stage ◷age; level omitted when null; no stage = no slot
  expect(text(slotPosition(mk({}), NOW))).toBe('M·l5·implement ◷3m')
  expect(text(slotPosition(mk({ urgent: true, level: null }), NOW))).toBe('M!·implement ◷3m')
  expect(text(slotPosition(mk({ stage_set_at: undefined }), NOW))).toBe('M·l5·implement')
  expect(slotPosition(mk({ stage: null }), NOW)).toBeNull()
  expect(slotPosition(null, NOW)).toBeNull()
  expect(slotPosition(mk({}), NOW)?.segs.find(g => g.tag === 'stage')?.color).toBe('claude')
  // unit: bar + k/N + 族; N > 10 scales to 10 cells; no unit = no slot
  const u = (index: number, total: number, fam: string[] = []) => slotUnit(mk({ unit: { kind: 'deliverable', index, total, label: '' }, review_families: fam }))
  expect(text(u(1, 3))).toBe('▰▱▱ 1/3')
  expect(text(u(3, 3, ['a']))).toBe('▰▰▰ 3/3 ·1fam') // the default table is en
  expect(slotUnit(mk({ unit: { kind: 'deliverable', index: 3, total: 3, label: '' }, review_families: ['a'] }), makeT('zh-TW')) === null ? '' : text(slotUnit(mk({ unit: { kind: 'deliverable', index: 3, total: 3, label: '' }, review_families: ['a'] }), makeT('zh-TW')))).toBe('▰▰▰ 3/3 ·1族')
  expect(u(2, 4)?.segs.map(g => [g.text, g.color])).toEqual([['▰', 'success'], ['▰', 'claude'], ['▱▱', 'inactive'], [' 2/4', undefined]])
  expect(text(u(7, 20))).toBe('▰▰▰▰▰▰▰▱▱▱ 7/20'.replace('▰▰▰▰▰▰▰▱▱▱', '▰▰▰▰▱▱▱▱▱▱')) // ceil(7*10/20) = 4th cell
  expect(slotUnit(mk({ unit: null }))).toBeNull()
  // dispatch: zero counts omitted
  expect(text(slotDispatch(2, 1))).toBe('●2 ⊘1')
  expect(text(slotDispatch(0, 1))).toBe('⊘1')
  expect(text(slotDispatch(3, 0))).toBe('●3')
  expect(slotDispatch(0, 0)).toBeNull()
  // review: ↺ R<n> QC▲ / QC✓; the chip alone has no leading space
  const rv = readReview(JSON.stringify({ schema: 'autopilot.review/1', project_key: KEY, code: { generation: 4, seats: [] } }), KEY)
  const qc = (state: string) => readQc(JSON.stringify({ schema: 'autopilot.qc-status/1', scope: { project_key: KEY, root_run_id: null }, state }), { project_key: KEY, root_run_id: null })
  expect(text(slotReview(rv, qc('owed')))).toBe('↺ R4 QC▲')
  expect(slotReview(rv, qc('owed'))?.segs.slice(3).map(g => [g.text, g.color, g.bold])).toEqual([['QC', undefined, undefined], ['▲', 'warning', undefined]]) // the label is default text; only the mark is yellow, and nothing is bold
  expect(text(slotReview(null, qc('ok')))).toBe('QC✓')
  expect(text(slotReview(rv, qc('not_needed')))).toBe('↺ R4')
  expect(slotReview(null, qc('unknown'))).toBeNull()
  // decisions
  const dv = (over: Record<string, unknown>) => ({ rows: [], count: 0, irreversible: 0, writers: [], undocumented: 0, identity: null, root: null, ladder: null, ...over }) as never
  expect(text(slotDecisions(dv({ count: 2, undocumented: 1, ladder: { rung: 'U3', at: 'x' } })))).toBe('◆2 ?1 U3')
  expect(text(slotDecisions(dv({ undocumented: 4 })))).toBe('?4')
  expect(slotDecisions(dv({}))).toBeNull()
  expect(slotDecisions(null)).toBeNull()
  // spend: `$<integer> <bar> <pct>`; warning from 80 %, error from 100 %
  const colorOf = (brain: number) => slotSpend({ brain, cap: 150 })?.segs[0].color
  const lay = (s: Slot | null, cols: number) => layoutBand(s === null ? [] : [s], cols).text
  expect(lay(slotSpend({ brain: 119.6, cap: 150 }), 209)).toBe('$120 ▰▰▰▰▰▰▰▰▱▱ 80% │ ⓘ ')
  expect(lay(slotSpend({ brain: 119.6, cap: 150 }), 150)).toBe('$120 ▰▰▰▰▱ │ ⓘ ')
  expect(lay(slotSpend({ brain: 119.6, cap: 150 }), 100)).toBe('$▰▰▱ │ ⓘ ')
  expect(lay(slotSpend({ brain: 12, cap: 100 }), 209)).toBe('$12 ▰▱▱▱▱▱▱▱▱▱ 12% │ ⓘ ')
  expect(lay(slotSpend({ brain: 160, cap: 150 }), 209)).toBe('$160 ▰▰▰▰▰▰▰▰▰▰ 107% │ ⓘ ') // over the cap: the bar is full, the percent is honest
  expect(colorOf(119)).toBeUndefined()
  expect(colorOf(120)).toBe('warning')
  expect(colorOf(149)).toBe('warning')
  expect(colorOf(150)).toBe('error')
  expect(slotSpend(null)).toBeNull()
  // hygiene: chip + wt n (n > 0 only)
  const ls = (over: Record<string, unknown> = {}) => readLoadSource(JSON.stringify({ schema: 'autopilot.load-source/1', source: 'dev', marketplace: 'directory', behind_upstream: 0, flags: [], stale_cache_dirs: [], ...over }))
  const rs = (n: number) => readResidue(JSON.stringify({ schema: 'autopilot.residue/1', project_key: KEY, reapable_worktrees: 9, by_class: {}, needs_human_count: n }), KEY)
  expect(text(slotHygiene(ls(), readResidue(JSON.stringify({ schema: 'autopilot.residue/1', project_key: KEY, reapable_worktrees: 5, by_class: {} }), KEY)))).toBe('dev') // reapable alone draws nothing: auto-reap clears it, needs_human_count is the number
  expect(text(slotHygiene(ls(), rs(2)))).toBe('dev ⚑2')
  expect(text(slotHygiene(ls({ behind_upstream: 3 }), rs(2)))).toBe('dev↓3 ⚑2') // the arrow follows the name without a space; it is the dim part
  expect(slotHygiene(ls({ behind_upstream: 3 }), null)?.segs.map(g => [g.text, g.dim === true])).toEqual([['dev', false], ['↓3', true]])
  expect(text(slotHygiene(ls(), rs(0)))).toBe('dev')
  expect(text(slotHygiene(null, rs(3)))).toBe('⚑3')
  expect(slotHygiene(null, rs(3))?.segs).toEqual([{ text: '⚑', color: 'warning', tag: 'wt' }, { text: '3', tag: 'wt' }]) // the mark is yellow, the number default text, no bold
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
    verdict: { mark: '●', word: '進行中', key: 'suggestion' }, marker: readMarker({ size: 'M', level: 'l5', stage: 'implement-' + 'x'.repeat(100), stage_set_at: '2026-10-04T09:57:30.000Z' }),
    live: 1, stalled: 0, review: null, qc: null, decisions: null, spend: null, loadSource: null, residue: null, nowMs: Date.parse('2026-10-04T10:00:30.000Z'),
  })
  const line = layoutBand(slots, 125) // 120-159: the position slot is `size·level·stage`
  expect(displayWidth(line.text)).toBeLessThanOrEqual(125)
  expect(displayWidth(line.text)).toBeGreaterThanOrEqual(123) // cut as little as needed
  expect(line.text.startsWith('● 進行中 │ M·l5·implement')).toBe(true)
  expect(line.text.endsWith('… │ ●1 │ ⓘ ')).toBe(true)
  expect(layoutBand(slots, 209).text).toBe('● 進行中 │ M·l5·implement-' + 'x'.repeat(100) + ' ◷3m │ ●1 │ ⓘ ')
  expect(layoutBand(slots, 100).text).toBe('● 進行中 │ ●1 │ ⓘ ') // 80-119: no position slot at all
})

test('P7 width table: below 160 the load-source chip goes but `⚑N` stays down to the narrowest line (a docked panel cannot hide the owner reminder)', () => {
  const ls = readLoadSource(JSON.stringify({ schema: 'autopilot.load-source/1', source: 'dev', marketplace: 'directory', behind_upstream: 3, flags: [], stale_cache_dirs: [] }))
  const rs = (n: number) => readResidue(JSON.stringify({ schema: 'autopilot.residue/1', project_key: KEY, reapable_worktrees: 0, by_class: {}, needs_human_count: n }), KEY)
  const slots = (n: number, withLs = true) => bandSlots({
    verdict: { mark: '●', word: '進行中', key: 'suggestion' }, marker: null, live: 1, stalled: 0, review: null, qc: null, decisions: null, spend: null,
    loadSource: withLs ? ls : null, residue: rs(n), nowMs: 0,
  })
  expect(layoutBand(slots(2), 209).text).toBe('● 進行中 │ ●1 │ dev↓3 ⚑2 │ ⓘ ')
  expect(layoutBand(slots(2), 159).text).toBe('● 進行中 │ ●1 │ ⚑2 │ ⓘ ') // the docked panel case (bodyColumns 114 at 209 columns)
  expect(layoutBand(slots(2), 114).text).toBe('● 進行中 │ ●1 │ ⚑2 │ ⓘ ')
  expect(layoutBand(slots(2, false), 114).text).toBe('● 進行中 │ ●1 │ ⚑2 │ ⓘ ')
  expect(layoutBand(slots(0), 114).text).toBe('● 進行中 │ ●1 │ ⓘ ') // no residue to act on: the chip alone leaves no empty slot or doubled separator
  expect(layoutBand(slots(2), 79).text).toBe('● 進行中 │ ●1 │ ⚑2 │ ⓘ ') // < 80 keeps verdict, ● and ⚑
  expect(layoutBand(slots(2), 20).text).toBe('● 進行中 │ ⚑2 │ ⓘ ') // the dispatch count goes before the owner reminder does
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
      const band = walkTexts((await bandLine($, surface, 209)).tree).find(n => textOf(n) === String(Math.round(brain)))
      // the tab draws the level on the meter: the bar and the percent take the level's theme key (the amount stays default text)
      const pct = walkTexts((await paneParts($, surface, 'spend')).tree).find(n => /^\s*\d+%$/.test(textOf(n)))
      return [band?.props?.color, pct?.props?.color, textOf(pct as Node).trim()] as const
    }
    const a = await spendNode(119.6) // rounds to 80 % but is below 0.8 of the cap
    expect(a[0]).toBeUndefined()
    expect(a[1]).toBeUndefined() // a healthy level is default text, not green
    expect(a[2]).toBe('79%') // floored, so it never reads 80% before the threshold
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
      expect(line.text.endsWith('ⓘ ')).toBe(true)
      expect(line.text.startsWith('⊘')).toBe(true)
      expect(displayWidth(line.text)).toBeLessThanOrEqual(cols)
      expect(line.info).toBeDefined()
    })
  }

  test('P7 fix B: below the table the unit bar goes first, then the stalled count, then the live count, then the verdict word; the owner reminder stays (' + surface + ')', async ($, on) => {
    world(on, richWorld())
    await start($, surface)
    const at = async (n: number) => (await bandLine($, surface, n)).text
    // every edge is one column wider than before P8: the ⓘ label is 'ⓘ ' (two cells, see BAND_INFO_LABEL), so each step lands one column later
    expect(await at(28)).toBe('⊘ 疑似卡住 │ ●2 ⊘1 │ ⚑2 │ ⓘ ') // exactly fits
    expect(await at(27)).toBe('⊘ 疑似卡住 │ ●2 │ ⚑2 │ ⓘ ') // the stalled count goes first
    expect(await at(24)).toBe('⊘ 疑似卡住 │ ⚑2 │ ⓘ ') // then the live count
    expect(await at(19)).toBe('⊘ 疑似卡… │ ⚑2 │ ⓘ ') // then the verdict word, never the ⚑ or the ⓘ
  })

  test('P7 fix C: the Now tab hero is verdict + project + elapsed, the stage is drawn once there, progress is its own row (' + surface + ')', async ($, on) => {
    world(on, richWorld())
    await start($, surface)
    const now = await paneParts($, surface, 'now')
    const p = await bandParts($, surface)
    expect(p.row).toBe('⊘ 疑似卡住 repo · 10m')
    expect(now.head[0]).not.toContain('implement') // the hero repeats no stage
    expect(now.texts.some(t => /^進度\s+—$/.test(t))).toBe(true)
    const verdict = walkTexts(now.tree).find(n => textOf(n) === '疑似卡住')
    expect(verdict?.props?.color).toBe('error')
    expect(verdict?.props?.bold).toBe(true)
  })
}

test('P7 fix D: a level with no valid size has no leading ·', () => {
  const NOW = Date.parse('2026-10-04T10:00:30.000Z')
  const text = (m: Record<string, unknown>) => slotPosition(readMarker({ stage: 'implement', stage_set_at: '2026-10-04T09:57:30.000Z', ...m }), NOW)?.segs.map(g => g.text).join('')
  expect(text({ level: 'l5' })).toBe('l5·implement ◷3m')
  expect(text({ size: 'HUGE', level: 'l5', urgent: true })).toBe('l5·implement ◷3m')
  expect(text({ size: 'S', level: 'l4' })).toBe('S·l4·implement ◷3m')
  expect(text({})).toBe('implement ◷3m')
})

// ==================== TUI v2: locale tables, locale choice, the band grid in both locales, CJK-aware columns ====================
// (the suite above pins zh-TW through AUTOPILOT_LOCALE; these cases are about the tables themselves)
const placeholdersOf = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]))].sort().join(',')

test('i18n tables: en and zh-TW carry the same ids and the same placeholders; key-column labels fit 12 cells', () => {
  expect(Object.keys(ZH_TW).sort()).toEqual(Object.keys(EN).sort())
  for (const id of Object.keys(EN)) {
    expect(placeholdersOf(ZH_TW[id]), id).toBe(placeholdersOf(EN[id]))
    expect(EN[id], id).not.toBe('')
    expect(ZH_TW[id], id).not.toBe('')
  }
  for (const id of Object.keys(EN).filter(k => k.startsWith('label.'))) {
    expect(displayWidth(EN[id]), 'en ' + id).toBeLessThanOrEqual(12)
    expect(displayWidth(ZH_TW[id]), 'zh-TW ' + id).toBeLessThanOrEqual(12)
  }
  // tab words (the owner's wording): 殘留 / 用量 / 審查 translated, `?` is the legend
  expect(PANE_TABS.map(t => ZH_TW['tab.' + t])).toEqual(['現況', '待決', '派工', '審查', '用量', '殘留', '?'])
  expect(PANE_TABS.map(t => EN['tab.' + t])).toEqual(['Now', 'Decide', 'Dispatch', 'Review', 'Spend', 'Hygiene', '?'])
})

test('i18n t(): variables, plurals, and the fallback chain locale -> en -> the id itself', () => {
  const en = makeT('en')
  const zh = makeT('zh-TW')
  expect(en('now.since', { e: '38m' })).toBe('38m since start')
  expect(zh('now.since', { e: '38m' })).toBe('已進行 38m')
  expect(en('now.residue', { n: 1 })).toBe('1 worktree needs you')
  expect(en('now.residue', { n: 3 })).toBe('3 worktrees need you')
  expect(zh('now.residue', { n: 1 })).toBe('1 個 worktree 要你處理')
  expect(zh('now.residue', { n: 3 })).toBe('3 個 worktree 要你處理')
  expect(en('ago', { age: '4s' })).toBe('4s ago')
  expect(zh('ago', { age: '4s' })).toBe('4s 前') // the direction word sits where the language puts it, inside one string
  expect(en('no.such.id')).toBe('no.such.id') // visible and greppable, never a throw
  expect(zh('no.such.id', { n: 2 })).toBe('no.such.id')
  expect(en('ago', { other: 1 })).toBe('{age} ago') // a placeholder with no value stays as written
})

test('i18n locale choice: ui.locale > AUTOPILOT_LOCALE > the Claude Code language setting > LC_ALL / LANG > en', () => {
  const pick = (over: Record<string, unknown>) => resolveLocale({ config: undefined, env: undefined, language: undefined, lang: undefined, ...over })
  expect(pick({})).toBe('en')
  expect(pick({ config: 'zh-TW', env: 'en', language: 'English', lang: 'en_US.UTF-8' })).toBe('zh-TW') // the explicit config wins over everything
  expect(pick({ config: 'en', env: 'zh-TW' })).toBe('en')
  expect(pick({ config: 'auto', env: 'zh-TW' })).toBe('zh-TW') // auto / unknown / absent falls through
  expect(pick({ config: 'fr', env: 'zh-TW' })).toBe('zh-TW')
  expect(pick({ env: 'auto', language: '正體中文台灣用語' })).toBe('zh-TW')
  expect(pick({ language: '正體中文台灣用語', lang: 'en_US.UTF-8' })).toBe('zh-TW') // the Claude Code language beats the shell
  expect(pick({ language: 'English', lang: 'zh_TW.UTF-8' })).toBe('en') // a setting that names no zh-TW variant is en, whatever LANG says
  expect(pick({ language: '   ', lang: 'zh_TW.UTF-8' })).toBe('zh-TW') // a blank setting is no setting
  expect(pick({ lang: 'zh_TW.UTF-8' })).toBe('zh-TW')
  expect(pick({ lang: 'zh_CN.UTF-8' })).toBe('en') // no other Chinese variant is claimed
  for (const text of ['正體中文台灣用語', '繁體中文', 'Traditional Chinese', 'zh-TW', 'zh_Hant', 'zh-Hant-TW']) expect(localeFromLanguage(text), text).toBe('zh-TW')
  for (const text of ['English', 'Español', '简体中文', 'ja']) expect(localeFromLanguage(text), text).toBe('en')
})

// facts of the three design states, as the band takes them (the same shapes the mod builds from the watcher's files)
const GRID_NOW = Date.parse('2026-10-04T10:00:30.000Z')
const gridWalk = (current: string) => ({ size: 'M', urgent: false, bug: false, high_risk: false, units: 5, nodes: ['spec', 'plan', 'implement', 'review', 'finish'], walk: ['spec', 'plan', 'implement', 'review', 'finish'], entry: 'spec', terminal: 'finish', unit_kind: 'task', current, stage_set_at: null, at: null })
const gridMarker = (stage: string) => ({ size: 'M', urgent: false, bug: false, high_risk: false, level: 'l5', stage, stage_set_at_ms: GRID_NOW - 3 * 60000, unit: { kind: 'task', index: 3, total: 5, label: 'wire the band' }, review_families: ['openai', 'xai'] })
const gridLs = { plugin_version: '3.0.0', source: 'dev', marketplace: 'directory', behind_upstream: 3, flags: [], stale_cache_dirs: [] }
const gridResidue = (n: number) => ({ reapable: 0, by_class: {}, at: null, needs_human_count: n, needs_human_bytes: null, needs_human: [], auto_ran_at: null, auto_removed_count: null, auto_archived_count: null })
function gridFacts(state: 'idle' | 'running' | 'blocked', t: ReturnType<typeof makeT>) {
  const zh = t('verdict.idle') === '待命'
  const common = {
    marker: gridMarker('implement'), live: 2, stalled: 0, review: { plan: null, code: { phase: 'impl', generation: 2, base: null, head: null, seats: [], converged: false, at: null } },
    qc: { state: 'owed', range: null, protected_files_count: 2, evidence: null },
    decisions: { rows: [], count: 3, irreversible: 0, writers: ['next-pick'], undocumented: 1, identity: null, root: null, ladder: { rung: 'U2', at: 'x' } },
    spend: { brain: 60, cap: 100 }, loadSource: gridLs, residue: gridResidue(0), stage: gridWalk('implement'), reason: null as string | null, nowMs: GRID_NOW,
  }
  if (state === 'idle') return { ...common, verdict: verdictOf('idle', t), marker: null, live: 0, review: null, qc: null, decisions: null, spend: { brain: 12, cap: 100 }, stage: null }
  if (state === 'running') return { ...common, verdict: verdictOf('running', t) }
  return { ...common, verdict: verdictOf('decide', t), marker: gridMarker('review'), live: 1, stage: gridWalk('review'), spend: { brain: 85, cap: 100 }, residue: gridResidue(3), reason: zh ? '選 adapter 方案 A 或 B' : 'pick adapter A or B' }
}
const gridLine = (locale: 'en' | 'zh-TW', state: 'idle' | 'running' | 'blocked', cols: number) => {
  const t = makeT(locale)
  return layoutBand(bandSlots(gridFacts(state, t) as never, t), cols)
}

// the owner-approved mockup lines (docs/plans/evidence/2026-10-10-tui-v2): idle / running / blocked at 209 / 160 / 140 / 120 / 80, both locales
const GRID: Record<string, string> = {
  'en idle 209': '◌ Idle │ $12 ▰▱▱▱▱▱▱▱▱▱ 12% │ dev↓3 │ ⓘ ',
  'en idle 120': '◌ Idle │ $12 ▰▱▱▱▱ │ ⓘ ',
  'en idle 80': '◌ Idle │ $▱▱▱ │ ⓘ ',
  'en running 209': '● Running │ M·l5 ✓─✓─◐─○─○ implement ◷3m │ ▰▰▰▱▱ 3/5 ·2fam │ ●2 ↺ R2 QC▲ │ ◆3 ?1 U2 │ $60 ▰▰▰▰▰▰▱▱▱▱ 60% │ dev↓3 │ ⓘ ',
  'en running 160': '● Running │ M·l5 ✓─✓─◐─○─○ implement ◷3m │ ▰▰▰▱▱ 3/5 ·2fam │ ●2 ↺ R2 QC▲ │ ◆3 ?1 U2 │ $60 ▰▰▰▰▰▰▱▱▱▱ 60% │ dev↓3 │ ⓘ ',
  'en running 140': '● Running │ M·l5·implement │ ▰▰▰▱▱ 3/5 │ ●2 ↺ R2 QC▲ │ $60 ▰▰▰▱▱ │ ⓘ ',
  'en running 120': '● Running │ M·l5·implement │ ▰▰▰▱▱ 3/5 │ ●2 ↺ R2 QC▲ │ $60 ▰▰▰▱▱ │ ⓘ ',
  'en running 80': '● Running │ ▰▰▰▱▱ │ ●2 QC▲ │ $▰▰▱ │ ⓘ ',
  'en blocked 209': '▲ Needs you pick adapter A or B │ M·l5 ✓─✓─✓─◐─○ review ◷3m │ ▰▰▰▱▱ 3/5 ·2fam │ ●1 ↺ R2 QC▲ │ ◆3 ?1 U2 │ $85 ▰▰▰▰▰▰▰▰▰▱ 85% │ dev↓3 ⚑3 │ ⓘ ',
  'en blocked 140': '▲ Needs you │ M·l5·review │ ▰▰▰▱▱ 3/5 │ ●1 ↺ R2 QC▲ │ $85 ▰▰▰▰▱ │ ⚑3 │ ⓘ ',
  'en blocked 80': '▲ Needs you │ ▰▰▰▱▱ │ ●1 QC▲ │ $▰▰▰ │ ⚑3 │ ⓘ ',
  'zh-TW idle 209': '◌ 待命 │ $12 ▰▱▱▱▱▱▱▱▱▱ 12% │ dev↓3 │ ⓘ ',
  'zh-TW idle 80': '◌ 待命 │ $▱▱▱ │ ⓘ ',
  'zh-TW running 209': '● 進行中 │ M·l5 ✓─✓─◐─○─○ implement ◷3m │ ▰▰▰▱▱ 3/5 ·2族 │ ●2 ↺ R2 QC▲ │ ◆3 ?1 U2 │ $60 ▰▰▰▰▰▰▱▱▱▱ 60% │ dev↓3 │ ⓘ ',
  'zh-TW running 120': '● 進行中 │ M·l5·implement │ ▰▰▰▱▱ 3/5 │ ●2 ↺ R2 QC▲ │ $60 ▰▰▰▱▱ │ ⓘ ',
  'zh-TW running 80': '● 進行中 │ ▰▰▰▱▱ │ ●2 QC▲ │ $▰▰▱ │ ⓘ ',
  'zh-TW blocked 209': '▲ 要你決定 選 adapter 方案 A 或 B │ M·l5 ✓─✓─✓─◐─○ review ◷3m │ ▰▰▰▱▱ 3/5 ·2族 │ ●1 ↺ R2 QC▲ │ ◆3 ?1 U2 │ $85 ▰▰▰▰▰▰▰▰▰▱ 85% │ dev↓3 ⚑3 │ ⓘ ',
  'zh-TW blocked 140': '▲ 要你決定 │ M·l5·review │ ▰▰▰▱▱ 3/5 │ ●1 ↺ R2 QC▲ │ $85 ▰▰▰▰▱ │ ⚑3 │ ⓘ ',
  'zh-TW blocked 80': '▲ 要你決定 │ ▰▰▰▱▱ │ ●1 QC▲ │ $▰▰▰ │ ⚑3 │ ⓘ ',
}

test('TUI v2 band grid: idle / running / blocked at 209 / 160 / 140 / 120 / 80 in en and zh-TW never exceed the column budget; the approved lines are drawn', () => {
  for (const locale of ['en', 'zh-TW'] as const) {
    for (const state of ['idle', 'running', 'blocked'] as const) {
      for (const cols of [209, 160, 159, 140, 139, 120, 119, 100, 80, 79, 60, 40, 30]) {
        const line = gridLine(locale, state, cols)
        const where = locale + ' ' + state + ' ' + cols
        expect(displayWidth(line.text), where).toBeLessThanOrEqual(cols) // the budget is in display cells, CJK = 2
        expect(line.width, where).toBe(displayWidth(line.text))
        expect(line.text.endsWith('ⓘ '), where).toBe(true)
        expect(line.text.startsWith(state === 'idle' ? '◌' : state === 'running' ? '●' : '▲'), where).toBe(true)
        if (state === 'blocked') expect(line.text, where).toContain('⚑3') // the owner reminder survives every width
        // tiers: the stage walk, the reason phrase, the 10-cell spend bar and the percent are for >= 160 only; the amount goes below 120
        expect(line.text.includes('◐'), where).toBe(cols >= 160 && state !== 'idle')
        expect(line.text.includes('%'), where).toBe(cols >= 160)
        expect(line.text.includes('pick adapter') || line.text.includes('選 adapter'), where).toBe(cols >= 160 && state === 'blocked')
        expect(/\$\d/.test(line.text), where).toBe(cols >= 120)
        expect(line.text.includes('▸'), where + ': `▸` means only "folded", so the band never draws it (plan 3.4 rule 2, owner ruling 2026-10-14)').toBe(false)
        expect(/·l5·(implement|review)/.test(line.text), where).toBe(cols >= 120 && cols < 160 && state !== 'idle') // `size·level·stage` without the walk
        expect(line.text.includes('◷'), where).toBe(cols >= 160 && state !== 'idle')
      }
    }
  }
  for (const [key, want] of Object.entries(GRID)) {
    const [locale, state, cols] = key.split(' ')
    expect(gridLine(locale as 'en' | 'zh-TW', state as 'idle' | 'running' | 'blocked', Number(cols)).text, key).toBe(want)
  }
})

// band lint: `▸` is the fold mark only. The control feeds the same check a band whose position slot still joins with the old arrow.
const bandFoldMarks = (texts: string[]): string[] => texts.filter(x => x.includes('▸'))
test('band lint: no band output at any width, state or locale draws `▸`; a planted `size·level ▸ stage` is caught (negative control)', () => {
  const texts: string[] = []
  for (const locale of ['en', 'zh-TW'] as const) for (const state of ['idle', 'running', 'blocked'] as const) for (let cols = 20; cols <= 240; cols += 7) texts.push(gridLine(locale, state, cols).text)
  expect(bandFoldMarks(texts)).toEqual([])
  expect(bandFoldMarks(texts.map(x => x.replace('l5·implement', 'l5 ▸ implement'))).length, 'control: the old arrow is found').toBeGreaterThan(0)
  expect(slotPosition(readMarker({ size: 'M', level: 'l5', stage: 'implement' }), 0)?.segs.map(g => g.text).join('')).not.toContain('▸')
})

test('TUI v2 band: the budget is in display cells for CJK too (a wide-character reason is clipped by cells, not characters)', () => {
  const t = makeT('zh-TW')
  const facts = { ...gridFacts('blocked', t), reason: '要不要把這個很長很長很長很長很長很長很長很長很長很長很長很長的 plan 拆開來分段做？' }
  const line = layoutBand(bandSlots(facts as never, t), 160)
  expect(displayWidth(line.text)).toBeLessThanOrEqual(160)
  expect(line.text).toContain('…') // clipped
  expect(line.text.startsWith('▲ 要你決定 要不要')).toBe(true)
})

// the same band through the mod, with the locale chosen the way a person would
for (const surface of SURFACES) {
  test('locale in the mod: ui.locale in ~/.autopilot/config.json beats AUTOPILOT_LOCALE; auto and absent fall through to the Claude Code language, then LANG (' + surface + ')', async ($, on) => {
    const files = base()
    const w = world(on, files, NOW_FRESH, SID_A, null, { AUTOPILOT_LOCALE: 'zh-TW' })
    await start($, surface)
    expect((await bandText($, surface)).startsWith('⊘ 疑似卡住')).toBe(true) // env alone
    files[AHOME + '/config.json'] = j({ ui: { locale: 'en' } })
    await w.clock.advance(5000)
    expect((await bandText($, surface)).startsWith('⊘ Stalled')).toBe(true) // the config beats the env, and a change takes effect on the next tick without a reload
    files[AHOME + '/config.json'] = j({ ui: { locale: 'auto' } })
    await w.clock.advance(5000)
    expect((await bandText($, surface)).startsWith('⊘ 疑似卡住')).toBe(true) // auto falls through to the env
  })

  test('locale in the mod: the Claude Code language setting (settings.json), then LANG, then en (' + surface + ')', async ($, on) => {
    const files = base()
    const w = world(on, files, NOW_FRESH, SID_A, null, {})
    await start($, surface)
    expect((await bandText($, surface)).startsWith('⊘ Stalled')).toBe(true) // nothing set: en
    files[HOME + '/.claude/settings.json'] = j({ language: '正體中文台灣用語' })
    await w.clock.advance(5000)
    expect((await bandText($, surface)).startsWith('⊘ 疑似卡住')).toBe(true)
    files[HOME + '/.claude/settings.json'] = j({ language: 'English' })
    await w.clock.advance(5000)
    expect((await bandText($, surface)).startsWith('⊘ Stalled')).toBe(true)
    delete files[HOME + '/.claude/settings.json']
    await w.clock.advance(5000)
    expect((await bandText($, surface)).startsWith('⊘ Stalled')).toBe(true)
  })

  test('locale in the mod: LANG zh_TW.UTF-8 alone picks zh-TW, a foreign LANG stays en (' + surface + ')', async ($, on) => {
    world(on, base(), NOW_FRESH, SID_A, null, { LANG: 'zh_TW.UTF-8' })
    await start($, surface)
    expect((await bandText($, surface)).startsWith('⊘ 疑似卡住')).toBe(true)
  })

  for (const locale of ['en', 'zh-TW'] as const) {
    test('TUI v2 panel: all seven tabs render in ' + locale + ', no string id leaks, no placeholder is left unfilled (' + surface + ')', async ($, on) => {
      world(on, richWorld(), NOW_FRESH, SID_A, locale)
      await start($, surface)
      const ids = new Set(Object.keys(EN).filter(k => k.includes('.')))
      for (const id of PANE_TABS) {
        const parts = await paneParts($, surface, id)
        expect(parts.texts.length, id).toBeGreaterThan(id === 'decide' ? 0 : 3) // nothing is pending in this world: the 待決 tab is its one empty line
        const all = [stripOf(parts.tree), ...parts.texts]
        for (const text of all) {
          for (const word of text.split(/\s+/)) expect(ids.has(word), id + ': ' + word).toBe(false) // a raw id on screen means a missing table entry
          expect(/\{\w+\}/.test(text), id + ': ' + text).toBe(false)
        }
        expect(stripOf(parts.tree).includes(locale === 'en' ? 'Hygiene' : '殘留'), id).toBe(true)
      }
    })
  }

  for (const locale of ['en', 'zh-TW'] as const) {
    test('TUI v2 panel: at pane widths 60, 76 and 90 no tab clips value text with … and no line is wider than the pane, in ' + locale + ' (' + surface + ')', async ($, on) => {
      world(on, richWorld(), NOW_FRESH, SID_A, locale)
      await start($, surface)
      for (const width of [60, 76, 90]) {
        for (const id of PANE_TABS) {
          const parts = await paneParts($, surface, id, width)
          // the strip is Buttons in a wrapping Box: lay its entries out row by row the way a wrapping Box does (an entry that does not fit starts the next row) and hold every ROW to the width
          const entries = (((((parts.tree.children || []) as Node[])[0].children || []) as Node[])[0].children || []) as Node[]
          const rowsW: number[] = [0]
          for (const e of entries) { const w = displayWidth(fullText(e)); if (rowsW[rowsW.length - 1] > 0 && rowsW[rowsW.length - 1] + w > width) rowsW.push(0); rowsW[rowsW.length - 1] += w }
          expect(entries.length, width + ' ' + id + ': the strip entries (› chip + 7 tabs)').toBe(8)
          for (const w of rowsW) expect(w, width + ' ' + id + ' strip row').toBeLessThanOrEqual(width)
          expect(stripOf(parts.tree).includes('…'), width + ' ' + id + ' strip').toBe(false)
          for (const text of parts.texts) {
            expect(displayWidth(text), width + ' ' + id + ': ' + text).toBeLessThanOrEqual(width)
            if (id !== 'dispatch' || !/^[⊘●✓◌○✗?▲△∅] /.test(text)) expect(text.includes('…'), width + ' ' + id + ': ' + text).toBe(false) // only a 派工 table ROW may cut a cell (§4 table, §3.5); the strip, headers, the pointer row and the footer must not
          }
        }
      }
    })
  }

  for (const locale of ['en', 'zh-TW'] as const) {
    test('TUI v2 panel: columns are padded by display cells: key labels are 12 cells wide and the run table lines up in ' + locale + ' (' + surface + ')', async ($, on) => {
      world(on, richWorld(), NOW_FRESH, SID_A, locale)
      await start($, surface)
      const table = await paneParts($, surface, 'dispatch')
      // two tables now (執行中, 已完成): in each, the id column starts where its header's does, whatever the script of the state word
      const headers = table.texts.filter(t => t.startsWith('  ' + (locale === 'en' ? 'state' : '狀態')))
      expect(headers.length).toBe(2)
      const rows = table.texts.filter(t => / r[123] /.test(t))
      expect(rows.length).toBe(3)
      const at = (line: string, needle: string) => displayWidth(line.slice(0, line.indexOf(needle)))
      const idHead = locale === 'en' ? 'run' : '編號'
      const idOf = (r: string) => (/ (r[123]) /.exec(r) as RegExpExecArray)[1]
      for (const r of rows) expect(at(r, idOf(r)), r).toBe(at(headers[idOf(r) === 'r3' ? 1 : 0], idHead))
      // key/value rows: the value starts at display cell 12 whatever the label's script
      const now = await paneParts($, surface, 'now')
      const kvRow = now.texts.find(t => t.startsWith(locale === 'en' ? 'stage' : '階段')) as string
      expect(displayWidth(kvRow.slice(0, kvRow.indexOf('implement')))).toBe(12)
      const unitRow = now.texts.find(t => t.startsWith(locale === 'en' ? 'unit' : '單元')) as string
      expect(displayWidth(unitRow.slice(0, unitRow.indexOf('▰')))).toBe(12)
    })
  }
}

// ---- review round 1 fixes ----
test('layoutBand: a long reason is clipped to the room left: a prefix of it is drawn, the line fits the budget exactly at the edge and the ⓘ keeps its cell (mutation room+1 turns this red)', () => {
  const REASONS = { en: 'x'.repeat(200), 'zh-TW': '要不要把這個很長很長很長很長很長很長很長很長很長很長很長很長的 plan 拆開來分段做？'.repeat(3) }
  for (const locale of ['en', 'zh-TW'] as const) {
    const t = makeT(locale)
    const reason = REASONS[locale]
    const at = (cols: number, r: string | null = reason) => layoutBand(bandSlots({ ...gridFacts('blocked', t), reason: r } as never, t), cols)
    for (const cols of [160, 209]) {
      const line = at(cols)
      expect(displayWidth(line.text), locale + ' ' + cols).toBeLessThanOrEqual(cols)
      expect(line.text.endsWith(' │ ⓘ '), locale + ' ' + cols).toBe(true)
      const v = verdictOf('decide', t)
      const body = line.text.slice(v.mark.length + 1 + v.word.length + 1, line.text.indexOf(' │ ')) // the text after the verdict word
      expect(body.length, locale + ' ' + cols + ': a reason is drawn').toBeGreaterThan(5)
      expect(body.endsWith('…'), locale + ' ' + cols).toBe(true)
      expect(reason.startsWith(body.slice(0, -1)), locale + ' ' + cols + ': it is a prefix of the reason').toBe(true)
    }
    // the edge: a long stage name makes the rest of the line wide enough that the room (not the 160-column tier) decides when the reason first fits
    const wideFacts = (r: string | null) => ({ ...gridFacts('blocked', t), marker: gridMarker('review-' + 'x'.repeat(70)), reason: r })
    const atW = (cols: number, r: string | null = reason) => layoutBand(bandSlots(wideFacts(r) as never, t), cols)
    const W = atW(400, null).width // the full line without a reason (stage uncut)
    expect(W, locale + ' bare line is wider than the 160 tier').toBeGreaterThan(165)
    const drawsReason = (cols: number) => atW(cols).text !== atW(cols, null).text
    let edge = -1
    for (let cols = 160; cols < W + 40; cols += 1) if (drawsReason(cols)) { edge = cols; break }
    expect(edge, locale + ' the scan starts below the edge').toBeGreaterThan(160)
    expect(drawsReason(edge - 1), locale + ' one column narrower: no reason').toBe(false)
    expect(drawsReason(edge), locale + ' at the edge: the reason is drawn').toBe(true)
    // the reason needs 8 cells (REASON_MIN) after its separating space: edge = bare width + 1 (the space) + 8 -> W + 9 (the ⓘ label is in W already)
    expect(edge, locale + ' edge = W + 9').toBe(W + 9)
    for (let cols = edge - 1; cols <= edge + 12; cols += 1) {
      const line = atW(cols)
      expect(displayWidth(line.text), locale + ' edge ' + cols).toBeLessThanOrEqual(cols)
      expect(line.text.endsWith('ⓘ '), locale + ' edge ' + cols).toBe(true)
    }
    expect(atW(edge).width, locale + ' the reason takes the spare cells at the edge (a 2-cell character may leave one)').toBeGreaterThanOrEqual(locale === 'en' ? edge : edge - 1)
    expect(atW(edge).width, locale + ' never over the budget').toBeLessThanOrEqual(edge)
  }
})

test('Review tab: a ladder rung outside U0..U5 is clamped, never a negative repeat', () => {
  const snap = (rung: string) => ({
    header: 'h', review: null, pending: [], sections: NO_SECTIONS,
    detail: { qc: null, now_ms: 1000, decisions: { rows: [], count: 1, irreversible: 0, writers: [], undocumented: 0, identity: null, root: null, ladder: { rung, at: new Date(0).toISOString() } } },
  }) as never
  for (const rung of ['U7', 'U9', 'U5', 'U0', 'Ux']) {
    const lines = reviewTabLines(snap(rung))
    const row = lines.find(l => l.text.includes('U0 ─ U5'))!
    const filled = (row.text.match(/▰/g) || []).length
    const empty = (row.text.match(/▱/g) || []).length
    expect(filled + empty, rung).toBe(6)
    expect(filled, rung).toBe(rung === 'U7' || rung === 'U9' || rung === 'U5' ? 6 : 1) // clamped to 5 -> six cells filled; U0 and a bad number -> one
  }
})

// ---- wrapping (pure): long values wrap under the value column, nothing is clipped, nothing is wider than the pane ----
test('wrapLines: a kv row wraps with a hanging indent of 12 cells, a long path breaks after a /, a token longer than the line is hard-broken, short lines are untouched', () => {
  const long = '/home/cookys/.claude/plugins/cache/autopilot/autopilot/2.36.36/some/deep/dir'
  const lines = wrapLines([{ text: 'cache       ' + long, hang: 12, segs: [{ text: 'cache       ', dim: true }, { text: long }] }], 40)
  expect(lines.length).toBeGreaterThan(1)
  for (const l of lines) expect(displayWidth(l.text)).toBeLessThanOrEqual(40)
  for (const l of lines.slice(1)) expect(l.text.startsWith(' '.repeat(12))).toBe(true)
  expect(lines.map(l => l.text.trim()).join('').replace(/^cache/, '').trim()).toBe(long) // nothing lost, nothing added
  const hard = wrapLines([{ text: 'x'.repeat(100) }], 30)
  expect(hard.map(l => l.text).join('')).toBe('x'.repeat(100))
  for (const l of hard) expect(displayWidth(l.text)).toBeLessThanOrEqual(30)
  const cjk = wrapLines([{ text: '要不要把這個很長很長很長很長很長很長很長很長的計畫拆開來分段做', hang: 2 }], 20)
  for (const l of cjk) expect(displayWidth(l.text)).toBeLessThanOrEqual(20)
  const fits = { text: 'short', dim: true }
  expect(wrapLines([fits], 40)[0]).toBe(fits)
})

// I15 (plan section 5.6): the `?` tab is generated from the tables the pane draws from. Every state of STATES (glyph + word) and every structure glyph a tab draws
// is on it, in both locales, at every width, and each entry is one example plus its explanation.
const LEGEND_STRUCTURE = ['open', 'folded', 'detail', 'command', 'goto', 'bullet', 'empty', 'tabMark', 'behind'] as const // the glyphs the tabs draw (the band's own symbols are not tab symbols)
const legendMissing = (lines: { text: string }[], t: ReturnType<typeof makeT>): string[] => {
  const all = lines.map(l => l.text).join('\n')
  const out: string[] = []
  for (const id of ui.STATE_IDS) {
    if (!lines.some(l => l.fact === 'legend.states' && l.text.includes(ui.STATES[id].glyph) && l.text.includes(t('ui.state.' + id)))) out.push('state row ' + id) // the glyph and its word on one row: elsewhere on the tab does not count
  }
  for (const k of LEGEND_STRUCTURE) if (!all.includes(ui.GLYPHS.structure[k])) out.push('structure glyph ' + k)
  if (![...ui.GLYPHS.chart.meterOn].every(c => all.includes(c))) out.push('meter glyph')
  return out
}
test('I15: the legend lists every state and every structure glyph a tab draws, wrapped to the width, in en and zh-TW at widths 40 to 100', () => {
  for (const locale of ['en', 'zh-TW'] as const) {
    const t = makeT(locale)
    for (const cols of [40, 60, 76, 90, 100]) {
      const lines = legendLines({ t, cols })
      for (const l of lines) {
        expect(displayWidth(l.text), locale + ' ' + cols + ': ' + l.text).toBeLessThanOrEqual(cols)
        expect(l.text.includes('…'), locale + ' ' + cols + ': ' + l.text).toBe(false)
        expect(ui.isMade(l), locale + ' ' + cols + ': ' + l.text).toBe(true)
      }
      expect(legendMissing(lines, t), locale + ' ' + cols).toEqual([])
      // each example row is a kv: the example at the key column, the explanation after it
      expect(lines.filter(l => l.kind === 'kv').length, locale + ' ' + cols).toBeGreaterThanOrEqual(ui.STATE_IDS.length + LEGEND_STRUCTURE.length - 1)
      // negative control: a legend that lost one state row is reported
      const withoutDone = lines.filter(l => !l.text.includes(ui.STATES.done.glyph) && !l.text.includes(t('ui.state.done')))
      expect(legendMissing(withoutDone, t).length, 'control ' + locale + ' ' + cols).toBeGreaterThan(0)
    }
  }
})
test('I15: the legend sections fold on their header and the generated rows follow SECTION_ORDER.legend', () => {
  const t = makeT('en')
  const open = legendLines({ t, cols: 76 })
  const folded = legendLines({ t, cols: 76, folded: new Set(['sec:legend.states']) })
  expect(folded.length).toBeLessThan(open.length)
  expect(folded.some(l => l.kind === 'header' && l.text.startsWith(ui.GLYPHS.structure.folded + ' ' + t('legend.sec_states')))).toBe(true)
  expect(open.filter(l => l.kind === 'header').map(l => l.toggle)).toEqual(ui.SECTION_ORDER.legend.map(k => 'sec:legend.' + k))
})

test('wrapLines: no continuation line is only a closing punctuation mark or a single glyph, widths 30 to 130 in en and zh-TW', () => {
  const lone = (l: { text: string }) => [...l.text.trim()].length === 1
  for (const locale of ['en', 'zh-TW'] as const) {
    const t = makeT(locale)
    for (let cols = 30; cols <= 130; cols++) {
      for (const l of legendLines({ t, cols })) {
        expect(displayWidth(l.text), locale + ' ' + cols + ': ' + l.text).toBeLessThanOrEqual(cols)
        if (/^ /.test(l.text) && l.text.trim() !== '') expect(lone(l), locale + ' ' + cols + ' lone glyph: ' + l.text).toBe(false)
      }
    }
  }
  const title = '狀態列上的符號（由左到右；沒有資料的項目不顯示）'
  for (let cols = 12; cols <= 60; cols++) {
    const lines = wrapLines([{ text: title }], cols)
    for (const l of lines.slice(1)) expect([...l.text.trim()].length > 1 && !'）」』、。，；：！？'.includes(l.text.trim()[0]), cols + ': ' + l.text).toBe(true)
  }
  for (const [txt, cols] of [['一二三四，五', 10], ['一二三四五六，七', 12], ['甲乙丙丁戊（己庚）辛', 14], ['一二三四五。六', 10]] as [string, number][]) {
    const ls = wrapLines([{ text: txt }], cols)
    expect(ls.map(l => l.text.trim()).join(''), txt).toBe(txt)
    for (const l of ls.slice(1)) expect(!'，。）」、；：！？'.includes(l.text.trim()[0]) && [...l.text.trim()].length > 1, txt + ' -> ' + JSON.stringify(ls.map(x => x.text))).toBe(true)
  }
  const dim = wrapLines([{ text: 'alpha beta gamma delta epsilon zeta eta theta ⚑' }], 40)
  expect(dim.map(l => l.text).join(' ').replace(/\s+/g, ' ')).toBe('alpha beta gamma delta epsilon zeta eta theta ⚑')
  expect(dim[dim.length - 1].text.trim().length).toBeGreaterThan(1)
})

test('band phase: a task-sourced phase renders in the session locale, not the producer zh prefix; other sources are shown as given', () => {
  const model = (phase: unknown) => ({ phase, acceptance: null, gates: [], needs_decision: false, conclusion: null, decisions: [], progress: null, sources_manifest: null }) as unknown as Parameters<typeof bandView>[1]
  const ph = { code: '1', label: '做：alpha', source: 'task' }
  expect(bandView({}, model(ph), 'p', 0, undefined, makeT('en')).phase).toBe('doing: alpha')
  expect(bandView({}, model(ph), 'p', 0, undefined, makeT('zh-TW')).phase).toBe('做：alpha')
  expect(bandView({}, model({ code: 'c', label: '審查', source: 'campaign' }), 'p', 0, undefined, makeT('en')).phase).toBe('審查')
})

test('hygiene tab: a long cache dir and a long worktree command wrap in full at 60 columns; the name loses only its tail', () => {
  const dir = '/home/cookys/.claude/plugins/cache/autopilot/autopilot/2.36.36'
  const target = '/home/cookys/projects/autopilot/.claude/worktrees/some-very-long-worktree-name-here-and-then-some-more-words'
  const snap = {
    header: 'h', sections: NO_SECTIONS,
    detail: {
      now_ms: 1000,
      load_source: { source: 'dev', plugin_version: '3.0.0', marketplace: 'directory', flags: ['stale_cache_dirs'], behind_upstream: null, stale_cache_dirs: [{ dir, in_use_pids: [18089, 18090], alive: [] }] },
      residue: { needs_human_count: 1, needs_human_bytes: 1000, needs_human: [{ kind: 'worktree', target, class: 'dirty', age_days: 4, bytes: 1000, reason: '12 uncommitted path(s)', command: 'git worktree remove ' + target }], auto_ran_at: null, auto_removed_count: null, auto_archived_count: null },
    },
  } as never
  for (const locale of ['en', 'zh-TW'] as const) {
    const lines = hygieneTabLines(snap, { t: makeT(locale), cols: 60 })
    const flat = lines.map(l => l.text.trim()).join('')
    // the name row is one line and may lose its tail; every other row (the reason, the command, the cache sentence) is whole
    for (const l of lines) { expect(displayWidth(l.text), l.text).toBeLessThanOrEqual(60); if (l.kind !== 'item' && l.kind !== 'bullet') expect(l.text.includes('…'), l.text).toBe(false) }
    const name = lines.find(l => l.kind === 'item' && l.text.startsWith('▲ some-very-long'))
    expect(name !== undefined && name.text.includes('…') && !name.text.includes('words'), 'the name keeps its head and loses its tail').toBe(true)
    expect(flat.replace(/\s/g, '').includes(dir.replace(/\s/g, ''))).toBe(true)
    expect(flat.replace(/\s/g, '').includes(target)).toBe(true)
    expect(lines.some(l => l.kind === 'detail' && l.text.includes('12') ), 'the reason carries the number from the producer').toBe(true)
  }
})

// ---- P2 派工 (design plan §5.2, §7): the runs are two tables (執行中 / 已完成), one line per run, the latest 5 finished + `more`, one pointer row to 審查 ----
// Local fixtures (no global busyWorld): rows are LivePaneRow-shaped, `detail.now_ms` is the clock F5 reads.
const D_NOW = Date.parse('2026-10-13T08:00:00.000Z')
const D_DAY = 86_400_000
const D_AGE_OUT = 6 * 3_600_000 // BL-0149: FRESH_MS.dispatch
const dispatchSnap = (rows: object[] | null, over: object = {}) => ({
  header: 'h', rows, gates: null, link: null, published_at: '2026-10-13T07:59:55.000Z', session_as_of: null, host_as_of: null,
  sections: NO_SECTIONS,
  detail: { counts: null, stalled: 0, now_ms: D_NOW },
  ...over,
}) as never
const RUN_FIN = (id: string, endedAgoMs: number, over: object = {}) => ({
  run_id: id, role: 'reviewer', runner: 'claude-native', model: 'claude-fable-5-1', stall: false, rc: 0, final_status: 'reviewed', elapsed_s: 60, probe_age_s: null, phase: 'exited',
  started_at: new Date(D_NOW - endedAgoMs - 60_000).toISOString(), ended_at: new Date(D_NOW - endedAgoMs).toISOString(), ended: true, fresh: false, ...over,
})
const RUN_LIVE = (id: string, over: object = {}) => ({
  run_id: id, role: 'implementer', runner: 'codex', model: 'gpt-5', stall: false, rc: null, final_status: null, elapsed_s: 90, probe_age_s: 5, phase: 'running',
  started_at: new Date(D_NOW - 90_000).toISOString(), ended_at: null, ended: false, fresh: true, ...over,
})
// the owner's busy screenshot: 32 finished reviewer runs with ~30-cell ids, a live run, a stalled one, one nobody confirmed, one that ended with no verdict, one older than a day
const busyDispatchRows = () => [
  ...Array.from({ length: 31 }, (_, i) => RUN_FIN('review-1791803964-24184' + String(10 + i).padStart(2, '0') + '-c58e', (5 * 3600 + i * 120) * 1000)),
  RUN_FIN('review-old-run-from-three-days-ago-x', 3 * D_DAY),
  RUN_LIVE('run-live-1'),
  RUN_LIVE('run-stall-1', { stall: true, probe_age_s: 200 }),
  RUN_LIVE('run-unconfirmed-1', { fresh: false, probe_age_s: 400 }),
  RUN_FIN('run-endednoverdict', 600_000, { rc: null, final_status: null }),
]
const bodyRows = (lines: { kind?: string; group?: string }[]) => lines.filter(l => l.kind === 'table' && l.group !== undefined)
const tabLocales = ['en', 'zh-TW'] as const

test('dispatch tab: every run is ONE table line at every width, 執行中 / 已完成 are separate tables, the latest 5 finished then one `more`, no kv line among the runs (I12, M25, M52a)', () => {
  for (const locale of tabLocales) {
    const t = makeT(locale)
    for (const cols of [40, 60, 76, 100, 120, 160]) {
      const lines = dispatchLines(dispatchSnap(busyDispatchRows(), { gates: [{ phase: 'plan', generation: 1, verdict: 'PASS', status: 'LIVE GATE' }] }), { t, cols })
      for (const l of lines) expect(displayWidth(l.text), locale + ' ' + cols + ' ' + l.text).toBeLessThanOrEqual(cols)
      for (const l of lines.filter(x => x.kind !== 'table')) expect(l.text.includes('…'), 'only a table row may cut a cell: ' + l.text).toBe(false)
      const at = (id: string) => lines.findIndex(l => l.toggle === id)
      const [r0, f0, o0] = [at('dispatch.running'), at('dispatch.finished'), at('dispatch.other')]
      expect(r0 >= 0 && f0 > r0 && o0 > f0, locale + ' ' + cols + ' section order').toBe(true)
      const running = lines.slice(r0, f0)
      const finished = lines.slice(f0, o0)
      expect(running.filter(l => l.kind === 'kv').length, 'no kv among the runs').toBe(0)
      expect(finished.filter(l => l.kind === 'kv').length).toBe(0)
      expect(bodyRows(running).length, locale + ' ' + cols + ' running rows').toBe(3) // live, stalled, unconfirmed
      expect(bodyRows(finished).length, locale + ' ' + cols + ' finished rows (the 5-row cap)').toBe(5)
      expect(finished.filter(l => l.kind === 'more').length).toBe(1)
      expect(finished.filter(l => l.kind === 'more')[0].toggle).toBe('more:dispatch.finished')
      if (cols === 76) expect(lines.length, 'at most 22 lines at 76 columns').toBeLessThanOrEqual(22)
    }
  }
})

test('dispatch tab: eight live runs show the five loudest and one `more` (the running table is capped too, M52a)', () => {
  const t = makeT('zh-TW')
  const rows = [...Array.from({ length: 7 }, (_, i) => RUN_LIVE('live-' + i)), RUN_LIVE('stall-0', { stall: true })]
  const lines = dispatchLines(dispatchSnap(rows), { t, cols: 100 })
  const running = lines.slice(lines.findIndex(l => l.toggle === 'dispatch.running'), lines.findIndex(l => l.toggle === 'dispatch.finished'))
  expect(bodyRows(running).length).toBe(5)
  expect(bodyRows(running)[0].text.startsWith('⊘')).toBe(true) // the stalled one outranks the live ones
  expect(running.filter(l => l.kind === 'more').length).toBe(1)
  expect(running.find(l => l.kind === 'more')?.text.includes('還有 3 筆執行中')).toBe(true)
})

test('dispatch tab: opening `more` lists every finished run still inside the day (the one older than a day stays out), the toggle then reads 收起', () => {
  const t = makeT('zh-TW')
  const snap = dispatchSnap(busyDispatchRows())
  const folded = dispatchLines(snap, { t, cols: 120 })
  const opened = dispatchLines(snap, { t, cols: 120, expanded: new Set(['more:dispatch.finished']) })
  expect(bodyRows(folded).filter(l => l.group?.startsWith('review-') || l.group === 'run-endednoverdict').length).toBe(5)
  const finished = bodyRows(opened).filter(l => l.group?.startsWith('review-17') || l.group === 'run-endednoverdict')
  expect(finished.length).toBe(32) // 31 + the verdictless one; review-old-run is aged out (F5)
  expect(opened.some(l => l.group === 'review-old-run-from-three-days-ago-x')).toBe(false)
  expect(opened.find(l => l.kind === 'more')?.text.includes('收起')).toBe(true)
  expect(folded.find(l => l.kind === 'more')?.text.includes('還有 27 筆已完成')).toBe(true)
})

test('dispatch tab: ownership (I17, M31, M38): no spend or usage fact, no seat verdict word, the review pointer is the one goto row, the footer carries no spend or as-of stamps', () => {
  for (const locale of tabLocales) {
    const t = makeT(locale)
    const gates = [{ phase: 'plan', generation: 1, verdict: 'PASS', status: 'LIVE GATE' }]
    const snap = dispatchSnap(busyDispatchRows(), { gates, session_as_of: '01:40', host_as_of: '01:41' })
    const lines = dispatchLines(snap, { t, cols: 76 })
    for (const l of lines) {
      if (l.fact === 'pane.chrome') continue // spacers, headings and toggles carry no data
      expect(l.fact.startsWith('spend.') || l.fact.startsWith('usage.'), l.text).toBe(false)
      const owner = ui.FACT_OWNER[l.fact]
      if (owner !== 'dispatch') { expect(l.goto, l.text + ' is a projection and must carry goto').toBe('review'); expect(l.kind).toBe('kv') }
    }
    const projections = lines.filter(l => l.fact === 'review.round') // the same pointer row 現況 draws, never the job page's receipt count (review.gates)
    expect(lines.some(l => l.fact === 'review.gates')).toBe(false)
    expect(projections.length, 'the only line for that fact on the tab').toBe(1)
    expect(projections[0].goto).toBe('review')
    expect(projections[0].text.includes(t('tab.review'))).toBe(true)
    const flat = lines.map(l => l.text).join('\n')
    expect(/SHIP|CONDITIONAL|STOP|PASS|FIX-THEN/.test(flat), 'no seat or gate verdict word').toBe(false)
    expect(/\$\d|01:40|01:41/.test(flat), 'no spend or session / host as-of stamp').toBe(false)
    expect(lines.filter(l => l.kind === 'detail').length).toBe(1)
  }
})

// the g4 docked finding: at a narrow pane the heading row used to wrap while the rows did not, so the columns no longer lined up
const cellStarts = (text: string): number[] => {
  const out: number[] = []
  let pos = 0
  let prev = '  ' // a cell starts after two spaces (a cell's own text has single spaces, `3m ago`)
  for (const ch of [...text]) { if (ch !== ' ' && prev === '  ') out.push(pos); pos += displayWidth(ch); prev = (prev + ch).slice(-2) }
  return out
}
test('dispatch tab: the heading row of a table is one line and its columns start where the cells beneath them start, at every width 30 to 140 (en and zh-TW)', () => {
  for (const locale of tabLocales) {
    const t = makeT(locale)
    for (let cols = 30; cols <= 140; cols += 1) {
      const lines = dispatchLines(dispatchSnap(busyDispatchRows()), { t, cols })
      const tables = lines.filter(l => l.kind === 'table')
      expect(tables.length).toBeGreaterThan(1)
      for (const l of tables) expect(displayWidth(l.text), locale + ' ' + cols + ' ' + l.text).toBeLessThanOrEqual(cols - 1)
      const head = tables[0]
      const heads = cellStarts(head.text)
      // a data row's first cell starts at the state column (col 0 holds its glyph); every later cell of the same table starts under a heading
      const rows = tables.filter(l => l !== head && cellStarts(l.text).length >= 1 && lines.indexOf(l) < lines.findIndex((x, i) => i > lines.indexOf(head) && x.kind === 'header'))
      for (const r of rows) for (const c of cellStarts(r.text).slice(2)) expect(heads, locale + ' ' + cols + ' row `' + r.text + '` vs head `' + head.text + '`').toContain(c)
    }
  }
})

test('dispatch tab: grouping and order (I22, M54): one row per group, severity then newest first, sections in SECTION_ORDER.dispatch', () => {
  const t = makeT('zh-TW')
  const lines = dispatchLines(dispatchSnap(busyDispatchRows()), { t, cols: 120, expanded: new Set(['more:dispatch.finished']) })
  expect(lines.filter(l => l.kind === 'header').map(l => (l.toggle as string).replace('dispatch.', ''))).toEqual([...ui.SECTION_ORDER.dispatch])
  for (const id of ['dispatch.running', 'dispatch.finished']) {
    const from = lines.findIndex(l => l.toggle === id)
    const rows = bodyRows(lines.slice(from + 1, lines.findIndex((l, i) => i > from && l.kind === 'header')))
    expect(new Set(rows.map(r => r.group)).size, id + ' no two rows share a group').toBe(rows.length)
    const sev = rows.map(r => ui.SEVERITY.indexOf((r.text.startsWith('⊘') ? 'stalled' : r.text.startsWith('●') ? 'running' : r.text.startsWith('◌') ? 'stopped' : 'done') as never))
    for (let i = 1; i < rows.length; i++) {
      expect(sev[i] >= sev[i - 1], id + ' severity order at ' + i).toBe(true)
      if (sev[i] === sev[i - 1]) expect(rows[i].ts as number, id + ' newest first at ' + i).toBeLessThanOrEqual(rows[i - 1].ts as number)
    }
  }
  const same = [RUN_FIN('dup', 1000), RUN_FIN('dup', 2000)]
  expect(bodyRows(dispatchLines(dispatchSnap(same), { t, cols: 120 })).length, 'rows of one group fold into one').toBe(1)
})

test('tableList refuses a row without group or ts (M53)', () => {
  const t = makeT('en')
  const u = { t, cols: 80 }
  const cols = [{ head: 'run', min: 4, priority: 1, cut: 'left' as const }]
  const ok = { state: ui.stateOf('run', { rc: 0, final_status: null, stall: false, fresh: false }), cells: ['a'], group: 'a', ts: 1 }
  expect(() => ui.tableList(u, 'x', 'n', cols, [ok], { fact: 'dispatch.runs' })).not.toThrow()
  expect(() => ui.tableList(u, 'x', 'n', cols, [{ state: ok.state, cells: ['a'], ts: 1 } as never], { fact: 'dispatch.runs' })).toThrow(/group or ts/)
  expect(() => ui.tableList(u, 'x', 'n', cols, [{ state: ok.state, cells: ['a'], group: 'a' } as never], { fact: 'dispatch.runs' })).toThrow(/group or ts/)
})

test('dispatch tab: F5 a finished run older than 6 h is counted in the chip, not listed (I11 at T-1, T, T+1 ms; M24e, M24j)', () => {
  const t = makeT('zh-TW')
  const T = ui.FRESH_MS.dispatch
  expect(T).toBe(D_AGE_OUT)
  for (const [delta, listed] of [[-1, true], [0, true], [1, false]] as const) {
    const row = RUN_FIN('edge', T + delta)
    const lines = dispatchLines(dispatchSnap([row]), { t, cols: 120 })
    expect(bodyRows(lines).length, 'T' + (delta < 0 ? delta : '+' + delta)).toBe(listed ? 1 : 0)
    const head = lines.find(l => l.toggle === 'dispatch.finished') as { text: string }
    expect(head.text.includes('✓ 1'), 'the chip still counts it').toBe(true)
    if (!listed) expect(lines.some(l => l.text.includes(t('dispatch.no_finished')))).toBe(true)
    expect(runAgedOut(paneRows({ runs: [{ ...row, phase: 'exited' }] } as never)?.[0] as never, D_NOW)).toBe(!listed)
  }
})

test('dispatch tab: BL-0149 the role column shows the manifest role (plan-review stays plan-review, not author)', () => {
  const t = makeT('en')
  const lines = dispatchLines(dispatchSnap([RUN_FIN('seat-1', 60_000, { role: 'plan-review' }), RUN_FIN('auth-1', 120_000, { role: 'author' })]), { t, cols: 120 })
  const rowOf = (id: string) => bodyRows(lines).find(l => l.text.includes(id))?.text ?? ''
  expect(rowOf('seat-1')).toContain('plan-review')
  expect(rowOf('seat-1')).not.toContain('author')
  expect(rowOf('auth-1')).toContain('author')
})

test('dispatch tab: who computes `fresh` (§2.5 gap): a row that ended with no rc and no final_status is stopped, never running; a stale probe is not running either', () => {
  const t = makeT('zh-TW')
  const env = (runs: object[]) => ({ counts: { fresh_bound_s: 30 }, runs }) as never
  const base = { run_id: 'x', role: 'hands', runner: 'codex', model: 'gpt', started_at: '2026-10-13T07:00:00.000Z', elapsed_s: 100, stall: false, rc: null, final_status: null }
  const cases: [string, object, string, boolean][] = [
    ['alive and probed inside the bound', { alive: true, probe_age_s: 5, phase: 'running' }, 'running', true],
    ['probe older than the bound', { alive: true, probe_age_s: 31, phase: 'running' }, 'stopped', false],
    ['never probed, launched longer ago than the bound', { alive: true, probe_age_s: null, phase: 'running', elapsed_s: 31 }, 'stopped', false],
    ['never probed, launched inside the bound: not started yet, not stopped', { alive: true, probe_age_s: null, phase: 'running', elapsed_s: 20 }, 'pending', false],
    ['never probed at exactly the bound', { alive: true, probe_age_s: null, phase: 'running', elapsed_s: 30 }, 'pending', false],
    ['probed once but the probe is stale, launched inside the bound', { alive: true, probe_age_s: 31, phase: 'running', elapsed_s: 20 }, 'stopped', false],
    ['not alive, not ended', { alive: false, probe_age_s: 5, phase: 'running' }, 'stopped', false],
    ['exited with no rc and no final_status', { alive: true, probe_age_s: 5, phase: 'exited' }, 'stopped', false],
    ['ended_at set, alive flag still true', { alive: true, probe_age_s: 5, phase: 'running', ended_at: '2026-10-13T07:05:00.000Z' }, 'stopped', false],
    ['unrecognised final_status on a fresh row', { alive: true, probe_age_s: 5, phase: 'running', final_status: 'WEIRD' }, 'unknown', false],
  ]
  for (const [name, over, want, fresh] of cases) {
    const nowAt = Date.parse(base.started_at) + (((over as { elapsed_s?: number }).elapsed_s ?? base.elapsed_s) * 1000) // the clock the case means: `elapsed_s` seconds after launch
    const [row] = paneRows(env([{ ...base, ...over }]), nowAt) as ReturnType<typeof paneRows> & object
    expect(row.fresh, name).toBe(fresh)
    expect(ui.stateOf('run', runSubject(row)).id, name).toBe(want)
    const text = dispatchLines(dispatchSnap([row], { detail: { counts: null, stalled: 0, now_ms: Date.parse('2026-10-13T08:00:00.000Z') } }), { t, cols: 120 }).map(l => l.text).join('\n')
    const drawnRunning = text.split('\n').some(l => l.startsWith('● ') && l.includes(' x '))
    expect(drawnRunning, name + ' drawn as running').toBe(want === 'running')
  }
  // elapsed_s is frozen in a heartbeat rewrite: a stale copy of 5 s must not keep a never-probed run "not started" once the CLOCK is past the bound
  const stale = { ...base, alive: true, probe_age_s: null, phase: 'running', elapsed_s: 5 }
  const startMs = Date.parse(base.started_at)
  const [late] = paneRows(env([stale]), startMs + 31_000) as never[]
  expect(ui.stateOf('run', runSubject(late)).id, 'elapsed_s 5 but the clock is 31 s past launch').toBe('stopped')
  const [early] = paneRows(env([stale]), startMs + 30_000) as never[]
  expect(ui.stateOf('run', runSubject(early)).id, 'exactly at the bound').toBe('pending')
  const [noClock] = paneRows(env([stale])) as never[]
  expect(ui.stateOf('run', runSubject(noClock)).id, 'no clock, no starting').toBe('stopped')
  const [noStart] = paneRows(env([{ ...stale, started_at: null }]), startMs + 1000) as never[]
  expect(ui.stateOf('run', runSubject(noStart)).id, 'no started_at, no starting').toBe('stopped')
  // no bound published: any probe counts as fresh
  const [noBound] = paneRows({ runs: [{ ...base, alive: true, probe_age_s: 900, phase: 'running' }] } as never) as never[]
  expect((noBound as { fresh: boolean }).fresh).toBe(true)
})

test('dispatch tab: a dead run with no ended_at and no final_status is dated by nothing: the ended cell is — and the row stays listed, never "0s 前" (runEndedMs)', () => {
  const t = makeT('zh-TW')
  const env = { counts: { fresh_bound_s: 30 }, runs: [{ run_id: 'dead-3d', role: 'hands', runner: 'codex', model: 'gpt', started_at: new Date(D_NOW - 3 * D_DAY).toISOString(), elapsed_s: 3 * 86400, stall: false, rc: null, final_status: null, phase: 'exited', alive: false, probe_age_s: null }] } as never
  const rows = paneRows(env) as never[]
  const lines = dispatchLines(dispatchSnap(rows), { t, cols: 120 })
  const body = bodyRows(lines)
  expect(body.length, 'listed, not aged out').toBe(1)
  expect(body[0].text.includes('0s 前')).toBe(false)
  expect(body[0].text.trimEnd().endsWith('—')).toBe(true)
  expect(runEndedMs(rows[0])).toBeNull()
  // with a final_status the frozen elapsed_s does date the end
  const dated = paneRows({ counts: { fresh_bound_s: 30 }, runs: [{ run_id: 'x', started_at: new Date(D_NOW - 3 * D_DAY).toISOString(), elapsed_s: 60, rc: null, final_status: 'done', phase: 'exited', alive: false }] } as never) as never[]
  expect(runEndedMs(dated[0])).toBe(D_NOW - 3 * D_DAY + 60_000)
})

test('dispatch tab: the footer snapshot stamp is HH:MM (or MM-DD), never the raw ISO string the producer publishes (§3.5)', () => {
  for (const locale of tabLocales) {
    const lines = dispatchLines(dispatchSnap([RUN_LIVE('a')]), { t: makeT(locale), cols: 100 })
    const note = lines.find(l => l.kind === 'detail') as { text: string }
    expect(/\d\d:\d\d$/.test(note.text), note.text).toBe(true)
    expect(/T\d\d|Z|2026-/.test(note.text), note.text).toBe(false)
  }
})

for (const surface of SURFACES) {
  test('P2 wiring: the mod passes its clock to paneRows: a never-probed run reads ○ 未開始 inside fresh_bound_s and ◌ 已停 once the clock is past it (' + surface + ')', async ($, on) => {
    const files = base()
    const runs = [row({ run_id: 'never-probed', alive: true, probe_age_s: null, phase: 'running', started_at: '2026-10-04T10:00:20.000Z', elapsed_s: 10 })]
    const env = envelope({ runs, counts: { confirmed_live: 0, exited: 0, unknown: 1, fresh_bound_s: 30 } })
    files[LIVE + '/runs/' + KEY + '--' + ROOT + '.json'] = j(env)
    files[LIVE + '/runs/' + KEY + '.json'] = j(envelope({ runs, counts: { confirmed_live: 0, exited: 0, unknown: 1, fresh_bound_s: 30 } }, null))
    const w = world(on, files)
    await start($, surface)
    const runRow = async () => (await paneParts($, surface, 'dispatch')).texts.find(x => x.includes('never-probed')) as string
    expect((await runRow()).startsWith('○ 未開始'), await runRow()).toBe(true) // 10 s after launch, bound 30
    for (let i = 0; i < 7; i++) await w.clock.advance(5000) // 35 s on: 45 s after launch, and the envelope (valid 180 s) is still fresh
    expect((await runRow()).startsWith('◌ 已停'), await runRow()).toBe(true)
  })
}

for (const surface of SURFACES) {
  test('P2 mounted (I18, I19): pressing the finished-runs `more` row lists every finished run and pressing it again restores the five; pressing the 審查 row calls onTab review (' + surface + ')', async ($, on) => {
    const files = base()
    const runs = [
      row({ run_id: 'live-1' }),
      ...Array.from({ length: 8 }, (_, i) => row({ run_id: 'done-' + i, phase: 'exited', alive: false, rc: 0, final_status: 'done', started_at: '2026-10-04T09:40:00.000Z', ended_at: '2026-10-04T09:' + String(41 + i).padStart(2, '0') + ':00.000Z', elapsed_s: 60 })),
    ]
    files[LIVE + '/runs/' + KEY + '--' + ROOT + '.json'] = j(envelope({ runs }))
    files[LIVE + '/runs/' + KEY + '.json'] = j(envelope({ runs }, null))
    world(on, files)
    await start($, surface)
    const mountPane = (props: object = PANE_PROPS) => $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-live', props, viewport: { columns: 160, rows: 50, isFullscreen: true } })
    const first = await mountPane()
    await first.press({ key: 'dispatch' })
    await first.unmount()
    const rowsNow = async () => { const p = await mountPane(); const r = rowsOf((await p.drawn()) as Node); await p.unmount(); return r }
    const doneCount = (r: string[]) => r.filter(x => / done-\d/.test(x)).length
    const before = await rowsNow()
    expect(doneCount(before)).toBe(5)
    const at = before.findIndex(x => x.includes('還有 3 筆已完成'))
    expect(at, before.join('\n')).toBeGreaterThan(0)
    const press = await mountPane()
    await press.press({ key: 'b' + at })
    await press.unmount()
    const opened = await rowsNow()
    expect(doneCount(opened)).toBe(8)
    expect(opened.some(x => x.includes('收起'))).toBe(true)
    const again = await mountPane()
    await again.press({ key: 'b' + opened.findIndex(x => x.includes('收起')) })
    await again.unmount()
    expect(await rowsNow()).toEqual(before)
    // the pointer row: a Button whose press switches the pane to 審查
    const ptr = before.findIndex(x => x.startsWith('審查 ›'))
    expect(ptr).toBeGreaterThan(0)
    const nav = await mountPane()
    await nav.press({ key: 'g' + ptr })
    await nav.unmount()
    const review = await mountPane()
    const active = (await activeKeyOf(review))
    await review.unmount()
    expect(active).toBe('review')
  })
}

// ---- follow-up C: the Spend tab's hourly sparkline (source: <live>/runs/spend-history.json, published by the runs watcher) ----
const SH_NOW = Date.parse('2026-10-10T12:30:00.000Z')
const shText = (samples: { at: string; usd: number }[]) => JSON.stringify({ schema: 'autopilot.spend-history/1', updated_at: new Date(SH_NOW).toISOString(), samples })
const at = (hoursAgo: number) => new Date(SH_NOW - hoursAgo * 3600 * 1000).toISOString()

test('spend history: a foreign schema, broken JSON or no file reads as null; bad samples are skipped; samples come back sorted', () => {
  expect(readSpendHistory(null)).toBe(null)
  expect(readSpendHistory('{nope')).toBe(null)
  expect(readSpendHistory(JSON.stringify({ schema: 'other/1', samples: [] }))).toBe(null)
  const got = readSpendHistory(JSON.stringify({ schema: 'autopilot.spend-history/1', samples: [{ at: at(1), usd: 5 }, { at: 'x', usd: 1 }, { at: at(2), usd: -3 }, { at: at(3), usd: 2 }, { at: at(4), usd: NaN }] }))
  expect(got?.map(x => x.usd)).toEqual([2, 5])
})

test('spend history: hourly buckets hold the spend ADDED in each hour, 24 of them, the current hour last', () => {
  const samples = readSpendHistory(shText([{ at: at(4.4), usd: 10 }, { at: at(3.4), usd: 12 }, { at: at(2.4), usd: 12 }, { at: at(1.4), usd: 17.5 }])) as never
  const b = hourlySpend(samples, SH_NOW) as number[]
  expect(b.length).toBe(24)
  // 12:30 now: the sample at 11:06 (1.4 h ago) is index 22; 10:06 is 2.4 h ago (index 21); 09:06 index 20; 08:06 (4.4) index 19 is the baseline, counted 0
  expect(Math.round(b[22] * 100) / 100).toBe(5.5)
  expect(b[23]).toBe(0)
  expect(b[21]).toBe(0)
  expect(Math.round(b[20] * 100) / 100).toBe(2)
  expect(b[19]).toBe(0)
  expect(Math.round(b.reduce((a, c) => a + c, 0) * 100) / 100).toBe(7.5)
})

test('spend history: a reset (any boundary) gives the new cumulative value, a flat or falling figure is never a negative bar, and a baseline over 1 h old draws no bar', () => {
  const nowMs = Date.parse('2026-10-10T01:30:00.000Z')
  const before = (h: number) => new Date(nowMs - h * 3600 * 1000).toISOString()
  const mk = (rows: [number, number][]) => hourlySpend(readSpendHistory(JSON.stringify({ schema: 'autopilot.spend-history/1', samples: rows.map(([h, usd]) => ({ at: before(h), usd })) })), nowMs) as number[]
  // 40 -> 3 (reset: +3, not -37 and not a spike of 40) -> 3.5 (+0.5) -> 2.5 (reset again: +2.5)
  const b = mk([[1.5, 40], [1.2, 3], [0.7, 3.5], [0.2, 2.5]])
  expect(Math.round(b.reduce((a, c) => a + c, 0) * 100) / 100).toBe(6)
  expect(b.some(v => v < 0)).toBe(false)
  // the same series at any wall-clock boundary gives the same answer: it never looks at the date
  const c = hourlySpend(readSpendHistory(JSON.stringify({ schema: 'autopilot.spend-history/1', samples: [{ at: '2026-10-10T04:00:00.000Z', usd: 40 }, { at: '2026-10-10T04:15:00.000Z', usd: 3 }] })), Date.parse('2026-10-10T04:20:00.000Z')) as number[]
  expect(c[23]).toBe(3)
  // a gap: the baseline is 90 minutes older than the sample -> unknown, no bar; exactly 1 h still counts
  const gap = mk([[2, 10], [0.5, 25], [0.2, 26]])
  expect(Math.round(gap.reduce((a, x) => a + x, 0) * 100) / 100).toBe(1)
  const edge = mk([[1.2, 10], [0.2, 16]])
  expect(Math.round(edge.reduce((a, x) => a + x, 0) * 100) / 100).toBe(6)
  // samples outside the 24 h window are ignored
  expect(mk([[40, 1], [30, 2], [0.1, 5]])).toBe(null as never)
})

test('spend history: fewer than 2 samples in the last 24 h is no sparkline (null), however old the others are', () => {
  expect(hourlySpend(null, SH_NOW)).toBe(null)
  expect(hourlySpend([], SH_NOW)).toBe(null)
  expect(hourlySpend(readSpendHistory(shText([{ at: at(0.1), usd: 5 }])), SH_NOW)).toBe(null)
  expect(hourlySpend(readSpendHistory(shText([{ at: at(40), usd: 1 }, { at: at(30), usd: 2 }, { at: at(0.1), usd: 5 }])), SH_NOW)).toBe(null)
  expect(hourlySpend(readSpendHistory(shText([{ at: at(1), usd: 1 }, { at: at(0.1), usd: 5 }])), SH_NOW)).not.toBe(null)
})

test('spend history: sparkText scales to the peak over the eight bars; zeros are the floor; an all-zero window is flat', () => {
  expect(SPARK_BARS).toBe('▁▂▃▄▅▆▇█')
  expect(sparkText([0, 1, 2, 4, 8])).toBe('▁▂▃▅█')
  expect(sparkText([0, 0, 0])).toBe('▁▁▁')
  expect(sparkText([5])).toBe('█')
})

const spendSnap = (hourly: number[] | null) => ({
  header: 'h', rows: null, gates: null, link: null, published_at: null, session_as_of: null, host_as_of: null,
  sections: NO_SECTIONS,
  detail: { counts: null, stalled: 0, now_ms: SH_NOW, spend: { session: '$1.00', host_all: '$20.00', host_all_n: 20, brain: 12, cap: 150, mode: 'warn', hourly } },
}) as never
const HOURLY = [0, 0, 0.5, 1, 0, 0, 2, 3.5, 1, 0, 0, 0, 0.2, 0, 4, 2, 1, 0, 0, 0.5, 0, 1, 2, 3]

for (const width of [60, 76, 90]) {
  for (const locale of ['en', 'zh-TW'] as const) {
    test('spend tab: the hourly sparkline is 24 bars with a total and a peak caption, nothing wider than the pane (' + locale + ', ' + width + ' columns)', () => {
      const t = makeT(locale)
      const lines = spendTabLines(spendSnap(HOURLY), { t, cols: width })
      for (const l of lines) expect(displayWidth(l.text), l.text).toBeLessThanOrEqual(width)
      const bars = lines.find(l => [...l.text].some(c => SPARK_BARS.includes(c)))
      expect(bars, 'the sparkline row').toBeDefined()
      const spark = [...(bars as { text: string }).text].filter(c => SPARK_BARS.includes(c)).join('')
      expect([...spark].length).toBe(24)
      expect(spark).toBe(sparkText(HOURLY)) // the design system's sparkValue scales like the legacy sparkText
      // chart glyphs are default text (a sparkline is not a running state): no colour, no bold
      expect((bars as { segs: { color?: string; bold?: boolean }[] }).segs.every(x => x.color === undefined && x.bold !== true)).toBe(true)
      const total = HOURLY.reduce((a, c) => a + c, 0)
      const head = lines.find(l => l.text.includes(t('usage.last24')))
      expect(head?.text).toContain('$' + total.toFixed(2))
      expect(head?.text.startsWith('▾ ')).toBe(true)
      const caption = lines.map(l => l.text).join('\n')
      expect(caption).toContain('$4.00')
      expect(caption).toContain(t('spend.hint').slice(0, 6))
      expect(lines.some(l => l.text.includes(t('spend.no_history')))).toBe(false)
    })

    test('spend tab: with no history (or fewer than 2 samples) there is no sparkline, only the note (' + locale + ', ' + width + ' columns)', () => {
      const t = makeT(locale)
      const lines = spendTabLines(spendSnap(null), { t, cols: width })
      expect(lines.map(l => l.text.trim()).filter(x => x !== '').join(' ').replace(/ +/g, ' ')).toContain(t('spend.no_history').replace(/ +/g, ' '))
      expect(lines.some(l => [...l.text].some(c => SPARK_BARS.includes(c)))).toBe(false)
      for (const l of lines) expect(displayWidth(l.text), l.text).toBeLessThanOrEqual(width)
    })
  }
}

const shareSnap = () => ({
  header: 'h', rows: null, gates: null, link: null, published_at: null, session_as_of: null, host_as_of: null,
  sections: NO_SECTIONS,
  detail: { counts: null, stalled: 0, now_ms: SH_NOW, spend: { session: '$1.00', host_all: '$112.40', host_all_n: 112.4, brain: 87.2, cap: 150, mode: 'warn', hourly: HOURLY } },
}) as never

for (const [cols, cells] of [[76, 20], [120, 40]] as const) {
  test('usage tab: the brain and other-tier share bars use one scale, their filled cells add up to the meter width (' + cols + ' columns, ' + cells + ' cells)', () => {
    const t = makeT('zh-TW')
    const lines = spendTabLines(shareSnap(), { t, cols })
    const on = (key: string) => {
      const row = lines.find(l => l.fact === 'usage.today' && l.text.startsWith(key))
      expect(row, key).toBeDefined()
      return [...(row as { text: string }).text].filter(c => c === '▰').length
    }
    const brain = on(t('label.brain') + ' ')
    const other = on(t('label.other_tiers'))
    expect(brain).toBeGreaterThan(other) // 87.20 of 112.40
    expect(other).toBeGreaterThanOrEqual(1) // a non-zero remainder keeps a cell
    expect(brain + other).toBe(cells)
    expect(brain).toBe(Math.round((87.2 / 112.4) * cells)) // the share of the host total, not of the cap
  })
}

for (const [cols, rowsExpected] of [[120, 1], [84, 1], [83, 2], [60, 2]] as const) {
  test('usage tab: the sparkline, its peak and its hint share one row when they fit, else the hint drops to a second (' + cols + ' columns: ' + rowsExpected + ' row(s))', () => {
    const t = makeT('zh-TW')
    const lines = spendTabLines(shareSnap(), { t, cols })
    const at = lines.findIndex(l => l.text.includes(t('usage.last24')))
    expect(at).toBeGreaterThan(-1)
    const rest = lines.slice(at + 1)
    const end = rest.findIndex(l => l.text.startsWith('▾ ') || l.text.startsWith('▸ '))
    const chart = (end === -1 ? rest : rest.slice(0, end)).filter(l => l.text.trim() !== '')
    expect(chart.length).toBe(rowsExpected)
    if (rowsExpected === 2) {
      expect(chart[1].text).toBe(' '.repeat(12) + t('spend.hint')) // the hint alone, indented under the sparkline
      expect(chart[0].text).not.toContain(t('spend.hint'))
    } else expect(chart[0].text).toContain(t('spend.hint'))
  })
}

test('usage tab: folding 今日花費 or 近 24 小時 leaves the heading alone and shows the arrow ▸', () => {
  const t = makeT('zh-TW')
  for (const [id, title, inner] of [[SECTION.today, t('now.cost'), t('label.host')], [SECTION.last24, t('usage.last24'), t('label.brain') + ' ']] as const) {
    const open = spendTabLines(shareSnap(), { t, cols: 120 })
    expect(open.some(l => l.text.startsWith('▾ ' + title))).toBe(true)
    expect(open.some(l => l.text.startsWith(inner))).toBe(true)
    const shut = spendTabLines(shareSnap(), { t, cols: 120, folded: new Set([id]) })
    expect(shut.some(l => l.text.startsWith('▸ ' + title))).toBe(true)
    expect(shut.some(l => l.text.startsWith('▾ ' + title))).toBe(false)
    if (id === SECTION.today) expect(shut.some(l => l.text.startsWith(inner))).toBe(false)
    else expect(shut.some(l => [...l.text].some(c => SPARK_BARS.includes(c)))).toBe(false)
  }
})

test('usage tab: an OAuth account with no email, organization or plan reads "signed in, details incomplete", never "not logged in"', () => {
  for (const locale of ['en', 'zh-TW'] as const) {
    const t = makeT(locale)
    const acc = readAccount(JSON.stringify({ oauthAccount: { accountUuid: 'u-1' } }))
    expect(acc, 'an account id alone is a signed-in account').not.toBe(null)
    const text = spendTabLines(usageSnap({ account: acc, quota: [] }), { t, cols: 120 }).map(l => l.text).join('\n')
    expect(text).toContain(t('account.partial'))
    expect(text).not.toContain(t('account.none'))
  }
})

// ---- the Now tab's trailing section: the last 3 prompts of the session, each with a collapsible reply (all prompts here are synthetic) ----
const U = (text: string, extra: Partial<SessionMsg> = {}): SessionMsg => ({ role: 'user', text, toolUses: [], ...extra })
const A = (text: string, toolUses: unknown[] = []): SessionMsg => ({ role: 'assistant', text, toolUses })

test('recent: grouping skips tool_result user messages and every injected-tag prefix', () => {
  expect(INJECTED_PREFIXES).toEqual(['<system-reminder>', '<task-notification>', '<local-command-', '<command-name>', '<command-message>', '<command-args>'])
  const injected = INJECTED_PREFIXES.map(p => U('  ' + p + 'synthetic body'))
  const groups = groupRecent([U('first question'), A('first answer'), ...injected, U('', { toolResults: [] }), U('tool output', { toolResults: [{ tool_use_id: 'x', text: 'r', isError: false }] }), A('second answer'), U('   ')])
  expect(groups.map(g => g.prompt)).toEqual(['first question']) // the injected / tool-result / blank user messages never open a group
  expect(groups[0].reply).toBe('first answer\n\nsecond answer') // and their assistant follow-ups still belong to the open group
})

test('recent: assistant text is joined across messages; tool-use-only messages add nothing', () => {
  const [g] = groupRecent([U('q'), A('part one'), A('', [{ name: 'Bash' }]), A('part two')])
  expect(g.reply).toBe('part one\n\npart two')
  expect(g.id).toBe('0')
})

test('recent: only the last 3 groups are kept, oldest first, ids are transcript indexes', () => {
  const msgs: SessionMsg[] = []
  for (const n of [1, 2, 3, 4, 5]) msgs.push(U('prompt ' + n), A('reply ' + n))
  const groups = groupRecent(msgs)
  expect(groups.map(g => g.prompt)).toEqual(['prompt 3', 'prompt 4', 'prompt 5'])
  expect(groups.map(g => g.id)).toEqual(['4', '6', '8'])
  expect(groups.map(g => g.reply)).toEqual(['reply 3', 'reply 4', 'reply 5'])
})

test('recent: every redaction pattern becomes ***, ordinary text is untouched', () => {
  const fake = (n: number, c = 'a') => c.repeat(n)
  const cases: [string, string][] = [
    ['key sk-' + fake(20) + ' end', 'key *** end'],
    ['key sk-ant-api03-' + fake(24, 'Z') + ' end', 'key *** end'],
    ['ghp_' + fake(30), '***'], ['gho_' + fake(30), '***'], ['ghs_' + fake(30), '***'], ['ghu_' + fake(30), '***'],
    ['github_pat_' + fake(30, 'B'), '***'],
    ['Authorization: Bearer ' + fake(30), 'Authorization: Bearer ***'],
    ['id AKIA' + fake(16, 'Q'), 'id ***'],
    ['slack xoxb-' + fake(12, '1'), 'slack ***'], ['slack xoxp-' + fake(12, '1'), 'slack ***'],
  ]
  for (const [input, want] of cases) expect(redactSecrets(input), input).toBe(want)
  const plain = 'the sk- prefix, a Bearer of news, AKIA short, ghp_ alone, task-1234 and skill-name-with-dashes-only are ordinary'
  expect(redactSecrets(plain)).toBe(plain)
  // and the group carries only the redacted text
  const [g] = groupRecent([U('use sk-' + fake(20)), A('done with ghp_' + fake(30))])
  expect(g.prompt).toBe('use ***')
  expect(g.reply).toBe('done with ***')
  // redaction runs before the 8000-char store clip, so a token straddling the clip never leaves a partial prefix
  const [long] = groupRecent([U(fake(7990, 'x') + ' sk-' + fake(30, 'K'))])
  expect(long.prompt).not.toContain('sk-')
  expect(long.prompt.endsWith('***')).toBe(true)
  // the store clip never splits a surrogate pair (no lone high surrogate at the cut)
  const [emoji] = groupRecent([U(fake(7999, 'x') + '\u{1F600}tail')])
  expect(/[\uD800-\uDBFF]$/.test(emoji.prompt)).toBe(false)
})

const OPEN_RECENT: ReadonlySet<string> = new Set(['sec:now.recent']) // membership = toggled away from its folded default = open
// P5: a recent group is a `bullet` with its toggle at the right edge; the tests compare it with the padding squeezed to one space
const squash = (x: string): string => x.trimEnd().replace(/ {2,}([▸▾])$/, ' $1')

test('recent: a collapsed prompt is one line of at most 60 characters plus …', () => {
  const long = 'word '.repeat(40) + '\n\nsecond paragraph'
  const c = collapsedPrompt(long)
  expect([...c].length).toBe(61)
  expect(c.endsWith('…')).toBe(true)
  expect(c).not.toContain('\n')
  expect(collapsedPrompt('short  prompt\nhere')).toBe('short prompt here')
  const exact = 'x'.repeat(60)
  expect(collapsedPrompt(exact)).toBe(exact)
  const lines = recentLines(groupRecent([U(long), A('reply')]), { t: makeT('en'), cols: 100, expanded: new Set(), folded: OPEN_RECENT })
  const g = lines.find(l => l.toggle === '0') as { text: string } // the group (id = its transcript index), not the foldable heading
  expect(squash(g.text)).toBe('◦ You: ' + c + ' ▸')
})

test('recent: an expanded group is capped at 20 lines with a final … line; a short one is shown whole', () => {
  const reply = Array.from({ length: 60 }, (_v, i) => 'reply line ' + i).join('\n')
  const groups = groupRecent([U('a question\nin two lines'), A(reply)])
  const ctx = { t: makeT('en'), cols: 80, expanded: new Set([groups[0].id]), folded: OPEN_RECENT }
  const lines = recentLines(groups, ctx).slice(1) // without the section heading
  expect(lines.length).toBe(RECENT_EXPANDED_LINES)
  expect(squash(lines[0].text)).toBe('◦ You: ▾')
  expect(lines[lines.length - 1].text.trim()).toBe('…')
  const text = lines.map(l => l.text).join('\n')
  expect(text).toContain('a question')
  expect(text).toContain('AI:')
  expect(text).toContain('reply line 0')
  expect(text).not.toContain('reply line 59')
  const short = recentLines(groupRecent([U('hi'), A('hello')]), { ...ctx, expanded: new Set(['0']) }).slice(1).map(l => l.text.trim())
  expect([squash(short[0]), ...short.slice(1)]).toEqual(['◦ You: ▾', 'hi', 'AI:', 'hello'])
})

test('recent: the tracker recomputes only when the message count (or the newest text) changes', () => {
  const msgs = [U('q1'), A('a1')]
  let calls = 0
  const read = () => { calls++; return msgs }
  const tr = makeRecentTracker()
  const first = tr.update('s', read())
  tr.update('s', read())
  tr.update('s', read())
  expect(calls).toBe(3)
  expect(tr.computed).toBe(1)
  msgs.push(U('q2'))
  const grown = tr.update('s', read())
  expect(tr.computed).toBe(2)
  expect(grown).not.toBe(first)
  expect(tr.update('s', read())).toBe(grown)
  expect(tr.computed).toBe(2)
  tr.update('other-session', read()) // a /clear gives a new sid: same count, still recomputed
  expect(tr.computed).toBe(3)
})

for (const locale of ['en', 'zh-TW'] as const) {
  test('recent: the Now tab ends with the section, empty state and filled, in ' + locale, async ($, on) => {
    const t = makeT(locale)
    let messages: SessionMsg[] = []
    const w = world(on, base(), NOW_FRESH, SID_A, locale)
    on('session.messages', () => ({ value: messages }))
    await start($, 'terminal')
    await openRecent($)
    const empty = (await paneParts($, 'terminal', 'now')).texts
    expect(empty.slice(-2)).toEqual([expect.stringContaining(t('recent.title')), expect.stringContaining(t('recent.empty'))])
    messages = [U('synthetic question one'), A('synthetic answer one'), U('<system-reminder>noise'), U('synthetic question two'), A('synthetic answer two')]
    await w.clock.advance(5000)
    const filled = (await paneParts($, 'terminal', 'now')).texts
    expect([filled.slice(-3)[0], ...filled.slice(-2).map(squash)]).toEqual([expect.stringContaining(t('recent.title')), '◦ ' + t('recent.you') + ': synthetic question one ▸', '◦ ' + t('recent.you') + ': synthetic question two ▸'])
  })
}

test('recent: the pane lists the section after a tick, and a throwing $.session.messages leaves the tick working', async ($, on) => {
  let throwing = false
  let messages: SessionMsg[] = [U('synthetic question one'), A('synthetic answer one')]
  let calls = 0
  const w = worldEn(on, base())
  on('session.messages', () => { calls++; if (throwing) throw new Error('transcript unavailable'); return { value: messages } })
  await start($, 'terminal')
  await openRecent($)
  const rows = async () => (await paneParts($, 'terminal', 'now')).texts
  let r = await rows()
  expect([r.slice(-2)[0], squash(r[r.length - 1])]).toEqual([expect.stringContaining('Recent conversation'), '◦ You: synthetic question one ▸'])
  throwing = true
  messages = [...messages, U('synthetic question two')]
  w.toasts.length = 0
  await w.clock.advance(5000)
  r = await rows()
  expect([r.slice(-2)[0], squash(r[r.length - 1])]).toEqual([expect.stringContaining('Recent conversation'), '◦ You: synthetic question one ▸']) // the previous value is kept
  expect(r.some(x => x.includes('Needs you') || x.includes('Stalled'))).toBe(true) // and the rest of the tick still ran
  throwing = false
  await w.clock.advance(5000)
  r = await rows()
  expect([r.slice(-3)[0], ...r.slice(-2).map(squash)]).toEqual([expect.stringContaining('Recent conversation'), '◦ You: synthetic question one ▸', '◦ You: synthetic question two ▸'])
  const before = calls
  await w.clock.advance(5000) // unchanged transcript: read again, not regrouped
  expect(calls).toBeGreaterThan(before)
  expect((await rows()).slice(-3).length).toBe(3)
})

test('recent: pressing a group Button expands it, pressing again collapses it', async ($, on) => {
  const w = worldEn(on, base())
  on('session.messages', () => ({ value: [U('synthetic question one'), A('synthetic answer one')] }))
  await start($, 'terminal')
  await openRecent($)
  const mountPane = () => $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'Pane', requestId: 'autopilot-live', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
  const first = await mountPane()
  await first.press({ key: 'now' })
  await first.unmount()
  const press = async () => {
    const pane = await mountPane()
    const key = 'b' + rowsOf((await pane.drawn()) as Node).findIndex(r => /^◦ You/.test(r)) // the line index of the group header
    await pane.press({ key })
    await pane.unmount()
    const again = await mountPane()
    const rows = rowsOf((await again.drawn()) as Node)
    await again.unmount()
    return rows
  }
  let rows = await press()
  expect([squash(rows.slice(-4)[0]), ...rows.slice(-3)]).toEqual(['◦ You: ▾', '  synthetic question one', '  AI:', '  synthetic answer one'])
  rows = await press()
  expect(rows.slice(-1).map(squash)).toEqual(['◦ You: synthetic question one ▸'])
  expect(w.toasts).toEqual([])
  // a new session id (/clear) reuses transcript indexes: an opened group must not stay open for the new session
  rows = await press()
  expect(squash(rows.slice(-4)[0])).toBe('◦ You: ▾')
  w.sid.value = SID_B
  await w.clock.advance(5000)
  const pane = await mountPane()
  rows = rowsOf((await pane.drawn()) as Node)
  await pane.unmount()
  expect(rows.slice(-1).map(squash)).toEqual(['◦ You: synthetic question one ▸'])
})

// ---- owner 2026-10-12: a wrapped group header stayed unpressable; sections fold ----
test('wrap: a toggle line that wraps keeps its toggle on every line (each piece stays pressable)', () => {
  const body = '測'.repeat(40)
  const l = { toggle: 'g1', text: '▸ 你: ' + body, segs: [{ text: '▸ ' }, { text: '你: ' }, { text: body }] }
  const out = wrapLines([l], 30)
  expect(out.length).toBeGreaterThan(1)
  expect(out.every(x => x.toggle === 'g1')).toBe(true)
})

test('recent: a collapsed CJK prompt wider than the pane is cut to one line that fits, and it is the toggle line', () => {
  const groups = groupRecent([U('第一則'), A('a'), U('這是一個很長的中文問題'.repeat(8)), A('b')])
  const lines = recentLines(groups, { t: makeT('zh-TW'), cols: 40, expanded: new Set(), folded: OPEN_RECENT }).slice(1)
  expect(lines.length).toBe(2)
  for (const l of lines) {
    expect(l.toggle).toBeDefined()
    expect(displayWidth(l.text)).toBeLessThanOrEqual(40)
  }
  expect(lines[1].text.includes('…') && lines[1].text.trimEnd().endsWith('▸')).toBe(true) // the prompt is cut, the toggle stays at the right edge
  expect(wrapLines(lines, 40).length).toBe(2) // nothing left for the pane's wrap to split
})

test('recent: on a narrow pane the long CJK group (the second one) opens on a press', async ($, on) => {
  world(on, base(), NOW_FRESH, SID_A, 'zh-TW')
  on('session.messages', () => ({ value: [U('第一則'), A('答一'), U('這是一個很長的中文問題'.repeat(8)), A('答二')] }))
  await start($, 'terminal')
  await openRecent($)
  const mountPane = () => $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'Pane', requestId: 'autopilot-live', props: { ...PANE_PROPS, bodyColumns: 48 }, viewport: { columns: 160, rows: 50, isFullscreen: true } })
  const first = await mountPane()
  await first.press({ key: 'now' })
  await first.unmount()
  const pane = await mountPane()
  const rows = rowsOf((await pane.drawn()) as Node)
  const at = rows.findIndex(r => r.startsWith('◦ 你: 這是一個'))
  expect(at).toBeGreaterThan(0)
  await pane.press({ key: 'b' + at })
  await pane.unmount()
  const again = await mountPane()
  const after = rowsOf((await again.drawn()) as Node)
  await again.unmount()
  expect(after.some(r => r.trim() === '答二')).toBe(true)
})

test('now: a section heading runs a rule to the edge; pressing it folds the section to its heading, pressing again opens it', async ($, on) => {
  worldEn(on, base())
  await start($, 'terminal')
  const mountPane = () => $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'Pane', requestId: 'autopilot-live', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
  const first = await mountPane()
  await first.press({ key: 'now' })
  await first.unmount()
  const draw = async (pressAt: number | null) => {
    const pane = await mountPane()
    if (pressAt !== null) await pane.press({ key: 'b' + pressAt })
    await pane.unmount()
    const again = await mountPane()
    const rows = rowsOf((await again.drawn()) as Node)
    await again.unmount()
    return rows
  }
  const open = await draw(null)
  const at = open.findIndex(r => r.startsWith('▾ Position'))
  expect(at).toBeGreaterThan(0)
  expect(open[at]).toMatch(/ ─{3,}$/)
  expect(displayWidth(open[at])).toBe(PANE_PROPS.bodyColumns - 1) // the rule stops one column short of the edge (a full-width row would wrap)
  const next = open.findIndex((r, i) => i > at && /^[▾▸▌] /.test(r)) // the following section's heading
  expect(next - at).toBeGreaterThan(2) // the open section has a body
  const folded = await draw(at)
  expect(folded[at].startsWith('▸ Position')).toBe(true)
  expect(folded.length).toBe(open.length - (next - at - 1)) // the body is gone; the heading stays and the next section follows it
  expect(folded[at + 1]).toBe(open[next])
  expect(await draw(at)).toEqual(open)
  expect(open[0].startsWith('▾ Needs you')).toBe(true) // 要你處理 is the first section and starts open (plan 2.2: every section folds, it never STARTS folded)
  expect((await draw(0))[0].startsWith('▸ Needs you')).toBe(true)
  expect(await draw(0)).toEqual(open)
})

// ---- background work in the Now tab's working section: shells and watches from the messages, subagents from $.agent.list() ----
// The texts are the shapes Claude Code wrote into a real transcript (ids and paths synthetic).
const BG_OUT = '/tmp/claude-1000/proj/sid/tasks/bqd50316d.output'
const bgText = (id: string, out: string) => 'Command running in background with ID: ' + id + '. Output is being written to: ' + out + '. You will be notified when it completes.'
const bgUse = (id: string, extra: Record<string, unknown> = {}, input: Record<string, unknown> = { command: 'bash hooks/tests/run.sh', description: 'full suite', run_in_background: true }) =>
  ({ tool_use_id: 'toolu_' + id, tool: 'Bash', input, result: { stdout: '', stderr: '', interrupted: false, isImage: false, noOutputExpected: false, backgroundTaskId: id }, text: bgText(id, '/tmp/claude-1000/proj/sid/tasks/' + id + '.output'), ...extra })
const monUse = (id: string) => ({ tool_use_id: 'toolu_' + id, tool: 'Monitor', input: { description: 'watch CI', command: 'gh run watch' }, result: { taskId: id, timeoutMs: 30000, persistent: false }, text: 'Monitor started (task ' + id + ', expires in 30s). You will be notified on each event.' })
const note = (taskId: string, body: string) => U('<task-notification>\n<task-id>' + taskId + '</task-id>\n' + body + '\n</task-notification>')
const doneNote = (taskId: string, status = 'completed') => note(taskId, '<tool-use-id>toolu_' + taskId + '</tool-use-id>\n<output-file>/tmp/x.output</output-file>\n<status>' + status + '</status>\n<summary>Background command "x" ' + status + '</summary>')
const eventNote = (taskId: string, event: string) => note(taskId, '<summary>Monitor event: "watch CI"</summary>\n<event>' + event + '</event>')

test('activity: a background Bash and a Monitor start rows; the output path comes from the result text', () => {
  const tasks = scanBackground([U('q'), A('', [bgUse('bqd50316d'), monUse('bng8w6gpz')])])
  expect(tasks).toEqual([
    { id: 'bqd50316d', kind: 'shell', label: 'full suite', output: BG_OUT, lastEvent: null },
    { id: 'bng8w6gpz', kind: 'monitor', label: 'watch CI', output: null, lastEvent: null },
  ])
})

test('activity: a foreground Bash moved to the background by its timeout is a row; a plain or refused call is not', () => {
  const timedOut = bgUse('b1', { result: { stdout: '', backgroundTaskId: 'b1', timedOutAfterMs: 120000 } }, { command: 'make test' })
  const plain = { tool_use_id: 'toolu_p', tool: 'Bash', input: { command: 'ls' }, result: { stdout: 'a', stderr: '' }, text: 'a' }
  const refused = { ...bgUse('b2'), isError: true }
  expect(scanBackground([A('', [timedOut, plain, refused])]).map(t => [t.id, t.label])).toEqual([['b1', 'make test']])
})

test('activity: a stored foreground result whose output reads like a start message is no row; a shell takes only its own output file', () => {
  const docker = { tool_use_id: 'toolu_d', tool: 'Bash', input: { command: 'docker create alpine' }, result: { stdout: 'Created container with ID: 3f2a9c.', stderr: '' }, text: 'Created container with ID: 3f2a9c.' }
  const grep = { tool_use_id: 'toolu_g', tool: 'Bash', input: { command: 'git diff' }, result: { stdout: bgText('zz', '/tmp/zz.output'), stderr: '' }, text: bgText('zz', '/tmp/zz.output') }
  const watch = { tool_use_id: 'toolu_w', tool: 'Monitor', input: { command: 'cat log' }, result: { stdout: '' }, text: 'Monitor started (task m7, expires in 30s).' }
  expect(scanBackground([A('', [docker, grep, watch])])).toEqual([])
  const foreign = bgUse('b1', { text: 'Command running in background with ID: b1. Output is being written to: /etc/other.output.' })
  expect(scanBackground([A('', [foreign])]).map(t => [t.id, t.output])).toEqual([['b1', null]])
  // the id is literal in the path match: `b.1` does not take `bx1.output`
  const dotted = bgUse('b.1', { text: 'Command running in background with ID: b.1. Output is being written to: /tmp/t/bx1.output.' })
  expect(scanBackground([A('', [dotted])]).map(t => [t.id, t.output])).toEqual([['b.1', null]])
  // headless: the start wording must open the text
  const quoted = { tool_use_id: 'toolu_q', tool: 'Bash', input: { command: 'cat log' }, result: undefined, text: 'log: ' + bgText('b8', '/tmp/t/b8.output') }
  expect(scanBackground([A('', [quoted])])).toEqual([])
})

test('activity: without a stored result (headless) the ids come from the result text', () => {
  const shell = { ...bgUse('b9'), result: undefined }
  const mon = { ...monUse('m9'), result: undefined }
  const echoed = { tool_use_id: 'toolu_e', tool: 'Bash', input: { command: 'docker create alpine' }, result: undefined, text: 'Created container with ID: 3f2a9c.' }
  expect(scanBackground([A('', [shell, mon, echoed])]).map(t => [t.id, t.kind, t.output])).toEqual([['b9', 'shell', '/tmp/claude-1000/proj/sid/tasks/b9.output'], ['m9', 'monitor', null]])
})

test('activity: a status notification or a TaskStop ends a row; a Monitor event keeps it and becomes its tail', () => {
  const start = A('', [bgUse('b1'), bgUse('b2'), bgUse('b3'), monUse('m1'), monUse('m2')])
  const tasks = scanBackground([
    start,
    eventNote('m1', 'build 3 of 7 passed'),
    eventNote('m1', 'build 4 of 7 passed'),
    doneNote('b1'),
    note('b2', '<tool-use-id>toolu_b2</tool-use-id>\n<status>failed</status>'),
    A('', [{ tool_use_id: 'toolu_s', tool: 'TaskStop', input: { task_id: 'm2' }, result: { message: 'stopped', task_id: 'm2', task_type: 'monitor' }, text: 'stopped' }]),
  ])
  expect(tasks.map(t => [t.id, t.lastEvent])).toEqual([['b3', null], ['m1', 'build 4 of 7 passed']])
  // a notification matched only by its tool-use id ends the row too, and a running status does not
  const byUse = scanBackground([A('', [bgUse('b4'), bgUse('b5')]), U('<task-notification>\n<tool-use-id>toolu_b4</tool-use-id>\n<status>killed</status>\n</task-notification>'), note('b5', '<status>running</status>')])
  expect(byUse.map(t => t.id)).toEqual(['b5'])
})

test('activity: a result flagged backgroundEndsWithFinalResponse ends its row once a later real prompt shows the turn is over; before that it stays', () => {
  const flagged = (id: string) => bgUse(id, { result: { stdout: '', backgroundTaskId: id, backgroundEndsWithFinalResponse: true } })
  // same turn (no later prompt): the command is still running, so the row stays
  expect(scanBackground([U('q'), A('', [flagged('f1')])]).map(t => t.id)).toEqual(['f1'])
  expect(scanBackground([U('q'), A('', [flagged('f1')]), A('still working', [])]).map(t => t.id)).toEqual(['f1'])
  // an injected notification is not a new prompt
  expect(scanBackground([U('q'), A('', [flagged('f1')]), note('zz', '<status>running</status>')]).map(t => t.id)).toEqual(['f1'])
  // a later real prompt: the final response ended the process and no notification can follow
  expect(scanBackground([U('q'), A('', [flagged('f1')]), A('done'), U('next')])).toEqual([])
  // negative control: the same shape without the flag keeps its row across the next prompt, and a task started after the prompt stays
  const plain = bgUse('p1')
  expect(scanBackground([U('q'), A('', [plain, flagged('f2')]), A('done'), U('next'), A('', [flagged('f3')])]).map(t => t.id)).toEqual(['p1', 'f3'])
})

test('activity: labels are one line, redacted and clipped', () => {
  const secret = 'curl -H "Authorization: Bearer ' + 'k'.repeat(30) + '"\nsecond line'
  const [t] = scanBackground([A('', [bgUse('b1', {}, { command: secret, run_in_background: true })])])
  expect(t.label).toBe('curl -H "Authorization: Bearer ***" second line')
  const [long] = scanBackground([A('', [bgUse('b2', {}, { description: 'x'.repeat(500) })])])
  expect([...long.label].length).toBe(201)
})

test('activity: the last output line drops escape codes, takes the final \\r redraw, skips blank lines and masks secrets', () => {
  expect(lastOutputLine('one\ntwo\n\n  \n')).toBe('two')
  expect(lastOutputLine('\x1b[32m✓ 12 pass\x1b[0m\n')).toBe('✓ 12 pass')
  expect(lastOutputLine('progress 10%\rprogress 55%\rprogress 90%')).toBe('progress 90%')
  expect(lastOutputLine('progress 90%\r\n')).toBe('progress 90%')
  expect(lastOutputLine('\x1b]0;title\x07token ghp_' + 'a'.repeat(30))).toBe('token ***')
  expect(lastOutputLine('')).toBe(null)
  expect(lastOutputLine('\n \n')).toBe(null)
})

test('activity: the Now tab lists the running shell with its last line and quiet time, and the running agents; finished ones leave', async ($, on) => {
  const t = makeT('zh-TW')
  let messages: SessionMsg[] = [U('跑全套'), A('', [bgUse('bqd50316d'), monUse('bng8w6gpz')])]
  let agentsThrow = false
  const w = world(on, { ...base(), [BG_OUT]: 'ℹ tests 336\n\x1b[32m(pass) recent: tracker\x1b[0m\n' })
  w.stats[BG_OUT] = { size: 60, mtimeMs: NOW_FRESH - 20000 }
  on('session.messages', () => ({ value: messages }))
  on('agent.list', () => {
    if (agentsThrow) throw new Error('no agent list')
    return { value: [{ id: 'a1', description: '審查 phase 1', type: 'autopilot:reviewer', status: 'running' }, { id: 'a2', description: '已完成的', type: 'Explore', status: 'completed' }] }
  })
  await start($, 'terminal')
  const rows = async () => (await paneParts($, 'terminal', 'now')).texts
  let r = await rows()
  const at = r.findIndex(x => x.startsWith('▾ ' + t('now.background')))
  expect(at).toBeGreaterThan(0)
  const body = r.slice(at + 1).join('\n')
  expect(body).toContain(t('label.bg_shell'))
  expect(body).toContain('full suite')
  expect(body).toContain(t('bg.quiet', { age: '20s' }))
  expect(body).not.toContain('└') // the tail sits behind the row's toggle
  await pressRow($, 'terminal', 'now', x => x.includes('full suite'))
  r = await rows()
  expect(r.join('\n')).toContain('(pass) recent: tracker')
  expect(body).toContain(t('label.bg_monitor'))
  expect(body).toContain('審查 phase 1 · ' + t('label.bg_agent') + ' · autopilot:reviewer')
  expect(body).not.toContain('已完成的')
  // an unchanged output file (same size and mtime) is not read again
  const outReads = () => w.reads.filter(p => p === BG_OUT).length
  const before = outReads()
  expect(before).toBeGreaterThan(0)
  await w.clock.advance(5000)
  await rows()
  expect(outReads()).toBe(before)
  // the output grows: re-read; the shell finishes and the agent list fails: the shell leaves, the watch stays
  w.files[BG_OUT] = 'ℹ tests 336\nℹ pass 336\n'
  w.stats[BG_OUT] = { size: 30, mtimeMs: NOW_FRESH }
  await w.clock.advance(5000)
  expect((await rows()).join('\n')).toContain('ℹ pass 336')
  messages = [...messages, doneNote('bqd50316d')]
  agentsThrow = true
  await w.clock.advance(5000)
  r = await rows()
  const after = r.join('\n')
  expect(after).not.toContain('full suite')
  expect(after).toContain('watch CI')
  expect(after).not.toContain('審查 phase 1') // the agent rows come from the list alone: no list, no agent rows
})

test('activity: an output file over 1 MiB shows no tail; an unread transcript keeps the shell rows; an agent description is one masked line', async ($, on) => {
  const t = makeT('zh-TW')
  let messagesThrow = false
  const w = world(on, { ...base(), [BG_OUT]: 'never read\n' })
  w.stats[BG_OUT] = { size: 2 * 1024 * 1024, mtimeMs: NOW_FRESH - 5000 }
  on('session.messages', () => {
    if (messagesThrow) throw new Error('no transcript')
    return { value: [U('跑全套'), A('', [bgUse('bqd50316d')])] }
  })
  on('agent.list', () => ({ value: [{ id: 'a1', description: '審查\nghp_' + 'a'.repeat(30), type: 'autopilot:reviewer', status: 'running' }] }))
  await start($, 'terminal')
  const body = async () => (await paneParts($, 'terminal', 'now')).texts.join('\n')
  let b = await body()
  expect(b).toContain('full suite')
  expect(b).toContain(t('bg.quiet', { age: '5s' }))
  expect(b).not.toContain('└')
  expect(w.reads).not.toContain(BG_OUT)
  expect(b).toContain('審查 *** · ' + t('label.bg_agent') + ' · autopilot:reviewer')
  messagesThrow = true
  await w.clock.advance(5000)
  b = await body()
  expect(b).toContain('full suite')
  expect(b).not.toContain(t('bg.quiet', { age: '5s' })) // a kept row's age would freeze: it shows none
  expect(b.split('審查 ***').length - 1).toBe(1) // the agent row is replaced, not kept beside the new one
})

// ---- account and quota: the logged-in Claude account (~/.claude.json oauthAccount) and the rate-limit windows ($.session.usage) ----
const RESET_5H = '2026-10-04T12:30:30.000Z' // NOW_FRESH + 2h30m
const USAGE = { startedAt: '2026-10-04T09:00:00.000Z', context: null, rateLimits: [{ kind: 'seven_day', percentUsed: 18.4 }, { kind: 'five_hour', percentUsed: 42, resetsAt: RESET_5H }] }
const CLAUDE_JSON = JSON.stringify({
  numStartups: 12, projects: { '/work/repo': { allowedTools: [] } },
  oauthAccount: {
    accountUuid: 'u-1', emailAddress: 'owner@example.com', organizationUuid: 'o-1', displayName: 'Owner', organizationName: 'Example Co',
    organizationRole: 'admin', organizationType: 'claude_max', organizationRateLimitTier: 'default_claude_max_20x', hasExtraUsageEnabled: true, billingType: 'stripe_subscription',
  },
})
const quotaSlots = (q: QuotaWindow[] | null) => bandSlots({
  verdict: { mark: '●', word: '進行中', key: 'suggestion' }, marker: null, live: 1, stalled: 0, review: null, qc: null, decisions: null, spend: null,
  loadSource: null, residue: readResidue(JSON.stringify({ schema: 'autopilot.residue/1', project_key: KEY, reapable_worktrees: 0, by_class: {}, needs_human_count: 2 }), KEY), quota: q, nowMs: 0,
})
const win = (kind: string, pct: number): QuotaWindow => ({ kind, pct, resetsAtMs: null })
// a snapshot for the 用量 tab: the account and the quota windows ride in `account`, the spend in `detail.spend` (null = nothing published)
const usageSnap = (account: AccountSnap | undefined, spend: unknown = null) => ({
  header: 'h', rows: null, gates: null, link: null, published_at: null, session_as_of: null, host_as_of: null,
  sections: NO_SECTIONS, account,
  detail: { counts: null, stalled: 0, now_ms: NOW_FRESH, spend },
}) as never

test('quota: readQuota keeps well-formed windows in 5h / 7d / spend order and parses the reset time', () => {
  expect(readQuota(USAGE.rateLimits)).toEqual([{ kind: 'five_hour', pct: 42, resetsAtMs: Date.parse(RESET_5H) }, { kind: 'seven_day', pct: 18.4, resetsAtMs: null }])
  expect(readQuota([{ kind: 'spend_limit', percentUsed: 130 }, { kind: 'x', percentUsed: 'a' }, null, { percentUsed: 3 }, { kind: 'five_hour', percentUsed: NaN }, { kind: 'seven_day', percentUsed: -2, resetsAt: 'soon' }]))
    .toEqual([{ kind: 'seven_day', pct: 0, resetsAtMs: null }, { kind: 'spend_limit', pct: 130, resetsAtMs: null }])
  // the same kind twice: one row, the most used reading
  expect(readQuota([{ kind: 'five_hour', percentUsed: 20 }, { kind: 'seven_day', percentUsed: 5 }, { kind: 'five_hour', percentUsed: 64, resetsAt: RESET_5H }, { kind: 'five_hour', percentUsed: 30 }]))
    .toEqual([{ kind: 'five_hour', pct: 64, resetsAtMs: Date.parse(RESET_5H) }, { kind: 'seven_day', pct: 5, resetsAtMs: null }])
  expect(readQuota(undefined)).toEqual([])
  expect(readQuota({ kind: 'five_hour' })).toEqual([])
})

test('account: readAccount takes the oauthAccount fields, the email whole; no oauthAccount is null, an unread or half-written file is undefined', () => {
  expect(readAccount(CLAUDE_JSON)).toEqual({ email: 'owner@example.com', name: 'Owner', org: 'Example Co', role: 'admin', plan: 'claude max · 20x', extraUsage: true })
  expect(readAccount(JSON.stringify({ numStartups: 1 }))).toBe(null) // an API-key login
  expect(readAccount(JSON.stringify({ oauthAccount: { displayName: 'x' } }))).toBe(null) // no email and no account id: no account
  expect(readAccount(CLAUDE_JSON.slice(0, 80))).toBe(undefined)
  expect(readAccount(null)).toBe(undefined)
  expect(readAccount(JSON.stringify({ oauthAccount: { emailAddress: 'a@b.c', displayName: 'two\nlines', organizationType: 'claude_pro' } })))
    .toEqual({ email: 'a@b.c', name: 'two lines', org: null, role: null, plan: 'claude pro', extraUsage: false })
})

test('quota slot: absent without windows; both windows from 120 columns, the most used one below 120, none below 80', () => {
  expect(slotQuota([])).toBe(null)
  expect(slotQuota(null)).toBe(null)
  expect(slotQuota([win('weekly_opus', 50)])).toBe(null) // an unknown kind has no short label: the Now tab lists it, the band does not
  expect(layoutBand(quotaSlots([]), 209).text).toBe(layoutBand(quotaSlots(null), 209).text)
  const q = [win('five_hour', 10), win('seven_day', 85)]
  expect(layoutBand(quotaSlots(q), 209).text).toBe('● 進行中 │ ●1 │ 5h 10% 7d 85% │ ⚑2 │ ⓘ ')
  expect(layoutBand(quotaSlots(q), 159).text).toBe('● 進行中 │ ●1 │ 5h 10% 7d 85% │ ⚑2 │ ⓘ ')
  expect(layoutBand(quotaSlots(q), 119).text).toBe('● 進行中 │ ●1 │ 7d 85% │ ⚑2 │ ⓘ ')
  expect(layoutBand(quotaSlots(q), 79).text).toBe('● 進行中 │ ●1 │ ⚑2 │ ⓘ ')
  expect(slotTab('quota')).toBe('spend') // the quota slot opens 用量 (P3), no longer 現況
  expect(slotUnfolds('quota')).toBe(SECTION.limits)
})

test('quota slot: a band still too long drops the quota windows before the ⊘ / ● counts; the spend window is `cap`, never `$`', () => {
  const slots = (word: string) => bandSlots({
    verdict: { mark: '●', word, key: 'suggestion' }, marker: null, live: 12, stalled: 3, review: null, qc: null, decisions: null, spend: null,
    loadSource: null, residue: null, quota: [win('five_hour', 10), win('seven_day', 85)], nowMs: 0,
  })
  const fits = layoutBand(slots('w'.repeat(60)), 100).text
  expect(fits).toContain('●12 ⊘3 │ 7d 85% │ ⓘ ')
  const tight = layoutBand(slots('w'.repeat(76)), 100).text // 102 cells: one step over; dropping ⊘3 alone would fit (99), so the old order kept the quota
  expect(tight).toContain('●12 ⊘3 │ ⓘ ')
  expect(tight).not.toContain('85%')
  expect(displayWidth(tight)).toBeLessThanOrEqual(100)
  expect((slotQuota([win('spend_limit', 30)]) as Slot).segs.map(g => g.text).join('')).toBe('cap 30%')
  // the quota goes before the stage text is cut
  const staged = (q: QuotaWindow[] | null) => bandSlots({
    verdict: { mark: '●', word: '進行中', key: 'suggestion' }, marker: readMarker({ size: 'M', level: 'l5', stage: 'implement-' + 'x'.repeat(100), stage_set_at: '2026-10-04T09:57:30.000Z' }),
    live: 1, stalled: 0, review: null, qc: null, decisions: null, spend: null, loadSource: null, residue: null, quota: q, nowMs: Date.parse('2026-10-04T10:00:30.000Z'),
  })
  expect(layoutBand(staged([win('five_hour', 10)]), 125).text).toBe(layoutBand(staged(null), 125).text)
  expect(layoutBand(staged([win('five_hour', 10)]), 209).text).toContain(' │ 5h 10% │ ')
})

test('quota slot: a window is plain below 80 %, warning from 80 %, error from 100 %; the label stays dim', () => {
  const colorOf = (pct: number) => (slotQuota([win('five_hour', pct)]) as Slot).segs.find(s => s.text.endsWith('%'))?.color
  expect([colorOf(79.9), colorOf(80), colorOf(99.9), colorOf(100), colorOf(130)]).toEqual([undefined, 'warning', 'warning', 'error', 'error'])
  // the text is floored, so it agrees with the colour: 79.9 is an uncoloured 79%, 99.9 a warning 99%, never 100% before the limit
  const textOf = (pct: number) => (slotQuota([win('five_hour', pct)]) as Slot).segs.map(g => g.text).join('')
  expect([textOf(79.9), textOf(80), textOf(99.9), textOf(100)]).toEqual(['5h 79%', '5h 80%', '5h 99%', '5h 100%'])
  const tabLine = spendTabLines(usageSnap({ account: undefined, quota: [win('five_hour', 79.9)] }), { t: makeT('en'), cols: 120 }).find(l => l.kind === 'meter') as { text: string; segs: { text: string; color?: string }[] }
  expect(tabLine.text).toContain(' 79%')
  expect(tabLine.text).not.toContain('80%')
  expect(tabLine.segs.find(s => s.text.endsWith('79%'))?.color).toBeUndefined() // the tab's meter judges the raw ratio too: 79.9 is not yet a warning
  expect((slotQuota([win('five_hour', 42)]) as Slot).segs[0]).toMatchObject({ text: '5h ', dim: true })
})

for (const locale of ['en', 'zh-TW'] as const) {
  for (const cols of [48, 120]) {
    test('usage tab: 帳號 lists account, organization and plan, 額度 each window as a meter with its reset time, every row fits (' + locale + ', ' + cols + ' columns)', () => {
      const t = makeT(locale)
      const snap: AccountSnap = { account: readAccount(CLAUDE_JSON), quota: readQuota([...USAGE.rateLimits, { kind: 'spend_limit', percentUsed: 104 }]) }
      const lines = spendTabLines(usageSnap(snap), { t, cols })
      const text = lines.map(l => l.text).join('\n')
      expect(lines.some(l => l.text.startsWith('▾ ' + t('now.account')))).toBe(true)
      expect(lines.some(l => l.text.startsWith('▾ ' + t('usage.limits')))).toBe(true)
      expect(text).toContain('owner@example.com (Owner)')
      expect(text).toContain('Example Co · admin')
      expect(text).toContain('claude max · 20x · ' + t('account.extra_on'))
      expect(text).toContain(t('label.quota_5h'))
      expect(text).toContain('42%')
      expect(text).toContain(t('ui.reset', { age: '2h30m' })) // the formatter's duration, then the string table's direction word
      expect(text).toContain(t('label.quota_7d'))
      expect(text).toContain('104%')
      const meters = lines.filter(l => l.kind === 'meter')
      expect(meters.length).toBe(3) // 5h, 7d, spend_limit: one meter row each, nothing else is a limit row
      expect(meters.map(l => l.fact)).toEqual(['usage.window5h', 'usage.window7d', 'usage.window_other'])
      expect(new Set(meters.map(l => (l.segs ?? []).filter(s => s.role === 'glyph').map(s => s.text).join('').length)).size).toBe(1) // equal bar length: the rows compare by length
      // the account is one fact: all of it on one row where it fits (the §5.4 120-column form), else one row each
      const account = lines.filter(l => l.fact === 'usage.account')
      expect(account.length).toBe(cols === 120 ? 1 : 3)
      for (const l of lines) expect(displayWidth(l.text), l.text).toBeLessThanOrEqual(cols)
    })
  }
}

test('usage tab: an API-key login is one absent row; no account read is one empty line; no windows and no spend is one empty line; folded shows the heading alone', () => {
  const t = makeT('zh-TW')
  const cols = 120
  const none = spendTabLines(usageSnap({ account: null, quota: [] }), { t, cols })
  expect(none.find(l => l.fact === 'usage.account')?.text.trim()).toBe(t('label.account') + '        — ' + t('account.none'))
  const unread = spendTabLines(usageSnap({ account: undefined, quota: [] }), { t, cols })
  expect(unread.filter(l => l.kind === 'empty').map(l => l.text)).toContain('— ' + t('nodata.account'))
  expect(unread.filter(l => l.kind === 'empty' && l.fact === 'usage.brain').length).toBe(1) // limits: exactly one empty line, not one per missing source
  expect(spendTabLines(usageSnap(undefined), { t, cols }).filter(l => l.kind === 'empty').length).toBe(4) // limits, today, last 24 h, account
  // windows without a readable file still show; a reset time already past or an unknown clock shows none
  const resets = t('ui.reset', { age: 'X' }).replace('X', '').trim()
  const meterOf = (quota: QuotaWindow[], now: number | null) => (spendTabLines({ ...(usageSnap({ account: undefined, quota }) as object), detail: { counts: null, stalled: 0, now_ms: now, spend: null } } as never, { t, cols }).find(l => l.kind === 'meter') as { text: string })
  expect(meterOf([{ kind: 'five_hour', pct: 5, resetsAtMs: NOW_FRESH + 60000 }], NOW_FRESH).text).toContain(resets)
  expect(meterOf([{ kind: 'five_hour', pct: 5, resetsAtMs: NOW_FRESH - 1 }], NOW_FRESH).text).not.toContain(resets)
  expect(meterOf([{ kind: 'five_hour', pct: 5, resetsAtMs: NOW_FRESH + 60000 }], null).text).not.toContain(resets)
  const folded = spendTabLines(usageSnap({ account: null, quota: [] }), { t, cols, folded: new Set([SECTION.account]) })
  expect(folded.filter(l => l.fact === 'usage.account').length).toBe(0)
  expect(folded.some(l => l.text.startsWith('▸ ' + t('now.account')))).toBe(true)
})

test('usage tab: the limits chip names the worst level; a window over its cap makes it 已超過, and the meter bar and percent take the level colour', () => {
  const t = makeT('zh-TW')
  const chipOf = (pct: number) => (spendTabLines(usageSnap({ account: undefined, quota: [win('five_hour', pct)] }), { t, cols: 76 }).find(l => l.kind === 'header' && l.text.startsWith('▾ ' + t('usage.limits'))) as { segs: { text: string; color?: string }[] }).segs.find(s => s.role === 'value')
  expect([chipOf(10), chipOf(79.9), chipOf(80), chipOf(100)].map(c => [c?.text, c?.color])).toEqual([[t('spend.ok'), undefined], [t('spend.ok'), undefined], [t('spend.warn'), 'warning'], [t('spend.over'), 'error']])
})

for (const surface of SURFACES) {
  test('account: the band shows the windows and the Usage tab the account; ~/.claude.json is read again only when it changed; pressing the slot opens Usage (' + surface + ')', async ($, on) => {
    const t = makeT('zh-TW')
    const PATH = HOME + '/.claude.json'
    let usage: unknown = USAGE
    const w = world(on, { ...base(), [PATH]: CLAUDE_JSON })
    w.stats[PATH] = { size: CLAUDE_JSON.length, mtimeMs: NOW_FRESH - 60000 }
    on('session.usage', () => {
      if (usage === null) throw new Error('no reading')
      return { value: usage }
    })
    await start($, surface)
    expect((await bandLine($, surface, 120)).text).toContain('5h 42% 7d 18%')
    const narrow = (await bandLine($, surface, 100)).text
    expect(narrow).toContain('5h 42%')
    expect(narrow).not.toContain('7d')
    const body = async () => (await paneParts($, surface, 'spend')).texts.join('\n')
    let b = await body()
    expect((await paneParts($, surface, 'now')).texts.join('\n')).not.toContain('owner@example.com') // Now no longer shows the account (I16)
    expect(b).toContain(t('now.account'))
    expect(b).toContain('owner@example.com (Owner)')
    expect(b).toContain('Example Co · admin')
    const reads = () => w.reads.filter(p => p === PATH).length
    const before = reads()
    expect(before).toBe(1)
    // unchanged size and mtime: not read again; a usage() that throws keeps the last windows
    usage = null
    await w.clock.advance(5000)
    expect(reads()).toBe(before)
    expect((await bandLine($, surface, 120)).text).toContain('5h 42% 7d 18%')
    // Claude Code rewrote the file (half a JSON) 10 s after the first parse: left alone until 30 s have passed since that parse,
    // then read, ignored, the account stays; a failed parse starts no interval, so the next tick reads again
    w.files[PATH] = CLAUDE_JSON.slice(0, 50)
    w.stats[PATH] = { size: 50, mtimeMs: NOW_FRESH }
    await w.clock.advance(5000)
    expect(reads()).toBe(before)
    await w.clock.advance(20000)
    expect(reads()).toBe(before + 1)
    expect(await body()).toContain('owner@example.com')
    await w.clock.advance(5000)
    expect(reads()).toBe(before + 2)
    const other = CLAUDE_JSON.replace('owner@example.com', 'second@example.com')
    w.files[PATH] = other
    w.stats[PATH] = { size: other.length, mtimeMs: NOW_FRESH + 1 }
    usage = { ...USAGE, rateLimits: [{ kind: 'five_hour', percentUsed: 91 }] }
    await w.clock.advance(5000)
    b = await body()
    expect(b).toContain('second@example.com')
    expect((await bandLine($, surface, 120)).text).toContain('5h 91%')
    // fold the Limits section, then press the slot: the Usage tab opens with the section unfolded
    const mountPane = () => $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-live', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
    const rowsNow = async () => { const q = await mountPane(); await q.press({ key: 'spend' }); await q.unmount(); const p = await mountPane(); const r = rowsOf((await p.drawn()) as Node); await p.unmount(); return r }
    const at = (await rowsNow()).findIndex(r => r.startsWith('▾ ' + t('usage.limits')))
    expect(at).toBeGreaterThanOrEqual(0)
    const fold = await mountPane()
    await fold.press({ key: 'b' + at })
    await fold.unmount()
    expect((await rowsNow())[at].startsWith('▸ ' + t('usage.limits'))).toBe(true)
    expect((await rowsNow()).join('\n')).not.toContain('91%')
    const elsewhere = await mountPane()
    await elsewhere.press({ key: 'dispatch' })
    await elsewhere.unmount()
    const band = await $.ui.mount({ plugin: 'autopilot', surface, component: 'AbovePrompt', props: { ...BAND_PROPS, bodyColumns: 209 }, viewport: { columns: 209, rows: 50, isFullscreen: true } })
    await band.press({ key: 'quota' })
    await band.unmount()
    const pane = await mountPane()
    const active = (await activeKeyOf(pane))
    await pane.unmount()
    expect(active).toBe('spend')
    expect((await rowsNow()).join('\n')).toContain('second@example.com')
    // stat refused while the file is still there (a permission or passing I/O error): the account stays, nothing is read
    w.statErrors[PATH] = "EACCES: permission denied, lstat '" + PATH + "'"
    const refused = reads()
    await w.clock.advance(5000)
    expect(reads()).toBe(refused)
    expect(await body()).toContain('second@example.com')
    // the file is gone but exists() itself rejects: no way to tell, the account stays
    delete w.files[PATH]
    delete w.stats[PATH]
    w.statErrors[PATH] = "ENOENT: no such file or directory, lstat '" + PATH + "'"
    w.existsThrows.add(PATH)
    await w.clock.advance(5000)
    expect(await body()).toContain('second@example.com')
    // the file is gone (logged out, another HOME): the account leaves, the windows stay
    w.existsThrows.delete(PATH)
    await w.clock.advance(5000)
    b = await body()
    expect(b).not.toContain('second@example.com')
    expect(b).toContain(t('label.quota_5h'))
    // back, then grown over $.fs.read's 4 MiB cap: not read, and no stale account either
    delete w.statErrors[PATH]
    w.files[PATH] = other
    w.stats[PATH] = { size: other.length, mtimeMs: NOW_FRESH + 2 }
    await w.clock.advance(5000)
    expect(await body()).toContain('second@example.com')
    // exactly at the cap: still read, once the interval is up
    w.stats[PATH] = { size: 4 * 1024 * 1024, mtimeMs: NOW_FRESH + 3 }
    const atCap = reads()
    await w.clock.advance(30000)
    expect(reads()).toBe(atCap + 1)
    w.stats[PATH] = { size: 4 * 1024 * 1024 + 1, mtimeMs: NOW_FRESH + 4 }
    const capped = reads()
    await w.clock.advance(5000)
    expect(reads()).toBe(capped)
    expect(await body()).not.toContain('@example.com')
  })
}

test('account: with CLAUDE_CONFIG_DIR set the account comes from that directory, not HOME', async ($, on) => {
  const moved = CLAUDE_JSON.replace('owner@example.com', 'moved@example.com')
  const w = world(on, { ...base(), [HOME + '/.claude.json']: CLAUDE_JSON, ['/cfg/.claude.json']: moved }, NOW_FRESH, SID_A, 'zh-TW', { CLAUDE_CONFIG_DIR: '/cfg/' })
  w.stats[HOME + '/.claude.json'] = { size: CLAUDE_JSON.length, mtimeMs: NOW_FRESH - 60000 }
  w.stats['/cfg/.claude.json'] = { size: moved.length, mtimeMs: NOW_FRESH - 60000 }
  await start($, 'terminal')
  const body = async () => (await paneParts($, 'terminal', 'spend')).texts.join('\n')
  const b = await body()
  expect(b).toContain('moved@example.com')
  expect(b).not.toContain('owner@example.com')
  expect(w.reads).not.toContain(HOME + '/.claude.json')
  // the variable changes mid-session to a directory whose file has the same size and mtime: read at once, not taken for the cached one
  const again = CLAUDE_JSON.replace('owner@example.com', 'again@example.com')
  w.files['/cfg2/.claude.json'] = again
  w.stats['/cfg2/.claude.json'] = { size: moved.length, mtimeMs: NOW_FRESH - 60000 }
  w.env.CLAUDE_CONFIG_DIR = '/cfg2'
  await w.clock.advance(5000)
  expect(await body()).toContain('again@example.com')
  // a third directory whose file is half written: no account rather than the previous directory's
  w.files['/cfg3/.claude.json'] = again.slice(0, 50)
  w.stats['/cfg3/.claude.json'] = { size: 50, mtimeMs: NOW_FRESH }
  w.env.CLAUDE_CONFIG_DIR = '/cfg3'
  await w.clock.advance(5000)
  expect(await body()).not.toContain('@example.com')
  // set but empty: HOME
  w.env.CLAUDE_CONFIG_DIR = ''
  await w.clock.advance(5000)
  expect(await body()).toContain('owner@example.com')
})

// ---- P4 (live-pane plan §7): the mounted halves of I9 (b), I18 (tasks and background `more`) and the full I19 (every summary row calls onTab) ----
const mountOn = ($: any, surface: (typeof SURFACES)[number], props: object = PANE_PROPS) => $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-live', props, viewport: { columns: 160, rows: 50, isFullscreen: true } })
// the Now tab's body rows, drawn fresh (the host draws again after every press: a press only sets state)
const nowRows = async ($: any, surface: (typeof SURFACES)[number]): Promise<string[]> => (await paneParts($, surface, 'now')).texts
const pressAt = async ($: any, surface: (typeof SURFACES)[number], key: string) => {
  const first = await mountOn($, surface)
  await first.press({ key: 'now' })
  await first.unmount()
  const pane = await mountOn($, surface)
  await pane.press({ key })
  await pane.unmount()
}

for (const surface of SURFACES) {
  test('P4 mounted (I9 b): the global header lines are byte-identical on all seven tabs, and the header is drawn above the body (' + surface + ')', async ($, on) => {
    world(on, richWorld())
    await start($, surface)
    // bodyRows 8 puts every tab over its window, so every header carries its own overflow hint. `pane.overflow` is EXCLUDED from the comparison: it is each tab's own
    // scroll state (how many rows lie below THIS tab's tree), not a fact of the session; everything else in the header must be byte-identical.
    const OVERFLOW = /下方還有 (\d+) 行/
    const rawHeads: string[][] = []
    for (const tab of ['now', 'dispatch', 'review', 'spend', 'hygiene', 'legend']) rawHeads.push((await paneParts($, surface, tab, PANE_PROPS.bodyColumns, { offset: 0, bodyRows: 8 })).head)
    const heads = rawHeads.map(h => h.map(l => l.replace(OVERFLOW, (_m, d: string) => " ".repeat(12 + d.length)).trimEnd())) // the hint is 12 + digits cells wide
    expect(heads[0].length, 'the header has a verdict line and the blank under it').toBeGreaterThanOrEqual(2)
    expect(heads[0][0]).toContain('⊘ 疑似卡住  repo')
    expect(heads[0].join('\n')).toContain('工作階段 $0.42 · 本機今日 $3.10 · ctx 37%')
    expect(heads[0][heads[0].length - 1]).toBe('')
    heads.forEach((h, i) => expect(h, 'tab ' + i).toEqual(heads[0]))
    // the hint is the ONLY difference: every raw header carries exactly one, and the raw headers differ from one another (different tree heights)
    rawHeads.forEach((h, i) => expect(h.filter(l => OVERFLOW.test(l)).length, 'tab ' + i + ' has one hint').toBe(1))
    expect(new Set(rawHeads.map(h => h.join('\n'))).size, 'the hints differ per tab, so the exclusion is exercised').toBeGreaterThan(1)
    // negative control: the comparison sees one byte of difference
    expect(JSON.stringify(heads[0].map((l, i) => (i === 0 ? l + ' ' : l)))).not.toBe(JSON.stringify(heads[1]))
  })

  test('P4 mounted (I18): the tasks `more` row lists the finished tasks, pressing it again restores the default (' + surface + ')', async ($, on) => {
    const files = base()
    files[P_TASKS()] = j(tasksFile())
    world(on, files)
    await start($, surface)
    const before = await nowRows($, surface)
    expect(before.some(x => x.includes('寫測試')), 'the completed task is not listed by default').toBe(false)
    const at = before.findIndex(x => x.includes('1 項已完成'))
    expect(at, before.join('\n')).toBeGreaterThanOrEqual(0)
    await pressAt($, surface, 'b' + at)
    const opened = await nowRows($, surface)
    expect(opened.some(x => x.includes('寫測試')), 'pressed: exactly the hidden task appears').toBe(true)
    expect(opened.length).toBe(before.length + 1)
    await pressAt($, surface, 'b' + at)
    expect(await nowRows($, surface)).toEqual(before)
  })

  test('P4 mounted (I18): the background `more` row lists the ended items, pressing it again restores the default (' + surface + ')', async ($, on) => {
    const w = world(on, { ...base(), [BG_OUT]: 'building\n[exited with code 0]\n' })
    w.stats[BG_OUT] = { size: 30, mtimeMs: NOW_FRESH - 5000 }
    on('session.messages', () => ({ value: [U('跑全套'), A('', [bgUse('bqd50316d')])] }))
    await start($, surface)
    const before = await nowRows($, surface)
    expect(before.some(x => x.includes('full suite')), 'an ended item is not listed by default').toBe(false)
    const at = before.findIndex(x => x.includes('1 項已結束'))
    expect(at, before.join('\n')).toBeGreaterThanOrEqual(0)
    await pressAt($, surface, 'b' + at)
    const opened = await nowRows($, surface)
    expect(opened.some(x => x.startsWith('✓ 完成') && x.includes('full suite')), opened.join('\n')).toBe(true)
    await pressAt($, surface, 'b' + at)
    expect(await nowRows($, surface)).toEqual(before)
  })

  test('P4 mounted (I19): pressing every summary row and the residue item calls onTab with its tab; pressing a header flips its fold; defaults equal SECTION_DEFAULTS (' + surface + ')', async ($, on) => {
    world(on, richWorld())
    await start($, surface)
    const activeAfter = async (key: string): Promise<string> => {
      await pressAt($, surface, key)
      const pane = await mountOn($, surface)
      const active = (await activeKeyOf(pane)) as string
      await pane.unmount()
      return active
    }
    const rows = await nowRows($, surface)
    const targets: [string, string][] = [['派工 ›', 'dispatch'], ['審查 ›', 'review'], ['用量 ›', 'spend'], ['殘留 ›', 'hygiene']]
    for (const [prefix, tab] of targets) {
      const at = rows.findIndex(r => r.startsWith(prefix))
      expect(at, prefix).toBeGreaterThanOrEqual(0)
      expect(await activeAfter('g' + at), prefix).toBe(tab)
    }
    const residueItem = rows.findIndex(r => r.startsWith('▲ ') && r.includes('worktree') && r.trimEnd().endsWith('殘留 ›'))
    expect(residueItem, rows.join('\n')).toBeGreaterThanOrEqual(0)
    expect(await activeAfter('g' + residueItem)).toBe('hygiene')
    // folds: every header starts as SECTION_DEFAULTS says, and a press flips it and a second press restores it
    const heads = (rs: string[]) => rs.map((r, i) => ({ r, i })).filter(x => /^[▾▸] \S/.test(x.r))
    const start0 = heads(await nowRows($, surface))
    expect(start0.length).toBeGreaterThanOrEqual(5)
    for (const h of start0) {
      const folded = h.r.startsWith('▸')
      const wantFolded = h.r.includes('最近對話') // SECTION_DEFAULTS: 現況's history starts folded, nothing else does
      expect(folded, h.r).toBe(wantFolded)
    }
    expect(start0[0].r.startsWith('▾ 要你處理'), '要你處理 starts open').toBe(true)
    const before = await nowRows($, surface)
    await pressAt($, surface, 'b' + start0[0].i)
    const flipped = await nowRows($, surface)
    expect(flipped[start0[0].i].startsWith('▸ 要你處理')).toBe(true)
    await pressAt($, surface, 'b' + start0[0].i)
    expect(await nowRows($, surface)).toEqual(before)
  })
}

// ---- P5 (live-pane plan §7): the mounted I18 / I19 / I23 for the residue toggles ----
for (const surface of SURFACES) {
  const hyg = async ($: any, cols?: number): Promise<string[]> => (await paneParts($, surface, 'hygiene', cols)).texts
  test('P5 mounted (I18): every residue entry is read where it stands: name, reason and command on screen by default, nothing to press open (' + surface + ')', async ($, on) => {
    world(on, richWorld())
    await start($, surface)
    const out = await hyg($)
    expect(out.some(t => t.startsWith('▲ hands-x') && t.trimEnd().endsWith('4d04h · 2.0 MB')), out.join('\n')).toBe(true)
    expect(out).toContain('  有沒提交的檔案，先看內容再決定要不要刪')
    expect(out.some(t => t.startsWith('  $ git -C /home/u/proj worktree remove --force')), 'the command sits under its own entry').toBe(true)
    expect(out.some(t => t.startsWith('▲ feature/old')), 'a branch is named by the branch').toBe(true)
    expect(out.some(t => t.startsWith('◦ hands-old') && t.trimEnd().endsWith('9d · 1.0 MB')), 'the cleanable entry is a neutral row in its own section').toBe(true)
    const sectionOf = (name: string) => out.findIndex(t => t.startsWith('▾ ' + name))
    expect(sectionOf('要你處理')).toBeLessThan(out.findIndex(t => t.startsWith('▲ hands-x')))
    expect(out.findIndex(t => t.startsWith('◦ hands-old'))).toBeGreaterThan(sectionOf('可以直接清掉'))
    expect(out.some(t => /[▸▾]$/.test(t.trimEnd()) && !/^[▸▾] /.test(t)), 'no row carries a fold mark at its right edge').toBe(false)
  })

  test('P5 mounted (I19): each residue section header flips its fold and a second press restores it; the default is SECTION_DEFAULTS (' + surface + ')', async ($, on) => {
    world(on, richWorld())
    await start($, surface)
    const first = await hyg($)
    const heads = first.filter(t => /^[▾▸] \S/.test(t))
    expect(heads.length).toBe(4)
    for (const h of heads) expect(h.startsWith('▾'), 'residue sections start open: ' + h).toBe(true)
    for (const prefix of ['▾ 要你處理', '▾ 可以直接清掉', '▾ 自動清理', '▾ 外掛來源']) {
      await pressRow($, surface, 'hygiene', t => t.startsWith(prefix))
      const folded = await hyg($)
      expect(folded.some(t => t.startsWith('▸' + prefix.slice(1))), prefix).toBe(true)
      expect(folded.length, prefix).toBeLessThan(first.length)
      await pressRow($, surface, 'hygiene', t => t.startsWith('▸' + prefix.slice(1)))
      expect(await hyg($), prefix).toEqual(first)
    }
  })

  test('P5 mounted (I23 golden): the 殘留 tab at 76 columns (' + surface + ')', async ($, on) => {
    world(on, richWorld())
    await start($, surface)
    expect(await hyg($, 76)).toEqual(HYGIENE_GOLDEN_76)
  })

  // The cleanup buttons run the one safe entry point (a stub here: nothing is deleted, no real store is touched), only for a worktree the snapshot lists as clearable.
  const HAND_OLD = '/home/u/proj/.claude/worktrees/hands-old'
  const cleanWorld = (on: any, $: any, report: string, more: Record<string, string> = {}) => {
    const files = { ...richWorld(), ...more } // the plugin root is the engine's: any path ending in the sweep script exists as a stub (the real script is never run)
    const w = world(on, new Proxy(files, { get: (t, k) => (typeof k === 'string' && k.endsWith('/scripts/repo-residue-sweep.js') ? '// stub' : (t as any)[k]) }))
    const ran: string[] = []
    on('process.run', ($$: any, e: any) => { ran.push((e.argv as string[]).join(' ')); return { value: { exitCode: 0, stdout: report, stderr: '' } } })
    return { w, ran, files }
  }
  const pressKeys = async ($: any) => {
    const pane = await paneOn($, surface, 'hygiene')
    const keys = ((await pane.findAll({ type: 'Button' })) as Drawn[]).map(n => n.props?.key as string)
    await pane.unmount()
    return keys
  }
  test('P5 mounted cleanup: the entry has a button and no command; pressing it runs reap --yes for that worktree only and the row says cleared (' + surface + ')', async ($, on) => {
    const { ran } = cleanWorld(on, $, JSON.stringify({ actions: { worktrees_removed: [{ path: HAND_OLD, class: 'clean-integrated' }], worktrees_kept: [] } }))
    await start($, surface)
    const before = await hyg($, 76)
    const cleanable = before.slice(before.findIndex(t => t.startsWith('▾ 可以直接清掉')), before.findIndex(t => t.startsWith('▾ 自動清理')))
    expect(cleanable.some(t => t.startsWith('  $ ')), 'no command under a cleanable entry').toBe(false)
    expect(cleanable).toContain('  [ 清掉 ]')
    expect(before.filter(t => t.startsWith('  $ ')).length, 'the entries to judge keep their commands').toBeGreaterThan(0)
    expect(await pressKeys($)).toContain('clean:' + HAND_OLD)
    const pane = await paneOn($, surface, 'hygiene')
    await pane.press({ key: 'clean:' + HAND_OLD })
    await pane.unmount()
    expect(ran.length).toBe(1)
    expect(ran[0]).toContain('repo-residue-sweep.js reap --repo ')
    expect(ran[0]).toMatch(/^node \S+\/scripts\/repo-residue-sweep\.js reap /)
    expect(ran[0]).toContain(' --yes ')
    expect(ran[0]).toContain('--worktree ' + HAND_OLD)
    const after = await hyg($, 76)
    expect(after).toContain('  已清掉')
    expect(after).not.toContain('  [ 清掉 ]')
  })
  test('P5 mounted cleanup: an unused old cache copy has a button; the press runs prune-plugin-cache.js for that version, and a busy one has none (' + surface + ')', async ($, on) => {
    const CACHE = '/home/u/.claude/plugins/cache/autopilot/autopilot/2.36.36'
    const files = richWorld()
    files[LIVE + '/load-source.json'] = j({ schema: 'autopilot.load-source/1', checked_at: PUBLISHED, plugin_version: '2.37.0', source: 'dev', source_basis: 'dev_link', marketplace: 'directory', behind_upstream: 0, flags: ['stale_cache_dirs'],
      stale_cache_dirs: [{ dir: CACHE, in_use_pids: [], alive: [] }, { dir: '/home/u/.claude/plugins/cache/autopilot/autopilot/2.36.35', in_use_pids: ['9'], alive: ['9'] }] })
    world(on, new Proxy(files, { get: (t, k) => (typeof k === 'string' && k.endsWith('/scripts/prune-plugin-cache.js') ? '// stub' : (t as any)[k]) }))
    const ran: string[] = []
    on('process.run', ($$: any, e: any) => { ran.push((e.argv as string[]).join(' ')); return { value: { exitCode: 0, stdout: JSON.stringify({ ok: true, dir: CACHE, removed: true }), stderr: '' } } })
    await start($, surface)
    expect((await pressKeys($)).filter(k => k.includes('/cache/'))).toEqual(['clean:' + CACHE])
    const pane = await paneOn($, surface, 'hygiene')
    await pane.press({ key: 'clean:' + CACHE })
    await pane.unmount()
    expect(ran.length).toBe(1)
    expect(ran[0]).toContain('prune-plugin-cache.js --version 2.36.36 --claude-dir /home/u/.claude')
    expect((await hyg($, 76)).some(t => t.includes('rm -rf'))).toBe(false)
  })
  test('P5 mounted cleanup: a path the report neither removed nor kept is not called cleared while its directory is still there (' + surface + ')', async ($, on) => {
    const { ran } = cleanWorld(on, $, JSON.stringify({ actions: { worktrees_removed: [], worktrees_kept: [] } }), { [HAND_OLD]: 'dir' })
    await start($, surface)
    const pane = await paneOn($, surface, 'hygiene')
    await pane.press({ key: 'clean:' + HAND_OLD })
    await pane.unmount()
    expect(ran.length).toBe(1)
    const after = await hyg($, 76)
    expect(after).not.toContain('  已清掉')
    expect(after.some(t => t.includes('沒清掉：the cleanup script did not handle this path'))).toBe(true)
    expect(after.some(t => t.startsWith('  $ git -C /home/u/proj worktree remove'))).toBe(true)
  })
  test('P5 mounted cleanup: the sweep runs under the repository the worktree belongs to; a worktree of another repository is not run (' + surface + ')', async ($, on) => {
    const own = cleanWorld(on, $, JSON.stringify({ actions: { worktrees_removed: [{ path: HAND_OLD }], worktrees_kept: [] } }), { '/work/repo/.git/HEAD': 'ref: refs/heads/main\n', [HAND_OLD + '/.git']: 'gitdir: /work/repo/.git/worktrees/hands-old\n' })
    await start($, surface)
    const pane = await paneOn($, surface, 'hygiene')
    await pane.press({ key: 'clean:' + HAND_OLD })
    await pane.unmount()
    expect(own.ran.length).toBe(1)
    expect(own.ran[0]).toContain(' reap --repo /work/repo --yes ')
  })
  test('P5 mounted cleanup: negative control, a worktree whose checkout belongs to another repository is not run and says so (' + surface + ')', async ($, on) => {
    const { ran } = cleanWorld(on, $, '{}', { '/work/repo/.git/HEAD': 'ref: refs/heads/main\n', [HAND_OLD + '/.git']: 'gitdir: /other/repo/.git/worktrees/hands-old\n' })
    await start($, surface)
    const pane = await paneOn($, surface, 'hygiene')
    await pane.press({ key: 'clean:' + HAND_OLD })
    await pane.unmount()
    expect(ran).toEqual([])
    expect((await hyg($, 76)).some(t => t.includes('沒清掉：this worktree belongs to another repository'))).toBe(true)
  })
  test('P5 mounted cleanup: 全部清掉 leaves out what a press already cleared (no second run, no "no such cache copy") (' + surface + ')', async ($, on) => {
    const C1 = '/home/u/.claude/plugins/cache/autopilot/autopilot/2.36.35'
    const C2 = '/home/u/.claude/plugins/cache/autopilot/autopilot/2.36.36'
    const files = richWorld()
    files[LIVE + '/load-source.json'] = j({ schema: 'autopilot.load-source/1', checked_at: PUBLISHED, plugin_version: '2.37.0', source: 'dev', source_basis: 'dev_link', marketplace: 'directory', behind_upstream: 0, flags: ['stale_cache_dirs'],
      stale_cache_dirs: [{ dir: C1, in_use_pids: [], alive: [] }, { dir: C2, in_use_pids: [], alive: [] }] })
    world(on, new Proxy(files, { get: (t, k) => (typeof k === 'string' && /\/scripts\/(repo-residue-sweep|prune-plugin-cache)\.js$/.test(k) ? '// stub' : (t as any)[k]) }))
    const ran: string[] = []
    on('process.run', ($$: any, e: any) => { const a = (e.argv as string[]).join(' '); ran.push(a); return { value: { exitCode: 0, stdout: a.includes('prune-plugin-cache') ? JSON.stringify({ ok: true }) : JSON.stringify({ actions: { worktrees_removed: [{ path: HAND_OLD }], worktrees_kept: [] } }), stderr: '' } } })
    await start($, surface)
    let pane = await paneOn($, surface, 'hygiene')
    await pane.press({ key: 'clean:' + HAND_OLD })
    await pane.unmount()
    expect(ran.length).toBe(1)
    expect((await hyg($, 76))[0]).toBe('  [ 全部清掉（2 項） ]') // the same count the press will act on
    pane = await paneOn($, surface, 'hygiene')
    await pane.press({ key: 'clean:all' })
    await pane.unmount()
    expect(ran.length, 'one more run per cache copy, none for the worktree again').toBe(3)
    expect(ran.filter(a => a.includes('repo-residue-sweep')).length).toBe(1)
    expect(ran.filter(a => a.includes('--version 2.36.35')).length + ran.filter(a => a.includes('--version 2.36.36')).length).toBe(2)
    expect((await hyg($, 76)).filter(t => t === '  已清掉').length).toBe(3)
  })
  test('P5 mounted cleanup: a worktree the sweep kept says why and then shows the command; a judged entry has no button (negative control) (' + surface + ')', async ($, on) => {
    const { ran } = cleanWorld(on, $, JSON.stringify({ actions: { worktrees_removed: [], worktrees_kept: [{ path: HAND_OLD, class: 'clean-integrated', why: 'worktree remove failed: busy' }] } }), { [HAND_OLD]: 'dir' })
    await start($, surface)
    expect((await pressKeys($)).filter(k => k.startsWith('clean:')), 'only the clearable worktree has a button').toEqual(['clean:' + HAND_OLD])
    const pane = await paneOn($, surface, 'hygiene')
    expect(ran).toEqual([])
    await pane.press({ key: 'clean:' + HAND_OLD })
    await pane.unmount()
    expect(ran.length).toBe(1)
    const after = await hyg($, 76)
    expect(after.some(t => t.includes('沒清掉：worktree remove failed: busy'))).toBe(true)
    expect(after.some(t => t.startsWith('  $ git -C /home/u/proj worktree remove /home/u/proj/.claude/worktrees/'))).toBe(true)
  })
}

// ---- the overflow hint (coordinator ruling 2026-10-14): `下方還有 N 行` on the header's last metrics line while the window is at the top over a taller tree ----
for (const surface of SURFACES) {
  test('P4 hint: N equals the rows the tree really has beyond bodyRows, on every tab; none when the tree fits, none once scrolled (' + surface + ')', async ($, on) => {
    world(on, richWorld())
    await start($, surface)
    const HINT = /下方還有 (\d+) 行/
    for (const tab of ['now', 'dispatch', 'review', 'spend', 'hygiene', 'legend']) {
      // the tree's real height: the tab strip (one row of tabs + its rule at 120 columns) plus every other child of the pane's column Box, one row each
      const tree = (await paneParts($, surface, tab)).tree
      const total = 2 + ((tree.children || []) as Node[]).slice(1).filter(k => textOf(k) !== '' || k.type === 'Link').length // drawn rows, not elements: an empty Text takes no row, a Link does
      const hintOf = async (scroll: { offset: number; bodyRows: number }): Promise<number | null> => {
        const line = (await paneParts($, surface, tab, PANE_PROPS.bodyColumns, scroll)).head.find(l => HINT.test(l))
        const m = line === undefined ? null : HINT.exec(line)
        return m === null ? null : Number(m[1])
      }
      expect(await hintOf({ offset: 0, bodyRows: total }), tab + ': a tree exactly the window high has no hint').toBeNull()
      expect(await hintOf({ offset: 0, bodyRows: total - 1 }), tab + ': one row taller than the window says 1').toBe(1)
      expect(await hintOf({ offset: 0, bodyRows: 5 }), tab + ': N = tree rows - bodyRows').toBe(total - 5)
      expect(await hintOf({ offset: 3, bodyRows: 5 }), tab + ': the header has scrolled away, so no hint').toBeNull()
    }
  })

  test('P4 hint: the hint ends the last metrics line and is dropped, not squeezed, when it does not fit (' + surface + ')', async ($, on) => {
    world(on, richWorld())
    await start($, surface)
    const wide = (await paneParts($, surface, 'now', 120, { offset: 0, bodyRows: 5 })).head
    // wide (the one-line header, already as wide as the pane): the hint sits in the blanks before the metrics, which do not move
    expect(wide.some(l => /^⊘ 疑似卡住  repo · 已進行 10m +下方還有 \d+ 行 +工作階段 \$0\.42 · 本機今日 \$3\.10 · ctx 37%$/.test(l)), wide.join('\n')).toBe(true)
    const plain = (await paneParts($, surface, 'now', 120, { offset: 0, bodyRows: 999 })).head
    expect(wide[0].replace(/下方還有 (\d+) 行/, (_m, d: string) => ' '.repeat(12 + d.length)), 'only the hint differs from the header without it').toBe(plain[0])
    // 76 columns (two header lines): the hint ends the metrics line
    const mid = (await paneParts($, surface, 'now', 76, { offset: 0, bodyRows: 5 })).head
    expect(mid.some(l => /^工作階段 \$0\.42 · 本機今日 \$3\.10 · ctx 37% +下方還有 \d+ 行$/.test(l)), mid.join('\n')).toBe(true)
    // 28 columns (the hint is now 2 cells narrower than with its arrow; 28 leaves gap 0, as tight as 30 did, so loosening `gap >= 2` is caught): the metrics line is already wrapped over rows; whichever row is last has no room for the hint, so it is gone and the figures stay whole
    const narrow = (await paneParts($, surface, 'now', 28, { offset: 0, bodyRows: 5 })).head
    expect(narrow.some(l => l.includes('下方還有')), narrow.join('\n')).toBe(false)
    expect(narrow.join('\n')).toContain('$3.10')
  })
}

// ---- the 待決 tab, mounted: option Buttons, note fields, the send Button, the sent state, a phone without Input. The pure half is decide.test.ts. ----
const DQ1 = { id: 'd-4290499d', question: 'P5 殘留分頁要不要把已清掉的也列出來', background: '殘留分頁現在只列要人處理的。', options: [{ label: 'OK', description: '照現況' }, { label: '完整顯示', description: '全列出來' }], recommendation: 'OK', blocks: '下一個派工' }
const DQ2 = { id: 'd-c24ecfd9', question: 'U6 要不要把建議也寫進回覆', options: [{ label: '要', description: '' }, { label: '不要', description: '' }] }
const DQ3 = { id: 'd-0000free', question: '這個分支要叫什麼名字？', options: [] }
for (const surface of SURFACES) {
  const decideWorld = (on: any, decisions: object[] = [DQ1, DQ2, DQ3]) => {
    const files = base()
    files[W_MODEL] = j(model({ needs_decision: true, decisions }))
    const w = world(on, files)
    const submits: { text: string; origin: unknown }[] = []
    on('prompt.submit', ($: any, e: any) => { submits.push({ text: e.text, origin: e.origin }); return { text: e.text } })
    return { w, files, submits }
  }
  const decideRows = async ($: any) => (await paneParts($, surface, 'decide')).texts
  const act = async ($: any, ...keys: string[]) => {
    const pane = await paneOn($, surface, 'decide')
    for (const key of keys) await pane.press({ key })
    await pane.unmount()
  }
  const keysOf = async ($: any, type: string) => {
    const pane = await paneOn($, surface, 'decide')
    const found = ((await pane.findAll({ type })) as Drawn[]).map(n => n.props?.key as string)
    await pane.unmount()
    return found
  }

  test('DECIDE mounted: each option is a Button, a text field sits under each question, the send Button is absent until something is chosen (' + surface + ')', async ($, on) => {
    decideWorld(on)
    await start($, surface)
    const rows = await decideRows($)
    expect(rows[1]).toBe('▲ 1. P5 殘留分頁要不要把已清掉的也列出來')
    expect(rows).toContain('  選項      [ ] ★ OK  [ ] 完整顯示')
    expect(rows).toContain('  選項      [ ] 要  [ ] 不要')
    expect(rows[rows.length - 1]).toBe('  [ 送出（已選 0/3） ]  答案會貼進這個對話送出')
    const buttons = await keysOf($, 'Button')
    for (const k of ['pick:d-4290499d:0', 'pick:d-4290499d:1', 'pick:d-c24ecfd9:0', 'pick:d-c24ecfd9:1']) expect(buttons, k).toContain(k)
    expect(buttons, 'nothing is chosen: the send row is plain text').not.toContain('submit')
    expect(await keysOf($, 'Input')).toEqual(['note:d-4290499d', 'note:d-c24ecfd9', 'note:d-0000free'])
    expect(rows.filter(r => r === ' ').length, 'a blank line is DRAWN after each card (an empty Text takes no row, a one-cell Text does)').toBe(3)
    expect(rows.findIndex(r => r === ' '), 'the first blank closes the first card, after its note field').toBeGreaterThan(rows.findIndex(r => r.startsWith('  補充')))
  })

  test('DECIDE mounted: a press picks, a second press on the same option unpicks, a pick survives the pane being drawn again, and the send Button appears (' + surface + ')', async ($, on) => {
    decideWorld(on)
    await start($, surface)
    await act($, 'pick:d-4290499d:1')
    let rows = await decideRows($)
    expect(rows).toContain('  選項      [ ] ★ OK  [x] 完整顯示')
    expect(rows[rows.length - 1]).toBe('  [ 送出（已選 1/3） ]  答案會貼進這個對話送出')
    expect(await keysOf($, 'Button')).toContain('submit')
    await act($, 'pick:d-4290499d:0') // another option of the same question replaces the pick
    expect(await decideRows($)).toContain('  選項      [x] ★ OK  [ ] 完整顯示')
    await act($, 'pick:d-4290499d:0') // the same one again: unpicked
    rows = await decideRows($)
    expect(rows).toContain('  選項      [ ] ★ OK  [ ] 完整顯示')
    expect(await keysOf($, 'Button')).not.toContain('submit')
  })

  test('DECIDE mounted: send submits ONE prompt with the answered questions only, not as the user; the cards then read sent and lose their Buttons until the id leaves the file (' + surface + ')', async ($, on) => {
    const { w, files, submits } = decideWorld(on)
    await start($, surface)
    const pane = await paneOn($, surface, 'decide')
    await pane.press({ key: 'pick:d-4290499d:0' })
    await pane.press({ key: 'pick:d-c24ecfd9:1' })
    await pane.input({ key: 'note:d-c24ecfd9', text: '要，但只寫一句', kind: 'change' })
    await pane.input({ key: 'note:d-0000free', text: '叫 main', kind: 'change' })
    await pane.press({ key: 'submit' })
    await pane.unmount()
    expect(submits.length).toBe(1)
    expect(submits[0].text).toBe([
      '[待決回覆]',
      'd-4290499d｜P5 殘留分頁要不要把已清掉的也列出來 → OK',
      'd-c24ecfd9｜U6 要不要把建議也寫進回覆 → 不要｜補充：要，但只寫一句',
      'd-0000free｜這個分支要叫什麼名字？ → 叫 main',
    ].join('\n'))
    expect((submits[0].origin as { asUser?: unknown } | undefined)?.asUser, 'the model must be able to tell the panel sent it').toBeUndefined()
    const rows = await decideRows($)
    expect(rows[1]).toBe('○ 1. P5 殘留分頁要不要把已清掉的也列出來 · 已送出，等處理')
    expect(rows).toContain('  選項      [x] ★ OK  [ ] 完整顯示')
    expect(rows[rows.length - 1]).toBe('  [ 全部已送出，等處理 ]')
    expect((await keysOf($, 'Button')).filter(k => k.startsWith('pick:') || k === 'submit')).toEqual([])
    expect(await keysOf($, 'Input')).toEqual([])
    await w.clock.advance(5000) // the file still lists them: still sent, and nothing is sent twice
    expect((await decideRows($))[1]).toContain('已送出，等處理')
    expect(submits.length).toBe(1)
    // the session closed them (open-decision.js close): the cards are gone
    files[W_MODEL] = j(model({ needs_decision: false, decisions: [] }))
    await w.clock.advance(5000)
    const after = await decideRows($)
    expect(after.length).toBe(2)
    expect(after[1]).toContain('目前沒有待你回答的問題')
  })

  test('DECIDE mounted: a question that is still open can be answered after another was sent; only the new answer goes in the second prompt (' + surface + ')', async ($, on) => {
    const { submits } = decideWorld(on)
    await start($, surface)
    await act($, 'pick:d-4290499d:0', 'submit')
    await act($, 'pick:d-c24ecfd9:0', 'submit')
    expect(submits.map(s => s.text)).toEqual([
      '[待決回覆]\nd-4290499d｜P5 殘留分頁要不要把已清掉的也列出來 → OK',
      '[待決回覆]\nd-c24ecfd9｜U6 要不要把建議也寫進回覆 → 要',
    ])
  })

  test('DECIDE mounted: the strip colours the 待決 tab, and the 現況 summary row opens it (' + surface + ')', async ($, on) => {
    decideWorld(on)
    await start($, surface)
    const pane = await paneOn($, surface, 'now')
    const tree = (await pane.drawn()) as Node
    await pane.unmount()
    expect(stripOf(tree)).not.toContain('▲')
    expect(tabName(tree, 'decide').props?.color).toBe('warning')
    expect(stripOf(tree)).not.toMatch(/待決 \d/)
    const rows = rowsOf(tree)
    const at = rows.findIndex(t => /^▲ 待決議事項 3 件\s+待決 ›$/.test(t))
    expect(at).toBeGreaterThanOrEqual(0)
    expect(rows.some(t => t.includes('P5 殘留分頁'))).toBe(false) // none of the question text is on 現況
    const now = await paneOn($, surface, 'now')
    await now.press({ key: 'g' + at })
    await now.unmount()
    expect(await shownTabOf($, surface)).toBe('decide')
  })

  test('DECIDE mounted: two presses on send at the same moment submit ONE prompt (' + surface + ')', async ($, on) => {
    const { submits } = decideWorld(on)
    await start($, surface)
    const a = await paneOn($, surface, 'decide')
    await a.press({ key: 'pick:d-4290499d:0' })
    await Promise.all([a.press({ key: 'submit' }), a.press({ key: 'submit' })]) // a double click: both presses run before either has written its marks
    await a.unmount()
    expect(submits.length).toBe(1)
    expect(submits[0].text).toBe('[待決回覆]\nd-4290499d｜P5 殘留分頁要不要把已清掉的也列出來 → OK')
  })

  test('DECIDE mounted: a question whose model.json entry has origin ask_user_question is left to its own dialog: no pick Button, no field, not counted (' + surface + ')', async ($, on) => {
    decideWorld(on, [DQ1, { ...DQ2, origin: 'ask_user_question' }]) // the origin travels model.json -> job model -> pane, nothing is put into a view by hand
    await start($, surface)
    const rows = await decideRows($)
    const at = rows.findIndex(t => t.startsWith('▲ 2. U6'))
    expect(at).toBeGreaterThan(0)
    expect(rows[at + 1]).toBe('  選項      [ ] 要  [ ] 不要') // still shown, as plain text
    expect(rows[at + 2]).toBe('  請在對話框回答。')
    expect(rows[rows.length - 1]).toBe('  [ 送出（已選 0/1） ]  答案會貼進這個對話送出') // only the first question counts
    const buttons = await keysOf($, 'Button')
    expect(buttons.filter(k => k.startsWith('pick:d-c24ecfd9')), 'no pick Button for the dialog question').toEqual([])
    expect(buttons.filter(k => k.startsWith('pick:d-4290499d')).length).toBe(2)
    expect(await keysOf($, 'Input')).toEqual(['note:d-4290499d'])
  })

  test('DECIDE mounted: a phone draws no text field; a question without options says to answer in the conversation, the option Buttons still work (' + surface + ')', async ($, on) => {
    decideWorld(on)
    await start($, surface)
    const mountPhone = () => $.ui.mount({ plugin: 'autopilot', surface: 'mobile', component: 'Pane', requestId: 'autopilot-live', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } })
    const first = await mountPhone()
    await first.press({ key: 'decide' })
    await first.unmount()
    const phone = await mountPhone()
    expect(((await phone.findAll({ type: 'Input' })) as Drawn[]).length).toBe(0)
    const rows = rowsOf((await phone.drawn()) as Node)
    expect(rows).toContain('  這題請在對話裡回答。')
    await phone.press({ key: 'pick:d-4290499d:0' })
    await phone.unmount()
    const again = await mountPhone()
    expect(rowsOf((await again.drawn()) as Node)).toContain('  選項      [x] ★ OK  [ ] 完整顯示')
    await again.unmount()
  })
}
// the 殘留 tab of richWorld() at 76 columns (zh-TW): two to judge, one to clear, the cleanup kv, the source with its behind-upstream sentence
const HYGIENE_GOLDEN_76: string[] = [
  "▾ 要你處理  2 · 3.0 MB ────────────────────────────────────────────────────",
  "▲ hands-x                                                    4d04h · 2.0 MB",
  "  有沒提交的檔案，先看內容再決定要不要刪",
  "  $ git -C /home/u/proj worktree remove --force /home/u/proj/.claude/",
  "    worktrees/hands-x",
  "▲ feature/old                                                           20d",
  "  分支還沒合併；確定不要了才刪",
  "  $ git branch -D feature/old",
  "▾ 可以直接清掉  1 · 1.0 MB ────────────────────────────────────────────────",
  "◦ hands-old                                                     9d · 1.0 MB",
  "  已合併，可以刪",
  "  [ 清掉 ]",
  "▾ 自動清理 ────────────────────────────────────────────────────────────────",
  "上次        3h00m 前 · 刪了 2 個 worktree、封存 1 條分支",
  "▾ 外掛來源 ────────────────────────────────────────────────────────────────",
  "▲ 開發目錄 · v2.37.0",
  "  落後遠端 3 個提交",
]
