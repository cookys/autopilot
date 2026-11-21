// pages/help.ts — v7.4 help page (S10); no data source.
import { GLYPHS } from '../../tux/glyphs.ts'
import type { Page, PageCtx } from './frame'
import type { Row } from './rows'

const row = (text: string): Row => [{ text: '  ' + text }]
const legend = (pairs: readonly (readonly [string, string])[]): Row =>
  row(pairs.map(([glyph, word]) => glyph + ' ' + word).join('   '))
const title = (ctx: PageCtx, key: string): Row => [{ text: GLYPHS.structure.open + ' ' + ctx.t(key) }]

export function renderHelp(ctx: PageCtx): { body: Row[]; actions: Row[] } {
  const s = GLYPHS.state, g = GLYPHS.structure
  const arrows = g.up + g.behind
  return {
    body: [
      title(ctx, 'v74.b.help.status_title'),
      legend([[s.failed, ctx.t('legend.help.failed')], [s.stalled, ctx.t('legend.help.idle')], [s.unknown, ctx.t('legend.help.unknown')], [s.need_you, ctx.t('legend.help.attention')]]),
      legend([[s.running, ctx.t('legend.help.running')], [s.done, ctx.t('legend.help.done')], [s.pending, ctx.t('legend.help.pending')], [g.decisions, ctx.t('legend.help.decision')]]),
      row(''),
      title(ctx, 'v74.b.help.symbol_title'),
      legend([[g.open, ctx.t('legend.help.open')], [g.folded, ctx.t('legend.help.folded')], [g.info, ctx.t('legend.help.info')]]),
      legend([[g.speed, ctx.t('legend.help.speed')], [g.residue, ctx.t('legend.help.residue')], [g.recommend, ctx.t('legend.help.recommend')]]),
      row(''),
      title(ctx, 'v74.b.help.keys_title'),
      ...['v74.b.help.keys_1', 'v74.b.help.keys_2', 'v74.b.help.keys_3', 'v74.b.help.keys_4', 'v74.b.help.keys_5', 'v74.b.help.keys_6'].map(key => row(ctx.t(key, { arrows, fold: g.open + g.foldUp }))),
      row(''),
    ],
    actions: [],
  }
}

export const helpPage: Page = { id: 'help', key: '9', title: '說明', framed: true, render: renderHelp }