// mods/live/pages/index.ts — v7.4 page registry: keys 1–9 per contract.ts; pet 0; quota not in the tab row (folded into spend).
import type { Page } from './frame'
import { nowPage } from './now'
import { decidePage } from './decide'
import { dispatchPage } from './dispatch'
import { reviewPage } from './review'
import { spendPage } from './spend'
import { hygienePage } from './hygiene'
import { fleetPage } from './fleet'
import { helpPage } from './help'
import { petPage } from '../pettab'
import { quotaPage } from './quota'
import { forgePage } from './forge'

const pet = (): Page => petPage

const todoShell: Page = { id: 'todo', key: '8', title: '待辦', framed: true, render: () => ({ body: [], actions: [] }) }

export const PAGES: Page[] = [
  nowPage,
  decidePage,
  dispatchPage,
  reviewPage,
  spendPage,
  hygienePage,
  fleetPage,
  todoShell,
  helpPage,
  pet(),
]

// Pages reachable by digit but not listed on the strip (quota → spend tab; forge legacy).
export const EXTRA_PAGES: Page[] = [quotaPage, forgePage]

// gen-locales reads this file: anchor v74.b.help.* ids used by pages/help.ts
void [
  'frame.help',
  'v74.b.help.status_title', 'v74.b.help.status_1', 'v74.b.help.status_2',
  'v74.b.help.symbol_title', 'v74.b.help.symbol_1', 'v74.b.help.symbol_2',
  'v74.b.help.keys_title', 'v74.b.help.keys_1', 'v74.b.help.keys_2', 'v74.b.help.keys_3',
  'v74.b.help.keys_4', 'v74.b.help.keys_5', 'v74.b.help.keys_6', 'v74.b.help.keys_7',
]