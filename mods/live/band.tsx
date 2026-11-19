// mods/live/band.tsx — the band above the prompt: ONE line (stage-graph P7, contract ②; TUI v2 grammar). Pure view over the snapshot's slots:
// `layoutBand` (model.ts) applies the width table, this file only draws the result: each slot a plain Button keyed by its slot id (a press opens
// the pane on the tab that explains it), the separators plain Texts between them, then the ⓘ Button.
// Colours are theme keys as text colour only: no backgroundColor, no inverse, no raw colour. No Image, no Raster.

import { T_EN } from './i18n'
import type { T } from './i18n'
import { BAND_INFO_LABEL, BAND_SEP, displayWidth, fittedBandWidth, hhmm, layoutBand, plainBandText, slotFleet } from './model'
import { PICK_MARK, QUICK_SEP, SHELL_MENUS } from './shell'
import type { LeftItem, ShellMenuId, ShellPlan } from './shell'
import type { DecideState, LiveSnapshot, PaneLine, PaneTab, Seg, SlotId } from './model'
import { actionSeg, cardParas, dimProps, drawSeg, forgeBar, GLYPHS, moreSeg, PALETTE, wrapPlain } from './ui'
import { fixedWindow, followsTail, thumbOf } from './scrollmath'
import type { ScrollModel } from './scrollmath'
import type { ForgeSegment } from './ui'
import { barRule, barStrip, decideBandPlan, pageBarStrip } from './tabs'
import { ROLE_WARNING, worstPool } from './pages/quota-pick'
import type { QuotaPool } from './console'
import type { ConsoleNav, ConsoleTab } from './consoletabs'
import { COL_GAP } from './speedview'
import type { SpeedColumn } from './speedview'
import type { BandPageId, BarStrip, BarTabId } from './tabs'
import { isBriefStale, staleBadge } from './pages/rows'
import { mostSevere } from './pages/frame'

type El = (props: any) => any

// the band is this many rows tall (one Box of one line); the mods drawn below it are given the rows that remain
export const BAND_ROWS = 1
// M5: the cells row 1 of the console band keeps free at its right end for the `[-]` control (three cells and a gap)
export const BAND_CLOSE_ROOM = 4
// r4 D: the console sources whose failure the band shows; slots, metrics, answer_log and changes are no_source on purpose in fleet's snapshot
const BAND_SOURCES = ['tasks', 'peers', 'cards', 'quota_now'] as const

// The band is the final row next to the prompt; open content grows above it.
export function stackBand(el: { Box: El }, band: unknown, below: unknown) {
  const { Box } = el
  return <Box flexDirection="column" justifyContent="flex-end">{below}{band}</Box>
}

// bandlayout: rows drawn top to bottom, menu row first and the quick row last (ux-v7). The tree is never taller than the band: a host that gets more
// than maxRows rows opens a window of its own and hides the last row (the quick row) behind a "n more" line, so there is no spare row here.
export function stackRows(el: { Box: El }, rows: unknown[]) {
  const { Box } = el
  return <Box flexDirection="column" justifyContent="flex-end">{rows}</Box>
}

// the scroll hint row of a window that holds more than it shows (guideline §13.3): `↑ 還有 N 行 · ↓ 還有 M 行`, each half a `[ … ]` Button (BarButton's look) that moves the window a page (a click, or Tab and Enter, reach what
// the wheel and the scroll keys also do), a half with nothing in that direction is not drawn
export function scrollHint(el: { Box: El; Text: El; Button?: El }, t: T, above: number, below: number, onUp: () => void, onDown: () => void): unknown {
  const { Box, Text, Button } = el
  const half = (k: string, text: string, press: () => void) => {
    const label = '[ ' + text + ' ]' // the same look as BarButton: the action colour and the [ ] frame, so it reads as a Button
    const draw = <Text key="t" {...drawSeg(actionSeg(label))} wrap="truncate">{label}</Text>
    return Button === undefined ? <Box key={k}>{draw}</Box> : <Button key={k} plain onPress={press}>{draw}</Button>
  }
  return (
    <Box key="scrollhint">
      <Text>{' '}</Text>
      {above > 0 ? half('scroll:up', t('shell.more_up', { n: above }), onUp) : <Text key="nu">{''}</Text>}
      {above > 0 && below > 0 ? <Text key="sep">{' '}</Text> : <Text key="ns">{''}</Text>}
      {below > 0 ? half('scroll:down', t('shell.more_down', { n: below }), onDown) : <Text key="nd">{''}</Text>}
    </Box>
  )
}

// consecutive segs of one slot become one Button; a seg with no slot (a separator) stays a bare Text
const FLEET_COUNT = new Set(['fleetRun', 'fleetWait', 'fleetStuck'])

// Stale fleet counts are not drawn. The cell becomes the short marker; a fleet cell with no counts stays as it is.
function maskFleetCounts(segs: Seg[], t: T): Seg[] {
  if (!segs.some(s => s.slot === 'fleet' && s.tag !== undefined && FLEET_COUNT.has(s.tag))) return segs
  const marker: Seg = { text: t('band.fleet_unknown'), slot: 'fleet', tag: 'fleetWord' }
  let placed = false
  const out: Seg[] = []
  for (const s of segs) {
    if (s.slot !== 'fleet') { out.push(s); continue }
    if (!placed) { out.push(marker); placed = true }
  }
  return out
}

function drawSegs(el: { Text: El; Button?: El }, segs: Seg[], onSlot: (id: SlotId) => void, dimAll = false) {
  const { Text, Button } = el
  const text = (s: Seg, i: number) => <Text key={'s' + i} {...drawSeg(s)} {...(dimAll ? dimProps() : {})} wrap="truncate">{s.text}</Text>
  const runs: { slot: SlotId | undefined; at: number; segs: Seg[] }[] = []
  segs.forEach((s, i) => {
    const last = runs[runs.length - 1]
    if (s.slot !== undefined && last !== undefined && last.slot === s.slot) last.segs.push(s)
    else runs.push({ slot: s.slot, at: i, segs: [s] })
  })
  return runs.map(r => {
    const texts = r.segs.map((s, j) => text(s, r.at + j))
    const id = r.slot
    if (id === undefined || Button === undefined) return texts
    return <Button key={id} plain onPress={() => onSlot(id)}>{texts}</Button>
  })
}

