// pages/help.ts — v7.4 help page (S10); no data source.
import { GLYPHS } from '../../tux/glyphs.ts'
import type { Page, PageCtx } from './frame'
import type { Row } from './rows'

const block = (ctx: PageCtx, titleKey: string, bodyKeys: readonly string[]): Row[] => [
  [{ text: GLYPHS.structure.open + ' ' + ctx.t(titleKey) }],
  ...bodyKeys.map(k => [{ text: '  ' + ctx.t(k) }]),
  [{ text: '' }],
]

export function renderHelp(ctx: PageCtx): { body: Row[]; actions: Row[] } {
  return {
    body: [
      ...block(ctx, 'v74.b.help.status_title', [
        'v74.b.help.status_1', 'v74.b.help.status_2',
      ]),
      ...block(ctx, 'v74.b.help.symbol_title', [
        'v74.b.help.symbol_1', 'v74.b.help.symbol_2',
      ]),
      ...block(ctx, 'v74.b.help.keys_title', [
        'v74.b.help.keys_1', 'v74.b.help.keys_2', 'v74.b.help.keys_3', 'v74.b.help.keys_4', 'v74.b.help.keys_5', 'v74.b.help.keys_6', 'v74.b.help.keys_7',
      ]),
    ],
    actions: [],
  }
}

export const helpPage: Page = { id: 'help', key: '9', title: '說明', framed: true, render: renderHelp }