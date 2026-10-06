// P7b (plugin load-source chip): model-level cases for the hygiene slot's load-source chip. The watcher publishes
// <live>/load-source.json (src/status/load-source.js, hooks/tests/load-source.test.sh); mods/live/model.ts reads it
// (readLoadSource) and turns it into the chip text (hygieneChip). Rendering the full band is P7.
import { test, expect } from 'claude-code/testing'
import { readLoadSource, hygieneChip, loadSourceFor, LOAD_SOURCE_SCHEMA } from './model'

const fact = (over: Record<string, unknown> = {}) => JSON.stringify({
  schema: LOAD_SOURCE_SCHEMA, checked_at: '2026-10-06T10:00:00.000Z', plugin_version: '2.37.0', source: 'dev', source_basis: 'dev_link',
  marketplace: 'directory', marketplace_path: '/home/t/autopilot', marketplace_is_dev: true, dev_link_ok: true, behind_upstream: 0,
  flags: [], stale_cache_dirs: [], ...over,
})
const CACHE_DIR = '/home/t/.claude/plugins/cache/autopilot/autopilot/2.36.36'
const cacheFact = (over: Record<string, unknown> = {}) => fact({
  source: 'cache:2.36.36', source_basis: 'any_alive_pid', flags: ['stale_cache_dirs', 'loaded_from_cache'],
  stale_cache_dirs: [{ dir: CACHE_DIR, in_use_pids: ['1808913', '2097570'], alive: ['2097570'] }], ...over,
})

test('P7b chip: the real dev tree reads `dev`, behind upstream adds the count', () => {
  expect(hygieneChip(readLoadSource(fact()))).toEqual({ text: 'dev', warn: false })
  expect(hygieneChip(readLoadSource(fact({ behind_upstream: 3 })))).toEqual({ text: 'dev ↓3', warn: false })
  expect(hygieneChip(readLoadSource(fact({ behind_upstream: null })))).toEqual({ text: 'dev', warn: false })
})

test('P7b chip: a planted semver cache dir in use by a live pid reads `cache <semver> ⚠`', () => {
  const v = readLoadSource(cacheFact())
  expect(v?.source).toBe('cache:2.36.36')
  expect(hygieneChip(v)).toEqual({ text: 'cache 2.36.36 ⚠', warn: true })
})

test('P7b chip: a non-directory marketplace is flagged even when the dev link loads', () => {
  const v = readLoadSource(fact({ marketplace: 'github', marketplace_is_dev: false, flags: ['marketplace_not_directory'] }))
  expect(hygieneChip(v)).toEqual({ text: 'dev ⚠', warn: true })
})

test('P7b chip: the session pid narrows the watcher reading to the copy that session listed', () => {
  const v = readLoadSource(cacheFact())!
  expect(loadSourceFor(v, '2097570')).toBe('cache:2.36.36') // this session is in the cache dir's .in_use
  expect(loadSourceFor(v, 4242)).toBe('dev') // another session holds the cache copy; this one is in none: dev
  expect(hygieneChip(v, 4242)?.text).toBe('dev')
  expect(loadSourceFor(readLoadSource(cacheFact({ flags: ['dev_link_missing_or_stale'] }))!, 4242)).toBe('unknown')
})

test('P7b chip: unknown source, an absent file and a foreign schema', () => {
  expect(hygieneChip(readLoadSource(fact({ source: 'unknown', source_basis: 'none', dev_link_ok: false })))).toEqual({ text: 'src ? ⚠', warn: true })
  expect(hygieneChip(readLoadSource(null))).toBeNull()
  expect(readLoadSource(fact({ schema: 'something/else' }))).toBeNull()
  expect(readLoadSource('not json')).toBeNull()
})