// W5: the live snapshot's age/cause also survives a missing console snapshot.
function staleLiveReason(snap: LiveSnapshot, t: T): string {
  const at = snap.published_at === null ? NaN : Date.parse(snap.published_at)
  const now = snap.detail.now_ms
  const age = Number.isFinite(at) && typeof now === 'number' ? t('console.command.age_m', { n: Math.max(0, Math.floor((now - at) / 60000)) }) : ''
  let reason = snap.text
  if (Number.isFinite(at)) for (const key of ['state.stale', 'state.stale_moved']) {
    if (reason === t(key + '_at', { at: hhmm(at) })) reason = t(key)
  }
  return (age === '' ? '' : age + ' · ') + reason
}

// the band's own cells (the line and the ⓘ), and the width they take
function bandCells(el: { Box: El; Text: El; Button?: El }, snap: LiveSnapshot | null, columns: number, onInfo: () => void, t: T, onSlot: (id: SlotId) => void, preset: { segs: Seg[]; width: number } | null = null, infoLabel = BAND_INFO_LABEL, legacyTabs = false, fleetUnknown = false): { nodes: unknown[]; width: number } {
  const { Text, Button } = el
  const extra = displayWidth(infoLabel) - displayWidth(BAND_INFO_LABEL)
  // only the ⓘ autoFocuses: Ctrl+x Tab lands on it, as before the slots were controls
  const icon = Button === undefined
    ? <Text>{infoLabel}</Text>
    : <Button key="info" plain autoFocus onPress={onInfo}>{infoLabel}</Button>
  // a fitted line (the fleet segment is on it): draw those segs, do not run layoutBand again. The width is the shared fitted width (segs + ⓘ), never preset.width on its own.
  const segW = (segs: { text: string }[]) => segs.reduce((n, s) => n + displayWidth(s.text), 0)
  const dimCells = !legacyTabs && snap?.state === 'stale' && snap.band !== null
  if (preset !== null) {
    const segs = fleetUnknown ? maskFleetCounts(preset.segs, t) : preset.segs
    return { nodes: [...drawSegs(el, segs, onSlot, dimCells), icon], width: fittedBandWidth(segW(segs), null, false) + extra }
  }
  if (snap === null || snap.band === null) {
    let reason = snap === null ? t('band.waiting') : snap.text
    // X4: a missing band still names the stale cause. The repair command stays off this row.
    if (!legacyTabs && snap?.state === 'stale') reason = GLYPHS.state.failed + ' ' + staleLiveReason(snap, t)
    const line = plainBandText(reason, columns - extra) + BAND_SEP
    return { nodes: [<Text key="w" {...(!legacyTabs && snap?.state === 'stale' ? drawSeg(staleBadge(line)) : dimProps())} wrap="truncate">{line}</Text>, icon], width: fittedBandWidth(displayWidth(line), null, false) + extra }
  }
  const line = layoutBand(snap.band.slots, columns - extra)
  const segs = fleetUnknown ? maskFleetCounts(line.segs, t) : line.segs
  return { nodes: [...drawSegs(el, segs, onSlot, dimCells), icon], width: fittedBandWidth(segW(segs), null, false) + extra }
}

export function Band(el: { Box: El; Text: El; Button?: El }, snap: LiveSnapshot | null, columns: number, onInfo: () => void, t: T = T_EN, onSlot: (id: SlotId) => void = () => {}) {
  const { Box } = el
  return <Box>{bandCells(el, snap, columns, onInfo, t, onSlot).nodes}</Box>
}

// ---- layout E1: the band row is the indicator on the left and the tabs on the right; an open tab draws its content under a rule ----

export type BarHandlers = { onInfo: () => void; onSlot: (id: SlotId) => void; onTab: (id: BarTabId | ConsoleTab | BandPageId) => void }

// the row, and the column its tabs start in (the rule under it is built from that)
// r2 §3.1: the right end of the summary row names the most dangerous pool, the same one the 現況 page names (worstPool, folds A7). null = nothing to show (no pools).
// `source` is the quota source's state in the console snapshot: no_source draws nothing, stale takes the warning colour, expired the broken one (a green on old numbers is a false all-clear)
export function bandQuotaSeg(pools: QuotaPool[] | null, nowMs: number, t: T, source?: string): Seg | null {
  if (source === 'no_source') return null
  const w = worstPool(pools, nowMs, t)
  if (w === null) return null
  const color = source === 'expired' || w.role === 'broken' ? PALETTE.broken : source === 'stale' || w.role === ROLE_WARNING ? PALETTE.attention : PALETTE.done
  return { text: t('console.command.sum_quota') + ' ' + (w.role === 'broken' ? GLYPHS.state.failed + ' ' : '') + w.pool + ' ' + w.text, color }
}

