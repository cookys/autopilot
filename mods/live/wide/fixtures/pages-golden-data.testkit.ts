// P5a: per-step inputs for pages-golden.test.ts. Everything here is design data (gen_wide_all.py / gen.py S), written as the page functions' inputs;
// the shared pane blocks (12 lanes, local events, per-page history, the other pages' summaries) are gen_wide_all.py's constants.
import type { PaneLane, PaneModel } from '../pane'
import { txt } from './pages-golden-text.testkit'
import { wideDispatch } from '../dispatch'
import type { WideDispatchInput, WideDispatchItem } from '../dispatch'
import { wideReview } from '../review'
import type { WideReviewInput } from '../review'
import { wideSpend } from '../spend'
import type { WideSpendInput } from '../spend'
import { wideFleet } from '../fleet'
import { wideHelp } from '../help'
import type { WideHelpOpts } from '../help'
import { wideTodo } from '../todo'
import type { WideTodoInput } from '../todo'
import type { WideFleetInput } from '../fleet'
import { wideHygiene } from '../hygiene'
import type { WideHygieneInput } from '../hygiene'
import { wideNow } from '../now'
import type { WideNowInput } from '../now'

export type Composed = {
  page: number
  out: { stepTitle: string; list: string[]; reply: string[]; hints: string; replyKeep?: number }
  pane: Omit<PaneModel, 'page' | 'tabs' | 'moved' | 'more'>
}
// a step whose design contradicts itself: the reason, and a check over the design's own rows that proves it
export const SKIPS: Record<string, { reason: string; holds: (rows: string[]) => boolean }> = {
  '6-M': {
    reason: 'the design header says 要你處理 9 but its own list holds 16 rows (5 in the band, 11 expanded under 清單（續）), the band rows read `· 4 天` and the expanded ones `（5 天沒動）`, and tri-fable appears in both',
    holds: rows => rows.some(r => r.includes('要你處理 9')) && rows.some(r => r.includes('worktree tri-fable · 5 天')) && rows.some(r => r.includes('worktree tri-fable（5 天沒動）')),
  },
  '3-M': {
    reason: 'the design header says 執行中 9 輪 but its own list holds more than 9 running rows (band rows plus the 清單（續） rows in the pane); a count taken from the rows cannot be 9',
    holds: rows => rows.some(r => r.includes('執行中 9 輪')) && rows.filter(r => /線 \S+ · (codex|claude|agy|grok) · \d+ 分/.test(r)).length > 9,
  },
}

type Fleet = [number, number, number] | '—'
export type Status = { dec?: string; act?: string; fleet?: Fleet; speed?: '—'; stale?: string[] }
type PageOut = { stepTitle: string; list: string[]; reply: string[]; hints: string; replyKeep?: number; pin?: string[]; ctx?: string[]; hist?: { title: string; rows: string[] } | null }

