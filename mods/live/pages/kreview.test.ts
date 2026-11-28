// kreview.test.ts — 審查 page 候選教訓區塊 (fleet 01M8ARXSD4): block renders when the feed has pending candidates, stays
// hidden with none, draws the broken-source row on a feed error, marks the focused row with ‣, keeps every row inside the
// frame width with CJK topics, and routes a/x to the kreview decision action.
import { test, expect } from 'claude-code/testing'
import { makeT } from '../i18n'
import type { LiveSnapshot } from '../model'
import { NO_DETAIL, NO_SECTIONS, displayWidth } from '../model'
import type { PageCtx, Row } from './frame'
import { routeKey } from './keys'
import { parseKReviewList } from '../v74/feeds'
import { DEFAULT_REVIEW_VIEW, renderReview } from './review'
import type { KReviewCandidate } from '../v74/contract'

const t = makeT('zh-TW')
const NOW = 1794200000000
const text = (row: Row): string => row.map(s => s.text).join('')

const cand = (over: Partial<KReviewCandidate> = {}): KReviewCandidate => ({
  key: over.key ?? 'a1b2c3d4e5f6',
  topic: over.topic ?? 'statusline 一行規則被 guard 蓋掉',
  pitfall: over.pitfall ?? 'guard 順序',
  solution: over.solution ?? '先畫再擋',
  tool: over.tool ?? 'codeforge',
  repo: over.repo ?? 'codeforge',
  count: over.count ?? 1,
})

const CANDS: KReviewCandidate[] = [
  cand(),
  cand({ key: 'b2c3d4e5f6a1', topic: 'json.dump 重寫 golden 檔', pitfall: '格式漂移', solution: 'sed 單行替換', tool: 'python', repo: 'autopilot', count: 3 }),
  cand({ key: 'c3d4e5f6a1b2', topic: 'COLORFGBG 尾欄才是底色', pitfall: '語義反讀', solution: '實跑驗證', tool: '', repo: '', count: 2 }),
]

const live = (): LiveSnapshot =>
  ({
    state: 'ok',
    text: '',
    header: '',
    band: null,
    pending: [],
    project_key: 'plan/x',
    root_run_id: null,
    link: null,
    rows: null,
    gates: null,
    sections: { ...NO_SECTIONS },
    review: null,
    published_at: null,
    watcher_note: null,
    session_as_of: null,
    host_as_of: null,
    detail: { ...NO_DETAIL, now_ms: NOW, project: 'plan/x', qc: null, decisions: null },
  }) as unknown as LiveSnapshot

const ctxOf = (cols: number, v74: PageCtx['v74']): PageCtx => ({
  live: live(),
  console: null,
  size: { cols, rows: 40 },
  t,
  nowMs: NOW,
  v74,
})

const body = (ctx: PageCtx, focus = 0): Row[] => renderReview(ctx, { ...DEFAULT_REVIEW_VIEW, focus }).body

test('kr: pending candidates draw the section rule and one row each (topic · pitfall→solution · tool@repo, ×count)', () => {
  const rows = body(ctxOf(120, { kreview: CANDS, kreviewError: null }))
  const texts = rows.map(text)
  const rule = texts.find(s => s.includes('候選教訓 3 則'))
  expect(rule).toBeDefined()
  expect(texts.some(s => s.includes('statusline 一行規則被 guard 蓋掉') && s.includes('guard 順序→先畫再擋') && s.includes('codeforge@codeforge'))).toBe(true)
  expect(texts.some(s => s.includes('json.dump 重寫 golden 檔') && s.includes('×3'))).toBe(true)
  // a candidate with no tool/repo draws no dangling separator
  expect(texts.some(s => s.includes('COLORFGBG 尾欄才是底色') && s.includes('·×2'))).toBe(true)
})

test('kr: an empty list draws no block at all', () => {
  const rows = body(ctxOf(120, { kreview: [], kreviewError: null }))
  expect(rows.map(text).some(s => s.includes('候選教訓'))).toBe(false)
})

test('kr: no v74 ctx (source not wired) draws nothing and stays back-compat', () => {
  const rows = body(ctxOf(120, undefined))
  expect(rows.map(text).some(s => s.includes('候選教訓'))).toBe(false)
})

test('kr: a feed error on a not-yet-successful fetch draws the broken-source row with the reason', () => {
  const rows = body(ctxOf(120, { kreview: null, kreviewError: 'Cannot determine seat lane（rc=2）' }))
  const texts = rows.map(text)
  const broken = texts.find(s => s.includes('候選教訓讀不到：Cannot determine seat lane（rc=2）'))
  expect(broken).toBeDefined()
})

test('kr: the focused row takes the ‣ cursor, the others keep their indent', () => {
  const rows = body(ctxOf(120, { kreview: CANDS, kreviewError: null }), 1)
  const marked = rows.filter(r => r.some(s => s.text.startsWith('‣')))
  expect(marked).toHaveLength(1)
  expect(text(marked[0])).toContain('json.dump 重寫 golden 檔')
})

test('kr: a focus past the list length (a decision shrank it) still marks exactly one row, the last', () => {
  // 3 candidates, j pressed twice (focus=2), a decided one -> 2 rows; the cursor must clamp to the last row
  const rows = body(ctxOf(120, { kreview: CANDS.slice(0, 2), kreviewError: null }), 2)
  const marked = rows.filter(r => r.some(s => s.text.startsWith('‣')))
  expect(marked).toHaveLength(1)
  expect(text(marked[0])).toContain('json.dump 重寫 golden 檔')
})

test('kr: CJK topics stay inside the frame width on every row', () => {
  const wide: KReviewCandidate[] = Array.from({ length: 5 }, (_, i) =>
    cand({ key: `k${i}`, topic: '操作員固定準則：狀態列永遠一行、寵物只在自己的分頁畫，寬字元主題也要照規則切', pitfall: '寬字元', solution: 'chars().take', tool: 'codeforge', repo: 'codeforge' }))
  for (const cols of [80, 120, 209]) {
    for (const rows of body(ctxOf(cols, { kreview: wide, kreviewError: null }))) {
      expect(displayWidth(text(rows))).toBeLessThanOrEqual(cols)
    }
  }
})

test('kr: a/x on the review page route to the kreview decision action, elsewhere they do not', () => {
  expect(routeKey('a', { page: 'review', paneFocus: true, focusedButton: false, textMode: false })).toEqual({ kind: 'kreview', verdict: 'approved' })
  expect(routeKey('x', { page: 'review', paneFocus: true, focusedButton: false, textMode: false })).toEqual({ kind: 'kreview', verdict: 'rejected' })
  // on 待決 a/x keep their own meanings (pick / preview-cancel)
  expect(routeKey('x', { page: 'decide', paneFocus: true, focusedButton: false, textMode: false })).not.toEqual({ kind: 'kreview', verdict: 'rejected' })
})

test('kr: parseKReviewList rejects a key outside the CLI key alphabet (it becomes a CLI argument)', () => {
  const ok = parseKReviewList(JSON.stringify([{ key: 'a1b2c3d4e5f6', status: 'pending', count: 1, topic: 't', pitfall_type: '', solution_type: '', tool: '', repo: '' }]))
  expect(ok).not.toBeNull()
  expect(ok![0].key).toBe('a1b2c3d4e5f6')
  for (const bad of ['--help', 'a b', 'x;rm', '']) {
    const out = parseKReviewList(JSON.stringify([{ key: bad, status: 'pending', count: 1, topic: 't' }]))
    expect(out).toBeNull()
  }
})