export function BandBar(el: { Box: El; Text: El; Button?: El }, snap: LiveSnapshot | null, columns: number, t: T, hd: BarHandlers, active: BarTabId | ConsoleTab | BandPageId | null, forge: readonly ForgeSegment[] | null, usage = true, moreTo: BarTabId | null = null, con: (ConsoleNav & { cols: number }) | null = null, preset: { segs: Seg[]; width: number } | null = null, quota: Seg | null = null, noTabs = false, legacyTabs = false, forgeRow = false): { node: unknown; stripRow: unknown; strip: BarStrip; tabsAt: number } {
  const { Box, Text, Button } = el
  // R4-4: the host may reduce band columns beside an open pane; the terminal's
  // width is not this budget. A visible fleet group always keeps its name.
  if (!legacyTabs && preset !== null && preset.segs.some(s => s.slot === 'fleet') && !preset.segs.some(s => s.slot === 'fleet' && s.tag === 'fleetWord')) {
    const at = preset.segs.findIndex(s => s.slot === 'fleet')
    const label = slotFleet({ stuck: 0, running: 0, waiting: 0 }, t)!.segs.filter(s => s.tag === 'fleetWord').map(s => ({ ...s, slot: 'fleet' as const }))
    preset = { segs: [...preset.segs.slice(0, at), ...label, ...preset.segs.slice(at)], width: preset.width + label.reduce((n, s) => n + displayWidth(s.text), 0) }
  }
  // A missing or stale source is not an error sentence on row 1 (guideline §1.1 rule 4).
  // 'band.no_console', 'band.fleet_stale' and 'band.quota_nopace' stay in the string table and are not drawn here.
  // The same conditions still drop the quota segment and, with the pane open, keep the repair on row 2.
  let sourceBad = false
  let fleetUnknown = false
  if (!legacyTabs && con !== null) {
    if (con.snap === null) sourceBad = true
    else {
      const nowMs = snap?.detail.now_ms ?? con.snap.generated_at_ms
      const brief = isBriefStale(con.snap, nowMs)
      const tasks = con.snap.sources.tasks
      fleetUnknown = tasks?.state === 'expired' || tasks?.state === 'stale' || brief.stale
      if (fleetUnknown || snap?.state === 'stale') sourceBad = true
      const forecast = con.snap.sources.quota_forecast
      if (forecast !== undefined && forecast.state !== 'ok') sourceBad = true
      if (!sourceBad) {
        const other = mostSevere({ live: snap, console: con.snap, size: { cols: columns, rows: 2 }, t, nowMs }, BAND_SOURCES)
        if (other !== null) sourceBad = true
      }
    }
  }
  // the forge label is read by forgeSegments (ui.ts): speed (and pet) sit on the left after the ⓘ, and the strip keeps a short forge tab that opens the full view.
  // The rate is measured on this seat. A failed data source or a stale live snapshot does not clear it; the failure line is what narrows.
  const fb = forge === null ? null : forgeBar(forge)
  const forgeW = fb === null ? 0 : fb.width
  const oldStrip = legacyTabs ? barStrip(snap, t, active as BarTabId | ConsoleTab | null, fb === null ? null : GLYPHS.structure.speed, usage, con) : null
  // `moreTo`: a tab has no room (用量, or forge with something timed), so a dim `›` ends the row: a Button (key 'more'), so Tab / Enter still reach the hidden tab
  const more = legacyTabs && moreTo !== null // X1: the shared strip already carries every page.
  const moreW = more ? displayWidth(GLYPHS.structure.goto) + 1 : 0
  const strip = legacyTabs && con === null ? oldStrip as BarStrip : pageBarStrip(snap, t, Math.max(0, columns - moreW), active, null, con?.snap ?? null, !legacyTabs)
  // M5: in the console band the tab strip is row 2 (pageBarStrip), so row 1 gives the left text every idle cell up to the right-hand controls (BAND_CLOSE_ROOM keeps
  // the `[-]` cell): the stale reason and its whole fix command (`autopilot status runs --watch`) are never cut while blank cells are left. M6: the open Button says what it opens.
  if (sourceBad || (!legacyTabs && snap?.state === 'stale')) quota = null
  const leftRoom = legacyTabs && con === null ? columns - (oldStrip as BarStrip).width - 1 - forgeW - moreW : columns - BAND_CLOSE_ROOM - forgeW - moreW - (quota === null ? 0 : displayWidth(quota.text) + 2)
  // R4-1: the open pane owns navigation; its spare band row holds the repair whole. Row 1 never carries the command. `forgeRow`: that row under the band is forge-stats' summary (PM G33), so the repair is not drawn here.
  const repairBelow = noTabs && !legacyTabs && !forgeRow && (sourceBad || snap?.state === 'stale')
  const left = bandCells(el, snap, Math.max(1, leftRoom), hd.onInfo, t, hd.onSlot, preset, con !== null && !noTabs ? t('band.open_pane') + ' ' : BAND_INFO_LABEL, legacyTabs, fleetUnknown)
  // the same fitted width as layoutBandLine: segs + ⓘ + speed + ›. The gap is whatever is left before the strip, at least one cell. tabsAt stops before the ›.
  const segW = preset !== null ? preset.segs.reduce((n, s) => n + displayWidth(s.text), 0) : left.width - displayWidth(BAND_INFO_LABEL)
  void segW
  const gap = Math.max(0, columns - strip.width - moreW)
  const moreText = <Text key="m" {...drawSeg(moreSeg())} wrap="truncate">{GLYPHS.structure.goto}</Text>
  const moreNode = !more ? [] : [<Box key="more">{Button === undefined ? moreText : <Button key="more" plain onPress={() => hd.onTab(moreTo as BarTabId)}>{moreText}</Button>}<Text> </Text></Box>]
  const texts = fb === null ? [] : fb.segs.map((s, i) => <Text key={'f' + i} {...drawSeg(s)} wrap="truncate">{s.text}</Text>)
  const speed = fb === null ? [] : [Button === undefined ? <Box key="speed">{texts}</Box> : <Button key="speed" plain onPress={() => hd.onTab('forge')}>{texts}</Button>]
  const tabs = strip.tabs.map(b => {
    const draw = <Text key="l" {...drawSeg(b.label)} wrap="truncate">{b.label.text}</Text>
    return (
      <Box key={'tab:' + b.id}>
        {Button === undefined ? draw : <Button key={b.id === 'forge' ? 'forge' : 'tab:' + b.id} plain onPress={() => hd.onTab(b.id)}>{draw}</Button>}
        <Text> </Text>
      </Box>
    )
  })
  // r2 §3.1: the band is two rows, always. Row 1 is the summary (cells, ⓘ, speed); row 2 is the tab strip, right-aligned to the bottom edge.
  const stripRow = <Box height={1} width={columns} overflow="hidden"><Text>{' '.repeat(gap)}</Text>{tabs}{moreNode}</Box>
  // `stripRow` alone is the menu row of the O4 shell: the shell is already 12 rows (SHELL_ROWS), so it takes the tab strip and leaves the summary row to the band's own draw
  // the quota segment sits at the right end of row 1 when two cells of room are left; it never takes a row and never pushes the speed label
  const qw = quota === null ? 0 : displayWidth(quota.text)
  const qpad = quota === null ? 0 : columns - left.width - forgeW - qw
  const qnode = quota === null || qpad < 2 ? [] : [<Text key="[REDACTED]">{' '.repeat(qpad)}</Text>, <Text key="[REDACTED]" {...drawSeg(quota)} wrap="truncate">{quota.text}</Text>]
  return { node: <Box flexDirection="column"><Box>{left.nodes}{speed}{qnode}</Box>{repairBelow ? <Box height={1} width={columns}><Text {...drawSeg(staleBadge('  autopilot status runs --watch'))}>{'  autopilot status runs --watch'}</Text></Box> : noTabs ? <Box height={1} width={columns} /> : stripRow}</Box>, stripRow, strip, tabsAt: gap }
}