const LANES: [PaneLane['state'], string, string, string, string][] = [
  ['running', 'codeforge', 'ϟ 41 tok/s  ▆▆▄▃▆', 'tux-sync 測試', ''],
  ['running', 'autopilot', 'ϟ 37 tok/s  ▄▅▆▆▅', 'band 對比修正', ''],
  ['running', 'hangar', 'ϟ 63 tok/s  ▆▇▆▅▆', '盤點 client 尺寸', ''],
  ['running', 'fleet', 'ϟ 30 tok/s  ▃▄▄▅▄', 'courier 重試佇列', ''],
  ['running', 'hippo', 'ϟ 22 tok/s  ▂▃▃▄▃', '安裝 P1.5', ''],
  ['running', 'lab', 'ϟ 18 tok/s  ▂▂▃▂▂', 'gate 掃描', ''],
  ['running', 'alfred', 'ϟ 15 tok/s  ▁▂▂▂▃', '部署前檢查', ''],
  ['running', 'mnemos', 'ϟ 11 tok/s  ▁▁▂▁▂', '索引重建', ''],
  ['failed', 'hangar 換池', '失敗 3 輪', '等 NAS 回應逾時', ''],
  ['failed', 'docs 建置', '失敗 1 輪', 'mdbook 版本不符', ''],
  ['waiting', 'pinball 美術', '卡住', '等操作員選版', ''],
  ['waiting', '308 地圖', '卡住', '等素材', ''],
]
const LANE_EV: Record<string, [string, string]> = {
  codeforge: ['09:38 check-all 綠，合 develop', '補 tux-sync 反例'],
  autopilot: ['09:35 band 淺色對比 4.7', '等 codeforge 審查'],
  hangar: ['09:40 量到 client 209x51', '交實拍單 01M825HR'],
  fleet: ['09:31 重試佇列清到 0', 'courier 逾時改 30 秒'],
  hippo: ['09:29 P1.5 裝好 3/5 台', '裝剩下 2 台'],
  lab: ['09:26 gate 掃完 41 個 repo', '寫掃描報告'],
  alfred: ['09:20 部署前檢查 7/9 過', '修 2 項設定'],
  mnemos: ['09:18 索引重建 62%', '跑完驗查詢'],
  'hangar 換池': ['09:22 NAS stat 逾時 600 秒', '第 4 輪前先查 NAS'],
  'docs 建置': ['09:05 mdbook 0.5 不認新語法', '釘 mdbook 版本'],
  'pinball 美術': ['昨天 18:10 交 3 版封面', '等你選版'],
  '308 地圖': ['昨天 16:40 缺第 3 區素材', '等素材進來'],
}
export const HIST: Record<number, [string, string[]]> = {
  1: ['今天結束的事', ['09:38 codeforge 合進 develop', '09:12 autopilot 審查通過', '08:55 hangar 盤點完成', '08:31 待決 2 張已送出', '08:15 換池 team → pool-b', '07:58 lab gate 放行 1 個 repo', '07:41 docs 第 2 版退件', '07:12 fleet 合進 develop']],
  3: ['今天結束的輪次', ['09:05 codex · codeforge tux-sync · 交件', '08:40 agy · hangar 盤點 · 交件', '08:12 claude · autopilot band · 交件', '07:55 codex · lab gate · 逾時（已重派）', '07:30 claude · docs 版本 · 交件', '07:02 agy · fleet 重試 · 交件']],
  4: ['今天的審查紀錄', ['08:31 合併 develop codeforge 05e2', '08:22 codex PASS autopilot e931', '08:02 agy PASS hangar 5cab', '07:55 合併 develop autopilot 7d1c', '07:41 退件 grok 第 2 版', '07:30 codex PASS lab 93fa', '07:12 合併 develop fleet 2b6e']],
  5: ['今天各席用量', ['codeforge · 92k tokens · 5h 的 10%', 'autopilot · 81k tokens · 9%', 'hangar · 64k tokens · 7%', 'fleet · 48k tokens · 5%', 'hippo · 37k tokens · 4%', 'lab · 29k tokens · 3%', 'alfred · 18k tokens · 2%', 'mnemos · 11k tokens · 1%']],
  6: ['最近自動清理的', ['昨天 23:10 worktree tri-old（已合併）', '昨天 23:10 分支 fix/band-rgb（已合併）', '昨天 03:00 過期暫存 1.4 GB', '11-24 23:10 worktree pane-b2（已合併）', '11-24 03:00 handoff 6 個（7 天前）']],
  7: ['今天結束的產線', ['09:05 codeforge · tux-sync 交件', '08:40 hangar · 盤點交件', '08:12 autopilot · band 交件', '07:30 docs · 版本交件', '07:02 fleet · 重試交件', '06:41 hippo · P1.4 交件']],
  8: ['最近完成的待辦', ['11-25 盤點 client 尺寸', '11-24 外掛版本對齊', '11-23 r1 rev4 示意', '11-22 v7.6 第 1 批', '11-21 band 對比']],
  9: ['顏色怎麼讀', ['綠 ◉ 正常、執行中', '紅 ✗ ⊘ 失敗、讀不到', '黃 △ ⋯ 過時、在等人', '紫 可按的鍵', '灰 說明文字，不能按']],
}
const EVENTS = ['09:41 pm status 更新', '09:40 hangar 回報 client 尺寸', '09:38 codeforge check-all 綠', '09:35 autopilot 送審', '09:31 fleet 重試佇列清空', '09:29 hippo 裝好第 3 台', '09:26 lab gate 掃描完', '09:22 hangar 換池第 3 輪逾時', '09:20 alfred 檢查 7/9', '09:18 mnemos 索引 62%', '09:12 autopilot 審查通過', '09:05 docs 建置失敗', '09:01 codex 席額度 47%', '08:55 hangar 盤點完成', '08:40 agy 交件 hangar', '08:31 待決 2 張送出', '08:22 codex PASS autopilot', '08:15 換池 team → pool-b', '08:02 agy PASS hangar', '07:58 lab gate 放行', '07:41 docs 第 2 版退件', '07:30 codex PASS lab', '07:12 fleet 合進 develop', '07:02 agy 交件 fleet', '06:50 alfred 上線日已決', '06:41 hippo P1.4 交件', '06:21 hippo 合進 develop', '06:05 codex 第 1 版退件']

