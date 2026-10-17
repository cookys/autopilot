// mods/viewer/pane.tsx — the viewer window: the path, a count line, a hint line, the text. Pure view over the state register.ts holds; `el` comes from $.ui.resolve(e).
// Scrolling is the engine's (arrows, PgUp, PgDn, Home, End while the pane holds the keyboard): this file draws the whole part and decides no scroll. Colour: the hint
// lines are dim (the live mod's way to quiet a line; no theme key, no background, no inverse); the text's own colours are the engine's highlighter.

import { DIFF_CHUNK_CHARS } from './model'
import type { DiffView, FileView } from './model'
import type { VT } from './strings'

type El = (props: any) => any

export type Shown =
  | { kind: 'loading' }
  | { kind: 'file'; view: FileView; prev: number | null; next: number | null }
  | { kind: 'diff'; view: DiffView }
  | { kind: 'empty'; what: 'file' | 'diff' }

export function Viewer(el: { Box: El; Text: El; Code: El; Button?: El }, shown: Shown, title: string, t: VT, goto: (start: number) => void) {
  const { Box, Text, Code, Button } = el
  const hint = <Text key="hint" dimColor>{t('viewer.hint')}</Text>
  // the title row of a pane is drawn only while a second pane is open, so the path is also the first line of the body
  const name = <Text key="name" wrap="truncate-start">{title}</Text>
  if (shown.kind === 'loading') {
    return (
      <Box flexDirection="column">
        {name}
        {hint}
      </Box>
    )
  }
  if (shown.kind === 'empty') {
    return (
      <Box flexDirection="column">
        {name}
        <Text dimColor>{t(shown.what === 'file' ? 'viewer.empty' : 'viewer.diff.none')}</Text>
        {hint}
      </Box>
    )
  }
  if (shown.kind === 'file') {
    const v = shown.view
    const head = v.partial ? t('viewer.lines', { a: v.first, b: v.last, n: v.total }) : t('viewer.whole', { n: v.total })
    const part = (label: string, start: number | null) => start === null || Button === undefined ? null : <Button key={label} plain onPress={() => goto(start)}>{label}</Button>
    return (
      <Box flexDirection="column">
        {name}
        <Box>
          <Text dimColor>{head}</Text>
          {shown.prev === null ? null : <Text>  </Text>}
          {part(t('viewer.prev'), shown.prev)}
          {shown.next === null ? null : <Text>  </Text>}
          {part(t('viewer.next'), shown.next)}
        </Box>
        {hint}
        <Code source={v.source} path={v.path} startLine={v.first} wrap="wrap" />
      </Box>
    )
  }
  const d = shown.view
  return (
    <Box flexDirection="column">
      {name}
      <Text dimColor>{t('viewer.diff.head', { files: d.files, hunks: d.hunks })}</Text>
      {hint}
      {d.sections.map((s, i) => (
        <Box key={'f' + i} flexDirection="column">
          <Text>{s.file}</Text>
          {s.chunks.map((c, j) => <Code key={'c' + j} source={c} format={c.length > DIFF_CHUNK_CHARS ? 'source' : 'diff'} wrap="wrap" />)}
          {s.cut ? <Text dimColor>{t('viewer.diff.cut')}</Text> : null}
        </Box>
      ))}
      {d.truncated ? <Text dimColor>{t('viewer.diff.cut')}</Text> : null}
    </Box>
  )
}
