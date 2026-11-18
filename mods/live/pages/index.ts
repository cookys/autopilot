// mods/live/pages/index.ts — the page registry: the pages of the new pane in key order (now 1, decide 2, fleet 3, quota 4, dispatch 5, review 6, spend 7, hygiene 8, pet 9, forge 0, help i).
// Each page is an EMPTY SHELL here (title only, body [] and actions []), declared inline below. The page hands replace one entry each
// (S1 decide, S2 fleet, S3 now, S4 quota): write the page in its own new file (pages/decide.ts ...), import it here, and swap the one shell line.
// A shell has no `framed` flag and pane.tsx still draws its tab the old way; the hand's page sets `framed: true` and is then drawn through frameRows.
import type { Page } from './frame'
import { quotaPage } from './quota'
import { nowPage } from './now'
import { fleetPage } from './fleet'
import { decidePage } from './decide'
import { hygienePage } from './hygiene'
import { reviewPage } from './review'
import { dispatchPage } from './dispatch'
import { spendPage } from './spend'
import { forgePage } from './forge'
import { legendLines } from '../tabs'

// A6 (g2 folds): 1-8, then 9 pet, 0 forge, i help, all drawn through frameRows. The pet page is a placeholder until P2 (the body says so); 5-8 are shells
// that keep their old tab's content until batch 2 moves it; forge and help are shells.
const pet = (): Page => ({ id: 'pet', key: '9', title: '寵物', framed: true, render: ctx => ({ body: [[{ text: ctx.t('frame.pet_todo'), dim: true }]], actions: [] }) })

export const PAGES: Page[] = [
  nowPage,
  decidePage,
  fleetPage,
  quotaPage,
  dispatchPage,
  reviewPage,
  spendPage,
  hygienePage,
  pet(),
  forgePage,
  // K1: help keeps its existing content inside the same frame and navigation.
  { id: 'help', key: 'i', title: '說明', framed: true, render: ctx => ({ body: legendLines({ t: ctx.t, cols: ctx.size.cols }).map(l => l.segs ?? [{ text: l.text }]), actions: [] }) },
]