export function summaries(st: Status): (string | null)[] {
  const dec = st.dec ?? '3'
  const act = st.act ?? '1'
  const fl = st.fleet ?? [8, 2, 2]
  const fleet = fl === '—' ? '讀不到' : `執行 ${fl[0]} · 失敗 ${fl[1]} · 卡住 ${fl[2]}${(st.stale ?? []).includes('fleet') ? ' · 過時' : ''}`
  return [
    `待決 ${dec} · 動手 ${act} · 殘留 2 項`,
    dec === '—' ? '讀不到' : `${dec} 張要你選 · ${act} 張要先動手`,
    '執行中 2 輪 · 失敗 1 輪 · 完成 1 輪',
    '欠審 1 · 我替你決定的事 4',
    '5h 42% · 7d 18% · 今日 380k tokens',
    '要你處理 2 · 自動清理 1',
    fleet,
    '3 張 · 最近到期 11-30',
    '狀態圖示與按鍵表',
  ]
}

// the shared pane blocks around a page's own pin / context / history
export function paneOf(page: number, out: PageOut, st: Status, x: { state?: string } = {}): Composed['pane'] {
  const fl = st.fleet ?? [8, 2, 2]
  const staleFleet = (st.stale ?? []).includes('fleet')
  const calm = fl !== '—' && fl[1] === 0 && fl[2] === 0
  const ok = (s: string): boolean => !calm || !['失敗', '逾時', '退件'].some(w => s.includes(w))
  const speedOff = st.speed === '—'
  const wide = page === 7
  const lanes: PaneLane[] | null = fl[0] === 8 && fl[1] === 2 && fl[2] === 2 && fl !== '—'
    ? LANES.map(([state, name, a, b]) => ({
      state, name, speed: speedOff && a.startsWith('ϟ') ? 'ϟ —' : a, task: b, ...(wide ? { ev: LANE_EV[name][0], next: LANE_EV[name][1] } : {}),
    }))
    : null
  const h = x.state === 'X' || x.state === 'X2' ? null : HIST[page]
  return {
    pin: out.pin ?? [], ctx: out.ctx ?? [], ctxFold: false, ctxOpen: false,
    lanes,
    lanesHead: (wide ? '12 條產線 · 最近一件事 → 下一步' : '艦隊 · 12 條產線 · 執行 8 · 失敗 2 · 卡住 2') + (staleFleet ? ' · 11 分鐘前的資料' : ''),
    hist: out.hist !== undefined && out.hist !== null ? out.hist : h ? { title: h[0], rows: h[1].filter(ok) } : null,
    events: EVENTS.filter(ok),
    summaries: summaries(st),
  }
}

const NOW0: WideNowInput = {
  pending: 3, act: 1, residue: 2, fleetTotal: 12, running: 8, failed: 2, stalled: 2, ctxPct: 42, sessionTokens: '240k', qcOwed: 1, proxyDecided: 4,
  oldestPendingAge: '3 小時', oldestPendingQuestion: '要不要把 tui 共用計畫合進 develop。', pmUpdatedAt: '09:41', pmAge: '1 分鐘前', failedNames: ['hangar 換池（3 輪）', 'docs 建置（1 輪）'],
  recentDone: [], stale: false, missingPm: false, missingConsole: false,
}

