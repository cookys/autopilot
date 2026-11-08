// mods/live/band.tsx — the band above the prompt: ONE line (stage-graph P7, contract ②; TUI v2 grammar). Pure view over the snapshot's slots:
// `layoutBand` (model.ts) applies the width table, this file only draws the result: each slot a plain Button keyed by its slot id (a press opens
// the pane on the tab that explains it), the separators plain Texts between them, then the ⓘ Button.
// Colours are theme keys as text colour only: no backgroundColor, no inverse, no raw colour. No Image, no Raster.

import { T_EN } from './i18n'
import type { T } from './i18n'
import { BAND_INFO_LABEL, BAND_SEP, displayWidth, layoutBand, plainBandText } from './model'
import { PICK_MARK, QUICK_SEP } from './shell'
import type { LeftItem, ShellPlan } from './shell'
import type { DecideState, LiveSnapshot, PaneLine, PaneTab, Seg, SlotId } from './model'
import { actionSeg, cardParas, dimProps, drawSeg, forgeBar, GLYPHS, moreSeg, PALETTE, wrapPlain } from './ui'
import { fixedWindow, thumbOf } from './scrollmath'
import type { ScrollModel } from './scrollmath'
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

// bandlayout: the rows drawn as they are, top to bottom, no band over them (the shell's own order puts the menu row second from the bottom). The tree is never taller than the band: a host that gets more
// than maxRows rows opens a window of its own and hides the last row (the quick row) behind a "n more" line, so there is no spare row here.
export function stackRows(el: { Box: El }, rows: unknown[]) {
  const { Box } = el
  return <Box flexDirection="column">{rows}</Box>
}

