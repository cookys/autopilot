import type { Register } from 'claude-code'

const W = '$C1'
const GEN = 'g' + Math.random().toString(36).slice(2, 8)
const LOG = W + '/out/events.log'

let n = 0
let renders = 0
let timer: { cancel: () => void } | undefined

const note = async ($: any, text: string) => {
  let cur = ''
  try { cur = await $.fs.read(LOG) } catch (_e) { cur = '' }
  await $.fs.write(LOG, cur + String(await $.clock.now()) + ' ' + GEN + ' ' + text + '\n')
}

const probe = async (label: string, f: () => Promise<unknown>) => {
  try {
    const v = await f()
    const text = typeof v === 'string' ? v : JSON.stringify(v)
    return { label, ok: true, length: text === undefined ? 0 : text.length, value: text === undefined ? null : text.slice(0, 200) }
  } catch (err) {
    const x = err as { code?: string; message?: string; name?: string }
    return { label, ok: false, errno: x.code ?? null, name: x.name ?? null, message: String(x.message ?? err).slice(0, 200) }
  }
}

const supply = async ($: any, tag: string) => {
  const sid = await $.session.id()
  const cwd = await $.session.cwd()
  const home = await $.env.get('HOME')
  const xdg = await $.env.get('XDG_RUNTIME_DIR')
  const H = home ?? '/nonexistent'
  const results: unknown[] = []
  results.push(await probe('session.id', async () => sid))
  results.push(await probe('session.cwd', async () => cwd))
  results.push(await probe('session.root', () => $.session.root()))
  results.push(await probe('fs.stat(cwd,resolve).realPath', async () => (await $.fs.stat(cwd, { resolve: true })).realPath))
  results.push(await probe('env.HOME', async () => home))
  results.push(await probe('env.XDG_RUNTIME_DIR', async () => xdg))
  results.push(await probe('read HOME/.autopilot/live-pointer.json', () => $.fs.read(H + '/.autopilot/live-pointer.json')))
  results.push(await probe('read /dev/shm/s7-fixture/live.json', () => $.fs.read('/dev/shm/s7-fixture/live.json')))
  results.push(await probe('read HOME/.autopilot/session-mode/<sid>.json', () => $.fs.read(H + '/.autopilot/session-mode/' + sid + '.json')))
  results.push(await probe('read HOME/.autopilot/review/projkey/live/runs.k1.json', () => $.fs.read(H + '/.autopilot/review/projkey/live/runs.k1.json')))
  results.push(await probe('list /dev/shm/s7-fixture/runs/paths', () => $.fs.list('/dev/shm/s7-fixture/runs/paths')))
  results.push(await probe('list HOME/.autopilot/livefix/runs/paths', () => $.fs.list(H + '/.autopilot/livefix/runs/paths')))
  results.push(await probe('read tilde ~/.autopilot/live-pointer.json', () => $.fs.read('~/.autopilot/live-pointer.json')))
  results.push(await probe('read abs /etc/hostname', () => $.fs.read('/etc/hostname')))
  await $.fs.write(W + '/out/supply-' + tag + '.json', JSON.stringify({ sid, tag, results }, null, 1))
}

const arm = async ($: any, why: string) => {
  if (timer) { await note($, 'arm skipped (' + why + '): timer already held'); return }
  timer = $.clock.every(1000, async () => {
    n += 1
    await note($, 'tick ' + n + ' sid=' + (await $.session.id()))
  })
  await note($, 'armed (' + why + ')')
}


export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await note($, 'EVENT session.start surface=' + e.surface)
    await supply($, 'start-' + GEN)
    await arm($, 'session.start')
    return next(e)
  })
  on('session.end', async ($, e, next) => {
    await note($, 'EVENT session.end reason=' + e.reason + ' (timer NOT cancelled by us)')
    return next(e)
  })
  on('classic.SessionStart', async ($, e, next) => {
    await note($, 'EVENT classic.SessionStart source=' + (e as any).source)
    if ((e as any).source === 'clear') await supply($, 'after-clear-' + GEN + '-t' + n)
    return next(e)
  })
  on('classic.SessionEnd', async ($, e, next) => {
    await note($, 'EVENT classic.SessionEnd reason=' + (e as any).reason)
    return next(e)
  })
  on('turn.start', async ($, e, next) => { await note($, 'EVENT turn.start'); return next(e) })
  on('turn.complete', async ($, e, next) => { await note($, 'EVENT turn.complete'); return next(e) })
  on('prompt.submit', async ($, e, next) => { await note($, 'EVENT prompt.submit'); return next(e) })
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    renders += 1
    if (renders <= 3 || renders % 20 === 0) await note($, 'EVENT ui.render AbovePrompt #' + renders + ' timerHeld=' + (timer ? 'yes' : 'no') + ' tickCount=' + n)
    return next(e)
  })
}
