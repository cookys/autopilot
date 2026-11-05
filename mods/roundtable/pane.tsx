// mods/roundtable/pane.tsx — the room window. Colours only through PALETTE (mods/live/ui.ts).
// Owner rows: "you are here" (PALETTE.here, theme key claude) — the same meaning as window A's owner foreground.
// System rows: attention. Send failures: broken. Seat rows: no colour (default text). Rules: structure.
// No background, no inverse. The Input label has no trailing colon (the field draws its own).
// The scrollbar thumb is scrollFrame → thumbOf (mods/live/scrollmath.ts): length visible/total of the track, minimum one cell.

import { PALETTE } from '../live/ui'
import { frameOf, scrollFrame } from '../live/scroll'
import type { ScrollModel } from '../live/scroll'
import type { DisplayLine, LineRole } from './model'
import type { RT } from './strings'

type El = (props: any) => any

export type RoundtableView = {
  room: string | null
  count: number
  lines: DisplayLine[]
  failure: string | null
  note: string | null
  draft: string
}

const colorOf = (role: LineRole) => {
  if (role === 'here') return PALETTE.here
  if (role === 'attention') return PALETTE.attention
  if (role === 'broken') return PALETTE.broken
  if (role === 'structure') return PALETTE.structure
  return undefined
}

function lineNode(Text: El, line: DisplayLine, key: string) {
  const color = colorOf(line.role)
  if (color === undefined) return <Text key={key} wrap="truncate-end">{line.text.length === 0 ? ' ' : line.text}</Text>
  return <Text key={key} color={color} wrap="truncate-end">{line.text.length === 0 ? ' ' : line.text}</Text>
}

export function RoundtablePane(
  el: { Box: El; Text: El; Button?: El; Input?: El },
  view: RoundtableView,
  t: RT,
  onDraft: (value: string) => void,
  onSubmit: (value: string) => void,
  win?: { props: unknown; model: ScrollModel },
) {
  const { Box, Text, Input } = el
  if (win !== undefined) win.model.framed = false
  const title = view.room === null ? t('rt.empty') : t('rt.head', { room: view.room, n: view.count })
  const name = <Text key="name" wrap="truncate-end">{title}</Text>
  const note = view.note === null ? null : <Text key="note">{view.note}</Text>
  const failure = view.failure === null ? null : <Text key="failure" color={PALETTE.broken} wrap="truncate-end">{view.failure}</Text>
  const field = Input === undefined ? null : (
    <Input key="say" autoFocus label={t('rt.sayLabel')} submitLabel={t('rt.send')} value={view.draft} onInput={(v: string) => onDraft(v)} onSubmit={(v: string) => onSubmit(v)} />
  )
  const frame = win === undefined ? null : frameOf(win.props)
  if (frame !== null && win !== undefined) {
    // The control area is the failure row and the field, always both rows: a send failure appears in its reserved row and never changes the area's height (chat-room layout).
    const bar = [failure ?? <Text key="failure"> </Text>, field].filter(n => n !== null)
    return scrollFrame(el, {
      rows: frame.rows, cols: frame.cols,
      head: [name, ...(note === null ? [] : [note])],
      headRows: note === null ? 1 : 2,
      total: view.lines.length,
      window: (o, r) => view.lines.slice(o, o + r).map((l, i) => lineNode(Text, l, 'r' + (o + i))),
      bar, barRows: bar.length,
      model: win.model,
      bottom: { above: n => t('rt.above', { n }), newer: t('rt.newer'), append: true, inline: (win.props as { placement?: unknown }).placement === 'inline' }, // the log only grows by appended rows
    })
  }
  return (
    <Box flexDirection="column">
      {name}
      {note}
      {view.lines.map((l, i) => lineNode(Text, l, 'r' + i))}
      {failure}
      {field}
    </Box>
  )
}
