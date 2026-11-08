// mods/live/band.tsx — the band above the prompt: ONE line (stage-graph P7, contract ②; TUI v2 grammar). Pure view over the snapshot's slots:
// `layoutBand` (model.ts) applies the width table, this file only draws the result: each slot a plain Button keyed by its slot id (a press opens
// the pane on the tab that explains it), the separators plain Texts between them, then the ⓘ Button.
// Colours are theme keys as text colour only: no backgroundColor, no inverse, no raw colour. No Image, no Raster.

import { T_EN } from './i18n'
import type { T } from './i18n'
import { BAND_INFO_LABEL, BAND_SEP, displayWidth, layoutBand, plainBandText } from './model'
import { BODY_ROWS, MAIN_CONTENT_ROWS, PICK_MARK, QUICK_SEP } from './shell'
import type { LeftItem, ShellPlan } from './shell'
import type { DecideState, LiveSnapshot, PaneLine, PaneTab, Seg, SlotId } from './model'
import { actionSeg, dimProps, drawSeg, forgeBar, GLYPHS, moreSeg } from './ui'
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
export function BandBar(el: { Box: El; Text: El; Button?: El }, snap: LiveSnapshot | null, columns: number, t: T, hd: BarHandlers, active: BarTabId | null, forge: readonly ForgeSegment[] | null, usage = true, moreTo: BarTabId | null = null): { node: unknown; strip: BarStrip; tabsAt: number } {
  const { Box, Text, Button } = el
  // the forge label is read by forgeSegments (ui.ts): speed (and pet) sit on the left after the ⓘ, and the strip keeps a short forge tab that opens the full view
  const fb = forge === null ? null : forgeBar(forge)
  const strip = barStrip(snap, t, active, fb === null ? null : GLYPHS.structure.speed, usage)
  const forgeW = fb === null ? 0 : fb.width
  // `moreTo`: a tab has no room (用量, or forge with something timed), so a dim `›` ends the row: a Button (key 'more'), so Tab / Enter still reach the hidden tab
  const more = moreTo !== null
  const moreW = more ? displayWidth(GLYPHS.structure.goto) + 1 : 0
  const left = bandCells(el, snap, Math.max(1, columns - strip.width - 1 - forgeW - moreW), hd.onInfo, t, hd.onSlot)
  const gap = Math.max(1, columns - left.width - forgeW - strip.width - moreW)
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
  return { node: <Box>{left.nodes}{speed}<Text>{' '.repeat(gap)}</Text>{tabs}{moreNode}</Box>, strip, tabsAt: left.width + forgeW + gap }
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
export function barParts(el: { Box: El; Text: El; Button?: El }, snap: LiveSnapshot | null, tab: PaneTab | 'usage', columns: number, t: T, o: { onSlot: (id: SlotId) => void; onOpen: (tab: PaneTab) => void }): { rows: unknown[]; quick: unknown[] } {
  const { Box, Text } = el
  if (tab === 'usage') return { rows: [], quick: [<Box key="buttons">{BarButton(el, 'open:usage', t('bar.open'), () => o.onOpen('spend'))}</Box>] }
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
export function barContent(el: { Box: El; Text: El; Button?: El }, snap: LiveSnapshot | null, tab: PaneTab | 'usage', columns: number, t: T, o: { onSlot: (id: SlotId) => void; onOpen: (tab: PaneTab) => void }): unknown[] {
  const p = barParts(el, snap, tab, columns, t, o)
  return [...p.rows, ...p.quick]
}

// the 待決 tab's compact form: the first open question's title and its options, then the send row the pane's own builder made (the same lines, the same press ids: a press is
// decidePress, so a pick or a send here is the one the pane makes). This compact form (the tab-row layout, for a host that gives fewer than 12 rows) has no note and no typed answer: those are the card view's 附註／其他回答 and 打字回答 buttons (`cardMain`, O4 shell) and the pane's text fields; the rest of the questions are the pane's too.
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
  main: unknown[] // the main window's content rows, at most MAIN_CONTENT_ROWS; the divider and the progress row below them are drawn here
  progress: unknown // the progress row's content (one Box), inside the main window
  quick: unknown[]
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
  const rows: unknown[] = [<Box key="top">{segsOf(plan.top, 't')}</Box>]
  for (let r = 0; r < BODY_ROWS; r++) {
    const item = d.left[r]
    const divider = r === MAIN_CONTENT_ROWS
    const leftCell = item === undefined
      ? blank('l')
      : Button === undefined
        ? <Box key="l">{segsOf(item.segs, 'l')}</Box>
        : <Button key={item.key} plain onPress={() => d.onLeft(item.id)}>{segsOf(item.segs, 'l')}</Button>
    const mainCell = divider ? <Text key="div" {...drawSeg(plan.divider.rule)}>{plan.divider.rule.text}</Text> : r > MAIN_CONTENT_ROWS ? d.progress : d.main[r] ?? blank('m')
    const cells = [
      vert(0, false),
      <Box key="lc" width={plan.geo.left} flexShrink={0}>{leftCell}</Box>,
      vert(1, divider),
      <Box key="mc" width={plan.geo.main} flexShrink={0}>{mainCell}</Box>,
    ]
    plan.columns.forEach((c, i) => {
      cells.push(vert(2 + i, divider && i === 0), <Box key={'c' + i} width={c.inner} flexShrink={0}>{segsOf(c.rows[r], 'c' + i + '-')}</Box>)
    })
    cells.push(vert(2 + plan.columns.length, divider && plan.columns.length === 0))
    rows.push(<Box key={'row' + r}>{cells}</Box>)
  }
  rows.push(<Box key="bottom">{segsOf(plan.bottom, 'b')}</Box>)
  rows.push(<Box key="quick"><Text>{' '}</Text>{d.quick}</Box>)
  return rows
}

// ---- the card view (ux-v7): the main window of the 待決 tab shows ONE card: its question, its background (dim, one row, two from 160), its options as hotkey Buttons 1..6; under the options one Button (no hotkey: 0-9 are all taken) fills the prompt box with the reply line so the owner types a note or a free answer there and presses Enter ----
export type CardView = {
  key: string
  question: string
  background: string | null
  options: { label: string; description: string; picked: boolean; recommended: boolean; key: string }[]
  note: string | null // a card the band cannot answer (typed or in a dialog) and has no way to fill: one dim line instead of options
  meta: string | null // the pane's card state, as the pane words it: `decide.sent` (already sent), `decide.held` (in its undo window), or, on a card the session or the CLI closed elsewhere, the answer line `decide.elsewhere`; drawn dim
  locked: boolean // sent or in the undo window: the options are plain text (no Button, no hotkey) and a press does nothing, as in the pane
  grey: boolean // an answered card (sent, or closed elsewhere): the question and the options are dim theme text, the card stays in its place
  fix: { label: string; onPress: () => void } | null // the pane's 改答案 on a card sent from here
  fill: { label: string; onPress: () => void } | null // the button that puts the reply line in the prompt box (`$.prompt.fill`): an option card's 附註／其他回答, a typed card's 打字回答; null where the surface has no prompt box or the card is a dialog's
  bgRows: number
  width: number // the main window's inner width less the pad
  onPress: (k: number) => void
}
// `text` cut into at most `n` lines of `w` cells; the last one ends in … when something is left. Breaks after a punctuation mark when one is near the end of the line.
export function chunkText(text: string, w: number, n: number): string[] {
  const out: string[] = []
  let rest = text.replace(/\s+/g, ' ').trim()
  while (rest !== '' && out.length < n) {
    if (displayWidth(rest) <= w) { out.push(rest); rest = ''; break }
    let cut = 0
    let used = 0
    for (const ch of rest) { const cw = displayWidth(ch); if (used + cw > w) break; used += cw; cut += ch.length }
    const head = rest.slice(0, cut)
    const brk = Math.max(head.lastIndexOf('，'), head.lastIndexOf('；'), head.lastIndexOf('、'), head.lastIndexOf('。'), head.lastIndexOf(' '))
    if (brk >= head.length - 8 && brk > 0 && out.length < n - 1) { out.push(head.slice(0, brk + 1).trimEnd()); rest = rest.slice(brk + 1).trimStart() } else { out.push(head); rest = rest.slice(cut) }
  }
  if (rest !== '' && out.length > 0) { const last = out[out.length - 1]; out[out.length - 1] = displayWidth(last) >= w ? last.slice(0, Math.max(0, last.length - 1)) + '…' : last + '…' }
  return out
}
// the option label is padded to this many cells inside its Button, so the highlight and the description column sit at the same place at every tier (ux-v7: the highlight is 13 wide with `1: `)
const OPT_LABEL_COLS = 10
export function cardMain(el: { Box: El; Text: El; Button?: El }, v: CardView, t: T): unknown[] {
  const { Box, Text, Button } = el
  const rows: unknown[] = []
  // the fill button sits in the row under the options; a card of five or six options leaves no such row, so there it stands in front of the question (the button wins over the second background row and never over an option)
  // the state line (meta, dim) takes the same row and the same fallback: under the options when a row is left, else in front of the question
  const inline = (v.fill !== null || v.meta !== null) && 1 + v.options.length + 1 > MAIN_CONTENT_ROWS
  const fillBtn = v.fill === null ? null : BarButton(el, 'fill', v.fill.label, v.fill.onPress)
  const fixBtn = v.fix === null ? null : BarButton(el, 'fix', v.fix.label, v.fix.onPress)
  const metaText = v.meta === null ? null : <Text key="meta" {...dimProps()} wrap="truncate">{v.meta}</Text>
  const lead = inline ? (fillBtn !== null ? fillBtn : metaText === null ? null : <Text key="metai" {...dimProps()}>{v.meta + ' · '}</Text>) : null
  rows.push(<Box key="q"><Text>{' '}</Text>{lead !== null ? <Box key="fi">{lead}{fillBtn !== null ? <Text>{' '}</Text> : <Text>{''}</Text>}</Box> : <Text key="fi">{''}</Text>}<Text {...(v.grey ? dimProps() : {})} wrap="truncate">{v.question}</Text></Box>)
  // the background area is two rows at every tier (one line of text when narrow, two from 160, the second row blank otherwise), so the options sit on the same rows everywhere; it
  // gives rows back only when the options would not fit
  const tail = inline ? 0 : v.fill !== null || v.meta !== null || v.note !== null ? 1 : 0
  const area = Math.max(0, Math.min(2, MAIN_CONTENT_ROWS - 1 - v.options.length - tail))
  const bg = v.background === null ? [] : chunkText(v.background, v.width - 6, Math.min(v.bgRows, area))
  for (let i = 0; i < area; i++) {
    const line = bg[i]
    rows.push(<Box key={'bg' + i}><Text>{' '}</Text>{line === undefined ? <Text key="e">{' '}</Text> : <Text key="e" {...dimProps()} wrap="truncate">{(i === 0 ? t('shell.bg') + '  ' : '      ') + line}</Text>}</Box>)
  }
  v.options.slice(0, MAIN_CONTENT_ROWS - rows.length).forEach((o, k) => {
    const hotkey = k < 6 ? String(k + 1) : undefined
    const label = v.locked
      ? <Text key="b" {...(v.grey ? dimProps() : {})} wrap="truncate">{o.label + ' '.repeat(Math.max(0, OPT_LABEL_COLS - displayWidth(o.label)))}</Text>
      : Button === undefined || hotkey === undefined
      ? <Text key="b" wrap="truncate">{(hotkey === undefined ? '' : hotkey + ': ') + o.label}</Text>
      : <Button key={o.key} plain hotkey={hotkey} onPress={() => v.onPress(k)}>{o.label + ' '.repeat(Math.max(0, OPT_LABEL_COLS - displayWidth(o.label)))}</Button>
    rows.push(
      <Box key={'o' + k}>
        <Text>{' '}</Text>{o.picked ? <Text key="pk" {...drawSeg(PICK_MARK)}>{PICK_MARK.text}</Text> : <Text key="pk">{' '}</Text>}<Text>{' '}</Text>
        {label}
        {o.recommended ? <Text key="rec">{' ' + GLYPHS.structure.recommend}</Text> : <Text key="rec">{''}</Text>}
        {o.description === '' ? <Text key="d">{''}</Text> : <Text key="d" {...dimProps()} wrap="truncate">{'  ' + o.description}</Text>}
      </Box>,
    )
  })
  if (v.fill !== null) { if (!inline) rows.push(<Box key="fill"><Text>{' '}</Text>{fillBtn}</Box>) }
  else if (v.meta !== null) { if (!inline) rows.push(<Box key="metar"><Text>{' '}</Text>{metaText}{fixBtn === null ? <Text key="nf">{''}</Text> : <Box key="fx"><Text>{'  '}</Text>{fixBtn}</Box>}</Box>) }
  else if (v.note !== null) rows.push(<Box key="note"><Text>{' '}</Text><Text {...dimProps()} wrap="truncate">{v.note}</Text></Box>)
  return rows.slice(0, MAIN_CONTENT_ROWS)
}

// the quick row of the 待決 card view: `0: 送出 N 張 │ 7: 上一張 │ 8: 下一張 │ 9: 下一個選單   tip`. The slots have fixed widths (15, 12, 12, 16), so the four labels sit at the same
// columns at every tier; only the tip's length changes.
export type CardQuick = { sendN: number; undo?: { secs: number; onUndo: () => void }; tip: string; onSend: () => void; onPrev: () => void; onNext: () => void; onMenu: () => void }
export function cardQuick(el: { Box: El; Text: El; Button?: El }, t: T, q: CardQuick): unknown[] {
  const { Box, Text, Button } = el
  const slot = (key: string, hotkey: string, label: string, width: number, press: () => void, sep: boolean) => (
    <Box key={'s-' + key} width={width} flexShrink={0}>
      {Button === undefined ? <Text key="b">{hotkey + ': ' + label}</Text> : <Button key={key} plain hotkey={hotkey} onPress={press}>{label}</Button>}
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
