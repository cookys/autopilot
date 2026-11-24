import assert from 'node:assert/strict'
import { ASKS_LIST_TAIL, makeAsksFeed, parseAsksJson, type CliRunner } from './v74/feeds'

const SAMPLE_ROWS = [
  { status: 'open', count: 2, at: '2026-11-24T10:00:00Z', ask: 'Which env?', answer: 'staging' },
  { status: 'open', count: 1, at: '2026-11-24T10:05:00Z', ask: 'Deploy now?', answer: null },
]

// (a) parseAsksJson valid input & empty array
assert.deepEqual(parseAsksJson(JSON.stringify(SAMPLE_ROWS)), SAMPLE_ROWS)
assert.deepEqual(parseAsksJson('[]'), [])
assert.deepEqual(ASKS_LIST_TAIL, ['list', '--answers', '--open', '--json'])

// (b) bad JSON, missing field, answer as number -> null
assert.equal(parseAsksJson('{bad'), null)
assert.equal(parseAsksJson('{}'), null)
assert.equal(parseAsksJson(JSON.stringify([{ status: 'open', count: 1, at: '2026-11-24T10:00:00Z', answer: null }])), null)
assert.equal(parseAsksJson(JSON.stringify([{ status: 'open', count: 1, at: '2026-11-24T10:00:00Z', ask: 'Q?', answer: 123 }])), null)

async function main() {
  const argv = ['node', 'scripts/pm-ask.js', ...ASKS_LIST_TAIL]

  // (c) refresh succeeds -> rows has data, fetchedMs === nowMs
  {
    const feed = makeAsksFeed(30_000)
    const run: CliRunner = async () => ({ exitCode: 0, stdout: JSON.stringify(SAMPLE_ROWS), stderr: '' })
    const ok = await feed.refresh(run, argv, 1000)
    assert.equal(ok, true)
    assert.deepEqual(feed.rows(), SAMPLE_ROWS)
    assert.equal(feed.fetchedMs(), 1000)
    assert.equal(feed.error(), null)
  }

  // (d) second refresh within TTL -> returns false and does not re-run
  {
    const feed = makeAsksFeed(30_000)
    let calls = 0
    const run: CliRunner = async () => {
      calls++
      return { exitCode: 0, stdout: JSON.stringify(SAMPLE_ROWS), stderr: '' }
    }
    assert.equal(await feed.refresh(run, argv, 1000), true)
    assert.equal(await feed.refresh(run, argv, 5000), false)
    assert.equal(calls, 1)
  }

  // (e) succeed then fail -> rows retained, error non-null
  {
    const feed = makeAsksFeed(30_000)
    let fail = false
    const run: CliRunner = async () => {
      if (fail) return { exitCode: 1, stdout: '', stderr: 'boom\ndetail' }
      return { exitCode: 0, stdout: JSON.stringify(SAMPLE_ROWS), stderr: '' }
    }
    assert.equal(await feed.refresh(run, argv, 1000), true)
    fail = true
    assert.equal(await feed.refresh(run, argv, 40_000), true)
    assert.deepEqual(feed.rows(), SAMPLE_ROWS)
    assert.equal(feed.fetchedMs(), 1000)
    assert.equal(feed.error(), 'boom（rc=1）')
  }

  // (f) exitCode !== 0 on initial fetch -> error non-null, rows === null
  {
    const feed = makeAsksFeed(30_000)
    const run: CliRunner = async () => ({ exitCode: 2, stdout: '', stderr: 'not found' })
    assert.equal(await feed.refresh(run, argv, 1000), true)
    assert.equal(feed.rows(), null)
    assert.equal(feed.fetchedMs(), null)
    assert.equal(feed.error(), 'not found（rc=2）')
  }
}

await main()
