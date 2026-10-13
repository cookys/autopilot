// mods/live/pane.tsx — the panel the ⓘ opens (TUI v2): Now · Dispatch · Review · Spend · Hygiene · ?  (the stage walk lives in Now, the decisions in Review,
// the glyph legend is the `?` tab). Pure view over the snapshot; `el` comes from $.ui.resolve(e). Every tab builds its lines in model.ts (a missing fact is an
// explicit "no data" line there, never an empty tab). Words come from the string tables through `t`; theme keys as text colour only, plus ONE background: the
// active tab (`subtle`, real-machine spike 2026-10-10: legible over ssh + tmux in truecolor and 256 colours; inverse stays banned).

import { T_EN } from './i18n'
import type { T } from './i18n'
import { NEXT_TAB_GLYPH, dispatchLines, headerLines, hygieneTabLines, legendLines, nowLines, paneWidth, PANE_TABS, reviewTabLines, spendTabLines, tabBadges, tabLabel } from './model'
import type { LiveSnapshot, PaneLine, PaneTab, Seg } from './model'

export type { PaneTab } from './model'

type El = (props: any) => any

// The tab strip: Buttons when the surface has them (a click or Enter switches the tab), plain Text otherwise. The active tab is bold on a `subtle`
// background (a tab you can see); a `subtle` rule under the strip is its baseline. A tab that holds something for the owner carries a badge.
// The FIRST drawn Button is the `▸` next-tab chip and it carries the pane's autoFocus ("of several in one site the first drawn wins"): whenever Ctrl+x Tab or
// `open({focus})` hands the pane the keyboard, the ring lands on a Button whose Enter steps to the next tab. It used to land on the ACTIVE tab's Button,
// where Enter pressed the tab already showing (a no-op): "Ctrl+x Tab, Enter, Enter" cycled tabs only when the ring happened to sit on the band's ⓘ
// (real machine 2026-10-10, 120 columns). The tab Buttons stay pressable (a click, or Tab / arrows + Enter) and still select their own tab.
function tabStrip(el: { Box: El; Text: El; Button?: El }, tab: PaneTab, onTab: (t: PaneTab) => void, onNext: () => void, snap: LiveSnapshot | null, t: T, cols: number) {
  const { Box, Text, Button } = el
  const badges = snap === null ? {} : tabBadges(snap)
  return (
    <Box flexDirection="column">
      <Box flexWrap="wrap">
        {Button === undefined ? null : <Box key="next"><Button key="next" plain autoFocus onPress={onNext}>{NEXT_TAB_GLYPH}</Button><Text> </Text></Box>}
        {PANE_TABS.map(id => {
          const on = id === tab
          const label = ' ' + tabLabel(id, t) + ' '
          const badge = badges[id]
          return (
            <Box key={id}>
              {Button === undefined
                ? <Text bold={on} dimColor={!on} backgroundColor={on ? 'subtle' : undefined}>{label}</Text>
                : <Button key={id} plain dimColor={!on} bold={on} onPress={() => onTab(id)}>
                    {on ? <Text bold backgroundColor="subtle">{label}</Text> : label}
                  </Button>}
              {badge === undefined ? null : <Text bold backgroundColor={on ? 'subtle' : undefined} color={badge.color}>{badge.text + (on ? ' ' : '')}</Text>}
              <Text> </Text>
            </Box>
          )
        })}
      </Box>
      <Text color="subtle" wrap="truncate">{'─'.repeat(cols)}</Text>
    </Box>
  )
}

export function Pane(el: { Box: El; Text: El; Link: El; Button?: El }, snap: LiveSnapshot | null, tab: PaneTab = 'now', onTab: (t: PaneTab) => void = () => {}, t: T = T_EN, bodyColumns: number | null = null, onNext: () => void = () => {}, expanded: ReadonlySet<string> = new Set(), onToggle: (id: string) => void = () => {}, folded: ReadonlySet<string> = new Set()) {
  const { Box, Text, Link, Button } = el
  const cols = paneWidth(bodyColumns)
  const ctx = { t, cols, expanded, folded }
  const plainLine = (l: PaneLine, i: number, k = '') => l.segs !== undefined
    ? <Box key={k + 'l' + i} flexWrap={l.wrap === true ? 'wrap' : undefined}>{l.segs.map((s, j) => <Text key={'g' + j} color={s.color} bold={s.bold} dimColor={s.dim} wrap={l.wrap === true ? 'wrap' : 'truncate'}>{s.text}</Text>)}</Box>
    : <Text key={k + 'l' + i} bold={l.bold} dimColor={l.dim} color={l.color ?? (l.warn ? 'warning' : undefined)} wrap={l.wrap === true ? 'wrap' : 'truncate'}>{l.text}</Text>
  // a line that carries a `toggle` id is a Button when the surface has them (a press expands / collapses its group), the plain line otherwise
  const line = (l: PaneLine, i: number, k = '') => l.toggle !== undefined && Button !== undefined
    ? <Button key={k + 'b' + i} plain onPress={() => onToggle(l.toggle as string)}>
        {(l.segs ?? [{ text: l.text }]).map((x, j) => <Text key={'g' + j} color={(x as Seg).color} bold={(x as Seg).bold} dimColor={(x as Seg).dim} wrap="truncate">{x.text}</Text>)}
      </Button>
    // a line that carries a `goto` tab (a projection row, design plan §2.3) is a Button that opens that tab
    : l.goto !== undefined && Button !== undefined
    ? <Button key={k + 'g' + i} plain onPress={() => onTab(l.goto as PaneTab)}>
        {(l.segs ?? [{ text: l.text }]).map((x, j) => <Text key={'g' + j} color={(x as Seg).color} bold={(x as Seg).bold} dimColor={(x as Seg).dim} wrap="truncate">{x.text}</Text>)}
      </Button>
    : plainLine(l, i, k)
  const strip = tabStrip(el, tab, onTab, onNext, snap, t, cols)
  if (snap === null) {
    return (
      <Box flexDirection="column">
        {strip}
        <Text dimColor>{t('pane.waiting')}</Text>
      </Box>
    )
  }
  // the global header (design plan §2.2): drawn here, once, on every tab; no tab builder emits it (I9)
  const head = headerLines(snap, ctx).map((l, i) => line(l, i, 'h'))
  if (tab === 'legend') return <Box flexDirection="column">{strip}{head}{legendLines(ctx).map((l, i) => line(l, i))}</Box>
  if (tab === 'now') return <Box flexDirection="column">{strip}{head}{nowLines(snap, ctx).map((l, i) => line(l, i))}</Box>
  if (tab === 'review') return <Box flexDirection="column">{strip}{head}{reviewTabLines(snap, ctx).map((l, i) => line(l, i))}</Box>
  if (tab === 'spend') return <Box flexDirection="column">{strip}{head}{spendTabLines(snap, ctx).map((l, i) => line(l, i))}</Box>
  if (tab === 'hygiene') return <Box flexDirection="column">{strip}{head}{hygieneTabLines(snap, ctx).map((l, i) => line(l, i))}</Box>
  return (
    <Box flexDirection="column">
      {strip}
      {head}
      {dispatchLines(snap, ctx).map((l, i) => line(l, i))}
      {snap.link === null ? null : <Link href={snap.link} label={t('dispatch.link')} />}
    </Box>
  )
}