type Model = () => Composed
const calmOf = (st: Status): ((s: string) => boolean) => {
  const fl = st.fleet ?? [8, 2, 2]
  const calm = fl !== '—' && fl[1] === 0 && fl[2] === 0
  return s => !calm || !['失敗', '逾時', '退件'].some(w => s.includes(w))
}
const histRows = (page: number, st: Status): string[] => HIST[page][1].filter(calmOf(st))

// 1 現況: the design's states as inputs; the sources that are gone are null, the pm status's own words come in as narrative / detail / warnings
const now = (id: string, st: Status, i: Partial<WideNowInput>): Model => () => {
  const x = txt(id)
  const o = wideNow({ ...NOW0, recentDone: id.endsWith('X') || id.endsWith('X2') ? [] : histRows(1, st), narrative: x.reply, detail: x.detail, warnings: x.pin, ...i })
  return { page: 1, out: o, pane: paneOf(1, o, st, { state: id.slice(2) }) }
}
const MODELS: Record<string, Model> = {
  '1-N': () => { const o = wideNow({ ...NOW0, recentDone: histRows(1, {}) }); return { page: 1, out: o, pane: paneOf(1, o, {}) } },
  '1-E': now('1-E', { dec: '0', act: '0', fleet: [3, 0, 0] }, { pending: 0, act: 0, residue: 0, fleetTotal: 3, running: 3, failed: 0, stalled: 0, ctxPct: 18, qcOwed: 0, label: '有資料、全部正常' }),
  '1-M': now('1-M', { dec: '12', act: '2', fleet: [19, 7, 5] }, { pending: 12, act: 2, residue: 9, fleetTotal: 31, running: 19, failed: 7, stalled: 5, ctxPct: 81, qcOwed: 6, label: '很多事' }),
  '1-L': now('1-L', {}, { focus: 'fleet', running: null, stalled: null, qcOwed: null, label: '失敗原因很長' }),
  '1-X': now('1-X', {}, { missingPm: true, fleetNote: '（改用 console）', stalled: null, ctxPct: null, qcOwed: null }),
  '1-S': now('1-S', { stale: ['fleet'] }, { stale: true, fleetNote: '（12 分鐘前）', stalled: null, ctxNote: '（12 分鐘前）', qcOwed: null }),
  '1-X2': now('1-X2', { fleet: '—' }, { missingPm: true, missingConsole: true, fleetNote: '（只剩 fleetSummary）', laneBusy: 5, laneIdle: 4 }),
}

// 3 派工
const run = (label: string, engine: string, dur: string, state: WideDispatchItem['state']): WideDispatchItem => ({ state, label, engine, dur })
const ITEMS3 = [run('甲線 codeforge', 'codex', '12 分', 'running'), run('乙線 autopilot', 'claude', '8 分', 'running'), run('丙線 hangar', 'codex', '31 分', 'failed'), run('丁線 docs', 'claude', '40 分', 'done')]
const dispatch = (id: string, st: Status, i: Partial<WideDispatchInput>): Model => () => {
  const x = txt(id)
  const o = wideDispatch({ items: ITEMS3, cursor: 0, recentRounds: id.endsWith('X') ? [] : histRows(3, st), stale: false, missing: false, narrative: x.reply, detail: x.detail, warnings: x.pin, ...i })
  return { page: 3, out: o, pane: paneOf(3, o, st, { state: id.slice(2) }) }
}

// 4 審查
const ITEMS4 = [{ label: 'codeforge 7d1c', engine: 'codex', verdict: 'PASS' }, { label: 'autopilot e931', engine: 'agy', verdict: 'PASS' }]
const DECISIONS4 = ['09:41 合併 codeforge develop', '09:30 換池 team → pool-b', '09:12 延期 01M89GKE 到明天', '08:55 合併 autopilot develop', '08:40 退件 codex 第 1 版', '08:31 合併 develop codeforge 05e2', '08:22 codex PASS autopilot e931', '08:15 換池 team → pool-b', '08:02 agy PASS hangar 5cab',
  '07:55 合併 develop autopilot 7d1c', '07:41 退件 grok 第 2 版', '07:30 codex PASS lab 93fa', '07:12 合併 develop fleet 2b6e', '06:58 換池 cookys → pool-a', '06:40 agy PASS docs 44c1', '06:21 合併 develop hippo 81d0', '06:05 退件 codex 第 1 版', '05:50 codex PASS mnemos 0f3a', '05:31 合併 develop alfred c2e9', '05:10 換池 lab → pool-c']
