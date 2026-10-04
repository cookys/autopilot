// mods/live/pane.tsx — the dispatch / gate pane (plan P1c). Pure view over the snapshot; `el` comes from
// $.ui.resolve(e). Tables are Text lines (Box/Text/Link exist on every surface; no Image anywhere).

import { hhmm } from './model'
import type { LiveGateRow, LivePaneRow, LiveSnapshot } from './model'

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

export function Pane(el: { Box: El; Text: El; Link: El }, snap: LiveSnapshot | null) {
  const { Box, Text, Link } = el
  if (snap === null) {
    return (
      <Box flexDirection="column">
        <Text dimColor>waiting for the first snapshot</Text>
      </Box>
    )
  }
  const rows = snap.rows
  const gates = snap.gates
  return (
    <Box flexDirection="column">
      <Text bold>{snap.text}</Text>
      {rows === null ? null : <Text dimColor>dispatch · execution status, not progress (執行狀態，不是進度)</Text>}
      {rows === null ? null : rows.length === 0 ? <Text dimColor>no runs in this scope</Text> : rows.map(r => <Text wrap="truncate">{dispatchLine(r)}</Text>)}
      {rows === null ? null : <Text dimColor>gates · review receipts of this job</Text>}
      {rows === null ? null : gates === null ? <Text dimColor>no review page published yet · gate rows —</Text> : gates.length === 0 ? <Text dimColor>no review receipt</Text> : gates.map(g => <Text wrap="truncate">{gateLine(g)}</Text>)}
      {snap.link === null ? null : <Link href={snap.link} label="open the review page" />}
      {snap.published_at === null ? null : <Text dimColor>snapshot published {snap.published_at}{snap.session_as_of ? ' · session cost as of ' + snap.session_as_of : ''}{snap.host_as_of ? ' · host cost as of ' + snap.host_as_of : ''}</Text>}
    </Box>
  )
}