// the rule under the bar
export function BarRule(el: { Box: El; Text: El }, strip: BarStrip, columns: number, tabsAt: number, active: BarTabId | ConsoleTab | BandPageId | null) {
  const { Box, Text } = el
  return <Box>{barRule(strip, columns, tabsAt, active as BarTabId | ConsoleTab | null).map((s, i) => <Text key={'r' + i} {...drawSeg(s)} wrap="truncate">{s.text}</Text>)}</Box>
}

// `[ label ]` in the action colour: a pressable control
export function BarButton(el: { Text: El; Button?: El }, id: string, label: string, onPress: () => void) {
  const { Text, Button } = el
  const text = <Text key="t" {...drawSeg(actionSeg('[ ' + label + ' ]'))} wrap="truncate">{'[ ' + label + ' ]'}</Text>
  return Button === undefined ? text : <Button key={id} plain onPress={onPress}>{text}</Button>
}

// the open tab's content: rows (each one drawn row). No buttons row sits under it: the band's height must not change with the open tab (the pane is reached from the ⓘ, a slot, the tab strip and /live-pane).
// Progress and spend left the collapsed slots, so the Now preview has no row. Dispatch shows the stalled chip. Review shows QC.
export function barParts(el: { Box: El; Text: El; Button?: El }, snap: LiveSnapshot | null, tab: PaneTab | 'usage', columns: number, _t: T, o: { onSlot: (id: SlotId) => void }): { rows: unknown[] } {
  const { Box } = el
  if (tab === 'usage' || snap === null || snap.band === null) return { rows: [] }
  const band = snap.band
  const sel = (ids: SlotId[]) => band.slots.filter(s => ids.includes(s.id))
  const lineOf = (ids: SlotId[]): unknown[] => {
    const slots = sel(ids)
    return slots.length === 0 ? [] : [<Box key="line">{drawSegs(el, layoutBand(slots, columns).segs.slice(0, -1), o.onSlot)}</Box>]
  }
  if (tab === 'dispatch') return { rows: lineOf(['dispatch']) }
  if (tab === 'review') return { rows: lineOf(['review']) }
  return { rows: [] }
}
export function barContent(el: { Box: El; Text: El; Button?: El }, snap: LiveSnapshot | null, tab: PaneTab | 'usage', columns: number, t: T, o: { onSlot: (id: SlotId) => void }): unknown[] {
  return barParts(el, snap, tab, columns, t, o).rows
}

// the 待決 tab's compact form: the first open question's title and its options, then the send row the pane's own builder made (the same lines, the same press ids: a press is
// decidePress, so a pick or a send here is the one the pane makes). This compact form (the tab-row layout, for a host that gives fewer than 12 rows) has no note and no typed answer: those are the card view's 附註／其他回答 and 打字回答 buttons (`cardMain`, O4 shell) and the pane's text fields; the rest of the questions are the pane's too.
// The rows come from `decideBandPlan` (tabs.ts): wrapped, never cut; a pointer row for what the pane alone shows; `maxRows` is the room under the bar and rule (rows - 3: the two-row bar and the rule).
export function decideContent(el: { Box: El; Text: El; Button?: El }, snap: LiveSnapshot | null, state: DecideState, columns: number, t: T, onPress: (id: string) => void, maxRows?: number): unknown[] {
  const { Box, Text, Button } = el
  if (snap === null || snap.band === null) return []
  const plan = decideBandPlan(snap, { t, cols: columns, decide: { ...state, inputs: false } }, maxRows)
  if (plan.empty) return [<Text key="none" {...dimProps()} wrap="truncate">{t('decide.none')}</Text>]
  const shown = plan.rows
  const bars = plan.bars
  const tail: unknown[] = plan.pointer === null ? [] : [<Text key="more" {...dimProps()} wrap="truncate">{t(plan.pointer)}</Text>]
  const drawLine = (l: PaneLine, k: string) => {
    const runs: { press: string | undefined; segs: Seg[] }[] = []
    for (const s of l.segs ?? [{ text: l.text }]) {
      const last = runs[runs.length - 1]
      if (last !== undefined && last.press === s.press) last.segs.push(s)
      else runs.push({ press: s.press, segs: [s] })
    }
    return (
      <Box key={k}>
        {runs.map((r, j) => {
          const texts = r.segs.map((s, n) => <Text key={'g' + n} {...drawSeg(s)} wrap="truncate">{s.text}</Text>)
          const press = r.press
          return press === undefined || Button === undefined ? <Box key={'r' + j}>{texts}</Box> : <Button key={press.replace(/^pick:/, 'opt:')} plain onPress={() => onPress(press)}>{texts}</Button>
        })}
      </Box>
    )
  }
  return [...shown.map((l, i) => drawLine(l, 'p' + i)), ...tail, ...bars.map((l, i) => drawLine(l, 'b' + i))]
}

// ---- the speed view under the tabs (BL-0359): the speed column and the recent-requests table, and the mod below (codeforge's forge-stats: Ferris, pet, memory, brain) ----

// where the speed view sits against the mod below: `beside` = one row, ours on the left and the mod's view on the right; `stack` = ours on top, the mod's view under it
export type SpeedPlacement = 'beside' | 'stack'