const review = (id: string, st: Status, i: Partial<WideReviewInput>): Model => () => {
  const x = txt(id)
  const o = wideReview({ items: ITEMS4, cursor: 0, qcOwed: 1, qcTarget: 'hangar 5cab', decidedCount: 4, decidedSummary: '合併 develop ×3 · 換池 ×1', recentReviews: id.endsWith('X') ? [] : histRows(4, st), stale: false, missing: false, narrative: x.reply, detail: x.detail, warnings: x.pin, ...i })
  return { page: 4, out: o, pane: paneOf(4, o, st, { state: id.slice(2) }) }
}

// 5 花費
const SPEND0: WideSpendInput = {
  pct5h: 42, reset5h: '2h10m', eta5h: '3h03m', hitBeforeReset: false, ratePerHour: 19, pct7d: 18, reset7d: '4d', pools: [{ label: 'A 池', pct: 42 }, { label: 'B 池', pct: 9 }],
  todayTokens: '380k', tps: 41, seatUsage: [], stale: false, missing: false, trend24h: '24h 趨勢比昨天高 12%',
}
const POOLS5 = [['team · claude max', 42], ['cookys · claude max', 77], ['ops · claude pro', 12], ['codex 席', 64], ['grok 席', 9], ['kimi 席', 31], ['glm 席', 12], ['agy 席', 54], ['codex 席', 47], ['fable 席', 6]] as const
const spend = (id: string, st: Status, i: Partial<WideSpendInput>, raw = false): Model => () => {
  const x = txt(id)
  const o = wideSpend({ ...SPEND0, seatUsage: id.endsWith('X') || id.endsWith('X2') ? [] : histRows(5, st), ...(raw ? {} : { narrative: x.reply, detail: x.detail }), warnings: x.pin, ...i })
  return { page: 5, out: o, pane: paneOf(5, o, st, { state: id.slice(2) }) }
}
// 6 殘留
const RES = (human: { kind: string; target: string; reason: string; command?: string }[]) => ({
  needs_human_count: human.length,
  needs_human: human.map(h => ({ kind: h.kind, target: h.target, branch: null, class: 'x', bytes: null, reason: h.reason, command: h.command ?? null })),
  auto_removed_count: 1, auto_archived_count: 0, auto_ran_at: null, by_class: {},
}) as unknown as NonNullable<WideHygieneInput['residue']>
const HUMAN6 = [{ kind: 'worktree', target: 'tri-merge', reason: '4 天沒動', command: 'git -C .claude/worktrees/tri-merge log develop..' }, { kind: 'branch', target: 'fix/verify-old', reason: '沒合併' }]
const LOAD6 = { source: 'dev', marketplace_path: null, flags: [] } as unknown as NonNullable<WideHygieneInput['loadSource']>
const hygiene = (id: string, st: Status, i: Partial<WideHygieneInput>): Model => () => {
  const x = txt(id)
  const o = wideHygiene({ residue: RES(HUMAN6), loadSource: LOAD6, focus: 0, autoRows: ['過期暫存：3 個 handoff'], loadRows: ['forge-stats 從主 clone 載入'], recent: id.endsWith('X') || id.endsWith('X2') ? [] : histRows(6, st), narrative: x.reply, detail: x.detail, warnings: x.pin, ...i })
  return { page: 6, out: o, pane: paneOf(6, o, st, { state: id.slice(2) }) }
}

