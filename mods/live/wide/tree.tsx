// mods/live/wide/tree.tsx - draws a WideBand (band.ts) as host elements: one row per line, one Text per same-role piece.
import { PALETTE } from '../../tux/palette'
import type { WideBand, WideRole } from './band'

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
