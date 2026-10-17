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

// A button (design plan §12.9): `[ label ]` in the `action` colour, text colour only, regular weight, ONE Button around the whole run (one press id). One that cannot be pressed
// now is dim, no colour and no press id (a Text, not a Button). No `hotkey`: a plain Button with a hotkey draws `1: ` before its label (a second marking, and not `[ label ]`), and a non-plain one draws bold default-colour brackets of its own; the keyboard way is the host's focus ring (Tab moves it, Enter presses; the arrow keys scroll the text), as in the live pane (§12.9 point 5).
function btn(el: { Text: El; Button?: El }, key: string, label: string, press: (() => void) | null) {
  const { Text, Button } = el
  if (press === null || Button === undefined) return <Text key={key} dimColor>{'[ ' + label + ' ]'}</Text>
  return <Button key={key} plain onPress={press}><Text color={PALETTE.action}>{'[ ' + label + ' ]'}</Text></Button>
}

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
        {running === null ? btn(el, 'summary', t('viewer.ai.summarize'), ai.summarize) : btn(el, 'cancel', t('viewer.ai.cancel'), ai.cancel)}
        {Input === undefined ? null : gap}
        {Input === undefined ? null : btn(el, 'ask', t('viewer.ai.ask'), ai.focusAsk)}
        {gap}
        {btn(el, 'send', t('viewer.ai.send'), st.shown === null ? null : ai.toChat)}
        {gap}
        {btn(el, 'toggle', t(st.visible ? 'viewer.ai.hide' : 'viewer.ai.show'), st.shown === null ? null : ai.toggle)}
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
    const part = (label: string, start: number | null) => btn(el, label, label, start === null ? null : () => goto(start))
    return (
      <Box flexDirection="column">
        {name}
        <Box>
          <Text dimColor>{head}</Text>
          {v.partial ? <Text>   </Text> : null}
          {v.partial ? part(t('viewer.prev'), shown.prev) : null}
          {v.partial ? <Text>  </Text> : null}
          {v.partial ? part(t('viewer.next'), shown.next) : null}
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
