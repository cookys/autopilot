// mods/live/advisories.ts — the advisory bridge reader (stage-graph plan A1, P7a; Claude Code only).
//
// Four hooks (cost-tracker, version-drift-check, context-budget T1, suggest-compact) no longer inject their owner-facing
// advice into the model's context. Each appends a row to <live_base>/advisories/<sanitised sid>.jsonl:
//   {id, kind, severity, text, at}      (hooks/_shared/advisory-sink.js writes it; the text is the hook's own, unchanged)
// This module reads that file for the CURRENT session and returns the rows not seen yet; register.ts shows each as a toast.
// The running count (rows seen this session) is kept for a band chip (P7 renders the band). Read-only: nothing is written.

export type Advisory = { id: string; kind: string; severity: 'info' | 'warn'; text: string; at: string }

// Rows of one file, malformed lines and rows without an id / text skipped. Pure.
export function parseAdvisories(text: string | null): Advisory[] {
  if (text === null) return []
  const out: Advisory[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let v: unknown
    try { v = JSON.parse(line) } catch (_e) { continue }
    if (typeof v !== 'object' || v === null) continue
    const r = v as Record<string, unknown>
    if (typeof r.id !== 'string' || !r.id || typeof r.text !== 'string' || !r.text) continue
    out.push({
      id: r.id,
      kind: typeof r.kind === 'string' ? r.kind : 'advisory',
      severity: r.severity === 'warn' ? 'warn' : 'info',
      text: r.text,
      at: typeof r.at === 'string' ? r.at : '',
    })
  }
  return out
}

// A row already older than this when the mod first reads a session's file is history, not news: it is counted, not toasted.
export const FRESH_MS = 5 * 60 * 1000

export type AdvisoryTracker = { sid: string | null; seen: Set<string>; count: number }

export function newTracker(): AdvisoryTracker {
  return { sid: null, seen: new Set(), count: 0 }
}

// The rows to toast now. A new sid (or /clear) starts a fresh tracker. On the first read of a session only rows younger
// than FRESH_MS are toasted; afterwards every unseen row is.
export function takeNew(tracker: AdvisoryTracker, sid: string, rows: Advisory[], nowMs: number): Advisory[] {
  const first = tracker.sid !== sid
  if (first) { tracker.sid = sid; tracker.seen = new Set(); tracker.count = 0 }
  const fresh: Advisory[] = []
  for (const row of rows) {
    if (tracker.seen.has(row.id)) continue
    tracker.seen.add(row.id)
    tracker.count += 1
    const at = Date.parse(row.at)
    if (!first || (Number.isFinite(at) && nowMs - at <= FRESH_MS)) fresh.push(row)
  }
  return fresh
}
