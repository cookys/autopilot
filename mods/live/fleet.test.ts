// mods/live/fleet.test.ts — the Fleet tab's data, pure half (fleet.ts): parsing the hub's task tree, the stuck rules, the lane grouping and the feed's TTL.
// The mounted half (the tab drawn from a mocked `fleet tasks --tree --json`) is in live.test.ts ("G23 Fleet tab"). Run through `bash mods/live/run-tests.sh`.
import { test, expect } from 'claude-code/testing'
import { FLEET_ARGV, FLEET_MAX_BYTES, fleetLanes, makeFleetFeed, utf8Bytes, OPEN_UNACCEPTED_MS, parseFleetTasks, QUIET_MS, stuckOf, taskTitle, ulidMs } from './fleet'
import type { FleetRow } from './fleet'

const NOW = Date.parse('2026-11-03T00:00:00.000Z')
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
// a ULID for `ms` (the test's own encoder, so the decoder is checked against an independent writer)
function ulid(ms: number, tail = 'Q'.repeat(16)): string {
  let out = ''
  for (let i = 0, v = ms; i < 10; i++, v = Math.floor(v / 32)) out = CROCKFORD[v % 32] + out
  return out + tail
}
const row = (o: Record<string, unknown>) => ({ kind: 'work', source: 'reported', progress: '', observed_at: new Date(NOW - 60_000).toISOString(), ...o })

test('ulidMs reads the creation time a task id carries; a non-ULID is null', () => {
  expect(ulidMs(ulid(NOW - 7_000))).toBe(NOW - 7_000)
  expect(ulidMs('01M6FA4ZXD73GRFN6QCPNSXPRY')).toBe(Date.parse('2026-11-02T23:40:12.077Z')) // a real hub id: the G23 dispatch
  expect(ulidMs('not-an-id')).toBe(null)
  expect(ulidMs('01M6FA4ZXD73GRFN6QCPNSXPRU')).toBe(null) // U is not a Crockford digit
})

test('a brief header is not a title: the row falls back to its progress, then to its id', () => {
  expect(taskTitle('[REG a1] events contract', 'x', 'ID')).toBe('[REG a1] events contract')
  expect(taskTitle('Engine: claude-opus-5-5 | Role: implementer | Lane: codeforge', 'G23 started\nmore', 'ID')).toBe('G23 started')
  expect(taskTitle('Engine: x | Role: y | Lane: z', '', '01M6FA4ZXD73GRFN6QCPNSXPRY')).toBe('CPNSXPRY')
})

test('parseFleetTasks keeps work rows and drops observed runs and finished rows; a non-list is an error', () => {
  const json = JSON.stringify([
    row({ task_id: ulid(NOW - 600_000), state: 'running', title: 'live', assignee: 'host-a/autopilot--claude' }),
    row({ task_id: ulid(NOW - 600_000, 'R'.repeat(16)), state: 'unknown', title: 'pid 42', assignee: 'host-a/autopilot--claude', kind: 'observed_run' }),
    row({ task_id: ulid(NOW - 600_000, 'S'.repeat(16)), state: 'done', title: 'shipped', assignee: 'openclaw/hangar--claude' }),
    row({ task_id: ulid(NOW - 600_000, 'T'.repeat(16)), state: 'TASK_ACCEPTED', title: 'ack', assignee: 'solo' }),
  ])
  const { rows, capped } = parseFleetTasks(json)
  expect(capped).toBe(0)
  expect(rows.map(r => r.title)).toEqual(['live', 'ack'])
  expect(rows[0]).toMatchObject({ lane: 'autopilot--claude', host: 'host-a', state: 'running', createdMs: NOW - 600_000, observedMs: NOW - 60_000 })
  expect(rows[1]).toMatchObject({ lane: 'solo', host: '', state: 'task_accepted' })
  expect(() => parseFleetTasks('{"members":[]}')).toThrow()
})

test('a waiting row says what it waits on: a linked watch first, else a live child (an observed run counts); a finished child or a row that is not waiting says nothing', () => {
  const W = ulid(NOW - 60_000, 'W'.repeat(16)), C = ulid(NOW - 60_000, 'C'.repeat(16)), D = ulid(NOW - 60_000, 'D'.repeat(16)), R = ulid(NOW - 60_000, 'R'.repeat(16))
  const { rows } = parseFleetTasks(JSON.stringify([
    row({ task_id: W, state: 'waiting', title: 'w', assignee: 'h/a--claude', watch_ids: ['01WATCH'] }),
    row({ task_id: C, state: 'waiting', title: 'c', assignee: 'h/a--claude', watch_ids: [] }),
    row({ task_id: ulid(NOW, 'K'.repeat(16)), state: 'unknown', title: 'pid 9', assignee: 'h/a--claude', kind: 'observed_run', parent_task_id: C }),
    row({ task_id: D, state: 'waiting', title: 'd', assignee: 'h/a--claude' }),
    row({ task_id: ulid(NOW, 'E'.repeat(16)), state: 'done', title: 'finished child', assignee: 'h/b--claude', parent_task_id: D }),
    row({ task_id: R, state: 'running', title: 'r', assignee: 'h/a--claude', watch_ids: ['01WATCH'] }),
  ]))
  expect(rows.map(r => [r.title, r.waitsOn])).toEqual([['w', 'watch'], ['c', 'child'], ['d', null], ['r', null]])
})

