// pages/now.v74.test.ts — ux-v7.4 S2 現況 (sub-task C): pm status fleet block, seat tokens, qc and proxy folds; negative control when pm is null.
import { test, expect } from 'claude-code/testing'
import { nowPage, nowV74HeaderExtra } from './now'
import { parsePmStatus } from '../v74/contract'
import { makeT } from '../i18n'
import type { PageCtx } from './frame'

const t = makeT('zh-TW')
const NOW = 1795150000000
const text = (row: { text: string }[]): string => row.map(s => s.text).join('')

const PM_FIXTURE_JSON = '{"schema":"fleet.pm.status","schema_version":1,"generated_at_ms":1795149000000,"selector":null,"projects":[{"project":"line-b","root_id":null,"counts":{"stuck":1,"overdue":1,"running":0,"waiting":0,"total":1},"tasks":[]},{"project":"line-a","root_id":null,"counts":{"stuck":1,"overdue":0,"running":0,"waiting":0,"total":1},"tasks":[]},{"project":"line-f","root_id":null,"counts":{"stuck":0,"overdue":0,"running":0,"waiting":2,"total":2},"tasks":[]},{"project":"line-e","root_id":null,"counts":{"stuck":0,"overdue":0,"running":0,"waiting":1,"total":1},"tasks":[]},{"project":"line-d","root_id":null,"counts":{"stuck":0,"overdue":0,"running":0,"waiting":1,"total":1},"tasks":[]},{"project":"line-c","root_id":null,"counts":{"stuck":0,"overdue":0,"running":0,"waiting":1,"total":1},"tasks":[]},{"project":"line-g","root_id":null,"counts":{"stuck":0,"overdue":0,"running":2,"waiting":0,"total":2},"tasks":[]},{"project":"line-h","root_id":null,"counts":{"stuck":0,"overdue":0,"running":1,"waiting":0,"total":1},"tasks":[]},{"project":"line-i","root_id":null,"counts":{"stuck":0,"overdue":0,"running":1,"waiting":0,"total":1},"tasks":[]}]}'

const pm = parsePmStatus(PM_FIXTURE_JSON)
if (pm === null) throw new Error('fixture pm-status.json must parse')

const liveOk = {
  state: 'ok' as const,
  text: '',
  header: '',
  band: {
    mark: '●', verdict: '進行中', elapsed: '3h26m', progress: '', progressDim: false, reason: null,
    verdictReason: null, head: '', project: 'demo', phase: '', slots: [],
    key: 'running' as const, why: '', text: '',
  },
  pending: [],
  project_key: 'demo',
  root_run_id: null,
  link: null,
  rows: [],
  gates: null,
  sections: { attention: null, attentionNotWired: false, tasks: null, tasksNote: null, decisionsNotWired: false, foreman: null },
  review: null,
  published_at: null,
  watcher_note: null,
  session_as_of: null,
  host_as_of: null,
  detail: {
    counts: null,
    stalled: 0,
    now_ms: NOW,
    project: 'demo',
    marker: null,
    qc: { state: 'not_needed' as const, range: 'a1b2c3d4..HEAD', protected_files_count: 0, evidence: null },
    stage: null,
    decisions: {
      count: 2,
      irreversible: 0,
      writers: [],
      undocumented: 0,
      identity: null,
      root: null,
      ladder: null,
      rows: [
        { round: null, decision: '合併 feat/tux-sync 進 develop（check-all 綠）', irreversible: false, writer: null, decision_id: null, source: null, root: null, at: new Date(NOW - 10 * 60_000).toISOString() },
        { round: null, decision: '改用 codex 跑 learn/search 測試（kimi 逾時兩次）', irreversible: false, writer: null, decision_id: null, source: null, root: null, at: new Date(NOW - 25 * 60_000).toISOString() },
      ],
    },
    load_source: null,
    residue: null,
    spend: { session: '', host_all: '', host_all_n: 380_000, brain: 1_200_000, cap: null, mode: '' },
  },
  metrics: { ctx: '11%' },
}

const v74Ctx = (pmVal: typeof pm, over: Partial<PageCtx> = {}): PageCtx => ({
  live: liveOk as never,
  console: null,
  size: { cols: 160, rows: 28 },
  t,
  nowMs: NOW,
  v74: { pm: pmVal, pmFetchedMs: NOW - 10_000, decide: null, todo: null, nav: { cursor: 0, picks: {}, notes: {}, noteMode: false } },
  ...over,
})

test('v74 now: fleet summary counts and fail/idle rows from fleetLines fixture', () => {
  const { body, actions } = nowPage.render(v74Ctx(pm))
  const lines = body.map(text)
  expect(lines.some(l => l.includes('產線') && l.includes('9') && l.includes('✗2') && l.includes('⊘4'))).toBe(true)
  expect(lines.some(l => l.includes('line-b') && l.includes('✗'))).toBe(true)
  expect(lines.some(l => l.includes('line-f') && l.includes('⊘'))).toBe(true)
  expect(lines.filter(l => /line-g|line-h|line-i/.test(l) && !l.includes('▾'))).toHaveLength(0)
  expect(actions).toHaveLength(0)
  expect(body.flat().every(s => s.press === undefined)).toBe(true)
})

test('v74 now negative control: null pm draws broken fleet block, never fixture-parse at runtime', () => {
  const { body } = nowPage.render(v74Ctx(null, { v74: { pm: null, pmFetchedMs: null, decide: null, todo: null, nav: { cursor: 0, picks: {}, notes: {}, noteMode: false } } }))
  const joined = body.map(text).join('\n')
  expect(joined).toContain('沒有 fleet pm status 來源')
  expect(joined).not.toContain('line-b')
})

test('v74 now: seat tokens and folded qc / proxy sections', () => {
  const { body } = nowPage.render(v74Ctx(pm))
  const joined = body.map(text).join('\n')
  expect(joined).toContain('本席 demo')
  expect(joined).toContain('1.2M tok')
  expect(joined).toContain('380k tok')
  expect(joined).toContain('推送前檢查')
  expect(joined).toContain('a1b2c3d4..HEAD')
  expect(joined).toContain('我替你決定的事 2 件')
  expect(joined).toContain('feat/tux-sync')
})

test('v74 header extra: source schema and fetch age when pmFetchedMs set', () => {
  const extra = nowV74HeaderExtra(v74Ctx(pm))
  expect(text(extra)).toContain('fleet pm status --json')
  expect(text(extra)).toContain('fleet.pm.status v1')
  expect(text(extra)).toContain('10 秒')
})

test('v74 header negative: missing fetch time is red marker', () => {
  const extra = nowV74HeaderExtra(v74Ctx(pm, { v74: { pm, pmFetchedMs: null, decide: null, todo: null, nav: { cursor: 0, picks: {}, notes: {}, noteMode: false } } }))
  expect(text(extra)).toContain('現況來源不明')
})