// mods/live/pane.tsx — the panel the ⓘ opens (TUI v2): Now · Dispatch · Review · Spend · Hygiene · ?  (the stage walk lives in Now, the decisions in Review,
// the glyph legend is the `?` tab). Pure view over the snapshot; `el` comes from $.ui.resolve(e). Every tab builds its lines in model.ts (a missing fact is an
// explicit "no data" line there, never an empty tab). Words come from the string tables through `t`; theme keys as text colour only, plus ONE background: the
// active tab (`subtle`, real-machine spike 2026-10-10: legible over ssh + tmux in truecolor and 256 colours; inverse stays banned).

import { T_EN } from './i18n'
import type { T } from './i18n'
import { dispatchLines, hygieneTabLines, legendLines, nowLines, paneWidth, PANE_TABS, reviewTabLines, spendTabLines, tabBadges, tabLabel } from './model'
import type { LiveSnapshot, PaneLine, PaneTab } from './model'

export type { PaneTab } from './model'

type El = (props: any) => any

// The tab strip: Buttons when the surface has them (a click or Enter switches the tab), plain Text otherwise. The active tab is bold on a `subtle`
// background (a tab you can see); a `subtle` rule under the strip is its baseline. A tab that holds something for the owner carries a badge.
function tabStrip(el: { Box: El; Text: El; Button?: El }, tab: PaneTab, onTab: (t: PaneTab) => void, snap: LiveSnapshot | null, t: T, cols: number) {
  const { Box, Text, Button } = el
  const badges = snap === null ? {} : tabBadges(snap)
  return (
    <Box flexDirection="column">
      <Box flexWrap="wrap">
        {PANE_TABS.map(id => {
          const on = id === tab
          const label = ' ' + tabLabel(id, t) + ' '
          const badge = badges[id]
          return (
            <Box key={id}>
              {Button === undefined
                ? <Text bold={on} dimColor={!on} backgroundColor={on ? 'subtle' : undefined}>{label}</Text>
                : <Button key={id} plain {...(on ? { autoFocus: true as const } : {})} dimColor={!on} bold={on} onPress={() => onTab(id)}>
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

export function Pane(el: { Box: El; Text: El; Link: El; Button?: El }, snap: LiveSnapshot | null, tab: PaneTab = 'now', onTab: (t: PaneTab) => void = () => {}, t: T = T_EN, bodyColumns: number | null = null) {
  const { Box, Text, Link } = el
  const cols = paneWidth(bodyColumns)
  const ctx = { t, cols }
  const line = (l: PaneLine, i: number) => l.segs !== undefined
    ? <Box key={'l' + i} flexWrap={l.wrap === true ? 'wrap' : undefined}>{l.segs.map((s, j) => <Text key={'g' + j} color={s.color} bold={s.bold} dimColor={s.dim} wrap={l.wrap === true ? 'wrap' : 'truncate'}>{s.text}</Text>)}</Box>
    : <Text key={'l' + i} bold={l.bold} dimColor={l.dim} color={l.color ?? (l.warn ? 'warning' : undefined)} wrap={l.wrap === true ? 'wrap' : 'truncate'}>{l.text}</Text>
  const strip = tabStrip(el, tab, onTab, snap, t, cols)
  if (snap === null) {
    return (
      <Box flexDirection="column">
        {strip}
        <Text dimColor>{t('pane.waiting')}</Text>
      </Box>
    )
  }
  if (tab === 'legend') return <Box flexDirection="column">{strip}{legendLines(ctx).map(line)}</Box>
  if (tab === 'now') return <Box flexDirection="column">{strip}{nowLines(snap, ctx).map(line)}</Box>
  if (tab === 'review') return <Box flexDirection="column">{strip}{reviewTabLines(snap, ctx).map(line)}</Box>
  if (tab === 'spend') return <Box flexDirection="column">{strip}{spendTabLines(snap, ctx).map(line)}</Box>
  if (tab === 'hygiene') return <Box flexDirection="column">{strip}{hygieneTabLines(snap, ctx).map(line)}</Box>
  return (
    <Box flexDirection="column">
      {strip}
      {dispatchLines(snap, ctx).map(line)}
      {snap.link === null ? null : <Link href={snap.link} label={t('dispatch.link')} />}
    </Box>
  )
}
