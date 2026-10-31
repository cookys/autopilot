// mods/live/band.tsx — the band above the prompt: ONE line (stage-graph P7, contract ②; TUI v2 grammar). Pure view over the snapshot's slots:
// `layoutBand` (model.ts) applies the width table, this file only draws the result: each slot a plain Button keyed by its slot id (a press opens
// the pane on the tab that explains it), the separators plain Texts between them, then the ⓘ Button.
// Colours are theme keys as text colour only: no backgroundColor, no inverse, no raw colour. No Image, no Raster.

import { T_EN } from './i18n'
import type { T } from './i18n'
import { BAND_INFO_LABEL, BAND_SEP, displayWidth, layoutBand, plainBandText } from './model'
import type { DecideState, LiveSnapshot, PaneLine, PaneTab, Seg, SlotId } from './model'
import { actionSeg, dimProps, drawSeg } from './ui'
import { barRule, barStrip, decideTabLines } from './tabs'
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

// what the mod below answered to the one-row ask, if it is a Text of strings: the forge tab's text (anything else draws no forge tab). The tab is drawn in the strip's own style.
export function forgeLabelOf(r: unknown): string | null {
  const n = r as { type?: string; children?: unknown[] } | null | undefined
  if (n === null || n === undefined || n.type !== 'Text' || !Array.isArray(n.children) || n.children.length === 0 || !n.children.every(c => typeof c === 'string')) return null
  const text = (n.children as string[]).join('').replace(/\s+/g, ' ').trim()
  return text === '' ? null : text
}

export type BarHandlers = { onInfo: () => void; onSlot: (id: SlotId) => void; onTab: (id: BarTabId) => void }

// the row, and the column its tabs start in (the rule under it is built from that)
export function BandBar(el: { Box: El; Text: El; Button?: El }, snap: LiveSnapshot | null, columns: number, t: T, hd: BarHandlers, active: BarTabId | null, forge: string | null): { node: unknown; strip: BarStrip; tabsAt: number } {
  const { Box, Text, Button } = el
  const strip = barStrip(snap, t, active, forge)
  const left = bandCells(el, snap, Math.max(1, columns - strip.width - 1), hd.onInfo, t, hd.onSlot)
  const gap = Math.max(1, columns - left.width - strip.width)
  const tabs = strip.tabs.map(b => {
    const draw = <Text key="l" {...drawSeg(b.label)} wrap="truncate">{b.label.text}</Text>
    return (
      <Box key={'tab:' + b.id}>
        {Button === undefined ? draw : <Button key={b.id === 'forge' ? 'forge' : 'tab:' + b.id} plain onPress={() => hd.onTab(b.id)}>{draw}</Button>}
        <Text> </Text>
      </Box>
    )
  })
  return { node: <Box>{left.nodes}<Text>{' '.repeat(gap)}</Text>{tabs}</Box>, strip, tabsAt: left.width + gap }
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

// the open tab's content: rows (each one drawn row)
export function barContent(el: { Box: El; Text: El; Button?: El }, snap: LiveSnapshot | null, tab: PaneTab, columns: number, t: T, o: { onSlot: (id: SlotId) => void; onOpen: (tab: PaneTab) => void }): unknown[] {
  const { Box, Text } = el
  if (snap === null || snap.band === null) return []
  const band = snap.band
  const sel = (ids: SlotId[]) => band.slots.filter(s => ids.includes(s.id))
  const lineOf = (ids: SlotId[]): unknown[] => {
    const slots = sel(ids)
    return slots.length === 0 ? [] : [<Box key="line">{drawSegs(el, layoutBand(slots, columns).segs.slice(0, -1), o.onSlot)}</Box>]
  }
  const open = <Box key="buttons">{BarButton(el, 'open:' + tab, t('bar.open'), () => o.onOpen(tab))}</Box>
  if (tab === 'now') return [...lineOf(PROJECT_SLOTS), <Box key="buttons">{BarButton(el, 'open:now', t('bar.open'), () => o.onOpen('now'))}<Text>{'  '}</Text>{BarButton(el, 'open:dispatch', t('bar.dispatch'), () => o.onOpen('dispatch'))}</Box>]
  if (tab === 'dispatch') return [...lineOf(['dispatch']), open]
  if (tab === 'review') return [...lineOf(['review', 'decisions']), open]
  return []
}

// the 待決 tab's compact form: the first open question's title and its options, then the send row the pane's own builder made (the same lines, the same press ids: a press is
// decidePress, so a pick or a send here is the one the pane makes). No notes (a text field is the pane's); the rest of the questions are the pane's too.
export function decideContent(el: { Box: El; Text: El; Button?: El }, snap: LiveSnapshot | null, state: DecideState, columns: number, t: T, onPress: (id: string) => void): unknown[] {
  const { Box, Text, Button } = el
  if (snap === null || snap.band === null) return []
  const lines = decideTabLines(snap, { t, cols: columns, decide: { ...state, inputs: false } })
  const picked: PaneLine[] = []
  for (const l of lines) {
    if (l.bar === true) continue
    if (l.kind === 'item' || l.kind === 'choice') picked.push(l)
    else if (picked.length > 0 && l.kind === 'blank') break
  }
  const bars = lines.filter(l => l.bar === true)
  if (picked.length === 0) return [<Text key="none" {...dimProps()} wrap="truncate">{t('decide.none')}</Text>]
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
          return press === undefined || Button === undefined ? <Box key={'r' + j}>{texts}</Box> : <Button key={press} plain onPress={() => onPress(press)}>{texts}</Button>
        })}
      </Box>
    )
  }
  return [...picked.map((l, i) => drawLine(l, 'p' + i)), ...bars.map((l, i) => drawLine(l, 'b' + i))]
}
