// mods/live/addrcomplete.test.ts — B73: prompt-box completion for fleet seats (@@) and project owners (p#). Pure matching, the cache rule, and the mounted hook through register.ts.
import { test, expect, mock } from 'claude-code/testing'
import { ADDR_TTL_MS, addrSuggestions, makeAddrFeed, ownerSuggestions, parseOwners, parseSeats, seatSuggestions } from './addrcomplete'
import { makeT } from './i18n'

const tEn = makeT('en')
const tZh = makeT('zh-TW')
const seat = (member: string, project: string, state: string, courier = 'aimax395-team', namespace = 'cookys') => ({ member, project, state, courier, namespace, harness: 'claude', activity: 'idle' })
const PEERS = JSON.stringify({ members: [
  seat('codeforge--claude', 'codeforge', 'live'),
  seat('autopilot--claude', 'autopilot', 'gone'),
  seat('autopilot--codex', 'autopilot', 'live', 'cuda'),
  seat('cobra--claude', 'cobra', 'live'),
  seat('autopilot--claude', 'autopilot', 'gone'), // duplicate address
  { member: 'x' }, 'junk', null, 7,
] })
const OWNERS = JSON.stringify({ owners: [
  { project: 'codeforge', owner: 'cookys/aimax395-team/codeforge--claude', backup: 'cookys/cuda/cf--claude', lead: null, role: '操作員的鍛造間 CLI 面板與狀態列負責人，長篇描述長篇描述長篇描述長篇描述長篇描述長篇描述長篇描述長篇描述長篇描述長篇描述長篇描述長篇描述' },
  { project: 'codeforge-docs', owner: 'cookys/a/docs--claude', backup: null, lead: null, role: 'docs' },
  { project: 'autopilot', owner: 'cookys/aimax395-team/autopilot--claude', backup: null, lead: null, role: 'plugin' },
  { project: 7, owner: 'bad' }, { project: 'noowner' }, 'junk',
] })

test('parseSeats / parseOwners drop malformed rows and throw on a wrong envelope', () => {
  expect(parseSeats(PEERS).map(s => s.address)).toEqual(['cookys/aimax395-team/codeforge--claude', 'cookys/aimax395-team/autopilot--claude', 'cookys/cuda/autopilot--codex', 'cookys/aimax395-team/cobra--claude', 'cookys/aimax395-team/autopilot--claude'])
  expect(parseOwners(OWNERS).map(o => o.project)).toEqual(['codeforge', 'codeforge-docs', 'autopilot'])
  expect(() => parseSeats('{"x":1}')).toThrow()
  expect(() => parseOwners('[]')).toThrow()
  expect(() => parseSeats('not json')).toThrow()
})

test('@@ matches member, project or courier; live first, then member; duplicates collapse; label and description', () => {
  const seats = parseSeats(PEERS)
  const all = seatSuggestions(seats, '')
  expect(all.map(s => s.label)).toEqual(['@@autopilot--codex', '@@cobra--claude', '@@codeforge--claude', '@@autopilot--claude'])
  expect(seatSuggestions(seats, 'CO').map(s => s.label)).toEqual(['@@autopilot--codex', '@@cobra--claude', '@@codeforge--claude']) // 'co' in cobra, codeforge, autopilot--codex (live all three; member order)
  const cuda = seatSuggestions(seats, 'cuda')
  expect(cuda).toEqual([{ text: 'cookys/cuda/autopilot--codex', label: '@@autopilot--codex', description: 'cuda · autopilot · live' }])
  expect(seatSuggestions(seats, 'zzz')).toEqual([])
  const many = Array.from({ length: 20 }, (_, i) => seat('m' + String(i).padStart(2, '0') + '--claude', 'p', 'live'))
  expect(seatSuggestions(parseSeats(JSON.stringify({ members: many })), 'm')).toHaveLength(8)
})

test('p# matches by prefix, exact first, a CJK role is cut by characters, backup is shown', () => {
  const owners = parseOwners(OWNERS)
  const rows = ownerSuggestions(owners, 'p#codeforge', tEn)
  expect(rows.map(r => r.label)).toEqual(['p#codeforge', 'p#codeforge-docs'])
  expect(rows[0].text).toBe('cookys/aimax395-team/codeforge--claude')
  expect(rows[0].description?.startsWith('owner 操作員的鍛造間 CLI')).toBe(true)
  expect(rows[0].description?.endsWith('… · cookys/cuda/cf--claude')).toBe(true)
  expect(Array.from(rows[0].description!.split(' · ')[0]).length).toBeLessThanOrEqual(6 + 1 + 60 + 1)
  expect(ownerSuggestions(owners, 'p#CODEFORGE-', tZh)[0].description).toBe('負責人 docs')
  expect(ownerSuggestions(owners, 'p#', tEn)).toHaveLength(3)
})

test('p# with the registry unavailable is one row, token unchanged, no guessed address', () => {
  expect(ownerSuggestions(null, 'p#cod', tEn)).toEqual([{ text: 'p#cod', description: 'project registry unavailable' }])
  expect(ownerSuggestions(null, 'p#cod', tZh)[0].description).toBe('專案名冊讀不到')
})

