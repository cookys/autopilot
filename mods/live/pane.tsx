// mods/live/pane.tsx — the panel the ⓘ opens (TUI v2): Now · Decide · Dispatch · Review · Spend · Hygiene · ?  (the stage walk lives in Now, the proxy decisions in Review, the owner's open questions in Decide,
// the glyph legend is the `?` tab). Pure view over the snapshot; `el` comes from $.ui.resolve(e). Every tab builds its lines in tabs.ts, out of ui.ts components
// (a missing fact is an explicit "no data" line there, never an empty tab). Words come from the string tables through `t`. This file decides no colour: every Text
// gets its props from `drawSeg` (ui.ts), theme keys as text colour only, no background, no inverse.

import { T_EN } from './i18n'
import type { T } from './i18n'
import { paneWidth } from './model'
import type { DecideState, LiveSnapshot, PaneLine, PaneTab, Seg } from './model'
import { decideTabLines, dispatchLines, headerLines, hygieneTabLines, legendLines, nowLines, reviewTabLines, spendTabLines, stripOf, treeRowCount, withOverflowHint } from './tabs'
import type { ScrollView } from './tabs'
import { dimProps, drawSeg } from './ui'

export type { PaneTab } from './model'

// What the 待決 tab's controls call: a press on an option or the send Button (by its `press` id), and an edit of a note field (by the field's key). `state` is the
// owner's picks and notes as the host holds them; `inputs` is whether the surface draws text fields.
export type DecideActs = { state: DecideState; inputs: boolean; onPress: (id: string) => void; onNote: (key: string, value: string) => void }

type El = (props: any) => any

// The tab strip (ui.ts `strip`): Buttons when the surface has them (a click or Enter switches the tab), plain Text otherwise. The active tab is a bold name, and
// the baseline under the strip carries a `claude` run of `━` beneath it (a strip that wraps keeps the bold alone). A tab that holds something for the owner is
// drawn attention bold (no badge, no count).
// The FIRST drawn Button is the `›` next-tab chip and it carries the pane's autoFocus ("of several in one site the first drawn wins"): whenever Ctrl+x Tab or
// `open({focus})` hands the pane the keyboard, the ring lands on a Button whose Enter steps to the next tab. It used to land on the ACTIVE tab's Button,
// where Enter pressed the tab already showing (a no-op): "Ctrl+x Tab, Enter, Enter" cycled tabs only when the ring happened to sit on the band's ⓘ
// (real machine 2026-10-10, 120 columns). The tab Buttons stay pressable (a click, or Tab / arrows + Enter) and still select their own tab.
function tabStrip(el: { Box: El; Text: El; Button?: El }, tab: PaneTab, onTab: (t: PaneTab) => void, onNext: () => void, snap: LiveSnapshot | null, t: T, cols: number) {
  const { Box, Text, Button } = el
  const strip = stripOf(snap, { t, cols }, tab, Button !== undefined)
  const draw = (s: Seg, k: string | number) => <Text key={k} {...drawSeg(s)} wrap="truncate">{s.text}</Text>
  return (
    <Box flexDirection="column">
      <Box flexWrap="wrap">
        {Button === undefined || strip.next === null ? null : <Box key="next"><Button key="next" plain autoFocus onPress={onNext}>{strip.next.text}</Button><Text> </Text></Box>}
        {strip.tabs.map(x => (
          <Box key={x.id}>
            {Button === undefined ? draw(x.label, 'label') : <Button key={x.id} plain onPress={() => onTab(x.id)}>{draw(x.label, 'label')}</Button>}
            <Text> </Text>
          </Box>
        ))}
      </Box>
      <Box>{strip.rule.map((s, i) => draw(s, 'rule' + i))}</Box>
    </Box>
  )
}

