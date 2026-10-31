// mods/live/band.tsx — the band above the prompt: ONE line (stage-graph P7, contract ②; TUI v2 grammar). Pure view over the snapshot's slots:
// `layoutBand` (model.ts) applies the width table, this file only draws the result: each slot a plain Button keyed by its slot id (a press opens
// the pane on the tab that explains it), the separators plain Texts between them, then the ⓘ Button.
// Colours are theme keys as text colour only: no backgroundColor, no inverse, no raw colour. No Image, no Raster.

import { T_EN } from './i18n'
import type { T } from './i18n'
import { BAND_INFO_LABEL, BAND_SEP, layoutBand, plainBandText } from './model'
import type { LiveSnapshot, Seg, SlotId } from './model'
import { dimProps, drawSeg } from './ui'

type El = (props: any) => any

// the band is this many rows tall (one Box of one line); the mods drawn below it are given the rows that remain
export const BAND_ROWS = 1

// the band over what a mod below it drew: autopilot on top, the other under it
export function stackBand(el: { Box: El }, band: unknown, below: unknown) {
  const { Box } = el
  return <Box flexDirection="column">{band}{below}</Box>
}

export function Band(el: { Box: El; Text: El; Button?: El }, snap: LiveSnapshot | null, columns: number, onInfo: () => void, t: T = T_EN, onSlot: (id: SlotId) => void = () => {}) {
  const { Box, Text, Button } = el
  // only the ⓘ autoFocuses: Ctrl+x Tab lands on it, as before the slots were controls
  const icon = Button === undefined
    ? <Text>{BAND_INFO_LABEL}</Text>
    : <Button key="info" plain autoFocus onPress={onInfo}>{BAND_INFO_LABEL}</Button>
  if (snap === null || snap.band === null) {
    const reason = snap === null ? t('band.waiting') : snap.text
    return (
      <Box>
        <Text {...dimProps()} wrap="truncate">{plainBandText(reason, columns) + BAND_SEP}</Text>
        {icon}
      </Box>
    )
  }
  const line = layoutBand(snap.band.slots, columns)
  const text = (s: Seg, i: number) => <Text key={'s' + i} {...drawSeg(s)} wrap="truncate">{s.text}</Text>
  // consecutive segs of one slot become one Button; a seg with no slot (a separator) stays a bare Text
  const runs: { slot: SlotId | undefined; at: number; segs: Seg[] }[] = []
  line.segs.forEach((s, i) => {
    const last = runs[runs.length - 1]
    if (s.slot !== undefined && last !== undefined && last.slot === s.slot) last.segs.push(s)
    else runs.push({ slot: s.slot, at: i, segs: [s] })
  })
  return (
    <Box>
      {runs.map(r => {
        const texts = r.segs.map((s, j) => text(s, r.at + j))
        const id = r.slot
        if (id === undefined || Button === undefined) return texts
        return <Button key={id} plain onPress={() => onSlot(id)}>{texts}</Button>
      })}
      {icon}
    </Box>
  )
}
