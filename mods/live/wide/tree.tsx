// mods/live/wide/tree.tsx - draws a WideBand (band.ts) as host elements: one row per line, one Text per same-role piece.
import { PALETTE } from '../../tux/palette'
import type { WideBand, WideRole } from './band'
import type { PaneRole, WidePane } from './pane'

type El = (props: Record<string, unknown>) => unknown
// the band's role names map to palette roles; plain text keeps the host's default colour
const COLOR: Record<WideRole, string | undefined> = { frame: PALETTE.idle, fold: PALETTE.needs_human, current: PALETTE.attention, text: undefined }

function hotkeys(el: { Box: El; Text: El; Button?: El }, onKey: (key: string) => void, epoch: number, surface: string) {
  const { Box, Text, Button } = el
  if (Button === undefined) return []
  const ep = epoch > 0 ? ':' + epoch : ''
  // the host has no raw key hook: a key reaches the mod only as a focused surface's Button hotkey (v7.4 does the same in pane.tsx `hidden`);
  // zero-size Boxes add no row; the one autoFocus Button is where Ctrl+x Tab lands. An array, not a fragment (none elsewhere in mods/live).
  return [...['1', '2', '3', '4', '5', '6', '7', '8', '9', 'e', 'g', 'j', 'k', 'o', 'w'].map(letter => (
    <Box key={'hk-' + letter} width={0} height={0} overflow="hidden"><Button key={surface + ':hotkey:' + letter + ep} plain hotkey={letter} onPress={() => onKey(letter)}>{letter}</Button></Box>
  )), <Box key="focus" width={0} height={0} overflow="hidden"><Button key={(surface === 'wide-pane' ? 'focus' : surface + ':focus') + ep} plain autoFocus onPress={() => {}}><Text>{''}</Text></Button></Box>]
}

export function WideBandTree(el: { Box: El; Text: El; Button?: El }, band: WideBand, onKey: (key: string) => void, epoch: number) {
  const { Box, Text } = el
  return (
    <Box key="wide-band" flexDirection="column" flexShrink={0}>
      {band.segs.map((row, y) => (
        <Box key={'wide-row-' + y} flexShrink={0}>
          {row.map((s, i) => <Text key={'s' + i} {...(COLOR[s.role] === undefined ? {} : { color: COLOR[s.role] })} wrap="truncate">{s.text}</Text>)}
        </Box>
      ))}
      {hotkeys(el, onKey, epoch, 'wide-band')}
    </Box>
  )
}

// the wide pane (pane.ts): one row per line; each `其他頁` summary row is a Button that jumps to its page (the digit keys do the same through pages/keys.ts)
const PANE_COLOR: Record<PaneRole, string | undefined> = { frame: PALETTE.idle, text: undefined, dim: PALETTE.idle, key: PALETTE.needs_human, ok: PALETTE.done, err: PALETTE.broken, warn: PALETTE.attention }
export function WidePaneTree(el: { Box: El; Text: El; Button?: El }, pane: WidePane, onPage: (n: number) => void, onKey: (key: string) => void, epoch: number) {
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
      {hotkeys(el, onKey, epoch, 'wide-pane')}
    </Box>
  )
}
