// mods/live/wide/tree.tsx - draws a WideBand (band.ts) as host elements: one row per line, one Text per same-role piece.
import { PALETTE } from '../../tux/palette'
import type { WideBand, WideRole } from './band'
import type { PaneRole, WidePane } from './pane'

type El = (props: Record<string, unknown>) => unknown
// the band's role names map to palette roles; plain text keeps the host's default colour
const COLOR: Record<WideRole, string | undefined> = { frame: PALETTE.idle, fold: PALETTE.needs_human, current: PALETTE.attention, text: undefined }

export function WideBandTree(el: { Box: El; Text: El }, band: WideBand) {
  const { Box, Text } = el
  return (
    <Box key="wide-band" flexDirection="column" flexShrink={0}>
      {band.segs.map((row, y) => (
        <Box key={'wide-row-' + y} flexShrink={0}>
          {row.map((s, i) => <Text key={'s' + i} {...(COLOR[s.role] === undefined ? {} : { color: COLOR[s.role] })} wrap="truncate">{s.text}</Text>)}
        </Box>
      ))}
    </Box>
  )
}

// the wide pane (pane.ts): one row per line; each `其他頁` summary row is a Button that jumps to its page (the digit keys do the same through pages/keys.ts)
const PANE_COLOR: Record<PaneRole, string | undefined> = { frame: PALETTE.idle, text: undefined, dim: PALETTE.idle, key: PALETTE.needs_human, ok: PALETTE.done, err: PALETTE.broken, warn: PALETTE.attention }
export function WidePaneTree(el: { Box: El; Text: El; Button?: El }, pane: WidePane, onPage: (n: number) => void) {
  const { Box, Text, Button } = el
  const click = new Map(pane.clicks.map(c => [c.row, c.page]))
  return (
    <Box key="wide-pane" flexDirection="column" flexShrink={0}>
      {pane.segs.map((row, y) => {
        const texts = row.map((s, i) => <Text key={'s' + i} {...(PANE_COLOR[s.role] === undefined ? {} : { color: PANE_COLOR[s.role] })} wrap="truncate">{s.text}</Text>)
        const page = click.get(y)
        // the host refuses a Button that holds a Box ("holds strings and Text, not <Box>"): the row Box holds the Button, the Button holds the Texts
        return <Box key={'wide-pane-' + y} flexShrink={0}>{page === undefined || Button === undefined ? texts : <Button key={'wide-pane-go-' + y} plain onPress={() => onPage(page)}>{texts}</Button>}</Box>
      })}
    </Box>
  )
}
