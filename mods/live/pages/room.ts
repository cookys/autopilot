// mods/live/pages/room.ts — the roundtable (圓桌) page. Pure: the rows are shell.ts's parseRoom reading of the newest room's log.
import type { Page } from './frame'
import { roomLines } from './../shell'

export const ROOM_ROWS = 40 // the page shows the newest messages; the Pane's own window scrolls what does not fit

export const roomPage: Page = {
  id: 'room',
  key: 'r',
  title: '圓桌',
  framed: true,
  render: ctx => {
    const rows = ctx.room ?? []
    const lines = roomLines(rows, Math.max(20, ctx.size.cols - 2), ROOM_ROWS)
    return { body: lines.length === 0 ? [[{ text: ctx.t('v75.room_none'), dim: true }]] : lines, actions: [] }
  },
}
