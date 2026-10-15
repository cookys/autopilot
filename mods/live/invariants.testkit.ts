// mods/live/invariants.testkit.ts — the structural invariants I1 to I8 and I10 as one checker over a tab's lines, shared by review.test.ts (the Review tab, fixtures x
// locales x widths) and now.test.ts (every tab, P5). Test support only: nothing in the pane imports it.
import type { PaneLine } from './model'
import type { makeT } from './i18n'
import { GLYPHS, STATES, displayWidth, emojiViolations, emphasisViolations, isMade } from './ui'

type Tr = ReturnType<typeof makeT>
// ---- the invariants I1 to I8 and I10 over a tab's lines (line 0, the legacy global header, is P4's: it is unbranded until the verdict header replaces it) ----
const RAW_TOKENS = ['SHIP-AS-IS', 'FIX-THEN-SHIP', 'BLOCK', 'REJECT', 'READY', 'APPROVE', 'PASS', 'CONDITIONAL', 'STOP', 'REVIEWED', 'NOT_NEEDED', 'WEIRD']
const hasToken = (text: string): boolean => RAW_TOKENS.some(tok => new RegExp('(^|[^A-Za-z0-9_-])' + tok + '($|[^A-Za-z0-9_-])', 'i').test(text))
const GLYPH_CHARS = new Set<string>([...Object.values(GLYPHS.state), ...Object.values(GLYPHS.structure), ...Object.values(GLYPHS.chart), ...Object.values(STATES).map(s => s.glyph)].flatMap(g => [...g]))
const STATE_KEY = new Map<string, string>(Object.values(STATES).map(s => [s.glyph, s.key]))
const leading = (text: string): number => text.length - text.trimStart().length

