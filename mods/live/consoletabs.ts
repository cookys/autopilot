// mods/live/consoletabs.ts — the operator-console tab strip (plan §3.1, §3.2, §3.5): the five tabs 指揮 · 團隊 · 額度 · 主機 · 本席 (ids command, team, quota, hosts, self) and
// the badge after each name. Pure: no `$`, no engine, no file; erasable syntax (types plus plain functions), so a node test loads it through the one-line `.ts` resolve hook.
// Every number comes from the snapshot's `counts.tabs` (the feed counts, this file never does); the glyphs come from GLYPHS and a chip is written by ui.chipSegs.
//
// The badge of a tab is the first two NON-ZERO entries of `counts.tabs[<page key>]` that have a mark (need_you ▲, failed ✗, stalled ⊘, findings △; `hint` and `hints` read as △).
// Narrow rows give up from the tail (§3.2): first △, then the number of ⊘; ▲N and ✗N are never given up. A strip that still does not fit one row becomes the compact form:
// the active tab's name and the whole program's ▲N and ✗N (the sum over every page).

import type { ConsoleSnapshot } from './console'
import type { T } from './i18n'
import type { Seg, SlotId } from './model'
import { CHIP_LEAD, GLYPHS, chipSegs, chipsJoin, displayWidth, strip } from './ui'
import type { Ctx, Strip, StripTab } from './ui'

export const CONSOLE_TABS = ['command', 'team', 'quota', 'hosts', 'self'] as const
export type ConsoleTab = (typeof CONSOLE_TABS)[number]
// what the console pane / band draw from: the parsed snapshot (null = no source yet) and the one shared navigation state (band and pane read the same tab)
export type ConsoleNav = { snap: ConsoleSnapshot | null; tab: ConsoleTab }

// the producer's own page names: DATA keys of fleet.console/1 (`counts.tabs`), never drawn; the drawn names come from the locales (console.tab.<id>)
const DATA_KEY: Record<ConsoleTab, string | null> = { command: '指揮', team: '團隊', quota: '額度', hosts: '主機', self: null }
type Mark = 'need_you' | 'failed' | 'stalled' | 'findings'
const MARK_OF: Record<string, Mark> = { need_you: 'need_you', failed: 'failed', stalled: 'stalled', findings: 'findings', hint: 'findings', hints: 'findings' }
type Badge = { mark: Mark; n: number }

// the strip is drawn with both △ and the ⊘ number only from this width up (plan §3.5: 120 columns keep △, 80 drop it)
export const CONSOLE_FULL_MIN_COLS = 100

export const nextConsoleTab = (tab: ConsoleTab): ConsoleTab => CONSOLE_TABS[(CONSOLE_TABS.indexOf(tab) + 1) % CONSOLE_TABS.length]
// a band slot has no tab of its own here: the open questions are the bottom of 指揮, everything about this session (現況, 派工, 審查, 花費, 殘留) is 本席
export const consoleSlotTab = (id: SlotId): ConsoleTab => (id === 'decisions' ? 'command' : 'self')

export function badgesOf(snap: ConsoleSnapshot | null, tab: ConsoleTab): Badge[] {
  const key = DATA_KEY[tab]
  if (snap === null || key === null) return []
  const out: Badge[] = []
  for (const [state, n] of snap.counts.tabs[key] ?? []) {
    const mark = MARK_OF[state]
    if (mark !== undefined && n > 0 && out.length < 2) out.push({ mark, n })
  }
  return out
}

// the program-wide ▲N and ✗N: the sum of every page's counts, as the feed gave them
export function consoleTotals(snap: ConsoleSnapshot | null): { need_you: number; failed: number } {
  const sum = { need_you: 0, failed: 0 }
  if (snap === null) return sum
  for (const pairs of Object.values(snap.counts.tabs)) for (const [state, n] of pairs) { const mark = MARK_OF[state]; if ((mark === 'need_you' || mark === 'failed') && n > 0) sum[mark] += n }
  return sum
}

