import type { Register } from 'claude-code'

const VERSION = 'v3'
const GEN = 'g' + Math.random().toString(36).slice(2, 8)
const FILE = '/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-b/out/ticks/' + GEN + '.log'

export const register: Register = on => {
  const lines: string[] = []
  let timer: { cancel: () => void } | undefined
  let n = 0

  on('session.start', async ($, e, next) => {
    lines.push(String(await $.clock.now()) + ' ' + VERSION + ' ' + GEN + ' session.start surface=' + e.surface)
    await $.fs.write(FILE, lines.join('\n') + '\n')
    timer = $.clock.every(1000, async () => {
      n += 1
      lines.push(String(await $.clock.now()) + ' ' + VERSION + ' ' + GEN + ' tick ' + n)
      await $.fs.write(FILE, lines.join('\n') + '\n')
    })
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    timer?.cancel()
    lines.push(String(await $.clock.now()) + ' ' + VERSION + ' ' + GEN + ' session.end reason=' + e.reason + ' cancelled')
    await $.fs.write(FILE, lines.join('\n') + '\n')
    return next(e)
  })
}
