// pages/help.ts — v7.4 help page (S10); no data source.
import { GLYPHS } from '../../tux/glyphs.ts'
import type { Page, PageCtx } from './frame'
import { wrapRow } from './rows'
import type { Row } from './rows'
import { displayWidth } from '../model'

const row = (text: string): Row => [{ text: '  ' + text }]
const legend = (pairs: readonly (readonly [string, string])[]): Row =>
  row(pairs.map(([glyph, word]) => glyph + ' ' + word).join('   '))
const title = (ctx: PageCtx, key: string): Row => [{ text: GLYPHS.structure.open + ' ' + ctx.t(key) }]

// design S10: a label column of 12 cells, the text beside it, and a wrapped line hangs under the text (not under the label)
const LABEL_W = 12
function labelled(ctx: PageCtx, label: string, key: string, params: Record<string, string>): Row[] {
  const l = ctx.t(label)
  return wrapRow(row(l + ' '.repeat(Math.max(1, LABEL_W - displayWidth(l))) + ctx.t(key, params)), Math.max(20, ctx.size.cols - 4), LABEL_W + 2)
}

export function renderHelp(ctx: PageCtx): { body: Row[]; actions: Row[] } {
  const s = GLYPHS.state, g = GLYPHS.structure
  const arrows = g.up + g.behind
  return {
    body: [
      title(ctx, 'v74.b.help.status_title'),
      legend([[s.failed, ctx.t('legend.help.failed')], [s.stalled, ctx.t('legend.help.idle')], [s.unknown, ctx.t('legend.help.unknown')], [s.need_you, ctx.t('legend.help.attention')]]),
      legend([[s.running, ctx.t('legend.help.running')], [s.done, ctx.t('legend.help.done')], [s.pending, ctx.t('legend.help.pending')], [s.waiting, ctx.t('legend.help.waiting')], [g.decisions, ctx.t('legend.help.decision')]]),
      legend([[g.answer, ctx.t('legend.help.answer')], [s.done, ctx.t('legend.help.proxy')]]),
      row(''),
      title(ctx, 'v74.b.help.symbol_title'),
      legend([[g.open, ctx.t('legend.help.open')], [g.folded, ctx.t('legend.help.folded')], [g.info, ctx.t('legend.help.info')]]),
      legend([[g.speed, ctx.t('legend.help.speed')], [g.residue, ctx.t('legend.help.residue')], [g.recommend, ctx.t('legend.help.recommend')]]),
      row(''),
      title(ctx, 'v74.b.help.keys_title'),
      ...['v74.b.help.keys_1', 'v74.b.help.keys_2', 'v74.b.help.keys_3', 'v74.b.help.keys_s'].map(key => row(ctx.t(key, { arrows }))),
      row(''),
      ...labelled(ctx, 'v74.b.help.l_why', 'v74.b.help.keys_4', {}),
      ...labelled(ctx, 'v74.b.help.l_digits', 'v74.b.help.keys_5', {}),
      ...(ctx.v74 !== undefined && ctx.v74.todo === null ? labelled(ctx, 'v74.b.help.l_todo', 'v74.b.help.todo_off', {}) : []),
      ...labelled(ctx, 'v74.b.help.l_click', 'v74.b.help.keys_6', { fold: g.open + g.foldUp }),
      row(''),
    ],
    actions: [],
  }
}

export const helpPage: Page = { id: 'help', key: '9', title: '說明', framed: true, render: renderHelp }