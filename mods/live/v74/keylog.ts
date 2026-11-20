// v7.4 key log. Off unless AUTOPILOT_V74_KEYLOG names a file. One JSON line per host event.
// Never writes prompt or note text: a string value is replaced by its length.
// The hooks module may not import node:fs. The write goes through the host fs API, same as pane-probe.ts.

export type V74KeyLog = {
  handler: string
  component?: string
  key?: string
  event?: string
  page?: string
  cursor?: number
  focusOwner?: string
  noteOpen?: boolean
  by?: number
  len?: number
  element?: string
}

type Host = {
  env: { get: (name: string) => Promise<string | undefined> }
  fs: { read: (path: string) => Promise<string>; write: (path: string, text: string) => Promise<unknown> }
}

let pending: Promise<void> = Promise.resolve()

export async function v74Keylog($: Host, rec: V74KeyLog): Promise<void> {
  let path: string | undefined
  try { path = await $.env.get('AUTOPILOT_V74_KEYLOG') } catch { return }
  if (path === undefined || path === '') return
  const line = JSON.stringify({ t: Date.now(), ...rec })
  const append = async () => {
    let previous = ''
    try { previous = await $.fs.read(path as string) } catch { /* first line creates the file */ }
    await $.fs.write(path as string, previous + line + '\n')
  }
  pending = pending.then(append).catch(() => {})
  await pending
}