test('a child that failed or was lost is not waited on (review g1): the parent says nothing; the failed child row itself still shows', () => {
  for (const ended of ['failed', 'lost', 'FAILED']) {
    const P = ulid(NOW - 60_000, 'P'.repeat(16)), K = ulid(NOW - 30_000, 'K'.repeat(16))
    const { rows } = parseFleetTasks(JSON.stringify([
      row({ task_id: P, state: 'waiting', title: 'parent', assignee: 'h/a--claude' }),
      row({ task_id: K, state: ended, title: 'only child', assignee: 'h/b--claude', parent_task_id: P }),
    ]))
    expect(rows.map(r => [r.title, r.waitsOn]), ended).toEqual([['parent', null], ['only child', null]])
  }
})

test('work rows past the cap are counted, not kept (review g1)', () => {
  const json = JSON.stringify([0, 1, 2, 3].map(i => row({ task_id: ulid(NOW - i * 1000, String(i).repeat(16)), state: 'running', title: 't' + i, assignee: 'h/a--claude' })))
  const { rows, capped } = parseFleetTasks(json, 3)
  expect(rows.map(r => r.title)).toEqual(['t0', 't1', 't2'])
  expect(capped).toBe(1)
})

test('an output over the byte bound, or one the engine cut, is refused and the last rows stay (review g1)', async () => {
  const good = JSON.stringify([row({ task_id: ulid(NOW), state: 'running', title: 'kept', assignee: 'h/a--claude' })])
  let reply: { exitCode: number; stdout: string; stderr: string; isStdoutTruncated?: boolean } = { exitCode: 0, stdout: good, stderr: '' }
  const feed = makeFleetFeed(0)
  const run = async () => reply
  expect(await feed.refresh(run, NOW)).toBe(true)
  expect(feed.rows().map(r => r.title)).toEqual(['kept'])
  reply = { exitCode: 0, stdout: '[' + ' '.repeat(FLEET_MAX_BYTES) + ']', stderr: '' }
  expect(await feed.refresh(run, NOW + 1)).toBe(true)
  expect(feed.error()).toContain('not read')
  expect(feed.rows().map(r => r.title)).toEqual(['kept'])
  expect(feed.fetchedMs()).toBe(NOW)
  // review g2: the bound is UTF-8 bytes, not UTF-16 units: CJK text under the bound in `length` but over it in bytes is refused too
  const cjk = '["' + '中'.repeat(Math.ceil(FLEET_MAX_BYTES / 3) + 10) + '"]'
  expect(cjk.length).toBeLessThan(FLEET_MAX_BYTES)
  expect(utf8Bytes(cjk)).toBeGreaterThan(FLEET_MAX_BYTES)
  reply = { exitCode: 0, stdout: cjk, stderr: '' }
  expect(await feed.refresh(run, NOW + 2)).toBe(true)
  expect(feed.error()).toContain('not read')
  expect(feed.rows().map(r => r.title)).toEqual(['kept'])
  expect(feed.fetchedMs()).toBe(NOW)
  reply = { exitCode: 0, stdout: good.replace('kept', 'cut'), stderr: '', isStdoutTruncated: true }
  expect(await feed.refresh(run, NOW + 3)).toBe(true)
  expect(feed.error()).toContain('not read')
  expect(feed.rows().map(r => r.title)).toEqual(['kept'])
})

test('utf8Bytes counts UTF-8 bytes: ASCII 1, Latin-1 and Greek 2, CJK 3, an astral pair 4, a lone surrogate 3 (as U+FFFD)', () => {
  expect(utf8Bytes('')).toBe(0)
  expect(utf8Bytes('ab')).toBe(2)
  expect(utf8Bytes('é')).toBe(2)
  expect(utf8Bytes('中文')).toBe(6)
  expect(utf8Bytes('𝄞')).toBe(4)
  expect(utf8Bytes('\ud800x')).toBe(4)
})

const r = (o: Partial<FleetRow>): FleetRow => ({ id: ulid(NOW - 60_000), lane: 'a--claude', host: 'h', title: 't', progress: '', state: 'running', createdMs: NOW - 60_000, observedMs: NOW - 60_000, ...o })

