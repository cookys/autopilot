// mods/live/band.tsx — the band above the prompt (plan P1c, redesigned in P1c C3). Pure view: `el` is the surface
// table's constructors from $.ui.resolve(e). A data band is two lines: line 1 is the verdict, project, phase, elapsed
// and progress; line 2 is one reason sentence. Any other state (no pointer, stale, ...) is one dim line of text.
// No Image, no Raster: nothing here depends on a graphics protocol.

import type { BandView } from './model'

type El = (props: any) => any

export function Band(el: { Box: El; Text: El }, text: string, view: BandView | null) {
  const { Box, Text } = el
  if (view === null) {
    return (
      <Box>
        <Text dimColor wrap="truncate">{text}</Text>
      </Box>
    )
  }
  // a decision awaited is the loudest thing on the band; the other words are drawn plain
  const loud = view.verdict === '要你決定'
  return (
    <Box flexDirection="column">
      <Box>
        {view.verdict === null ? null : <Text bold color={loud ? 'warning' : undefined} wrap="truncate">{view.mark + ' ' + view.verdict}</Text>}
        <Text wrap="truncate">{(view.verdict === null ? view.mark + ' ' : ' ') + view.head}</Text>
        <Text dimColor={view.progressDim} wrap="truncate">{view.progress}</Text>
      </Box>
      {view.reason === null ? null : <Text dimColor wrap="truncate">{view.reason}</Text>}
    </Box>
  )
}
