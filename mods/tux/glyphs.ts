// mods/tux/glyphs.ts — the glyph tables and their checkers. One copy; mods/live/ui.ts re-exports them.
// tableGlyphs() does not include pet.icons. petIconViolations() is the separate check (shared-TUI §6).
// vocabularyViolations / SHARED_GLYPHS stay in mods/live/ui.ts (they walk the groups, not this table scan).

import { displayWidth } from './width.ts'

export type PetIcon = { id: 'cat' | 'chick' | 'crab'; emoji: string; fallback: string; verified: string }
export const GLYPHS = {
  state: { need_you: '▲', failed: '✗', stalled: '⊘', findings: '△', running: '●', done: '✓', pending: '○', waiting: '⋯', stopped: '◌', skipped: '∅', unknown: '?', stale: '~' },
  structure: { open: '▾', folded: '▸', rule: '─', detail: '└', command: '$', goto: '›', bullet: '◦', empty: '—', tabMark: '━', residue: '⚑', behind: '↓', bandSep: '│', info: 'ⓘ', speed: 'ϟ', round: '↺', decisions: '◆', age: '◷', recommend: '★', fresh: '✦', frameTL: '╭', frameTR: '╮', frameBL: '╰', frameBR: '╯', frameDown: '┬', frameUp: '┴', frameLeftT: '├', frameRightT: '┤', answer: '→' },
  chart: { meterOn: '▰', meterOff: '▱', here: '◐' },
  scrollbar: { track: '│', thumb: '█' }, // §12.10: the scrolling window's right-hand column; track and thumb borrow the drawing of bandSep and the top spark step, a second meaning each (SHARED_GLYPHS)
  spark: ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'],
  fallback: { stalled: '◍', findings: '!' },
  // Pet tab icons (shared-TUI §6): fixed 2-cell emoji with 2-char printable ASCII fallback for < 80 cols / plain terminals. Exempt from tableGlyphs() and linted separately via petIconViolations.
  pet: {
    icons: {
      cat: { id: 'cat', emoji: '🐱', fallback: ':3', verified: 'pending-owner' },
      chick: { id: 'chick', emoji: '🐣', fallback: 'o<', verified: 'pending-owner' },
      crab: { id: 'crab', emoji: '🦀', fallback: '}{', verified: 'pending-owner' },
    } as Record<string, PetIcon>,
  },
  verified: { '⊘': '2026-10-13 owner-ssh-tmux', '△': '2026-10-13 owner-ssh-tmux', '○': '2026-10-13 owner-ssh-tmux', '◌': '2026-10-13 owner-ssh-tmux', '∅': '2026-10-13 owner-ssh-tmux', '◦': '2026-10-13 owner-ssh-tmux', '›': '2026-10-13 owner-ssh-tmux', '━': '2026-10-13 owner-ssh-tmux', '◐': '2026-10-13 owner-ssh-tmux', '◍': '2026-10-13 owner-ssh-tmux', '↓': 'pending-owner', '★': 'pending-owner', '⋯': 'pending-owner', '✦': 'pending-owner', '╭': 'pending-owner', '╮': 'pending-owner', '╰': 'pending-owner', '╯': 'pending-owner', '┬': 'pending-owner', '┴': 'pending-owner', '├': 'pending-owner', '┤': 'pending-owner', '→': 'pending-owner' } as Record<string, string>,
}
export const NEW_GLYPHS = ['⊘', '△', '○', '◌', '∅', '◦', '›', '━', '◐', '◍', '↓', '★', '⋯', '✦', '╭', '╮', '╰', '╯', '┬', '┴', '├', '┤', '→'] as const
// Extended_Pictographic glyphs a terminal may draw as an emoji box (§3.4); repeated so the rule survives a Unicode update
export const EMOJI_BANNED = ['⏸', '⚙', '⚠', '✔', '✖', '▶', '⏹', '⏺', '▪', '▫'] as const