// the scroll hint row of a window that holds more than it shows (guideline §13.3): `↑ 還有 N 行 · ↓ 還有 M 行`, each half a Button that moves the window a page (a click, or Tab and Enter, reach what
// the wheel and the scroll keys also do), a half with nothing in that direction is not drawn
export function scrollHint(el: { Box: El; Text: El; Button?: El }, t: T, above: number, below: number, onUp: () => void, onDown: () => void): unknown {
  const { Box, Text, Button } = el
  const half = (k: string, text: string, press: () => void) => {
    const draw = <Text key="t" {...dimProps()} wrap="truncate">{text}</Text>
    return Button === undefined ? <Box key={k}>{draw}</Box> : <Button key={k} plain onPress={press}>{draw}</Button>
  }
  return (
    <Box key="scrollhint">
      <Text>{' '}</Text>
      {above > 0 ? half('scroll:up', t('shell.more_up', { n: above }), onUp) : <Text key="nu">{''}</Text>}
      {above > 0 && below > 0 ? <Text key="sep" {...dimProps()}>{' · '}</Text> : <Text key="ns">{''}</Text>}
      {below > 0 ? half('scroll:down', t('shell.more_down', { n: below }), onDown) : <Text key="nd">{''}</Text>}
    </Box>
  )
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

// ---- the O4 shell (contract 2026-11-06, bandlayout: operation area at the bottom): a frame of three kinds of window, a progress row and a quick row; 12 rows. shell.ts plans the frame, the
// columns and the left submenu; this file draws them. Only the left submenu, the main window and the quick row hold Buttons: the right-hand columns are Text, so the Tab order and the
// highlight are the same at every tier. ----

export type ShellDraw = {
  plan: ShellPlan
  left: LeftItem[]
  onLeft: (id: string) => void
  main: unknown[] // the main window's content rows, at most plan.bodyRows - 2; the divider and the progress row below them are drawn here
  progress: unknown // the progress row's content (one Box), inside the main window
  quick: unknown[]
  bar: unknown // the menu row (BandBar): bandlayout puts it on the second row from the bottom, the quick row last (guideline §13: the operation area is the last two rows)
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
  const body = plan.bodyRows
  const content = body - 2
  for (let r = 0; r < body; r++) {
    const item = d.left[r]
    const divider = r === content
    const leftCell = item === undefined
      ? blank('l')
      : Button === undefined
        ? <Box key="l">{segsOf(item.segs, 'l')}</Box>
        : <Button key={item.key} plain onPress={() => d.onLeft(item.id)}>{segsOf(item.segs, 'l')}</Button>
    const mainCell = divider ? <Text key="div" {...drawSeg(plan.divider.rule)}>{plan.divider.rule.text}</Text> : r > content ? d.progress : d.main[r] ?? blank('m')
    const cells = [
      vert(0, false),
      <Box key="lc" width={plan.geo.left} flexShrink={0}>{leftCell}</Box>,
      vert(1, divider),
      <Box key="mc" width={plan.geo.main} flexShrink={0}>{mainCell}</Box>,
    ]
    plan.columns.forEach((c, i) => {
      cells.push(vert(2 + i, divider && i === 0), <Box key={'c' + i} width={c.inner} flexShrink={0}>{segsOf(c.rows[r] ?? [], 'c' + i + '-')}</Box>)
    })
    cells.push(vert(2 + plan.columns.length, divider && plan.columns.length === 0))
    rows.push(<Box key={'row' + r}>{cells}</Box>)
  }
  rows.push(<Box key="bottom">{segsOf(plan.bottom, 'b')}</Box>)
  rows.push(<Box key="menu">{d.bar}</Box>)
  rows.push(<Box key="quick"><Text>{' '}</Text>{d.quick}</Box>)
  return rows
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
  if (v.background !== null) block('bg', keys[0], v.background, true)
  v.options.forEach((o, k) => {
    const hotkey = k < 6 ? String(k + 1) : undefined
    const hasKey = !v.locked && Button !== undefined && hotkey !== undefined
    // the name wraps by display width: the row has the pad and the pick mark in front (3 cells), the host's `k: ` in front of a Button, and the ★ behind the last piece (2 cells)
    const room = Math.max(1, w - 3 - (hasKey ? 3 : 0) - 2)
    const [head = '', ...more] = wrapPlain(o.label, room, room)
    const label = v.locked
      ? <Text key="b" {...dim(v.grey)} wrap="truncate">{head + ' '.repeat(Math.max(0, OPT_LABEL_COLS - displayWidth(head)))}</Text>
      : !hasKey
      ? <Text key="b" wrap="truncate">{(hotkey === undefined ? '' : hotkey + ': ') + head}</Text>
      : <Button key={o.key} plain hotkey={hotkey} onPress={() => v.onPress(k)}>{head + ' '.repeat(Math.max(0, OPT_LABEL_COLS - displayWidth(head)))}</Button>
    const star = o.recommended ? <Text key="rec">{' ' + GLYPHS.structure.recommend}</Text> : <Text key="rec">{''}</Text>
    if (hasKey) keyed.push({ k, at: v.split ? null : rows.length })
    optTo.push(
      <Box key={'o' + k}>
        <Text>{' '}</Text>{o.picked ? <Text key="pk" {...drawSeg(PICK_MARK)}>{PICK_MARK.text}</Text> : <Text key="pk">{' '}</Text>}<Text>{' '}</Text>
        {label}
        {more.length === 0 ? star : <Text key="rec">{''}</Text>}
      </Box>,
    )
    // the rest of a long name hangs under the first piece; the ★ follows the last piece
    more.forEach((r, i) => optTo.push(
      <Box key={'on' + k + '_' + i}><Text>{' '}</Text><Text {...dim(v.grey)} wrap="truncate">{'    ' + r}</Text>{i === more.length - 1 ? star : <Text key="rec">{''}</Text>}</Box>,
    ))
    if (o.description !== '') wrapPlain(o.description, w - 4, w - 4).forEach((r, i) => line('od' + k + '_' + i, r, true, v.split && i === 0 ? String(k + 1).padEnd(4) : '    '))
  })
  if (v.advice !== null) {
    block('ad', keys[1], v.advice.label, false)
    if (v.advice.why !== null) block('aw', null, v.advice.why, false)
  }
  if (v.notAuthorized !== null) block('na', keys[2], v.notAuthorized, false)
  if (fillBtn !== null) optTo.push(<Box key="fill"><Text>{' '}</Text>{fillBtn}</Box>)
  if (v.meta === null && v.note !== null) line('note', v.note, true)
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
  const win = fixedWindow(o.top.length, winRows, o.model)
  const th = thumbOf(o.top.length, winRows, win.offset)
  const shown = o.top.slice(win.offset, win.offset + win.rows)
  const rows: unknown[] = shown.map((r, i) => {
    const on = th !== null && i >= th.top && i < th.top + th.len
    const bar = th === null ? <Text key="sb">{' '}</Text> : <Text key="sb" color={on ? PALETTE.here : PALETTE.structure}>{on ? GLYPHS.scrollbar.thumb : GLYPHS.scrollbar.track}</Text>
    return <Box key={'sw' + i}><Box key="c" width={o.cells - 1} flexShrink={0} overflow="hidden">{r}</Box>{bar}</Box>
  })
  while (rows.length < winRows) rows.push(<Text key={'sp' + rows.length}>{' '}</Text>)
  rows.push(<Text key="rule" color={PALETTE.structure}>{GLYPHS.structure.rule.repeat(Math.max(1, o.cells - 1))}</Text>)
  rows.push(...o.strip)
  if (win.hint) rows.push(scrollHint(el, t, win.above, win.below, () => o.onPage(-1), () => o.onPage(1)))
  return { rows, from: win.offset, to: win.offset + win.rows } // [from, to): the rows of `top` the window shows
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
