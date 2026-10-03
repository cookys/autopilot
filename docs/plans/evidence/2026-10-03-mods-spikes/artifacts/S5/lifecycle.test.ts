import { test, expect, mock } from 'claude-code/testing'

// How a test picks a surface (types, header lines 46-58): `$.ui.mount({ plugin, surface })`, surface in
// 'terminal' | 'desktop' | 'vscode' | 'mobile'. Session/clock lifecycle has no surface parameter; the surface
// matters only to ui.render trees. We therefore loop surfaces around a session.start input that carries `surface`.
for (const surface of ['terminal', 'desktop'] as const) {
  test(`clock.every ticks once per period, stops after session.end (surface=${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    const writes: string[] = []
    on('fs.write', async (_$, e) => { writes.push(e.text.trim().split('\n').pop() ?? ''); return { value: undefined } as any })
    on('session.start', async (_$, e) => ({ cwd: e.cwd }))
    on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))

    await $.session.start({ cwd: '/tmp', surface, isInteractive: true } as any)
    await clock.advance(3000)
    const ticks = writes.filter(w => / tick \d+$/.test(w))
    expect(ticks.length).toBe(3)

    await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } } as any)
    const before = writes.length
    await clock.advance(5000)
    expect(writes.length).toBe(before)
  })
}