const plain = (text: string): Seg => ({ text })
const chipOf = (b: Badge, bare: boolean): Seg[] => (bare ? [plain(GLYPHS.state[b.mark])] : chipSegs([plain(GLYPHS.state[b.mark])], [plain(String(b.n))]))
const textOf = (name: string, chips: readonly (readonly Seg[])[]): string => name + (chips.length === 0 ? '' : CHIP_LEAD + chipsJoin(chips).map(s => s.text).join(''))

// level 0: both badge entries; 1: no △; 2: no △ and ⊘ without its number
type Level = 0 | 1 | 2
function labelAt(snap: ConsoleSnapshot | null, tab: ConsoleTab, t: T, level: Level): StripTab<ConsoleTab> {
  const all = badgesOf(snap, tab)
  const shown = level === 0 ? all : all.filter(b => b.mark !== 'findings')
  const need = all.some(b => b.mark === 'need_you' || b.mark === 'failed')
  return { id: tab, label: textOf(t('console.tab.' + tab), shown.map(b => chipOf(b, level === 2 && b.mark === 'stalled'))), ...(need ? { need: true } : {}) }
}

const rowWidth = (tabs: readonly StripTab<ConsoleTab>[], hasNext: boolean): number => tabs.reduce((w, x) => w + displayWidth(' ' + x.label + ' ') + 1, hasNext ? displayWidth(GLYPHS.structure.goto) + 1 : 0)

// the tabs one row of `room` cells can hold (`cols` is the surface's own width, which decides whether △ is drawn at all): the most badge that fits, else the compact form (active tab name + ▲N ✗N)
export function consoleStripTabs(snap: ConsoleSnapshot | null, t: T, room: number, cols: number, active: ConsoleTab, hasNext: boolean): StripTab<ConsoleTab>[] {
  const levels: Level[] = cols >= CONSOLE_FULL_MIN_COLS ? [0, 1, 2] : [1, 2]
  for (const level of levels) {
    const tabs = CONSOLE_TABS.map(id => labelAt(snap, id, t, level))
    if (rowWidth(tabs, hasNext) <= room) return tabs
  }
  const sum = consoleTotals(snap)
  const chips = [...(sum.need_you > 0 ? [chipOf({ mark: 'need_you', n: sum.need_you }, false)] : []), ...(sum.failed > 0 ? [chipOf({ mark: 'failed', n: sum.failed }, false)] : [])]
  return [{ id: active, label: textOf(t('console.tab.' + active), chips), ...(chips.length > 0 ? { need: true } : {}) }]
}

// the pane's strip (the same ui.strip as the other tabs: Buttons when the surface has them, the `━` mark under the active name)
export const consoleStrip = (u: Ctx, nav: ConsoleNav, hasNext: boolean): Strip<ConsoleTab> => strip<ConsoleTab>(u, nav.tab, consoleStripTabs(nav.snap, u.t, u.cols, u.cols, nav.tab, hasNext), hasNext)

// the band's row of tabs: `room` is what the row can give the tabs (the band keeps its indicator's own room); `cols` is the band's width. The forge tab (the mod below's, text `forge`) stays after them.
export type ConsoleBarTab = { id: ConsoleTab | 'forge'; label: Seg; width: number; start: number }
export function consoleBarStrip(nav: ConsoleNav, t: T, cols: number, room: number, forge: string | null): { tabs: ConsoleBarTab[]; width: number } {
  const forgeW = forge === null ? 0 : displayWidth(' ' + forge + ' ') + 1
  const list = consoleStripTabs(nav.snap, t, Math.max(0, room - forgeW), cols, nav.tab, false)
  const built = strip<ConsoleTab | 'forge'>({ t, cols: 100000 }, nav.tab, forge === null ? list : [...list, { id: 'forge' as const, label: forge }], false)
  const tabs: ConsoleBarTab[] = []
  let x = 0
  for (const b of built.tabs) {
    const width = displayWidth(b.label.text)
    tabs.push({ id: b.id, label: b.label, width, start: x })
    x += width + 1
  }
  return { tabs, width: x }
}