export function Pane(el: { Box: El; Text: El; Link: El; Button?: El; Input?: El }, snap: LiveSnapshot | null, tab: PaneTab = 'now', onTab: (t: PaneTab) => void = () => {}, t: T = T_EN, bodyColumns: number | null = null, onNext: () => void = () => {}, expanded: ReadonlySet<string> = new Set(), onToggle: (id: string) => void = () => {}, folded: ReadonlySet<string> = new Set(), scroll: ScrollView | null = null, decide: DecideActs | null = null) {
  const { Box, Text, Link, Button, Input } = el
  const cols = paneWidth(bodyColumns)
  const ctx = { t, cols, expanded, folded, ...(decide === null ? {} : { decide: { ...decide.state, inputs: decide.inputs && Input !== undefined } }) }
  const segsOf = (l: PaneLine): Seg[] => l.segs ?? [{ text: l.text }]
  const drawn = (l: PaneLine) => segsOf(l).map((x, j) => <Text key={'g' + j} {...drawSeg(x)} wrap="truncate">{x.text}</Text>)
  // a line with no segments is the blank (an empty Text takes no row); every other line is a row of segments
  const plainLine = (l: PaneLine, i: number, k = '') => l.segs !== undefined
    ? <Box key={k + 'l' + i} flexWrap={l.wrap === true ? 'wrap' : undefined}>{l.segs.map((s, j) => <Text key={'g' + j} {...drawSeg(s)} wrap={l.wrap === true ? 'wrap' : 'truncate'}>{s.text}</Text>)}</Box>
    : <Text key={k + 'l' + i} wrap="truncate">{l.text}</Text>
  // a line with pressable segments (the 待決 option row and send row): consecutive segments of one `press` id are one Button, the rest plain Text. Without Button it is plain.
  const pressLine = (l: PaneLine, i: number, k: string) => {
    const runs: { press: string | undefined; segs: Seg[] }[] = []
    for (const s of l.segs as Seg[]) {
      const last = runs[runs.length - 1]
      if (last !== undefined && last.press === s.press) last.segs.push(s)
      else runs.push({ press: s.press, segs: [s] })
    }
    return (
      <Box key={k + 'p' + i} flexWrap="wrap">
        {runs.map((r, j) => {
          const texts = r.segs.map((s, n) => <Text key={'g' + n} {...drawSeg(s)} wrap="truncate">{s.text}</Text>)
          return r.press === undefined || Button === undefined || decide === null
            ? <Box key={'r' + j}>{texts}</Box>
            : <Button key={r.press} plain onPress={() => decide.onPress(r.press as string)}>{texts}</Button>
        })}
      </Box>
    )
  }
  // a text-field line: the label, then the Input (what is typed is the owner's note, kept by the host under the field's key)
  const fieldLine = (l: PaneLine, i: number, k: string) => {
    const f = l.field as NonNullable<PaneLine['field']>
    return (
      <Box key={k + 'f' + i}>
        {l.segs === undefined ? null : l.segs.map((s, j) => <Text key={'g' + j} {...drawSeg(s)} wrap="truncate">{s.text}</Text>)}
        {Input === undefined || decide === null ? null : <Input key={f.key} placeholder={f.placeholder} value={f.value} onInput={(v: string) => decide.onNote(f.key, v)} onSubmit={(v: string) => decide.onNote(f.key, v)} />}
      </Box>
    )
  }
  // a line that carries a `toggle` id is a Button when the surface has them (a press expands / collapses its group), the plain line otherwise
  const line = (l: PaneLine, i: number, k = '') => l.field !== undefined && l.segs !== undefined
    ? fieldLine(l, i, k)
    : l.kind === 'choice' && l.segs !== undefined
    ? pressLine(l, i, k)
    : l.toggle !== undefined && Button !== undefined
    ? <Button key={k + 'b' + i} plain onPress={() => onToggle(l.toggle as string)}>{drawn(l)}</Button>
    // a line that carries a `goto` tab (a projection row, design plan §2.3) is a Button that opens that tab
    : l.goto !== undefined && Button !== undefined
    ? <Button key={k + 'g' + i} plain onPress={() => onTab(l.goto as PaneTab)}>{drawn(l)}</Button>
    : plainLine(l, i, k)
  const strip = tabStrip(el, tab, onTab, onNext, snap, t, cols)
  if (snap === null) {
    return (
      <Box flexDirection="column">
        {strip}
        <Text {...dimProps()}>{t('pane.waiting')}</Text>
      </Box>
    )
  }
  // the global header (design plan §2.2): drawn here, once, on every tab; no tab builder emits it (I9)
  // (pane.overflow: this site's own scroll state, so the one thing allowed to differ between tabs: the last metrics line may end with the overflow hint)
  const body: PaneLine[] = tab === 'legend' ? legendLines(ctx) : tab === 'now' ? nowLines(snap, ctx) : tab === 'decide' ? decideTabLines(snap, ctx) : tab === 'review' ? reviewTabLines(snap, ctx) : tab === 'spend' ? spendTabLines(snap, ctx) : tab === 'hygiene' ? hygieneTabLines(snap, ctx) : dispatchLines(snap, ctx)
  const link = tab === 'dispatch' && snap.link !== null
  const stripH = stripOf(snap, ctx, tab, Button !== undefined)
  const plainHead = headerLines(snap, ctx)
  const head = withOverflowHint(plainHead, ctx, scroll, treeRowCount(stripH.rows, plainHead, body, link ? 1 : 0), stripH.exact).map((l, i) => line(l, i, 'h'))
  return (
    <Box flexDirection="column">
      {strip}
      {head}
      {body.map((l, i) => line(l, i))}
      {link ? <Link href={snap.link as string} label={t('dispatch.link')} /> : null}
    </Box>
  )
}
