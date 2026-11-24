import { test, expect } from 'claude-code/testing'
import { ASKS_LIST_TAIL, makeAsksFeed, parseAsksJson, type CliRunner } from './v74/feeds'

const SAMPLE_ROWS = [
  { status: 'open', count: 2, at: '2026-11-24T10:00:00Z', ask: 'Which env?', answer: 'staging' },
  { status: 'open', count: 1, at: '2026-11-24T10:05:00Z', ask: 'Deploy now?', answer: null },
]

// (a) parseAsksJson valid input & empty array
expect(parseAsksJson(JSON.stringify(SAMPLE_ROWS))).toEqual(SAMPLE_ROWS)
expect(parseAsksJson('[]')).toEqual([])
expect(ASKS_LIST_TAIL).toEqual(['list', '--answers', '--open', '--json'])

// (b) bad JSON, missing field, answer as number -> null
expect(parseAsksJson('{bad')).toBe(null)
expect(parseAsksJson('{}')).toBe(null)
expect(parseAsksJson(JSON.stringify([{ status: 'open', count: 1, at: '2026-11-24T10:00:00Z', answer: null }]))).toBe(null)
expect(parseAsksJson(JSON.stringify([{ status: 'open', count: 1, at: '2026-11-24T10:00:00Z', ask: 'Q?', answer: 123 }]))).toBe(null)

test('asks feed: parse, ttl, keep last rows, errors', async () => {
  const argv = ['node', 'scripts/pm-ask.js', ...ASKS_LIST_TAIL]

  // (c) refresh succeeds -> rows has data, fetchedMs === nowMs
  {
    const feed = makeAsksFeed(30_000)
    const run: CliRunner = async () => ({ exitCode: 0, stdout: JSON.stringify(SAMPLE_ROWS), stderr: '' })
    const ok = await feed.refresh(run, argv, 1000)
    expect(ok).toBe(true)
    expect(feed.rows()).toEqual(SAMPLE_ROWS)
    expect(feed.fetchedMs()).toBe(1000)
    expect(feed.error()).toBe(null)
  }

  // (d) second refresh within TTL -> returns false and does not re-run
  {
    const feed = makeAsksFeed(30_000)
    let calls = 0
    const run: CliRunner = async () => {
      calls++
      return { exitCode: 0, stdout: JSON.stringify(SAMPLE_ROWS), stderr: '' }
    }
    expect(await feed.refresh(run, argv, 1000)).toBe(true)
    expect(await feed.refresh(run, argv, 5000)).toBe(false)
    expect(calls).toBe(1)
  }

  // (e) succeed then fail -> rows retained, error non-null
  {
    const feed = makeAsksFeed(30_000)
    let fail = false
    const run: CliRunner = async () => {
      if (fail) return { exitCode: 1, stdout: '', stderr: 'boom\ndetail' }
      return { exitCode: 0, stdout: JSON.stringify(SAMPLE_ROWS), stderr: '' }
    }
    expect(await feed.refresh(run, argv, 1000)).toBe(true)
    fail = true
    expect(await feed.refresh(run, argv, 40_000)).toBe(true)
    expect(feed.rows()).toEqual(SAMPLE_ROWS)
    expect(feed.fetchedMs()).toBe(1000)
    expect(feed.error()).toBe('boom（rc=1）')
  }

  // (f) exitCode !== 0 on initial fetch -> error non-null, rows === null
  {
    const feed = makeAsksFeed(30_000)
    const run: CliRunner = async () => ({ exitCode: 2, stdout: '', stderr: 'not found' })
    expect(await feed.refresh(run, argv, 1000)).toBe(true)
    expect(feed.rows()).toBe(null)
    expect(feed.fetchedMs()).toBe(null)
    expect(feed.error()).toBe('not found（rc=2）')
  }
})