export function speedContent(el: { Box: El; Text: El }, cols: readonly SpeedColumn[], below: unknown | null, placement: SpeedPlacement): unknown[] {
  const { Box, Text } = el
  const column = (c: SpeedColumn, k: string) => (
    <Box key={k} flexDirection="column" width={c.width} flexShrink={0}>
      {c.lines.map((line, i) => <Box key={'l' + i}>{line.map((s, j) => <Text key={'s' + j} {...drawSeg(s)} wrap="truncate">{s.text}</Text>)}</Box>)}
    </Box>
  )
  const gap = (k: string) => <Box key={k} width={COL_GAP} flexShrink={0}><Text>{' '.repeat(COL_GAP)}</Text></Box>
  const ours = cols.flatMap((c, i) => (i === 0 ? [column(c, 'c0')] : [gap('g' + i), column(c, 'c' + i)]))
  if (below === null) return [<Box key="speedview" flexDirection="row">{ours}</Box>]
  if (placement === 'beside') return [<Box key="speedview" flexDirection="row">{ours}{gap('gb')}{below}</Box>]
  return [<Box key="speedview" flexDirection="row">{ours}</Box>, below]
}

// ---- the O4 shell (contract 2026-11-06, bandlayout: operation area at the bottom): a frame of three kinds of window, a progress row and a quick row; 12 rows. shell.ts plans the frame, the
// columns and the left submenu; this file draws them. Only the left submenu, the main window and the quick row hold Buttons: the right-hand columns are Text, so the Tab order and the
// highlight are the same at every tier. ----

export type ShellDraw = {
  plan: ShellPlan
  left: LeftItem[]
  onLeft: (id: string) => void
  main: unknown[] // the main window's content rows, top-aligned, at most plan.bodyRows - 2; the divider and the progress row below them are drawn here
  progress: unknown // the progress row's content (one Box), inside the main window
  quick: unknown[]
  bar: unknown // the menu row, always first (ux-v7). The quick row is always last.
}
export function Shell(el: { Box: El; Text: El; Button?: El }, d: ShellDraw): unknown[] {
  const { Box, Text, Button } = el
  const { plan } = d
  const segsOf = (segs: readonly Seg[], k: string) => segs.map((s, i) => <Text key={k + i} {...drawSeg(s)} wrap="truncate">{s.text}</Text>)
  const vert = (i: number, divider: boolean) => {
    const seg = divider && i === 1 ? plan.divider.left : divider && i === 2 ? plan.divider.right : plan.verts[i]
    return <Text key={'v' + i} {...drawSeg(seg)}>{seg.text}</Text>
  }
  const blank = (k: string) => <Text key={k}>{' '}</Text>
  const rows: unknown[] = [<Box key="menu">{d.bar}</Box>]
  rows.push(<Box key="top">{segsOf(plan.top, 't')}</Box>)
  const body = plan.bodyRows
  const content = plan.compact ? body : body - 2 // r4: a compact frame has no divider and no progress row
  const S = GLYPHS.structure
  for (let r = 0; r < body; r++) {
    const item = d.left[r]
    const divider = r === content
    const leftCell = item === undefined
      ? blank('l')
      : Button === undefined
        ? <Box key="l">{segsOf(item.segs, 'l')}</Box>
        : <Button key={item.key} plain onPress={() => d.onLeft(item.id)}>{segsOf(item.segs, 'l')}</Button>
    const mainCell = divider ? <Text key="div" {...drawSeg(plan.divider.rule)}>{plan.divider.rule.text}</Text> : r > content ? d.progress : d.main[r] ?? blank('m')
    const cells: unknown[] = []
    if (plan.separate) {
      const edge = (k: string, here: boolean, ch: string) => <Text key={k} color={here ? PALETTE.here : PALETTE.idle}>{ch}</Text>
      cells.push(
        edge('v0', false, S.bandSep),
        <Box key="lc" width={plan.leftInner} flexShrink={0}>{leftCell}</Box>,
        edge('v1', false, S.bandSep),
        <Text key="gap">{' '}</Text>,
        edge('v2', true, divider ? S.frameLeftT : S.bandSep),
        <Box key="mc" width={plan.geo.main} flexShrink={0}>{mainCell}</Box>,
        edge('v3', true, divider ? S.frameRightT : S.bandSep),
      )
    } else {
      cells.push(
        vert(0, false),
        <Box key="lc" width={plan.geo.left} flexShrink={0}>{leftCell}</Box>,
        vert(1, divider),
        <Box key="mc" width={plan.geo.main} flexShrink={0}>{mainCell}</Box>,
      )
      plan.columns.forEach((c, i) => {
        cells.push(vert(2 + i, divider && i === 0), <Box key={'c' + i} width={c.inner} flexShrink={0}>{segsOf(c.rows[r] ?? [], 'c' + i + '-')}</Box>)
      })
      cells.push(vert(2 + plan.columns.length, divider && plan.columns.length === 0))
    }
    rows.push(<Box key={'row' + r}>{cells}</Box>)
  }
  rows.push(<Box key="bottom">{segsOf(plan.bottom, 'b')}</Box>)
  rows.push(<Box key="quick"><Text>{' '}</Text>{d.quick}</Box>)
  return rows
}

