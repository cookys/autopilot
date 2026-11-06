// mods/live/band.tsx — the band above the prompt: ONE line (stage-graph P7, contract ②; TUI v2 grammar). Pure view over the snapshot's slots:
// `layoutBand` (model.ts) applies the width table, this file only draws the result: each slot a plain Button keyed by its slot id (a press opens
// the pane on the tab that explains it), the separators plain Texts between them, then the ⓘ Button.
// Colours are theme keys as text colour only: no backgroundColor, no inverse, no raw colour. No Image, no Raster.

import { T_EN } from './i18n'
import type { T } from './i18n'
import { BAND_INFO_LABEL, BAND_SEP, displayWidth, layoutBand, plainBandText } from './model'
import { BODY_ROWS } from './shell'
import type { LeftItem, ShellPlan } from './shell'
import type { DecideState, LiveSnapshot, PaneLine, PaneTab, Seg, SlotId } from './model'
import { actionSeg, dimProps, drawSeg, forgeBar, GLYPHS } from './ui'
import type { ForgeSegment } from './ui'
import { barRule, barStrip, decideBandPlan } from './tabs'
import { COL_GAP } from './speedview'
import type { SpeedColumn } from './speedview'
import type { BarStrip, BarTabId } from './tabs'

type El = (props: any) => any

// the band is this many rows tall (one Box of one line); the mods drawn below it are given the rows that remain
export const BAND_ROWS = 1

// the band over what a mod below it drew: autopilot on top, the other under it
export function stackBand(el: { Box: El }, band: unknown, below: unknown) {
  const { Box } = el
  return <Box flexDirection="column">{band}{below}</Box>
}

