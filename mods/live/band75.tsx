// mods/live/band75.tsx — v7.5: the band's card block (the rows v75.ts planned) as an element tree. Fixed height: V75_BAND_ROWS - 1 rows (the status row is drawn by BandBar), every row one line, never wrapped.
// Keys are zero-size hotkey Buttons (a visible Button between rows ate Up/Down in r8); the one autoFocus Button, `v75:anchor`, is where ctrl+x tab lands. In the note mode the row is an Input and no hotkey is bound.
import { drawSeg } from './ui'
import type { KeyAction } from './pages/keys'
import { V74_KEY } from './v74/contract'
import { V75_MOVED } from './pages/keys'
import type { V75BandIn, V75Row } from './v75'

type El = (props: any) => any

export type V75BandActs = { onKey: (k: KeyAction) => void; onPage: (id: string) => void; onText: (v: string) => void; epoch?: number }

const LETTERS = ['a', 'b', 'c'] as const

export function V75Band(el: { Box: El; Text: El; Button?: El; Input?: El }, rows: V75Row[], i: V75BandIn, acts: V75BandActs) {
  const { Box, Text, Button, Input } = el
  const ep = acts.epoch !== undefined && acts.epoch > 0 ? ':' + acts.epoch : ''
  const drawn = (r: V75Row, k: number) => <Box key={'v75-row' + k} height={1} width={i.cols} overflow="hidden">{r.map((x, j) => <Text key={'g' + j} {...drawSeg(x)} wrap="truncate">{x.text}</Text>)}</Box>
  const typing = i.noteMode && Input !== undefined
  const body = rows.map((r, k) => {
    if (k === 2 && typing) {
      // the note row: the lead stays Text, the buffer is a host Input (Enter saves, Esc ends it through the focus event, register.ts)
      return <Box key="v75-row2" height={1} width={i.cols} overflow="hidden"><Text {...drawSeg(r[0])}>{r[0].text}</Text><Input key="v74-note" value={i.noteBuf} onInput={(v: string) => acts.onText(v)} onSubmit={() => acts.onKey({ kind: 'text_save' })} autoFocus /></Box>
    }
    return drawn(r, k)
  })
  if (Button === undefined || typing) return <Box key="v75-band" flexDirection="column">{body}</Box>
  const c = i.cards[Math.max(0, Math.min(i.cards.length - 1, i.cursor))]
  const nOpts = c === undefined ? 0 : Math.min(3, c.options.length)
  const hot = (id: string, hotkey: string, run: () => void) => <Box key={'hk:' + id} width={0} height={0} overflow="hidden"><Button key={'v75:' + id + ep} plain hotkey={hotkey} onPress={run}>{hotkey}</Button></Box>
  const hidden: unknown[] = [
    ...LETTERS.slice(0, nOpts).map((l, k) => hot(l, l, () => acts.onKey({ kind: 'pick', index: k }))),
    hot('j', 'j', () => acts.onKey({ kind: 'move', by: 1 })), // next / previous card: the fallback when the arrows do not reach the page
    hot('k', 'k', () => acts.onKey({ kind: 'move', by: -1 })),
    hot('n', 'n', () => acts.onKey({ kind: 'move', by: 1 })),
    hot('p', 'p', () => acts.onKey({ kind: 'move', by: -1 })),
    hot('m', 'm', () => acts.onKey({ kind: 'note' })),
    hot('s', 's', () => acts.onKey({ kind: 'submit' })),
    ...(i.armed ? [hot('y', 'y', () => acts.onKey({ kind: 'confirm' })), hot('x', 'x', () => acts.onKey({ kind: 'disarm' }))] : []), // x cancels the preview (a hotkey is one digit or one lowercase letter, d.ts:1391: the band cannot take Esc)
    // §3: in the band a digit means page N: it opens the Pane there (the band has no pages of its own)
    ...Object.entries(V74_KEY).filter(([id]) => id !== 'help').map(([id, d]) => hot('d' + d, d as string, () => acts.onPage(id))),
    ...Object.entries(V75_MOVED).filter(([d]) => d !== 'p').map(([d, id]) => hot('m' + d, d, () => acts.onPage(id))), // the old shell's menus: r 圓桌, u 用量, p 寵物
    hot('d0', '0', () => acts.onPage('pet')),
    <Box key="hk:anchor" width={0} height={0} overflow="hidden"><Button key={'v75:anchor' + ep} plain autoFocus onPress={() => undefined}>{' '}</Button></Box>,
  ]
  return <Box key="v75-band" flexDirection="column">{body}{hidden}</Box>
}