// The top menu row (ux-v7 §1). The host draws a letter hotkey as `k: ` in front of the label, so the label is the words
// and the Box is as wide as that prefix plus the words. ▾ sits on the selected menu. ▲N stays on 待決. 待你動手 is the tail.
export type MenuRowSpec = { selected: ShellMenuId; pending: number; room: number; awaiting: number; columns: number; onSelect: (id: ShellMenuId) => void }
export function shellMenuRow(el: { Box: El; Text: El; Button?: El }, t: T, spec: MenuRowSpec): unknown {
  const { Box, Text, Button } = el
  const word = (id: ShellMenuId): string => {
    const base = id === 'd' ? t('tab.decide') + ' ' + GLYPHS.state.need_you + spec.pending
      : id === 'r' ? t('shell.room') + ' ' + spec.room
      : id === 'u' ? t('shell.usage')
      : id === 'p' ? t('tab.pet')
      : t('shell.help')
    return spec.selected === id ? base + ' ' + GLYPHS.structure.open : base
  }
  const items = SHELL_MENUS.map(id => {
    const label = word(id)
    const hotkey = id
    const shown = hotkey + ': ' + label
    const key = id === 'd' ? 'tab:decide' : 'menu:' + id
    return { id, label, hotkey, shown, key, width: displayWidth(shown) }
  })
  const tail = spec.awaiting > 0 ? t('shell.awaiting', { n: spec.awaiting }) : ''
  let gaps = [1, 3, 5, 5, 5]
  const hostWidth = (): number => displayWidth(gaps.map((g, i) => ' '.repeat(g)).join('')) + items.reduce((n, it) => n + it.width, 0) + (tail === '' ? 0 : 2 + displayWidth(tail))
  // gaps[0] is the leading space; the rest sit between items. Shrink from the right until the row fits.
  while (hostWidth() > spec.columns) {
    const at = gaps.map((g, i) => (i > 0 && g > 1 ? i : -1)).filter(i => i >= 0).pop()
    if (at === undefined) { if (gaps[0] > 0) gaps[0] -= 1; else break }
    else gaps[at] -= 1
  }
  const kids: unknown[] = []
  items.forEach((it, i) => {
    if (gaps[i] > 0) kids.push(<Text key={'g' + i}>{' '.repeat(gaps[i])}</Text>)
    const btn = Button === undefined
      ? <Text key="b">{it.shown}</Text>
      : <Button key={it.key} hotkey={it.hotkey} plain onPress={() => spec.onSelect(it.id)}>{it.label}</Button>
    kids.push(<Box key={it.id} width={it.width} flexShrink={0}>{btn}</Box>)
  })
  if (tail !== '') kids.push(<Text key="await" color={PALETTE.attention}>{'  ' + tail}</Text>)
  return <Box key="shellmenu">{kids}</Box>
}

// one plain line in the main window (the pet placeholder, the help line, an empty 待決)
export function shellNote(el: { Box: El; Text: El }, text: string): unknown[] {
  const { Box, Text } = el
  return [<Box key="note"><Text wrap="truncate">{' ' + text}</Text></Box>]
}