test('stuck: open past the hour unaccepted, a seat quiet past four hours, the hub own suspect / lost / blocked_human; each just inside its bound is not', () => {
  expect(stuckOf(r({ state: 'open', createdMs: NOW - OPEN_UNACCEPTED_MS - 1 }), NOW)).toBe('unaccepted')
  expect(stuckOf(r({ state: 'open', createdMs: NOW - OPEN_UNACCEPTED_MS }), NOW)).toBe(null)
  expect(stuckOf(r({ state: 'task_accepted', createdMs: NOW - 10 * OPEN_UNACCEPTED_MS }), NOW)).toBe(null) // accepted: the hour rule is about nobody taking it
  expect(stuckOf(r({ observedMs: NOW - QUIET_MS - 1 }), NOW)).toBe('quiet')
  expect(stuckOf(r({ observedMs: NOW - QUIET_MS }), NOW)).toBe(null)
  for (const s of ['suspect', 'lost', 'blocked_human']) expect(stuckOf(r({ state: s }), NOW)).toBe('hub')
})

test('lanes: in flight (stuck first, then newest) before upcoming (oldest first); a lane with a stuck row first, then the busiest, then by name', () => {
  const rows: FleetRow[] = [
    r({ id: 'b1', lane: 'b--claude', state: 'running', createdMs: NOW - 5_000 }),
    r({ id: 'b2', lane: 'b--claude', state: 'running', createdMs: NOW - 1_000 }),
    r({ id: 'c1', lane: 'c--claude', state: 'running', createdMs: NOW - 1_000 }),
    r({ id: 'a1', lane: 'a--claude', state: 'running', createdMs: NOW - 9_000 }),
    r({ id: 'a2', lane: 'a--claude', state: 'open', createdMs: NOW - 1_000 }),
    r({ id: 'a3', lane: 'a--claude', state: 'open', createdMs: NOW - OPEN_UNACCEPTED_MS - 5 }),
    r({ id: 'a4', lane: 'a--claude', state: 'running', createdMs: NOW - 2_000, observedMs: NOW - QUIET_MS - 5 }),
  ]
  const lanes = fleetLanes(rows, NOW)
  expect(lanes.map(l => l.lane)).toEqual(['a--claude', 'b--claude', 'c--claude'])
  expect(lanes[0].inflight.map(t => t.id)).toEqual(['a4', 'a1'])
  expect(lanes[0].upcoming.map(t => t.id)).toEqual(['a3', 'a2'])
  expect(lanes[0].stuck).toBe(2)
  expect(lanes[1].inflight.map(t => t.id)).toEqual(['b2', 'b1'])
  expect(lanes[0].upcoming[0]).toMatchObject({ stuck: 'unaccepted', ageMs: OPEN_UNACCEPTED_MS + 5, inflight: false })
})

test('the feed runs the CLI once per TTL and never twice at once; a failed run keeps the last rows and their time and reports the error', async () => {
  const calls: string[] = []
  let reply: { exitCode: number; stdout: string; stderr: string } = { exitCode: 0, stdout: JSON.stringify([row({ task_id: ulid(NOW), state: 'running', title: 'x', assignee: 'h/a--claude' })]), stderr: '' }
  let release: () => void = () => {}
  let gate: Promise<void> | null = null
  const run = async (argv: readonly string[]) => {
    calls.push(argv.join(' '))
    if (gate !== null) await gate
    return reply
  }
  const feed = makeFleetFeed(30_000)
  expect(await feed.refresh(run, NOW)).toBe(true)
  expect(calls).toEqual([FLEET_ARGV.join(' ')])
  expect(feed.rows().length).toBe(1)
  expect(feed.fetchedMs()).toBe(NOW)
  expect(await feed.refresh(run, NOW + 29_999)).toBe(false) // inside the TTL
  gate = new Promise<void>(res => { release = res })
  const slow = feed.refresh(run, NOW + 30_000)
  expect(await feed.refresh(run, NOW + 90_000, true)).toBe(false) // one run at a time, even forced
  release()
  expect(await slow).toBe(true)
  gate = null
  reply = { exitCode: 2, stdout: '', stderr: 'hub unreachable\nretry later' }
  expect(await feed.refresh(run, NOW + 60_000)).toBe(true)
  expect(feed.error()).toBe('hub unreachable')
  expect(feed.rows().length).toBe(1) // the last good rows stay
  expect(feed.fetchedMs()).toBe(NOW + 30_000) // and their time: the pane shows how old they are
  reply = { exitCode: 0, stdout: 'not json', stderr: '' }
  expect(await feed.refresh(run, NOW + 90_000)).toBe(true)
  expect(feed.error()).not.toBe(null)
  expect(calls.length).toBe(4)
})