const EXT_PICT = /\p{Extended_Pictographic}/u
const EMOJI_PRES_ONE = /^\p{Emoji_Presentation}$/u
export type GlyphTables = { state: Record<string, string>; structure: Record<string, string>; chart: Record<string, string>; scrollbar?: Record<string, string>; spark?: readonly string[]; fallback?: Record<string, string>; pet?: { icons?: Record<string, Partial<PetIcon>> }; verified?: Record<string, string> }
// I5 (c) for one text: an emoji-presentation hazard. `allowPictographic` is true for kind 'detail' lines only. Digits, `#` and `*` are legal (keycap bases, not pictographs).
export function emojiViolations(text: string, allowPictographic = false): string[] {
  const out: string[] = []
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number
    if (cp === 0xfe0f) out.push('U+FE0F (emoji variation selector)')
    else if (cp === 0x20e3) out.push('U+20E3 (keycap mark)')
    else if ((EMOJI_BANNED as readonly string[]).includes(ch)) out.push('banned emoji-prone glyph ' + ch)
    else if (!allowPictographic && EXT_PICT.test(ch)) out.push('Extended_Pictographic ' + ch)
  }
  return out
}
export const tableGlyphs = (g: GlyphTables): string[] => [...Object.values(g.state), ...Object.values(g.structure), ...Object.values(g.chart), ...Object.values(g.scrollbar ?? {}), ...(g.spark ?? []), ...Object.values(g.fallback ?? {})]
// a `verified` entry is `pending-owner` or `<YYYY-MM-DD> <terminal>`; anything else (`yes`, ``, `pending`) is refused
export const verifiedOk = (v: unknown): boolean => typeof v === 'string' && (v === 'pending-owner' || /^\d{4}-\d{2}-\d{2} \S/.test(v))
// Pet icon whitelist check (shared-TUI §6): separate from glyphTableViolations so 1-cell enforcement stays intact while pet icons pin 2-cell Emoji_Presentation + 2-char printable ASCII fallback.
export function petIconViolations(g: GlyphTables = GLYPHS): string[] {
  const icons = g.pet?.icons
  if (icons === undefined || typeof icons !== 'object' || icons === null || Object.keys(icons).length === 0) return ['GLYPHS.pet.icons is missing or empty']
  const out: string[] = []
  for (const [k, entry] of Object.entries(icons)) {
    const at = 'pet.icons.' + k
    if (typeof entry !== 'object' || entry === null) { out.push(at + ': not an object'); continue }
    const emoji = entry.emoji
    if (typeof emoji !== 'string' || emoji.length === 0) out.push(at + ': missing emoji')
    else {
      if (/\uFE0F/u.test(emoji)) out.push(at + ' emoji ' + emoji + ': contains U+FE0F')
      if ([...emoji].length !== 1) out.push(at + ' emoji ' + emoji + ': must be a single code point')
      if (!EMOJI_PRES_ONE.test(emoji)) out.push(at + ' emoji ' + emoji + ': must be Emoji_Presentation')
      if ((EMOJI_BANNED as readonly string[]).includes(emoji)) out.push(at + ' emoji ' + emoji + ': banned emoji-prone glyph')
      if (displayWidth(emoji) !== 2) out.push(at + ' emoji ' + emoji + ': draws ' + displayWidth(emoji) + ' cells, must be 2')
    }
    const fb = entry.fallback
    if (typeof fb !== 'string' || !/^[\x20-\x7e]{2}$/.test(fb) || displayWidth(fb) !== 2) out.push(at + ' fallback ' + JSON.stringify(fb) + ': must be two printable ASCII characters')
    if (!verifiedOk(entry.verified)) out.push(at + ' verified ' + JSON.stringify(entry.verified) + ': invalid verified entry')
  }
  return out
}
// I5 (a) + L3: every glyph is non-emoji, and each new-to-vocabulary glyph carries a `verified` entry
export function glyphTableViolations(g: GlyphTables = GLYPHS): string[] {
  const out: string[] = []
  for (const glyph of tableGlyphs(g)) for (const v of emojiViolations(glyph)) out.push(`glyph ${glyph}: ${v}`)
  for (const glyph of tableGlyphs(g)) if (displayWidth(glyph) !== 1) out.push(`glyph ${glyph}: draws ${displayWidth(glyph)} cells, a table glyph must be exactly one`)
  for (const glyph of NEW_GLYPHS) {
    if (!tableGlyphs(g).includes(glyph)) continue
    const v = g.verified?.[glyph]
    if (!verifiedOk(v)) out.push(`glyph ${glyph} is new to the vocabulary and has no \`verified\` entry`)
  }
  return out
}
