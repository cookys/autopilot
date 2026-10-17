// mods/live/scroll.tsx — the one scrolling window both panes use: the viewer window and the live 待決 tab (design plan §12.10).
//
// The engine scrolls a pane by moving a window over the whole tree it was handed, which carries the pane's own header and any button row along. A tab that needs its buttons in
// view while its content scrolls draws its own window instead: the pane body is exactly `bodyRows` rows high (read from `e.props.scroll.bodyRows`), made of a fixed head, a content
// window the mod cuts itself, one rule and a fixed action strip. The person's scroll keys reach `ui.scroll`; the mod moves its own offset there and never calls `next`, so the
// engine's window stays at 0. One blank row is drawn under the frame so the tree is one row taller than the window, which is what makes the engine raise `ui.scroll` at all.
//
// The cost of drawing the rows ourselves is that every content row must be exactly one row: a line wider than the room is cut (no wrapping), the caller pre-wraps what must wrap.
// Colour: the track is the `structure` role, the thumb the `here` role (you are here), the rule `structure`; text colour only. Glyphs: GLYPHS.scrollbar and GLYPHS.structure.rule
// Five track cells (top, quarter, middle, three quarters, bottom: scrollmath.jumpCells) are plain Buttons (no chrome, the Text child keeps its colour); a click on one jumps the window (scrollmath.jumpOffset). The host has no prop to keep a Button out of
// the Tab ring, so the keyboard walk gains one stop per jump cell (five); the click is the pointer path, the keys scroll as before.
// (ui.ts owns every glyph; ui-lint L2 keeps literals out of this file).
import { GLYPHS, PALETTE } from './ui'
import { jumpCells, jumpOffset, roomOf, thumbOf } from './scrollmath'
import type { ScrollModel } from './scrollmath'
export * from './scrollmath'

type El = (props: any) => any

export type FrameOptions = {
  rows: number // the pane body's rows (props.scroll.bodyRows)
  cols: number // the pane body's columns (props.bodyColumns)
  head: unknown[] // the fixed top: already drawn nodes
  headRows: number // how many rows they take
  total: number // content rows in all
  window: (offset: number, room: number) => unknown[] // the nodes for content rows offset .. offset + room, one row each (a node may hold several rows of one block)
  bar: unknown[] // the fixed action strip under the rule
  barRows: number
  model: ScrollModel
}

export function scrollFrame(el: { Box: El; Text: El; Button?: El }, o: FrameOptions) {
  const { Box, Text, Button } = el
  const room = roomOf(o)
  o.model.max = Math.max(0, o.total - room)
  o.model.room = room
  o.model.framed = true
  o.model.offset = Math.min(o.model.offset, o.model.max)
  const off = o.model.offset
  const th = thumbOf(o.total, room, off)
  const cells: unknown[] = []
  const jumps = new Set(jumpCells(room))
  if (th !== null) {
    for (let i = 0; i < room; i++) {
      const on = i >= th.top && i < th.top + th.len
      const glyph = <Text key={'sb' + i} color={on ? PALETTE.here : PALETTE.structure}>{on ? GLYPHS.scrollbar.thumb : GLYPHS.scrollbar.track}</Text>
      // only the five jump cells (jumpCells) are Buttons: a click jumps the window to that share of the track (jumpOffset); the other cells stay plain Text, as does every cell on a host with no Button
      cells.push(Button === undefined || !jumps.has(i) ? glyph : <Button key={'sbj' + i} plain onPress={() => { o.model.offset = jumpOffset(i, room, o.model.max); o.model.redraw?.() }}>{glyph}</Button>)
    }
  }
  return (
    <Box key="frame" flexDirection="column">
      <Box key="fixed" flexDirection="column" height={o.rows} overflow="hidden">
        {o.head}
        <Box key="content" flexDirection="row" flexGrow={1} overflow="hidden">
          <Box key="rows" flexDirection="column" flexGrow={1} overflow="hidden">{o.window(off, room)}</Box>
          {th === null ? null : <Box key="scrollbar" flexDirection="column" width={1} flexShrink={0}>{cells}</Box>}
        </Box>
        <Text key="rule" color={PALETTE.structure}>{GLYPHS.structure.rule.repeat(Math.max(1, o.cols))}</Text>
        {o.bar}
      </Box>
      <Text key="spare"> </Text>
    </Box>
  )
}
