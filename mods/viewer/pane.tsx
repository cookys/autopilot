// mods/viewer/pane.tsx — the viewer window: the path, a count line, a hint line, the text, and a fixed action strip under it. Pure view over the state register.ts holds; `el`
// comes from $.ui.resolve(e).
// Layout (design plan §12.10, the shared frame in ../live/scroll.tsx): head (path, the range on screen, the hint), the scrolling content (the answer rows first, then the file or the
// diff, cut into rows by the mod), a rule, the action strip. The strip never scrolls: row 1 the answer buttons, row 2 the part buttons (a file shown in parts), then the question
// field, then the status line (always reserved, so the content window does not jump when a call starts). Scrolling is the mod's: arrows, PgUp, PgDn, Home, End and the wheel reach
// `ui.scroll` (register.ts). Without a frame (a host that gave no room) the plain tree is drawn and the engine scrolls it.
// Colour: the hint lines are dim (no theme key, no background, no inverse); the text's own colours are the engine's highlighter.

import { PALETTE, displayWidth } from '../live/ui'
import { frameOf, scrollFrame, sliceCells, wrapCells } from '../live/scroll'
import type { ScrollModel } from '../live/scroll'
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

// the button row, the question field and the status line (the pieces of the action strip; the part buttons sit between the first two in the framed layout)
function aiButtons(el: { Box: El; Text: El; Button?: El; Input?: El }, ai: AiView, t: VT) {
  const { Box, Text, Input } = el
  const st = ai.state
  const running = st.running
  const gap = <Text key="gap">  </Text>
  return (
    <Box key="ai-buttons">
      {running === null ? btn(el, 'summary', t('viewer.ai.summarize'), ai.summarize) : btn(el, 'cancel', t('viewer.ai.cancel'), ai.cancel)}
      {Input === undefined ? null : gap}
      {Input === undefined ? null : btn(el, 'ask', t('viewer.ai.ask'), ai.focusAsk)}
      {gap}
      {btn(el, 'send', t('viewer.ai.send'), st.shown === null ? null : ai.toChat)}
      {gap}
      {btn(el, 'toggle', t(st.visible ? 'viewer.ai.hide' : 'viewer.ai.show'), st.shown === null ? null : ai.toggle)}
    </Box>
  )
}
function aiInput(el: { Input?: El }, ai: AiView, t: VT) {
  const { Input } = el
  return Input === undefined ? null : <Input key="ask-input" label={t('viewer.ai.askLabel')} placeholder={t('viewer.ai.askPlaceholder')} submitLabel={t('viewer.ai.askGo')} onSubmit={(q: string) => ai.ask(q)} />
}
// the status line: the running line is the `running` role, a failure the `broken` role, a cancel dim; nothing to say draws a blank (one cell: an empty Text takes no row)
function aiStatus(el: { Text: El }, ai: AiView, t: VT) {
  const { Text } = el
  const st = ai.state
  if (st.running !== null) return <Text key="status" color={PALETTE.running}>{t(st.running.kind === 'ask' ? 'viewer.ai.asking' : 'viewer.ai.working')}</Text>
  if (st.error !== null) return <Text key="status" color={PALETTE.broken} wrap="truncate-end">{st.error}</Text>
  if (st.cancelled) return <Text key="status" dimColor>{t('viewer.ai.cancelled')}</Text>
  return <Text key="status"> </Text>
}
// the unframed form (no room known): buttons, field, status and the answer in one column, as before the frame
function aiBar(el: { Box: El; Text: El; Button?: El; Input?: El }, ai: AiView, t: VT) {
  const { Box } = el
  if (el.Button === undefined) return null
  return (
    <Box key="ai-bar" flexDirection="column">
      {aiButtons(el, ai, t)}
      {aiInput(el, ai, t)}
      {aiStatus(el, ai, t)}
    </Box>
  )
}

const usageText = (u: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }, cached: boolean, t: VT): string =>
  cached ? t('viewer.ai.usageCached', { total: totalTokens(u) }) : t('viewer.ai.usage', { inn: u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens, out: u.output_tokens, total: totalTokens(u) })

// the answer block of the unframed form, drawn above the original text
function aiBlock(el: { Box: El; Text: El }, st: AiState, t: VT) {
  const { Box, Text } = el
  const r = st.shown
  if (r === null || !st.visible) return null
  return (
    <Box key="ai-block" flexDirection="column" marginBottom={1}>
      <Text>{t(r.kind === 'ask' ? 'viewer.ai.title.answer' : 'viewer.ai.title.summary', { subject: r.subject })}</Text>
      {r.kind === 'ask' ? <Text dimColor>{t('viewer.ai.question', { q: r.question ?? '' })}</Text> : null}
      {r.note === null ? null : <Text dimColor>{r.note}</Text>}
      <Text wrap="wrap">{r.text}</Text>
      <Text dimColor>{usageText(r.usage, r.cached, t)}</Text>
    </Box>
  )
}