// 7 艦隊
const LANE_NAMES = ['codeforge', 'autopilot', 'hangar', 'fleet', 'hippo', 'lab', 'alfred', 'mnemos']
const SPEEDS = ['41', '37', '63', '30', '22', '18', '15', '11']
const lanes12 = (speed: boolean): NonNullable<WideFleetInput['lanes']> => [
  ...LANE_NAMES.map((name, i) => ({ state: 'running' as const, name, word: speed ? `ϟ ${SPEEDS[i]} tok/s` : 'ϟ —' })),
  { state: 'failed', name: 'hangar 換池', word: '失敗 3 輪' }, { state: 'failed', name: 'docs 建置', word: '失敗 1 輪' },
  { state: 'waiting', name: 'pinball 美術', word: '等人' }, { state: 'waiting', name: '308 地圖', word: '等人' },
]
const AGENTS17 = [['codeforge', 41], ['autopilot', 37], ['hangar', 63], ['fleet', 22], ['gpu-lead', 48], ['hippo', 33], ['lab', 29], ['alfred', 27], ['mnemos', 24], ['game-lead', 21], ['recovery-lead', 19], ['ops', 17], ['pinball', 15], ['308', 14], ['revival', 12], ['twgame', 11], ['docs', 9]] as const
const fleet = (id: string, st: Status, i: Partial<WideFleetInput>, hist: boolean | 'none' = true): Model => () => {
  const x = txt(id)
  const o = wideFleet({ lines: null, steps: [], nowMs: 0, t: undefined as never, focus: 0, lanes: lanes12(true), narrative: x.reply, detail: x.detail, warnings: x.pin, ...i })
  return { page: 7, out: o, pane: paneOf(7, o, st, { state: id.slice(2) }) }
}
const CARDS = (a: string): { head: string }[] => [{ head: a }]

// 8 待辦 / 9 說明
const due = (m: number, d: number): number => Date.UTC(2026, m - 1, d, 12)
const opt = (label: string, detail: string, recommended = false): { label: string; detail: string; recommended: boolean } => ({ label, detail, recommended })
const MERGE = { id: 'merge', title: '合併計畫', dueMs: due(11, 30), question: '這次合併要不要等 hippo 裝完？', options: [opt('先合併', '今天合併；hippo 之後再接', true), opt('等 hippo', '晚兩天；少一次回滾'), opt('再放一週', '到期日改到 12-07')] }
const PLUGIN = { id: 'plugin', title: '外掛更新', dueMs: due(12, 2), question: '外掛要現在更新嗎？', options: [opt('更新', 'x', true)] }
const REPORT = { id: 'report', title: '核對報表', dueMs: due(12, 5), question: '報表要核對嗎？', options: [opt('核對', 'x', true)] }
const CARDS3 = [MERGE, PLUGIN, REPORT]
const todo = (id: string, st: Status, i: Partial<WideTodoInput>): Model => () => {
  const x = id === '8-X' || id === '8-E' ? { reply: [] as string[] } : {}
  void x
  const o = wideTodo({ todo: CARDS3, cursor: 0, picks: {}, notes: {}, ...i })
  return { page: 8, out: o, pane: paneOf(8, o, st, { state: id.slice(2) }) }
}
const LONG = { id: 'merge', title: '合併計畫', dueMs: due(11, 30), question: '這次合併牽涉 codeforge、autopilot、hangar 三條產線，審查和部署時程都還沒對齊；要現在合併、等明天的額外審查，還是延到下週？', options: [opt('現在合併', '值班的人看著；出事回滾到 7d1c', true), opt('等明天', '多一輪 agy 審查，晚一天；明早 9 點前審完就合併，審出 blocking 就改到下週，到期日跟著延'), opt('延到下週', '保留目前版本，到期日改 12-07')] }
const KEYS_NOTES = ['1–9        切到第 N 頁', 'j/k        換一筆（待決頁用 p/n 換張）', 'o          展開焦點列（待決頁沒有）', 'a/b/c      選選項（待決、待辦）', 'f          沒選的卡填成建議（⏶ 卡不填）', 'm          寫附註（只有待決）', 's          送出前先預覽', 'y / x      預覽中確認 / 取消', 'g ＊       複製等你動手卡的網址', 'Tab ＊      換到下一頁', 'e ＊        展開來龍去脈（待決卡預設收起）', 'Esc        待決回輸入框；其他頁關閉', 'Enter      附註輸入中：存附註']
const help = (id: string, focus: number, i: WideHelpOpts): Model => () => {
  const x = txt(id)
  const o = wideHelp(focus, { names: ['狀態圖示', '按鍵', '符號'], narrative: x.reply, detail: x.detail, ...i })
  return { page: 9, out: o, pane: paneOf(9, o, {}, { state: id.slice(2) }) }
}
void KEYS_NOTES

