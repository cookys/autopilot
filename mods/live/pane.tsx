// mods/live/pane.tsx — the panel the ⓘ opens (stage-graph P7, contract ②): Legend · Now · Graph · Dispatch · Review · Decisions · Spend · Hygiene.
// Pure view over the snapshot; `el` comes from $.ui.resolve(e). Every tab builds its lines in model.ts (a missing fact is an explicit
// "no data" line there, never an empty tab); only the Dispatch rows are formatted here. Theme keys as text colour only.

import { graphLines, hhmm, legendLines, nowLines, PANE_TABS, qcLines, reviewLines, decisionsTabLines, spendLines, hygieneLines, staleSuffix, TAB_LABEL } from './model'
import type { LiveGateRow, LivePaneRow, LiveSnapshot, PaneLine, PaneTab } from './model'

export type { PaneTab } from './model'

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

// The tab strip: Buttons when the surface has them (a click or Enter switches the tab), plain Text otherwise. It wraps on a narrow pane.
function tabStrip(el: { Box: El; Text: El; Button?: El }, tab: PaneTab, onTab: (t: PaneTab) => void, hasReview: boolean) {
  const { Box, Text, Button } = el
  const label = (t: PaneTab) => TAB_LABEL[t] + (t === 'review' && hasReview ? ' •' : '')
  return (
    <Box flexWrap="wrap">
      {PANE_TABS.map(t => Button === undefined
        ? <Text key={t} bold={t === tab} dimColor={t !== tab}>{(t === tab ? '[' + label(t) + ']' : ' ' + label(t) + ' ') + ' '}</Text>
        : <Button key={t} plain dimColor={t !== tab} bold={t === tab} onPress={() => onTab(t)}>{t === tab ? '[' + label(t) + ']' : ' ' + label(t) + ' '}</Button>)}
    </Box>
  )
}

export function Pane(el: { Box: El; Text: El; Link: El; Button?: El }, snap: LiveSnapshot | null, tab: PaneTab = 'now', onTab: (t: PaneTab) => void = () => {}) {
  const { Box, Text, Link } = el
  const line = (l: PaneLine, i: number) => l.segs !== undefined
    ? <Box key={'l' + i} flexWrap="wrap">{l.segs.map((s, j) => <Text key={'g' + j} color={s.color} bold={s.bold}>{s.text}</Text>)}</Box>
    : <Text key={'l' + i} bold={l.bold} dimColor={l.dim} color={l.color ?? (l.warn ? 'warning' : undefined)} wrap="truncate">{l.text}</Text>
  if (snap === null) {
    return (
      <Box flexDirection="column">
        {tabStrip(el, tab, onTab, false)}
        <Text dimColor>waiting for the first snapshot</Text>
      </Box>
    )
  }
  const strip = tabStrip(el, tab, onTab, snap.review !== null)
  const head = <Text bold>{snap.header}</Text>
  if (tab === 'legend') return <Box flexDirection="column">{strip}{legendLines().map(line)}</Box>
  if (tab === 'now') {
    const b = snap.band
    const d = snap.decision
    return (
      <Box flexDirection="column">
        {strip}
        {head}
        {b === null ? null : (
          <Box>
            <Text bold={b.verdict !== '待命'} color={b.slots[0]?.segs[0]?.color} wrap="truncate">{b.mark + ' ' + b.verdict}</Text>
            <Text wrap="truncate">{' ' + (snap.detail.project ?? b.project) + ' · ' + b.elapsed}</Text>
          </Box>
        )}
        {nowLines(snap).map(line)}
        {d === null || snap.sections.attention.length > 0 ? null : <Text bold color="warning">要你決定</Text>}
        {d === null ? null : <Text>{d.question + staleSuffix(d)}</Text>}
        {d === null ? null : d.options.map((o, i) => <Text key={'o' + i} wrap="truncate">{(i + 1) + '. ' + o.label + (o.consequence ? ' — ' + o.consequence : '')}</Text>)}
      </Box>
    )
  }
  if (tab === 'graph') return <Box flexDirection="column">{strip}{head}{graphLines(snap.detail.stage).map(line)}</Box>
  if (tab === 'review') return <Box flexDirection="column">{strip}{head}{reviewLines(snap.review).map(line)}{qcLines(snap.detail.qc).map(line)}</Box>
  if (tab === 'decisions') return <Box flexDirection="column">{strip}{head}{decisionsTabLines(snap).map(line)}</Box>
  if (tab === 'spend') return <Box flexDirection="column">{strip}{head}{spendLines(snap).map(line)}</Box>
  if (tab === 'hygiene') return <Box flexDirection="column">{strip}{head}{hygieneLines(snap.detail.load_source, snap.detail.residue).map(line)}</Box>
  const rows = snap.rows
  const gates = snap.gates
  return (
    <Box flexDirection="column">
      {strip}
      {head}
      {rows === null ? <Text dimColor>no data · no runs published</Text> : <Text dimColor>dispatch · execution status, not progress (執行狀態，不是進度)</Text>}
      {rows === null ? null : rows.length === 0 ? <Text dimColor>no runs in this scope</Text> : rows.map((r, i) => <Text key={'r' + i} wrap="truncate">{dispatchLine(r)}</Text>)}
      {rows === null ? null : <Text dimColor>gates · review receipts of this job</Text>}
      {rows === null ? null : gates === null ? <Text dimColor>no review page published yet · gate rows —</Text> : gates.length === 0 ? <Text dimColor>no review receipt</Text> : gates.map((g, i) => <Text key={'g' + i} wrap="truncate">{gateLine(g)}</Text>)}
      {snap.sections.waiting.map(line)}
      {snap.sections.tasks.map(line)}
      {snap.sections.foreman.map(line)}
      {snap.link === null ? null : <Link href={snap.link} label="open the review page" />}
      {snap.published_at === null ? null : <Text dimColor>snapshot published {snap.published_at}{snap.session_as_of ? ' · session cost as of ' + snap.session_as_of : ''}{snap.host_as_of ? ' · host cost as of ' + snap.host_as_of : ''}</Text>}
    </Box>
  )
}
