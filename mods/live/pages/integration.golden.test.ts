// integration.golden.test.ts — pane batch 1 (S1-S4 merged): ONE synthetic console feed goes through parseConsole (the trust boundary) and each of the four real pages
// at 120x30 draws exactly H rows from what the parser kept. Fixture only, no real data. The data checks make the golden red when parseConsole drops `quota` or an item's `facts`.
import { test, expect } from 'claude-code/testing'
import { frameRows } from './frame'
import { PAGES, EXTRA_PAGES } from './index'
import { consoleOf, POOLS, SEATS, NOW, MIN } from './quota.fixture'
import { makeT } from '../i18n'
import { worstPool } from './quota-pick'
import type { ConsoleSnapshot } from '../console'

const H = 30
const COLS = 120
const text = (row: { text: string }[]) => row.map(s => s.text).join('')
const blocked = { id: 'seat_blocked:twgame-2', kind: 'seat_blocked', severity: 1, state: 'failed', needs_operator: true, title: 'twgame-2 額度用完', text: 'twgame-2 額度用完：team 池 7 天用盡', since_ms: NOW - 5 * MIN, line_id: null, to_console: true, answerable_by: [],
  facts: { seat: 'twgame-2', pool: 'team', resets_at: NOW + 3600_000, source: 'statusline', window: '7d', resets_at_text: '週四 22:00', stale: true } }
const snap = consoleOf(POOLS, { seats: SEATS, items: [blocked] }) as ConsoleSnapshot
const ctx = { live: null, console: snap, size: { cols: COLS, rows: H }, t: makeT('zh-TW'), nowMs: NOW } as never
const pageOf = (id: string) => [...PAGES, ...EXTRA_PAGES].find(p => p.id === id)!

test('integration: parseConsole keeps quota.pools, quota.seats and the seat_blocked item facts', () => {
  expect(snap.quota.pools?.length).toBe(POOLS.length)
  expect(snap.quota.seats.length).toBe(SEATS.length)
  const it = snap.items.find(i => i.kind === 'seat_blocked')
  expect(it?.facts.pool).toBe('team')
  expect(it?.facts.stale).toBe(true)
  expect(worstPool(snap.quota.pools, NOW)?.pool).toBeTruthy()
})

for (const id of ['now', 'decide', 'fleet', 'quota']) {
  test('integration: ' + id + ' draws exactly ' + H + ' rows at ' + COLS + 'x' + H + ' from the parsed feed', () => {
    expect(frameRows(pageOf(id), ctx).length).toBe(H)
  })
}

test('integration: the blocked seat reaches the 額度 page (that pool, red reason) and the 現況 page', () => {
  const quota = frameRows(pageOf('quota'), ctx).map(text).join('\n')
  expect(quota).toContain('team')
  const now = frameRows(pageOf('now'), ctx).map(text).join('\n')
  expect(now).toContain('twgame-2')
  expect(now).toContain('額度')
})