// consecutive segs of one slot become one Button; a seg with no slot (a separator) stays a bare Text
function drawSegs(el: { Text: El; Button?: El }, segs: Seg[], onSlot: (id: SlotId) => void) {
  const { Text, Button } = el
  const text = (s: Seg, i: number) => <Text key={'s' + i} {...drawSeg(s)} wrap="truncate">{s.text}</Text>
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

// the band's own cells (the line and the ⓘ), and the width they take
function bandCells(el: { Box: El; Text: El; Button?: El }, snap: LiveSnapshot | null, columns: number, onInfo: () => void, t: T, onSlot: (id: SlotId) => void): { nodes: unknown[]; width: number } {
  const { Text, Button } = el
  // only the ⓘ autoFocuses: Ctrl+x Tab lands on it, as before the slots were controls
  const icon = Button === undefined
    ? <Text>{BAND_INFO_LABEL}</Text>
    : <Button key="info" plain autoFocus onPress={onInfo}>{BAND_INFO_LABEL}</Button>
  if (snap === null || snap.band === null) {
    const reason = snap === null ? t('band.waiting') : snap.text
    const line = plainBandText(reason, columns) + BAND_SEP
    return { nodes: [<Text key="w" {...dimProps()} wrap="truncate">{line}</Text>, icon], width: displayWidth(line) + displayWidth(BAND_INFO_LABEL) }
  }
  const line = layoutBand(snap.band.slots, columns)
  return { nodes: [...drawSegs(el, line.segs, onSlot), icon], width: line.width }
}

export function Band(el: { Box: El; Text: El; Button?: El }, snap: LiveSnapshot | null, columns: number, onInfo: () => void, t: T = T_EN, onSlot: (id: SlotId) => void = () => {}) {
  const { Box } = el
  return <Box>{bandCells(el, snap, columns, onInfo, t, onSlot).nodes}</Box>
}

// ---- layout E1: the band row is the indicator on the left and the tabs on the right; an open tab draws its content under a rule ----

export type BarHandlers = { onInfo: () => void; onSlot: (id: SlotId) => void; onTab: (id: BarTabId) => void }

// the row, and the column its tabs start in (the rule under it is built from that)
export function BandBar(el: { Box: El; Text: El; Button?: El }, snap: LiveSnapshot | null, columns: number, t: T, hd: BarHandlers, active: BarTabId | null, forge: readonly ForgeSegment[] | null): { node: unknown; strip: BarStrip; tabsAt: number } {
  const { Box, Text, Button } = el
  // the forge label is read by forgeSegments (ui.ts): speed (and pet) sit on the left after the ⓘ, and the strip keeps a short forge tab that opens the full view
  const fb = forge === null ? null : forgeBar(forge)
  const strip = barStrip(snap, t, active, fb === null ? null : GLYPHS.structure.speed)
  const forgeW = fb === null ? 0 : fb.width
  const left = bandCells(el, snap, Math.max(1, columns - strip.width - 1 - forgeW), hd.onInfo, t, hd.onSlot)
  const gap = Math.max(1, columns - left.width - forgeW - strip.width)
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
  return { node: <Box>{left.nodes}{speed}<Text>{' '.repeat(gap)}</Text>{tabs}</Box>, strip, tabsAt: left.width + forgeW + gap }
}

// the rule under the bar
export function BarRule(el: { Box: El; Text: El }, strip: BarStrip, columns: number, tabsAt: number, active: BarTabId | null) {
  const { Box, Text } = el
  return <Box>{barRule(strip, columns, tabsAt, active).map((s, i) => <Text key={'r' + i} {...drawSeg(s)} wrap="truncate">{s.text}</Text>)}</Box>
}

// `[ label ]` in the action colour: a pressable control
export function BarButton(el: { Text: El; Button?: El }, id: string, label: string, onPress: () => void) {
  const { Text, Button } = el
  const text = <Text key="t" {...drawSeg(actionSeg('[ ' + label + ' ]'))} wrap="truncate">{'[ ' + label + ' ]'}</Text>
  return Button === undefined ? text : <Button key={id} plain onPress={onPress}>{text}</Button>
}

const PROJECT_SLOTS: SlotId[] = ['position', 'unit', 'review', 'spend']

// the open tab's content: rows (each one drawn row). `barParts` keeps the buttons row apart: the tab-row layout draws it as the last row, the O4 shell as its quick row.
export function barParts(el: { Box: El; Text: El; Button?: El }, snap: LiveSnapshot | null, tab: PaneTab, columns: number, t: T, o: { onSlot: (id: SlotId) => void; onOpen: (tab: PaneTab) => void }): { rows: unknown[]; quick: unknown[] } {
  const { Box, Text } = el
  if (snap === null || snap.band === null) return { rows: [], quick: [] }
  const band = snap.band
  const sel = (ids: SlotId[]) => band.slots.filter(s => ids.includes(s.id))
  const lineOf = (ids: SlotId[]): unknown[] => {
    const slots = sel(ids)
    return slots.length === 0 ? [] : [<Box key="line">{drawSegs(el, layoutBand(slots, columns).segs.slice(0, -1), o.onSlot)}</Box>]
  }
  const open = <Box key="buttons">{BarButton(el, 'open:' + tab, t('bar.open'), () => o.onOpen(tab))}</Box>
  if (tab === 'decide') return { rows: [], quick: [open] }
  if (tab === 'now') return { rows: lineOf(PROJECT_SLOTS), quick: [<Box key="buttons">{BarButton(el, 'open:now', t('bar.open'), () => o.onOpen('now'))}<Text>{'  '}</Text>{BarButton(el, 'open:dispatch', t('bar.dispatch'), () => o.onOpen('dispatch'))}</Box>] }
  if (tab === 'dispatch') return { rows: lineOf(['dispatch']), quick: [open] }
  if (tab === 'review') return { rows: lineOf(['review', 'decisions']), quick: [open] }
  return { rows: [], quick: [] }
}
export function barContent(el: { Box: El; Text: El; Button?: El }, snap: LiveSnapshot | null, tab: PaneTab, columns: number, t: T, o: { onSlot: (id: SlotId) => void; onOpen: (tab: PaneTab) => void }): unknown[] {
  const p = barParts(el, snap, tab, columns, t, o)
  return [...p.rows, ...p.quick]
}

// the 待決 tab's compact form: the first open question's title and its options, then the send row the pane's own builder made (the same lines, the same press ids: a press is
// decidePress, so a pick or a send here is the one the pane makes). No notes (a text field is the pane's); the rest of the questions are the pane's too.
// The rows come from `decideBandPlan` (tabs.ts): wrapped, never cut; a pointer row for what the pane alone shows; `maxRows` is the room under the bar and rule (rows - 2).
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

// ---- the O4 shell (contract 2026-11-06): menu row on top (BandBar), then a frame of three kinds of window, a progress row and a quick row; 12 rows. shell.ts plans the frame, the
// columns and the left submenu; this file draws them. Only the left submenu, the main window and the quick row hold Buttons: the right-hand columns are Text, so the Tab order and the
// highlight are the same at every tier. ----

export type ShellDraw = {
  plan: ShellPlan
  left: LeftItem[]
  onLeft: (id: string) => void
  main: unknown[] // the main window's rows (the open tab's content), at most BODY_ROWS
  progress: { segs: Seg[]; onSlot: (id: SlotId) => void } | null
  quick: unknown[]
}
export function Shell(el: { Box: El; Text: El; Button?: El }, d: ShellDraw): unknown[] {
  const { Box, Text, Button } = el
  const { plan } = d
  const segsOf = (segs: readonly Seg[], k: string) => segs.map((s, i) => <Text key={k + i} {...drawSeg(s)} wrap="truncate">{s.text}</Text>)
  const vert = (i: number) => <Text key={'v' + i} {...drawSeg(plan.verts[i])}>{plan.verts[i].text}</Text>
  const blank = (k: string) => <Text key={k}>{' '}</Text>
  const rows: unknown[] = [<Box key="top">{segsOf(plan.top, 't')}</Box>]
  for (let r = 0; r < BODY_ROWS; r++) {
    const item = d.left[r]
    const leftCell = item === undefined
      ? blank('l')
      : Button === undefined
        ? <Box key="l">{segsOf(item.segs, 'l')}</Box>
        : <Button key={'menu:' + item.id} plain onPress={() => d.onLeft(item.id)}>{segsOf(item.segs, 'l')}</Button>
    const cells = [
      vert(0),
      <Box key="lc" width={plan.geo.left} flexShrink={0}>{leftCell}</Box>,
      vert(1),
      <Box key="mc" width={plan.geo.main} flexShrink={0}>{d.main[r] ?? blank('m')}</Box>,
    ]
    plan.columns.forEach((c, i) => {
      cells.push(vert(2 + i), <Box key={'c' + i} width={c.inner} flexShrink={0}>{segsOf(c.rows[r], 'c' + i + '-')}</Box>)
    })
    cells.push(vert(2 + plan.columns.length))
    rows.push(<Box key={'row' + r}>{cells}</Box>)
  }
  rows.push(<Box key="bottom">{segsOf(plan.bottom, 'b')}</Box>)
  rows.push(<Box key="progress"><Text>{' '}</Text>{d.progress === null ? blank('p') : drawSegs(el, d.progress.segs, d.progress.onSlot)}</Box>)
  rows.push(<Box key="quick"><Text>{' '}</Text>{d.quick}</Box>)
  return rows
}
