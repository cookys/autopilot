// Persistent failure log for 待決 sends and background claims: appends one JSON line per failure to `<live dir>/decide-send.jsonl`.
export type SendLogFs = {
  read: (path: string) => Promise<string>
  write: (path: string, content: string) => Promise<unknown>
}

export type SendLogEntry = {
  ts: number
  event: 'post_refused' | 'claim_failed'
  ids: string[]
  reason: string
}

let pending: Promise<void> = Promise.resolve()

export async function appendSendLog(
  fs: SendLogFs,
  liveDir: string | null,
  entry: SendLogEntry,
): Promise<void> {
  if (liveDir === null || liveDir === '') return
  const path = liveDir + '/decide-send.jsonl'
  // The host's fs API offers read/write, not append. Serialize the read-modify-write
  // within this mod instance so overlapping failures keep all lines.
  const append = async () => {
    let previous = ''
    try { previous = await fs.read(path) } catch (_) { /* first failure creates the file */ }
    await fs.write(path, previous + JSON.stringify(entry) + '\n')
  }
  pending = pending.then(append).catch(() => {}) // a log write failure must never break sending or the pane
  await pending
}