const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '' })
const runnerOf = (peers: ReturnType<typeof ok>, owners: ReturnType<typeof ok>) => {
  const calls: string[] = []
  const run = async (argv: readonly string[]) => { calls.push(argv.join(' ')); return argv[1] === 'peers' ? peers : owners }
  return { run, calls }
}

test('registry exit 2 leaves owners null: the hook answers the single unavailable row; a project known only from seats gets the no-owner row', async () => {
  const feed = makeAddrFeed()
  const { run } = runnerOf(ok(PEERS), { exitCode: 2, stdout: '', stderr: 'not published' })
  await feed.refresh(run, 1000)
  expect(feed.owners()).toBe(null)
  expect(addrSuggestions('p#cobra', feed, 1000, () => {}, tEn)).toEqual([{ text: 'p#cobra', description: 'project registry unavailable' }])
  const feed2 = makeAddrFeed()
  await feed2.refresh(runnerOf(ok(PEERS), ok(OWNERS)).run, 1000)
  expect(addrSuggestions('p#cob', feed2, 1000, () => {}, tZh)).toEqual([{ text: 'p#cob', label: 'p#cobra', description: '未設負責人' }])
})

test('cache: the hook answers without awaiting the runner and starts one refresh when stale; fresh cache starts none', async () => {
  const feed = makeAddrFeed()
  let release: () => void = () => {}
  const gate = new Promise<void>(r => { release = r })
  let runs = 0
  const run = async (argv: readonly string[]) => { runs++; await gate; return argv[1] === 'peers' ? ok(PEERS) : ok(OWNERS) }
  let kicks = 0
  const kick = () => { kicks++; void feed.refresh(run, 5000) }
  expect(addrSuggestions('@@co', feed, 5000, kick, tEn)).toEqual([]) // nothing cached yet: empty, and it did not wait
  expect(kicks).toBe(1)
  expect(addrSuggestions('@@co', feed, 5001, kick, tEn)).toEqual([]) // in flight: the attempt time is already recorded, so it is not stale and nothing is kicked again
  release()
  await new Promise(r => setTimeout(r, 0))
  expect(runs).toBe(2) // one peers + one owners
  const fresh = addrSuggestions('@@co', feed, 5000 + ADDR_TTL_MS - 1, kick, tEn)
  expect(fresh!.length).toBe(3)
  expect(kicks).toBe(1)
  addrSuggestions('@@co', feed, 5000 + ADDR_TTL_MS, kick, tEn)
  expect(kicks).toBe(2)
})

test('other tokens pass through (null); malformed output keeps the last good seats', async () => {
  const feed = makeAddrFeed()
  expect(addrSuggestions('@x', feed, 0, () => { throw new Error('kicked') }, tEn)).toBe(null)
  expect(addrSuggestions('#p', feed, 0, () => { throw new Error('kicked') }, tEn)).toBe(null)
  await feed.refresh(runnerOf(ok(PEERS), ok(OWNERS)).run, 0)
  const before = feed.seats().length
  await feed.refresh(runnerOf(ok('{garbage'), ok('{"owners":"x"}')).run, 100_000)
  expect(feed.seats().length).toBe(before)
  expect(feed.owners()).toBe(null)
})

async function host($, on, peers: string) {
  const root = '/fixture/addr'
  mock.clock(on, { now: Date.parse('2026-11-27T01:00:00Z') })
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? root : e.name === 'AUTOPILOT_LOCALE' ? 'zh-TW' : undefined }))
  on('fs.read', () => { throw new Error('ENOENT') })
  on('fs.exists', () => ({ value: false }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', (_, e) => ({ value: { kind: e.path === root ? 'dir' : 'file', size: 1, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('config.list', () => ({ value: [] }))
  on('session.id', () => ({ value: 'addr-fixture' }))
  on('session.cwd', () => ({ value: root }))
  on('session.root', () => ({ value: root }))
  on('session.start', () => ({ cwd: root }))
  on('session.end', () => ({ sessionId: 'addr-fixture' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('process.run', (_, e) => {
    const argv = (e as { argv?: string[] }).argv ?? []
    const out = argv[1] === 'peers' ? peers : argv[1] === 'owners' ? OWNERS : ''
    return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))
  on('prompt.autocomplete', () => ({ suggestions: [] })) // the host's own rows: none
}

test('mounted hook: @@co and p#codeforge through register.ts answer from the cache once the first refresh landed; other tokens add nothing', async ($, on) => {
  await host($, on, PEERS)
  await $.session.start({ surface: 'terminal', cwd: '/fixture/addr' })
  const ask = async (token: string) => (await $.prompt.autocomplete({ text: token, cursor: token.length, token, start: 0 })).suggestions
  expect(await ask('@@co')).toEqual([]) // first ask: cache empty, refresh kicked
  await new Promise(r => setTimeout(r, 50))
  expect((await ask('@@co')).map(s => s.label)).toEqual(['@@autopilot--codex', '@@cobra--claude', '@@codeforge--claude'])
  const p = await ask('p#codeforge')
  expect(p.map(s => s.label)).toEqual(['p#codeforge', 'p#codeforge-docs'])
  expect(p[0].description?.startsWith('負責人 ')).toBe(true)
})
