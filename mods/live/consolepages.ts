// mods/live/consolepages.ts — the console pane's team, quota and hosts pages (C1 U6, plan §3.3 + §4.1): a skeleton of one name line and one summary line each. Pure: no `$`, no engine, no file;
// erasable syntax (types plus plain functions) so a node test loads it through the one-line `.ts` resolve hook. Every number comes from the snapshot's `counts.summary` (the feed counted, this file
// never does); every word from the locales. A page whose source is `no_source` (or missing, or the page's own section absent from the snapshot) says "no source" and draws no table; an `expired` one
// says "expired" and draws no content (§4.1). The pages' detail (one row per line, per pool, per host) is not in C1.

import type { ConsoleSnapshot } from './console'
import type { ConsoleTab } from './consoletabs'
import type { T } from './i18n'

export type ConsolePageKind = 'no_source' | 'expired' | 'summary'
export type ConsolePage = { kind: ConsolePageKind; lines: string[] }
export type SkeletonTab = Exclude<ConsoleTab, 'command' | 'self'>

// the feed source each page reads (§4.1: `sources` keys are fixed)
const SOURCE_OF: Record<SkeletonTab, string> = { team: 'tasks', quota: 'quota_now', hosts: 'hosts' }

export function consolePage(snap: ConsoleSnapshot | null, tab: SkeletonTab, t: T): ConsolePage {
  const none: ConsolePage = { kind: 'no_source', lines: [t('console.page.no_source')] }
  if (snap === null) return none
  const state = snap.sources[SOURCE_OF[tab]]?.state
  if (state === undefined || state === 'no_source') return none
  if (state === 'expired') return { kind: 'expired', lines: [t('console.page.expired')] }
  const sum = snap.counts.summary
  if (tab === 'team') {
    // the section is absent from the snapshot (no `lines` array): no source, not an empty table
    if (snap.lines.length === 0) return none
    return { kind: 'summary', lines: [t('console.team.summary', { running: sum.lines.running ?? 0, waiting: sum.lines.waiting ?? 0, stalled: sum.lines.stalled ?? 0 })] }
  }
  if (tab === 'quota') return { kind: 'summary', lines: [sum.quota_worst === null ? t('console.quota.summary', { risk: snap.counts.quota_risk }) : t('console.quota.summary_worst', { risk: snap.counts.quota_risk, worst: sum.quota_worst })] }
  return { kind: 'summary', lines: [t('console.hosts.summary', { online: sum.hosts.online ?? 0, total: sum.hosts.total ?? 0, busy: sum.hosts.gpu_busy ?? 0, gpu: sum.hosts.gpu_total ?? 0 })] }
}
