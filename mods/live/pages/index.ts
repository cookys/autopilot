// mods/live/pages/index.ts — the page registry: the pages of the new pane in key order (now 1, decide 2, fleet 3, quota 4, dispatch 5, review 6, spend 7, hygiene 8, pet 9, forge 0, help ?).
// Each page is an EMPTY SHELL here (title only, body [] and actions []), declared inline below. The page hands replace one entry each
// (S1 decide, S2 fleet, S3 now, S4 quota): write the page in its own new file (pages/decide.ts ...), import it here, and swap the one shell line.
// A shell has no `framed` flag and pane.tsx still draws its tab the old way; the hand's page sets `framed: true` and is then drawn through frameRows.
import type { Page } from './frame'
import { quotaPage } from './quota'

const shell = (id: Page['id'], key: string, title: string): Page => ({ id, key, title, render: () => ({ body: [], actions: [] }) })

// A6 (g2 folds): 1-8, then 9 pet, 0 forge, ? help, all drawn through frameRows. The pet page is a placeholder until P2 (the body says so); 5-8 are shells
// that keep their old tab's content until batch 2 moves it; forge and help are shells.
const pet = (): Page => ({ id: 'pet', key: '9', title: '寵物', framed: true, render: ctx => ({ body: [[{ text: ctx.t('frame.pet_todo'), dim: true }]], actions: [] }) })

export const PAGES: Page[] = [
  shell('now', '1', '現況'),
  shell('decide', '2', '待決'),
  shell('fleet', '3', '艦隊'),
  quotaPage,
  shell('dispatch', '5', '派工'),
  shell('review', '6', '審查'),
  shell('spend', '7', '花費'),
  shell('hygiene', '8', '殘留'),
  pet(),
  shell('forge', '0', 'forge'),
  shell('help', '?', '說明'),
]
