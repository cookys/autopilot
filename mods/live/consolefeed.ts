// mods/live/consolefeed.ts — the console mode's data source (operator console, 指揮 page): the snapshot `fleet console --json` prints (schema fleet.console/1), refreshed
// at most once a minute, with the file the courier keeps (~/.local/state/fleet/console.json, the same JSON written every 60 s) as the fallback when the command fails.
// Pure like fleet.ts: the runner, the file reader, the parser and the clock are injected (register.ts passes `$.process.run`, `$.fs.read` and parseConsole), nothing is
// spawned or read while drawing, and a failure never throws. Syntax is erasable, so `node` imports this file directly.
import type { ConsoleSnapshot } from './console'

export const CONSOLE_ARGV = ['fleet', 'console', '--json'] as const
export const CONSOLE_EVERY_MS = 60_000 // one refresh per interval, success or failure
export const CONSOLE_TIMEOUT_MS = 5_000
export const CONSOLE_STALE_MS = 5 * 60_000 // a fallback file older than this is drawn stale
export const CONSOLE_MAX_BYTES = 2_000_000
export const CONSOLE_FILE = '.local/state/fleet/console.json' // under the state home's parent: HOME/.local/state/fleet/console.json

export type ConsoleRunner = (argv: readonly string[]) => Promise<{ exitCode: number; stdout: string; stderr?: string; isStdoutTruncated?: boolean }>
export type ConsoleFeed = {
  // the snapshot to draw as of nowMs: the same object until it changes (identity is what the tick compares); null = no source
  current: (nowMs: number) => ConsoleSnapshot | null
  // runs the command (else reads the file) when the interval has passed and none is in flight; true when it ran
  refresh: (run: ConsoleRunner, readFile: () => Promise<string | null>, parse: (text: string) => ConsoleSnapshot | null, nowMs: number) => Promise<boolean>
}

// every source that says ok is said stale (its own at_ms stays, so the age line shows how old); expired and no_source stay as they were
export function staleOf(snap: ConsoleSnapshot): ConsoleSnapshot {
  const sources: ConsoleSnapshot['sources'] = {}
  for (const [k, v] of Object.entries(snap.sources)) sources[k] = v.state === 'ok' ? { at_ms: v.at_ms, state: 'stale' } : v
  return { ...snap, sources }
}

export function makeConsoleFeed(everyMs = CONSOLE_EVERY_MS, staleMs = CONSOLE_STALE_MS): ConsoleFeed {
  let snap: ConsoleSnapshot | null = null
  let fromFile = false
  let staleSnap: ConsoleSnapshot | null = null // memoised staleOf(snap), so identity holds between ticks
  let triedMs: number | null = null
  let busy = false
  const accept = (s: ConsoleSnapshot | null, file: boolean): void => {
    snap = s
    fromFile = file
    staleSnap = null
  }
  return {
    current: (nowMs: number) => {
      if (snap === null) return null
      if (!fromFile || nowMs - snap.generated_at_ms <= staleMs) return snap
      if (staleSnap === null) staleSnap = staleOf(snap)
      return staleSnap
    },
    refresh: async (run, readFile, parse, nowMs) => {
      if (busy) return false
      if (triedMs !== null && nowMs - triedMs < everyMs) return false
      busy = true
      triedMs = nowMs
      try {
        let got: ConsoleSnapshot | null = null
        try {
          const r = await run(CONSOLE_ARGV)
          if (r.exitCode === 0 && r.isStdoutTruncated !== true && r.stdout.length <= CONSOLE_MAX_BYTES) got = parse(r.stdout)
        } catch (_e) {
          got = null
        }
        if (got !== null) { accept(got, false); return true }
        let fileSnap: ConsoleSnapshot | null = null
        try {
          const text = await readFile()
          if (typeof text === 'string' && text.length <= CONSOLE_MAX_BYTES) fileSnap = parse(text)
        } catch (_e) {
          fileSnap = null
        }
        accept(fileSnap, fileSnap !== null)
      } finally {
        busy = false
      }
      return true
    },
  }
}