// ---- the framed layout: the content as rows ----

// one row of the scrolling content: a line of text (the answer, a diff's file name, a cut notice) or a line of code. Consecutive code rows of one group are drawn as ONE Code element,
// so the engine highlights them together; a group is a file part or one chunk of a diff.
export type Row = { kind: 'text'; text: string; dim?: boolean } | { kind: 'code'; group: number; line: string; num: number; fmt: 'file' | 'diff' | 'source'; path?: string }

export function contentRows(shown: Shown, ai: AiState, cols: number, t: VT): Row[] {
  const rows: Row[] = []
  const r = ai.shown
  if (r !== null && ai.visible) {
    const w = Math.max(4, cols - 1) // one cell goes to the scrollbar
    const add = (text: string, dim?: boolean) => { for (const l of wrapCells(text, w)) rows.push({ kind: 'text', text: l, ...(dim === true ? { dim } : {}) }) }
    add(t(r.kind === 'ask' ? 'viewer.ai.title.answer' : 'viewer.ai.title.summary', { subject: r.subject }))
    if (r.kind === 'ask') add(t('viewer.ai.question', { q: r.question ?? '' }), true)
    if (r.note !== null) add(r.note, true)
    add(r.text)
    add(usageText(r.usage, r.cached, t), true)
    rows.push({ kind: 'text', text: ' ' })
  }
  if (shown.kind === 'file') {
    const v = shown.view
    v.source.split('\n').forEach((line, i) => rows.push({ kind: 'code', group: 0, line, num: v.first + i, fmt: 'file', path: v.path }))
  } else if (shown.kind === 'diff') {
    let group = 1
    shown.view.sections.forEach(sec => {
      rows.push({ kind: 'text', text: sec.file })
      sec.chunks.forEach(c => {
        const fmt = c.length > DIFF_CHUNK_CHARS ? 'source' : 'diff'
        c.split('\n').forEach((line, i) => rows.push({ kind: 'code', group, line, num: i + 1, fmt }))
        group += 1
      })
      if (sec.cut) rows.push({ kind: 'text', text: t('viewer.diff.cut'), dim: true })
    })
    if (shown.view.truncated) rows.push({ kind: 'text', text: t('viewer.diff.cut'), dim: true })
  }
  return rows
}

// The sideways window over the code lines: `hoff` cells shifted, `hmax` the largest legal shift (the frame writes it each draw, the buttons clamp to it), `width` the cells a code
// line has, `step` what one press moves. The host gives the mod no Left / Right key (ui.scroll carries only a row count), so the two buttons in the strip are the way.
export type HScroll = { hoff: number; hmax: number; width: number; step: number; redraw?: () => void }
export const newHScroll = (): HScroll => ({ hoff: 0, hmax: 0, width: 0, step: 1 })
export function hMove(hs: HScroll, by: number): void { // `by` signed cells
  const before = hs.hoff
  hs.hoff = Math.max(0, Math.min(hs.hmax, hs.hoff + by))
  if (hs.hoff !== before) hs.redraw?.()
}
// the cells the code text has per row (the file's own number gutter and the scrollbar cell come off the width; a diff line keeps its +/- mark in front) and the widest line
function hGeom(rows: Row[], cols: number): { width: number; longest: number } {
  let longest = 0
  let digits = 0
  let diff = false
  for (const r of rows) {
    if (r.kind !== 'code') continue
    longest = Math.max(longest, displayWidth(r.fmt === 'diff' ? r.line.slice(1) : r.line))
    if (r.fmt === 'file') digits = Math.max(digits, String(r.num).length)
    if (r.fmt === 'diff') diff = true
  }
  const gutter = digits > 0 ? digits + 3 : 0
  return { width: Math.max(1, cols - 1 - gutter - (diff ? 1 : 0)), longest }
}
const shiftLine = (r: Extract<Row, { kind: 'code' }>, hs: HScroll): string =>
  hs.hmax === 0 ? r.line : r.fmt === 'diff' ? r.line.slice(0, 1) + sliceCells(r.line.slice(1), hs.hoff, hs.width) : sliceCells(r.line, hs.hoff, hs.width)