// ---- the card view (ux-v7, bandlayout): the main window of the 待決 tab shows ONE card, every word of it. The rows below are all of the card, wrapped and never cut; the caller (register.ts) shows
// the window of them that fits (shell scroll, `windowRows`) and grows the frame upward as far as the host's maxRows allows. One option per row (a hotkey Button 1..6), its description wrapped under it;
// the recommendation (★ on the option and a 建議 row with its reason), the 不授權 line, then one Button (no hotkey: 0-9 are all taken) that fills the prompt box with the reply line so the owner types a
// note or a free answer there and presses Enter ----
export type CardView = {
  key: string
  question: string
  background: string | null
  advice: { label: string; why: string | null } | null // the recommended option's label (or the recommendation as written) and its reason
  notAuthorized: string | null
  options: { label: string; description: string; picked: boolean; recommended: boolean; key: string }[]
  note: string | null // a card the band cannot answer (typed or in a dialog) and has no way to fill: one dim line instead of options
  meta: string | null // the pane's card state, as the pane words it: `decide.sent` (already sent), `decide.held` (in its undo window), or, on a card the session or the CLI closed elsewhere, the answer line `decide.elsewhere`; drawn dim
  locked: boolean // sent or in the undo window: the options are plain text (no Button, no hotkey) and a press does nothing, as in the pane
  split: boolean // a card too tall for the frame (§12.10): the options, the fill Button and the page Buttons go to the fixed strip under the scrolling rows; the descriptions stay in the rows, each led by its option's number. false: everything in the rows, each description right under its option
  grey: boolean // an answered card (sent, or closed elsewhere): the question and the options are dim theme text, the card stays in its place
  fix: { label: string; onPress: () => void } | null // the pane's 改答案 on a card sent from here
  fill: { label: string; onPress: () => void } | null // the button that puts the reply line in the prompt box (`$.prompt.fill`): an option card's 附註／其他回答, a typed card's 打字回答; null where the surface has no prompt box or the card is a dialog's
  compact?: boolean // r4: a window of 4 content rows or fewer: the title row, then the options, then the rest of the card (scrolled)
  width: number // the main window's inner width less the pad
  onPress: (k: number) => void
}
// the option label is padded to this many cells inside its Button, so the highlight sits at the same place at every width (ux-v7: the highlight is 13 wide with `1: `)
const OPT_LABEL_COLS = 10
// `text` as rows: the first row `first` cells wide, the next ones `rest`; a paragraph break (newline or a `(1)` item marker) starts a row, an item's continuation hangs under its text
function paraRows(text: string, first: number, rest: number): { row: string; indent: number }[] {
  const out: { row: string; indent: number }[] = []
  for (const para of cardParas(text)) {
    const hang = Math.max(0, Math.min(para.hang, rest - 2))
    wrapPlain(para.text, out.length === 0 ? first : rest, Math.max(1, rest - hang)).forEach((row, i) => out.push({ row, indent: i === 0 ? 0 : hang }))
  }
  return out
}
export function cardMain(el: { Box: El; Text: El; Button?: El }, v: CardView, t: T): { rows: unknown[]; strip: unknown[]; keyed: { k: number; at: number | null }[] } {
  const { Box, Text, Button } = el
  const rows: unknown[] = []
  const strip: unknown[] = []
  const keyed: { k: number; at: number | null }[] = [] // the options that have a hotkey Button: `at` is the row of `rows` it sits in, null when it stands in the strip
  const optTo = v.split ? strip : rows
  const w = Math.max(8, v.width)
  const dim = (on: boolean) => (on ? dimProps() : {})
  const line = (k: string, text: string, dimmed = false, lead = '') => rows.push(<Box key={k}><Text>{' ' + lead}</Text><Text {...dim(dimmed)} wrap="truncate">{text}</Text></Box>)
  const fillBtn = v.fill === null ? null : BarButton(el, 'fill', v.fill.label, v.fill.onPress)
  const fixBtn = v.fix === null ? null : BarButton(el, 'fix', v.fix.label, v.fix.onPress)
  wrapPlain(v.question, w, w).forEach((r, i) => line('q' + i, r, v.grey))
  // the state line of a sent or closed card (and its 改答案 Button) sits right under the question, so a window that shows only the top of a tall card still shows it
  if (v.meta !== null) rows.push(<Box key="metar"><Text>{' '}</Text><Text key="meta" {...dimProps()} wrap="truncate">{v.meta}</Text>{fixBtn === null ? <Text key="nf">{''}</Text> : <Box key="fx"><Text>{'  '}</Text>{fixBtn}</Box>}</Box>)
  // a keyed block (背景, 建議, 不授權): the key at column 1, the value from column KEY; a continuation row hangs under the value
  const keys = [t('shell.bg'), t('decide.k_advice'), t('decide.k_not_authorized')]
  const KEY = Math.max(...keys.map(displayWidth)) + 2
  const block = (id: string, key: string | null, text: string, dimmed: boolean) => {
    paraRows(text, w - KEY, w - KEY).forEach((p, i) => {
      const head = i === 0 && key !== null ? key + ' '.repeat(KEY - displayWidth(key)) : ' '.repeat(KEY)
      line(id + i, ' '.repeat(p.indent) + p.row, dimmed, head)
    })
  }
  let bgLines = 0
  if (v.background !== null) {
    const before = rows.length
    block('bg', keys[0], v.background, true)
    bgLines = rows.length - before
  }
  // two background rows when the card is drawn whole, so a one-line question puts the first option on band row 5 at every tier
  if (!v.split && v.compact !== true) while (bgLines < 2) { line('bgpad' + bgLines, ' ') ; bgLines++ }
  const optFrom = rows.length
  v.options.forEach((o, k) => {
    if (v.split) {
      const hotkey = k < 6 ? String(k + 1) : undefined
      const hasKey = !v.locked && Button !== undefined && hotkey !== undefined
      const room = Math.max(1, w - 3 - (hasKey ? 3 : 0) - 2)
      const [head = '', ...more] = wrapPlain(o.label, room, room)
      const label = v.locked
        ? <Text key="b" {...dim(v.grey)} wrap="truncate">{head + ' '.repeat(Math.max(0, OPT_LABEL_COLS - displayWidth(head)))}</Text>
        : !hasKey
        ? <Text key="b" wrap="truncate">{(hotkey === undefined ? '' : hotkey + ': ') + head}</Text>
        : <Button key={o.key} plain onPress={() => v.onPress(k)}>{head + ' '.repeat(Math.max(0, OPT_LABEL_COLS - displayWidth(head)))}</Button>
      const star = o.recommended ? <Text key="rec">{' ' + GLYPHS.structure.recommend}</Text> : <Text key="rec">{''}</Text>
      if (hasKey) keyed.push({ k, at: null })
      optTo.push(
        <Box key={'o' + k}>
          <Text>{' '}</Text>{o.picked ? <Text key="pk" {...drawSeg(PICK_MARK)}>{PICK_MARK.text}</Text> : <Text key="pk">{' '}</Text>}<Text>{' '}</Text>
          {label}
          {more.length === 0 ? star : <Text key="rec">{''}</Text>}
        </Box>,
      )
      more.forEach((r, i) => optTo.push(
        <Box key={'on' + k + '_' + i}><Text>{' '}</Text><Text {...dim(v.grey)} wrap="truncate">{'    ' + r}</Text>{i === more.length - 1 ? star : <Text key="rec">{''}</Text>}</Box>,
      ))
      if (o.description !== '') wrapPlain(o.description, w - 4, w - 4).forEach((r, i) => line('od' + k + '_' + i, r, true, i === 0 ? String(k + 1).padEnd(4) : '    '))
      return
    }
    // one line `   N: label ★  description`; a description that does not fit wraps under the description column. No digit hotkey.
    const num = String(k + 1)
    const star = o.recommended ? ' ' + GLYPHS.structure.recommend : ''
    const prefix = (o.picked ? PICK_MARK.text : ' ') + '  ' + num + ': '
    const prefixW = displayWidth(prefix)
    const gap = '  '
    const budget = Math.max(1, w - prefixW - displayWidth(star) - displayWidth(gap))
    const labelParts = wrapPlain(o.label, budget, Math.max(1, w - prefixW))
    if (labelParts.length === 0) labelParts.push('')
    const oneLabel = labelParts.length === 1
    const head = prefix + labelParts[0] + (oneLabel ? star : '')
    const descAt = displayWidth(head + gap)
    const descRoom = Math.max(1, w - (oneLabel ? descAt : prefixW))
    const descParts = o.description === '' ? [] : wrapPlain(o.description, oneLabel ? Math.max(1, w - descAt) : descRoom, descRoom)
    const restHead = '  ' + num + ': ' + labelParts[0] + (oneLabel ? star : '')
    const restFirst = oneLabel && descParts.length > 0 ? restHead + gap + descParts[0] : restHead
    const hasKey = !v.locked && Button !== undefined && k < 6
    const drawn = hasKey
      ? <Button key={o.key} plain onPress={() => v.onPress(k)}>{restFirst}</Button>
      : <Text key="b" {...dim(v.grey)} wrap="truncate">{restFirst}</Text>
    const mark = o.picked ? <Text key="pk" {...drawSeg(PICK_MARK)}>{PICK_MARK.text}</Text> : <Text key="pk">{' '}</Text>
    if (hasKey) keyed.push({ k, at: rows.length })
    rows.push(<Box key={'o' + k}>{mark}{drawn}</Box>)
    // mark is one cell, then two spaces, then the digit: content column 3, band column 31 when the main border is column 27
    labelParts.slice(1).forEach((piece, i) => {
      const last = i === labelParts.length - 2
      const text = ' '.repeat(prefixW) + piece + (last ? star : '')
      rows.push(<Box key={'on' + k + '_' + i}><Text {...dim(v.grey)} wrap="truncate">{text}</Text></Box>)
    })
    const descFrom = oneLabel ? 1 : 0
    const indent = oneLabel ? descAt : displayWidth(prefix + labelParts[labelParts.length - 1] + star + gap)
    descParts.slice(descFrom).forEach((piece, i) => {
      rows.push(<Box key={'od' + k + '_' + i}><Text {...dimProps()} wrap="truncate">{' '.repeat(Math.min(indent, Math.max(0, w - 1))) + piece}</Text></Box>)
    })
  })
  const optTo2 = rows.length
  if (v.advice !== null) {
    block('ad', keys[1], v.advice.label, false)
    if (v.advice.why !== null) block('aw', null, v.advice.why, false)
  }
  if (v.notAuthorized !== null) block('na', keys[2], v.notAuthorized, false)
  if (fillBtn !== null) optTo.push(<Box key="fill"><Text>{' '}</Text>{fillBtn}</Box>)
  if (v.meta === null && v.note !== null) line('note', v.note, true)
  if (v.compact === true && !v.split && optTo2 > optFrom) {
    // the first row of the question stays on top, the options come next, and everything else (the rest of the question, the state line, the background, the advice) follows and scrolls
    const re = [...rows.slice(0, 1), ...rows.slice(optFrom, optTo2), ...rows.slice(1, optFrom), ...rows.slice(optTo2)]
    keyed.forEach(x => { if (x.at !== null && x.at >= optFrom && x.at < optTo2) x.at = x.at - optFrom + 1 })
    return { rows: re, strip, keyed }
  }
  return { rows, strip, keyed }
}