export function violations(lines: PaneLine[], cols: number, t: Tr): string[] {
  const out: string[] = []
  const wordKey = new Map<string, string>(Object.entries(STATES).map(([id, s]) => [t('ui.state.' + id), s.key]))
  let empties = 0
  lines.forEach((l, i) => {
    const at = 'line ' + (i + 1) + ' ' + JSON.stringify(l.text)
    if (displayWidth(l.text) > cols) out.push('I1 ' + at + ' is ' + displayWidth(l.text) + ' wide')
    if (!isMade(l) || l.kind === undefined) out.push('I2 ' + at + ' is not made by a component')
    if (l.kind === 'header') empties = 0
    if (l.kind === 'empty' && l.text.startsWith(GLYPHS.structure.empty)) { empties++; if (empties > 1) out.push('I10 ' + at + ': a second empty line in a section') }
    if (/沒有資料|no data/.test(l.text) && l.kind !== 'empty') out.push('I10 ' + at + ' says no data outside an empty line')
    if (l.kind !== 'blank' && l.text !== '') {
      const lead = leading(l.text)
      const attached = (l.kind === 'detail' || l.kind === 'command') && (lead === 14 || lead === 16) // a detail under a column-12 item moves right by 12 (§5.3, I23): `└` at 14, text at 16; I3 of the plan does not list them
      if (![0, 2, 4, 12].includes(lead) && !attached) out.push('I3 ' + at + ' starts at ' + lead)
      if (l.kind === 'kv' && l.hang !== 12) out.push('I3 ' + at + ' kv without hang 12')
    }
    if (l.kind === 'header') { // I4: `^[▾▸] \S.*─+$`, width cols - 1, column 0
      if (!/^[▾▸] \S.*─+$/u.test(l.text)) out.push('I4 ' + at + ' is not a header line')
      if (displayWidth(l.text) !== cols - 1) out.push('I4 ' + at + ' is ' + displayWidth(l.text) + ' wide, not ' + (cols - 1))
    }
    if (l.text.includes('▌')) out.push('I4 ' + at + ' contains ▌')
    for (const v of emphasisViolations(l)) out.push('I4 ' + at + ' ' + v)
    const needYouRow = (l.kind === 'item' || l.kind === 'kv') && (l.segs ?? []).some(g => g.role === 'glyph' && g.text === STATES.need_you.glyph) // the plan lets a need_you item bold its mark, word and body (§3.6); a 各分頁 summary row is the same state made by worst(), so a need_you aggregate (kv) bolds alike
    const needYouBold = (s: { role?: string }): boolean => needYouRow && (l.kind === 'item' || s.role === 'glyph' || s.role === 'state') // an item may bold mark, word and body; a kv summary row only its state mark and word (§3.6: bold is for the need_you item text), never its values
    for (const s of l.segs ?? []) { // a bold segment only in a header, a verdict, a here segment, a need_you item, or a meter headline value (fmt pct)
      const meterHeadline = s.role === 'value' && s.fmt === 'pct' && l.kind === 'meter' // a meter is a line KIND (ui.meter), not a line that happens to draw filled cells: a 0% meter has none
      if (s.bold === true && l.kind !== 'header' && l.kind !== 'verdict' && s.here !== true && !needYouBold(s) && !meterHeadline && !(l.fact === 'legend.structure' && s.color === 'warning')) out.push('I4 ' + at + ' seg ' + JSON.stringify(s.text) + ' is bold outside header / verdict / need_you / here / meter headline')
    }
    if (l.kind !== 'detail' && emojiViolations(l.text).length > 0) out.push('I5 ' + at + ' ' + emojiViolations(l.text).join(','))
    if (/[️⃣]/u.test(l.text)) out.push('I5 ' + at + ' has VS16 or keycap')
    for (const s of l.segs ?? []) {
      const sat = at + ' seg ' + JSON.stringify(s.text)
      if ('backgroundColor' in s || 'inverse' in s) out.push('I6 ' + sat + ' has a background')
      if (s.color === 'claude' && s.here !== true) out.push('I6 ' + sat + ' claude without here')
      if (s.role === 'glyph') {
        for (const ch of s.text.replace(/\d+$/, '')) if (ch !== ' ' && !GLYPH_CHARS.has(ch)) out.push('I5 ' + sat + ' glyph not in GLYPHS')
        const key = STATE_KEY.get(s.text)
        if (key !== undefined && s.color !== undefined && s.color !== key) out.push('I6 ' + sat + ' glyph colour ' + s.color + ' != ' + key)
      }
      if (s.role === 'state') {
        const key = wordKey.get(s.text.trim())
        if (key === undefined || s.color !== key) out.push('I6 ' + sat + ' state word colour ' + String(s.color) + ' != ' + String(key))
      }
      if (s.color === 'suggestion' && s.role !== 'glyph' && s.role !== 'state') out.push('I6 ' + sat + ' suggestion outside a running mark')
      if ((s.role === 'state' || s.role === 'value') && l.kind !== 'detail' && l.kind !== 'command') { // a command is copied verbatim: ids and paths are its text
        if (hasToken(s.text)) out.push('I7 ' + sat + ' holds a raw token')
        if (/\[exited with code|\brc \d/.test(s.text)) out.push('I7 ' + sat + ' holds an exit marker')
        if (/\d/.test(s.text) && s.fmt === undefined) out.push('I8 ' + sat + ' has a number no formatter made')
      }
      if (s.fmt === 'sha' && !/^((\p{Hex_Digit}{8})|—)(\.\.((\p{Hex_Digit}{8})|—|HEAD))?$/u.test(s.text)) out.push('I8 ' + sat + ' is not 8 hex')
      if (s.fmt === 'ago' && /\d/.test(s.text) && !/\d+(s|m|d|h\d\dm)/.test(s.text)) out.push('I8 ' + sat + ' is not a duration')
      if (s.fmt === 'count' && /\d\*/.test(s.text)) out.push('I8 ' + sat + ' has N*')
    }
  })
  return out
}
