// mods/live/pane.tsx — the dispatch / gate pane (plan P1c; C3: the header row carries cost / context, an awaited
// decision comes first). Pure view over the snapshot; `el` comes from
// $.ui.resolve(e). W3a: the attention / waiting / task / decision / foreman sections arrive as ready text lines. Tables are Text lines (Box/Text/Link exist on every surface; no Image anywhere).

import { hhmm, reviewLines, staleSuffix } from './model'
import type { LiveGateRow, LivePaneRow, LiveSnapshot, PaneLine } from './model'

type El = (props: any) => any

const cell = (v: string | number | null | undefined): string => (v === null || v === undefined || v === '' ? '—' : String(v))

function dispatchLine(r: LivePaneRow): string {
  const started = r.started_at && Number.isFinite(Date.parse(r.started_at)) ? hhmm(Date.parse(r.started_at)) : null
  return [
    cell(r.run_id), cell(r.role), cell(r.runner) + '/' + cell(r.model), 'started ' + cell(started),
    'elapsed ' + (r.elapsed_s === null ? '—' : r.elapsed_s + 's'), 'phase ' + cell(r.phase), 'rc ' + cell(r.rc),
    'final ' + cell(r.final_status), 'probe ' + (r.probe_age_s === null ? '—' : r.probe_age_s + 's ago'),
  ].join(' · ')
}

function gateLine(g: LiveGateRow): string {
  return [cell(g.phase), 'gen ' + cell(g.generation), cell(g.verdict), cell(g.status)].join(' · ')
}

export type PaneTab = 'dispatch' | 'review'

// P7d: the tab strip. Buttons when the surface has them (a click or Enter switches the tab), plain Text otherwise.
function tabStrip(el: { Box: El; Text: El; Button?: El }, tab: PaneTab, onTab: (t: PaneTab) => void, hasReview: boolean) {
  const { Box, Text, Button } = el
  const tabs: { id: PaneTab; label: string }[] = [{ id: 'dispatch', label: 'Dispatch' }, { id: 'review', label: hasReview ? 'Review •' : 'Review' }]
  return (
    <Box>
      {tabs.map(t => Button === undefined
        ? <Text key={t.id} bold={t.id === tab} dimColor={t.id !== tab}>{(t.id === tab ? '[' + t.label + ']' : ' ' + t.label + ' ') + ' '}</Text>
        : <Button key={t.id} plain dimColor={t.id !== tab} bold={t.id === tab} onPress={() => onTab(t.id)}>{t.id === tab ? '[' + t.label + ']' : ' ' + t.label + ' '}</Button>)}
    </Box>
  )
}

export function Pane(el: { Box: El; Text: El; Link: El; Button?: El }, snap: LiveSnapshot | null, tab: PaneTab = 'dispatch', onTab: (t: PaneTab) => void = () => {}) {
  const { Box, Text, Link } = el
  const line = (l: PaneLine) => <Text bold={l.bold} dimColor={l.dim} color={l.warn ? 'warning' : undefined} wrap="truncate">{l.text}</Text>
  if (snap === null) {
    return (
      <Box flexDirection="column">
        <Text dimColor>waiting for the first snapshot</Text>
      </Box>
    )
  }
  const rows = snap.rows
  const gates = snap.gates
  if (tab === 'review') {
    return (
      <Box flexDirection="column">
        {tabStrip(el, tab, onTab, snap.review !== null)}
        <Text bold>{snap.header}</Text>
        {reviewLines(snap.review).map(line)}
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      {tabStrip(el, tab, onTab, snap.review !== null)}
      <Text bold>{snap.header}</Text>
      {snap.sections.attention.map(line)}
      {snap.decision === null || snap.sections.attention.length > 0 ? null : <Text bold color="warning">要你決定</Text>}
      {snap.decision === null ? null : <Text>{snap.decision.question + staleSuffix(snap.decision)}</Text>}
      {snap.decision === null ? null : snap.decision.options.map((o, i) => <Text wrap="truncate">{(i + 1) + '. ' + o.label + (o.consequence ? ' — ' + o.consequence : '')}</Text>)}
      {rows === null ? null : <Text dimColor>dispatch · execution status, not progress (執行狀態，不是進度)</Text>}
      {rows === null ? null : rows.length === 0 ? <Text dimColor>no runs in this scope</Text> : rows.map(r => <Text wrap="truncate">{dispatchLine(r)}</Text>)}
      {rows === null ? null : <Text dimColor>gates · review receipts of this job</Text>}
      {rows === null ? null : gates === null ? <Text dimColor>no review page published yet · gate rows —</Text> : gates.length === 0 ? <Text dimColor>no review receipt</Text> : gates.map(g => <Text wrap="truncate">{gateLine(g)}</Text>)}
      {snap.sections.waiting.map(line)}
      {snap.sections.tasks.map(line)}
      {snap.sections.decisions.map(line)}
      {snap.sections.foreman.map(line)}
      {snap.link === null ? null : <Link href={snap.link} label="open the review page" />}
      {snap.published_at === null ? null : <Text dimColor>snapshot published {snap.published_at}{snap.session_as_of ? ' · session cost as of ' + snap.session_as_of : ''}{snap.host_as_of ? ' · host cost as of ' + snap.host_as_of : ''}</Text>}
    </Box>
  )
}