// a card taller than the frame (§12.10, owner d-60e13bd4): `top` scrolls in `room - strip rows - 1 rule - 1 page row` rows with a scrollbar column at its right edge, then one rule, then the fixed `strip`
// (the options, the fill Button, the page Buttons). The strip never moves with the scroll. `cells` is the main window's width. Returns exactly `room` rows when the strip fits; a strip taller than `room`
// leaves the window one row and the rest is cut by the shell (reported, not hidden: no layout of its own is invented).
export function cardSplit(el: { Box: El; Text: El; Button?: El }, t: T, o: { top: unknown[]; strip: unknown[]; room: number; cells: number; model: ScrollModel; onPage: (by: number) => void }): { rows: unknown[]; from: number; to: number } {
  const { Box, Text } = el
  const fixed = 1 + o.strip.length // the rule and the strip
  const fits = o.top.length <= o.room - fixed
  const winRows = Math.max(1, fits ? o.room - fixed : o.room - fixed - 1) // an overflowing window gives one more row to the page Buttons
  if (followsTail(o.model)) o.model.offset = Math.max(0, o.top.length - winRows)
  const win = fixedWindow(o.top.length, winRows, o.model)
  const th = thumbOf(o.top.length, winRows, win.offset)
  const shown = o.top.slice(win.offset, win.offset + win.rows)
  const rows: unknown[] = shown.map((r, i) => {
    const on = th !== null && i >= th.top && i < th.top + th.len
    const bar = th === null ? <Text key="sb">{' '}</Text> : <Text key="sb" color={on ? PALETTE.here : PALETTE.structure}>{on ? GLYPHS.scrollbar.thumb : GLYPHS.scrollbar.track}</Text>
    return <Box key={'sw' + i}><Box key="c" width={o.cells - 1} flexShrink={0} overflow="hidden">{r}</Box>{bar}</Box>
  })
  while (rows.length < winRows) rows.unshift(<Text key={'sp' + rows.length}>{' '}</Text>)
  rows.push(<Text key="rule" color={PALETTE.structure}>{GLYPHS.structure.rule.repeat(Math.max(1, o.cells - 1))}</Text>)
  if (win.hint) rows.push(scrollHint(el, t, win.above, win.below, () => o.onPage(-1), () => o.onPage(1)))
  rows.push(...o.strip)
  return { rows, from: win.offset, to: win.offset + win.rows } // [from, to): the rows of `top` the window shows
}

// the quick row of the 待決 card view: `0: 送出 N 張 │ 7: 上一張 │ 8: 下一張 │ 9: 下一個選單   tip`. The slots have fixed widths (15, 12, 12, 16), so the four labels sit at the same
// columns at every tier; only the tip's length changes.
export type CardQuick = { sendN: number; undo?: { secs: number; onUndo: () => void }; tip: string; onSend: () => void; onPrev: () => void; onNext: () => void; onMenu: () => void }
export function cardQuick(el: { Box: El; Text: El; Button?: El }, t: T, q: CardQuick): unknown[] {
  const { Box, Text, Button } = el
  // the digits are label text, never a hotkey (a bare digit in an empty composer would press the Button). The Box width, not the text, places 0/7/8/9.
  const slot = (key: string, hotkey: string, label: string, width: number, press: () => void, sep: boolean) => (
    <Box key={'s-' + key} width={width} flexShrink={0}>
      {Button === undefined ? <Text key="b">{hotkey + ': ' + label}</Text> : <Button key={key} plain onPress={press}>{hotkey + ': ' + label}</Button>}
      {sep ? <Text key="sep" {...drawSeg(QUICK_SEP)}>{QUICK_SEP.text}</Text> : <Text key="sep">{''}</Text>}
    </Box>
  )
  return [
    q.undo === undefined ? slot('send', '0', t('shell.send', { n: q.sendN }), 15, q.onSend, true) : slot('undo', '0', t('shell.undo', { n: q.undo.secs }), 15, q.undo.onUndo, true), // inside the undo window the slot takes the send back
    slot('prev', '7', t('shell.prev'), 12, q.onPrev, true),
    slot('next', '8', t('shell.next'), 12, q.onNext, true),
    slot('next-menu', '9', t('shell.next_menu'), 16, q.onMenu, false),
    <Text key="tip" {...dimProps()} wrap="truncate">{q.tip}</Text>,
  ]
}

// the usage tab's rows (shell.ts usageRows): one drawn row each, a blank one still takes its row
export function usageDraw(el: { Box: El; Text: El }, rows: readonly (readonly Seg[])[]): unknown[] {
  const { Box, Text } = el
  return rows.map((segs, i) => <Box key={'usage' + i}>{segs.length === 0 ? <Text key="b">{' '}</Text> : drawSegs(el, segs as Seg[], () => undefined)}</Box>)
}
// the progress row's content inside the main window: a one-cell pad, then the segments (slot segs become Buttons through `onSlot`)
export function progressRow(el: { Box: El; Text: El; Button?: El }, segs: readonly Seg[], onSlot?: (id: SlotId) => void): unknown {
  const { Box, Text } = el
  return <Box key="progress"><Text>{' '}</Text>{segs.length === 0 ? <Text key="p">{' '}</Text> : drawSegs(el, segs as Seg[], onSlot ?? (() => undefined))}</Box>
}