// the nodes for rows lo .. hi
function drawRows(el: { Text: El; Code: El }, rows: Row[], lo: number, hi: number, hs: HScroll) {
  const { Text, Code } = el
  const out: unknown[] = []
  let i = lo
  while (i < hi) {
    const r = rows[i]
    if (r.kind === 'text') { out.push(<Text key={'r' + i} dimColor={r.dim === true} wrap="truncate-end">{r.text}</Text>); i += 1; continue }
    let j = i
    while (j < hi && rows[j].kind === 'code' && (rows[j] as { group: number }).group === r.group) j += 1
    const run = rows.slice(i, j) as Extract<Row, { kind: 'code' }>[]
    out.push(<Code key={'r' + i} source={run.map(x => shiftLine(x, hs)).join('\n')} wrap="truncate-end" {...(r.fmt === 'file' ? { path: r.path, startLine: r.num } : { format: r.fmt })} />)
    i = j
  }
  return out
}

export function Viewer(el: { Box: El; Text: El; Code: El; Button?: El; Input?: El }, shown: Shown, title: string, t: VT, goto: (start: number) => void, ai?: AiView, win?: { props: unknown; model: ScrollModel; hs: HScroll }) {
  const { Box, Text, Code, Button } = el
  if (win !== undefined) win.model.framed = false // set again by the frame; a plain tree (loading, empty, no room, no Button) leaves ui.scroll to the engine
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
  const frame = win === undefined ? null : frameOf(win.props)
  const part = (label: string, start: number | null) => btn(el, label, label, start === null ? null : () => goto(start))
  if (frame !== null && win !== undefined && ai !== undefined && Button !== undefined) {
    const rows = contentRows(shown, ai.state, frame.cols, t)
    const parts = shown.kind === 'file' && shown.view.partial
    // a new answer or a hide / show starts at the top, where the answer is (and at the left edge)
    const k = title + '|' + rows.length + '|' + (ai.state.shown === null ? '' : ai.state.shown.text.length + (ai.state.visible ? 'v' : 'h'))
    const hs = win.h
    if (win.model.key !== k) { win.model.key = k; win.model.offset = 0; hs.hoff = 0 }
    const geo = hGeom(rows, frame.cols)
    hs.width = geo.width
    hs.hmax = Math.max(0, geo.longest - geo.width)
    hs.step = Math.max(1, Math.floor(geo.width / 2))
    hs.hoff = Math.min(hs.hoff, hs.hmax)
    const wide = hs.hmax > 0
    const barRows = 1 + (parts || wide ? 1 : 0) + (el.Input === undefined ? 0 : 1) + 1
    const headRows = 3
    const room = Math.max(1, frame.rows - headRows - 1 - barRows)
    const off = Math.min(win.model.offset, Math.max(0, rows.length - room))
    const codeRows = rows.slice(off, Math.min(rows.length, off + room)).filter((x): x is Extract<Row, { kind: 'code' }> => x.kind === 'code')
    // the range on screen, as the file's own line numbers (a file); a diff keeps its counts
    let count: string
    if (shown.kind === 'file') {
      const v = shown.view
      count = codeRows.length > 0 ? t('viewer.lines', { a: codeRows[0].num, b: codeRows[codeRows.length - 1].num, n: v.total }) : (v.partial ? t('viewer.lines', { a: v.first, b: v.last, n: v.total }) : t('viewer.whole', { n: v.total }))
    } else count = t('viewer.diff.head', { files: shown.view.files, hunks: shown.view.hunks })
    // the cue that the lines go on sideways: which columns are on screen
    if (wide) count += '   ' + t('viewer.cols', { a: hs.hoff + 1, b: hs.hoff + hs.width, n: hs.hmax + hs.width })
    const bar = [
      aiButtons(el, ai, t),
      ...(parts || wide ? [<Box key="parts">{parts && shown.kind === 'file' ? part(t('viewer.prev'), shown.prev) : null}{parts ? <Text>  </Text> : null}{parts && shown.kind === 'file' ? part(t('viewer.next'), shown.next) : null}{parts && wide ? <Text>   </Text> : null}{wide ? btn(el, 'hleft', t('viewer.left'), hs.hoff > 0 ? () => hMove(hs, -hs.step) : null) : null}{wide ? <Text>  </Text> : null}{wide ? btn(el, 'hright', t('viewer.right'), hs.hoff < hs.hmax ? () => hMove(hs, hs.step) : null) : null}</Box>] : []),
      ...(el.Input === undefined ? [] : [aiInput(el, ai, t)]),
      aiStatus(el, ai, t),
    ]
    return scrollFrame(el, {
      rows: frame.rows, cols: frame.cols, head: [name, <Text key="count" dimColor>{count}</Text>, hint], headRows,
      total: rows.length, window: (o, r) => drawRows(el, rows, o, Math.min(rows.length, o + r), hs), bar, barRows, model: win.model,
    })
  }
  if (shown.kind === 'file') {
    const v = shown.view
    const head = v.partial ? t('viewer.lines', { a: v.first, b: v.last, n: v.total }) : t('viewer.whole', { n: v.total })
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
