import type { Register } from 'claude-code'

const W = '/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-a'

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const sid = await $.session.id()
    const at = new Date().toISOString()
    let s1: string
    try {
      await $.fs.write(W + '/s1-mod-line.jsonl', JSON.stringify({ spike: 'S1', sid, at }) + '\n')
      s1 = 'ok'
    } catch (err) { s1 = 'ERR ' + String(err) }

    const probe = async (label: string, f: () => Promise<unknown>) => {
      try {
        const v = await f()
        const text = typeof v === 'string' ? v : JSON.stringify(v)
        return { label, ok: true, length: text === undefined ? 0 : text.length, value: text === undefined ? null : text.slice(0, 300) }
      } catch (err) {
        const x = err as { code?: string; message?: string; name?: string }
        return { label, ok: false, errno: x.code ?? null, name: x.name ?? null, message: String(x.message ?? err).slice(0, 300) }
      }
    }
    const home = await $.env.get('HOME')
    const xdg = await $.env.get('XDG_RUNTIME_DIR')
    const cwd = await $.session.cwd()
    const results: unknown[] = []
    results.push(await probe('session.id', async () => sid))
    results.push(await probe('session.cwd', async () => cwd))
    results.push(await probe('session.root', () => $.session.root()))
    results.push(await probe('fs.stat(cwd,resolve).realPath', async () => (await $.fs.stat(cwd, { resolve: true })).realPath))
    results.push(await probe('env.HOME', async () => home))
    results.push(await probe('env.XDG_RUNTIME_DIR', async () => xdg))
    const H = home ?? '/nonexistent'
    results.push(await probe('read HOME/.autopilot/live-pointer.json', () => $.fs.read(H + '/.autopilot/live-pointer.json')))
    results.push(await probe('read /run/user/1000/autopilot/spike-s2/live.json', () => $.fs.read('/run/user/1000/autopilot/spike-s2/live.json')))
    results.push(await probe('read HOME/.autopilot/session-mode/<sid>.json', () => $.fs.read(H + '/.autopilot/session-mode/' + sid + '.json')))
    results.push(await probe('read HOME/.autopilot/review/projkey/live/runs.k1.json', () => $.fs.read(H + '/.autopilot/review/projkey/live/runs.k1.json')))
    results.push(await probe('list /run/user/1000/autopilot/spike-s2/runs/paths', () => $.fs.list('/run/user/1000/autopilot/spike-s2/runs/paths')))
    results.push(await probe('list HOME/.autopilot/livefix/runs/paths', () => $.fs.list(H + '/.autopilot/livefix/runs/paths')))
    results.push(await probe('stat /run/user/1000/autopilot/spike-s2/live.json', () => $.fs.stat('/run/user/1000/autopilot/spike-s2/live.json', { resolve: true })))
    // relative / absolute / outside-root semantics (cwd = proj/sub; marker files placed in sub, proj, and W)
    results.push(await probe('read rel marker.txt', () => $.fs.read('marker.txt')))
    results.push(await probe('read rel ../marker.txt', () => $.fs.read('../marker.txt')))
    results.push(await probe('read rel ../../outside-marker.txt', () => $.fs.read('../../outside-marker.txt')))
    results.push(await probe('read abs W/outside-marker.txt', () => $.fs.read(W + '/outside-marker.txt')))
    results.push(await probe('read abs /etc/hostname', () => $.fs.read('/etc/hostname')))
    results.push(await probe('read tilde ~/.autopilot/live-pointer.json', () => $.fs.read('~/.autopilot/live-pointer.json')))
    results.push(await probe('list rel (no arg)', () => $.fs.list()))
    results.push(await probe('list rel .', () => $.fs.list('.')))
    results.push(await probe('list abs W (outside root)', async () => (await $.fs.list(W)).map(x => x.name).slice(0, 5)))
    results.push(await probe('exists rel marker.txt', () => $.fs.exists('marker.txt')))
    results.push(await probe('exists abs /etc/hostname', () => $.fs.exists('/etc/hostname')))
    results.push(await probe('stat rel marker.txt resolve', () => $.fs.stat('marker.txt', { resolve: true })))
    results.push(await probe('stat abs symlink W/proj/link resolve', () => $.fs.stat(W + '/proj/link-to-outside', { resolve: true })))
    results.push(await probe('write abs outside root W/s2-write-outside.txt', async () => { await $.fs.write(W + '/s2-write-outside.txt', 'x'); return 'written' }))
    results.push(await probe('write rel s2-write-rel.txt', async () => { await $.fs.write('s2-write-rel.txt', 'x'); return 'written' }))
    await $.fs.write(W + '/s2-findings.json', JSON.stringify({ spike: 'S2', sid, at, s1, results }, null, 1))
    return next(e)
  })
}
