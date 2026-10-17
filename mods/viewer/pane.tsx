// mods/viewer/pane.tsx — the viewer window: the path, a count line, a hint line, the text. Pure view over the state register.ts holds; `el` comes from $.ui.resolve(e).
// Scrolling is the engine's (arrows, PgUp, PgDn, Home, End while the pane holds the keyboard): this file draws the whole part and decides no scroll. Colour: the hint
// lines are dim (the live mod's way to quiet a line; no theme key, no background, no inverse); the text's own colours are the engine's highlighter.

import { PALETTE } from '../live/ui'
import { DIFF_CHUNK_CHARS, totalTokens } from './model'
import type { DiffView, FileView } from './model'
import type { AiState } from './assist'
import type { VT } from './strings'

type El = (props: any) => any

export type Shown =
  | { kind: 'loading' }
  | { kind: 'file'; view: FileView; prev: number | null; next: number | null }
  | { kind: 'diff'; view: DiffView }
  | { kind: 'empty'; what: 'file' | 'diff' }

// what the three buttons do: register.ts binds them to the engine; the pane only draws and presses
export type AiView = {
  state: AiState
  summarize: () => void
  cancel: () => void
  focusAsk: () => void
  ask: (question: string) => void
  toChat: () => void
  toggle: () => void
}

// the button row, the question field, and (when there is one) the answer block. Colour: the running line is the `running` role, a failure the `broken` role, the rest default or dim.
function aiBar(el: { Box: El; Text: El; Button?: El; Input?: El }, ai: AiView, t: VT) {
  const { Box, Text, Button, Input } = el
  if (Button === undefined) return null
  const st = ai.state
  const running = st.running
  const gap = <Text key="gap">  </Text>
  return (
    <Box key="ai-bar" flexDirection="column">
      <Box>
        {running === null
          ? <Button key="summary" plain hotkey="1" onPress={ai.summarize}>{t('viewer.ai.summarize')}</Button>
          : <Button key="cancel" plain hotkey="1" onPress={ai.cancel}>{t('viewer.ai.cancel')}</Button>}
        {Input === undefined ? null : gap}
        {Input === undefined ? null : <Button key="ask" plain hotkey="2" onPress={ai.focusAsk}>{t('viewer.ai.ask')}</Button>}
        {gap}
        <Button key="send" plain hotkey="3" dimColor={st.shown === null} onPress={ai.toChat}>{t('viewer.ai.send')}</Button>
        {st.shown === null ? null : gap}
        {st.shown === null ? null : <Button key="toggle" plain hotkey="4" onPress={ai.toggle}>{t(st.visible ? 'viewer.ai.hide' : 'viewer.ai.show')}</Button>}
      </Box>
      {Input === undefined ? null : <Input key="ask-input" label={t('viewer.ai.askLabel')} placeholder={t('viewer.ai.askPlaceholder')} submitLabel={t('viewer.ai.askGo')} onSubmit={(q: string) => ai.ask(q)} />}
      {running === null ? null : <Text color={PALETTE.running}>{t(running.kind === 'ask' ? 'viewer.ai.asking' : 'viewer.ai.working')}</Text>}
      {st.error === null ? null : <Text color={PALETTE.broken}>{st.error}</Text>}
      {st.cancelled ? <Text dimColor>{t('viewer.ai.cancelled')}</Text> : null}
    </Box>
  )
}

// the answer block, drawn above the original text
function aiBlock(el: { Box: El; Text: El }, st: AiState, t: VT) {
  const { Box, Text } = el
  const r = st.shown
  if (r === null || !st.visible) return null
  const u = r.usage
  return (
    <Box key="ai-block" flexDirection="column" marginBottom={1}>
      <Text>{t(r.kind === 'ask' ? 'viewer.ai.title.answer' : 'viewer.ai.title.summary', { subject: r.subject })}</Text>
      {r.kind === 'ask' ? <Text dimColor>{t('viewer.ai.question', { q: r.question ?? '' })}</Text> : null}
      {r.note === null ? null : <Text dimColor>{r.note}</Text>}
      <Text wrap="wrap">{r.text}</Text>
      <Text dimColor>{r.cached ? t('viewer.ai.usageCached', { total: totalTokens(u) }) : t('viewer.ai.usage', { inn: u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens, out: u.output_tokens, total: totalTokens(u) })}</Text>
    </Box>
  )
}

export function Viewer(el: { Box: El; Text: El; Code: El; Button?: El; Input?: El }, shown: Shown, title: string, t: VT, goto: (start: number) => void, ai?: AiView) {
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
        {ai === undefined ? null : aiBar(el, ai, t)}
        {ai === undefined ? null : aiBlock(el, ai.state, t)}
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
      {ai === undefined ? null : aiBar(el, ai, t)}
      {ai === undefined ? null : aiBlock(el, ai.state, t)}
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