Object.assign(MODELS, {
  '3-N': dispatch('3-N', {}, {}),
  '3-E': dispatch('3-E', {}, { items: [] }),
  '3-L': dispatch('3-L', {}, { cursor: 2, label: '失敗原因很長' }),
  '3-X': dispatch('3-X', { fleet: '—' }, { items: [], missing: true, laneBusy: 5, laneIdle: 4, recentRounds: [] }),
  '3-S': dispatch('3-S', { stale: ['fleet'] }, { stale: true, staleNote: '（15 分鐘前）' }),
  '4-N': review('4-N', {}, {}),
  '4-E': review('4-E', {}, { items: [], qcOwed: 0, qcTarget: null, decidedCount: 0, decidedSummary: null }),
  '4-M': review('4-M', {}, { items: [], decisions: DECISIONS4, cursor: 1, decidedCount: 20, label: '很多條' }),
  '4-L': review('4-L', {}, { label: '審查意見很長' }),
  '4-X': review('4-X', {}, { items: [], qcOwed: null, decidedCount: null, missing: true }),
  '4-S': review('4-S', {}, { stale: true, qcTarget: null, qcNote: '（20 分鐘前）' }),
  '5-N': spend('5-N', {}, {}, true),
  '5-E': spend('5-E', { speed: '—' }, { pct5h: 0, reset5h: null, eta5h: null, hitBeforeReset: null, ratePerHour: null, pct7d: 3, reset7d: '6d', pools: [], todayTokens: null, tps: null, label: '還沒有用量' }),
  '5-M': spend('5-M', {}, { poolRows: POOLS5.map(([label, pct]) => ({ label, pct })), cursor: 1, label: '10 個額度池' }),
  '5-L': spend('5-L', {}, { label: '說明很長' }),
  '5-X': spend('5-X', { speed: '—' }, { pct5h: null, pct7d: null, reset5h: null, eta5h: null, hitBeforeReset: null, reset7d: null, tps: null, label: '缺源（quota 和速度）' }),
  '5-S': spend('5-S', { stale: ['speed'] }, { stale: true, staleAge: '18 分鐘前', reset5h: null, eta5h: null, hitBeforeReset: null, reset7d: null, poolsNote: '（14 分鐘前）', todayNote: '（35 分鐘前）' }),
  '5-X2': spend('5-X2', {}, { eta5h: null, hitBeforeReset: null, pools: [], poolsMissing: true, todayMissing: true, todayTokens: null, tps: null, label: '缺源（額度池和今日用量）' }),
  '6-N': hygiene('6-N', {}, {}),
  '6-E': hygiene('6-E', {}, { residue: RES([]), autoHeader: '自動清理', autoRows: ['今天清了 4 個暫存檔'], loadSource: null, loadRows: undefined }),
  '6-L': hygiene('6-L', {}, { label: '說明很長' }),
  '6-X': hygiene('6-X', {}, { residue: null, label: '缺源' }),
  '6-S': hygiene('6-S', {}, { stale: true, humanNote: '（2 小時前）' }),
  '6-X2': hygiene('6-X2', {}, { loadSource: null, loadRows: undefined, loadHeader: '外掛載入 1', label: '缺源（外掛載入）' }),
  '7-N': fleet('7-N', {}, {}),
  '7-E': fleet('7-E', { speed: '—', dec: '0', act: '0', fleet: [0, 0, 0] } as Status, { lanes: undefined, label: '沒有 agent', focus: -1, sections: [{ head: '執行中 0' }, ...CARDS('待決卡：本機 0 · 他機 0')].map((s, k) => (k === 0 ? { ...s, rows: ['沒有在跑的 agent'] } : s)) }),
  '7-M': fleet('7-M', { fleet: [17, 4, 0] } as Status, {
    lanes: undefined, label: '很多 agent', focus: 2,
    sections: [
      { head: '執行中 17', rows: AGENTS17.map(([n, s]) => `${n}--claude · ${s} tok/s`) },
      { head: '失敗 4', rows: ['codex 派工 · 測試逾時', 'agy 派工 · 認證失敗', 'grok 審查 · 額度用完', 'hangar 換池 · NAS 逾時'] },
      { head: '完成 9', rows: ['docs 建置 · lab gate · fleet 重試', 'hippo 安裝 · alfred 部署 · mnemos 索引', 'codex 審查 · agy 審查 · 換池 pool-c'] },
    ],
  }),
  '7-L': fleet('7-L', {}, { focus: 8, label: '失敗原因很長' }),
  '7-X': fleet('7-X', { dec: '—', act: '—', speed: '—' } as Status, { lanes: lanes12(false), label: '缺源（本機卡、他機卡、速度）' }),
  '7-S': fleet('7-S', { stale: ['fleet'] } as Status, { label: '過時' }),
  '7-X2': fleet('7-X2', { fleet: '—', speed: '—' } as Status, { lanes: undefined, focus: -1, label: '缺源（runs 和摘要）', sections: [{ head: '執行中', rows: ['runs 讀不到'] }, { head: '待決卡：本機 3 · 他機 1' }] }),
  '8-N': todo('8-N', {}, { movedNote: '等 hippo 的時程再說', detail: ['到期 11-30（還有 4 天）· 從待決移來 11-24', '到期前不會再出現在待決'] }),
  '8-E': todo('8-E', {}, { todo: [], emptyNote: '沒有待辦。待決卡選 c 就會移到這裡。', detail: ['上一張在 11-24 回到待決。'] }),
  '8-M': todo('8-M', {}, { todo: [{ ...PLUGIN, id: 'nas', title: 'NAS 換池', dueMs: due(11, 26) }, { id: 'cert', title: '憑證輪替提醒', dueMs: due(11, 28), question: '憑證輪替要排在週末還是平日？', options: [opt('週末', '影響少；要有人值班', true), opt('平日', '有人在線上；會中斷 10 分鐘'), opt('再放一週', '到期日改到 12-05')] }, { ...MERGE }, { ...PLUGIN }, { ...REPORT }, ...[['hippo 第二批', 7], ['盤點報告', 9], ['外掛清理', 10], ['pool 續約檢查', 12], ['年度備份', 15], ['r1 重做', 18]].map(([n, d]) => ({ ...REPORT, id: String(n), title: String(n), dueMs: due(12, Number(d)) }))], cursor: 1, label: '很多張', detail: ['到期 11-28（還有 2 天）'] }),
  '8-L': todo('8-L', {}, { todo: [LONG, PLUGIN, REPORT], detail: ['附註（移來時寫的）：先確認審查結果', '到期 11-30 · 從待決移來 11-24', '退回原因：（新增資料，目前沒有資料來源）', '11-24 PM：hippo 裝完前不要合併', '11-25 PM：hippo 延到 11-29'], label: '長問題加長選項' }),
  '8-L2': todo('8-L2', {}, { todo: [LONG, PLUGIN, REPORT], detail: ['附註（移來時寫的）：先確認審查結果', '到期 11-30 · 從待決移來 11-24', '退回原因：（新增資料，目前沒有資料來源）', '11-24 PM：hippo 裝完前不要合併', '11-25 PM：hippo 延到 11-29'], label: '捲到底' }),
  '8-X': todo('8-X', {}, { todo: null, missingNote: ['待辦的資料還沒接上，這頁目前一定是空的。', '接線後讀不到的樣子同 2-X。'], detail: ['runtime 現況：沒有資料。'], warnings: ['⊘ fleet todo 還沒接線'], label: '缺源（還沒接線）' }),
  '8-S': todo('8-S', {}, { stale: true, staleNote: '（30 分鐘前）', detail: ['到期 11-30'], warnings: ['△ 待辦清單 30 分鐘前（過時）'] }),
  '9-N': help('9-N', 0, { label: '狀態圖示' }),
  '9-L': help('9-L', 1, { label: '按鍵表', detail: KEYS_NOTES }),
} as Record<string, Model>)
export function composeStep(id: string): Composed {
  const m = MODELS[id]
  if (m === undefined) throw new Error(`no model for step ${id}`)
  return m()
}
