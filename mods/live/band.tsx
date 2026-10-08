// mods/live/band.tsx — the band above the prompt: ONE line (stage-graph P7, contract ②). Pure view over the snapshot's slots:
// `layoutBand` (model.ts) applies the width table, this file only draws the result as a row of Texts and the ⓘ Button.
// Colours are theme keys as text colour only: no backgroundColor, no inverse, no raw colour. No Image, no Raster.

import { BAND_ICON, layoutBand, plainBandText } from './model'
import type { LiveSnapshot } from './model'

type El = (props: any) => any

export function Band(el: { Box: El; Text: El; Button?: El }, snap: LiveSnapshot | null, columns: number, onInfo: () => void) {
  const { Box, Text, Button } = el
  const icon = Button === undefined
    ? <Text>{BAND_ICON}</Text>
    : <Button key="info" plain autoFocus onPress={onInfo}>{BAND_ICON}</Button>
  if (snap === null || snap.band === null) {
    const reason = snap === null ? 'live · waiting for the first snapshot' : snap.text
    return (
      <Box>
        <Text dimColor wrap="truncate">{plainBandText(reason, columns) + ' │ '}</Text>
        {icon}
      </Box>
    )
  }
  const line = layoutBand(snap.band.slots, columns)
  return (
    <Box>
      {line.segs.map((s, i) => <Text key={'s' + i} color={s.color} bold={s.bold} wrap="truncate">{s.text}</Text>)}
      {icon}
    </Box>
  )
}
