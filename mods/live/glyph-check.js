#!/usr/bin/env node
// mods/live/glyph-check.js — owner-run terminal check for the glyphs the live pane adds (plan P0 b; the plan's §8 Q2).
// Run it in the REAL terminal (ssh + tmux): `node mods/live/glyph-check.js`
// Each glyph sits between two `|` markers, once with ASCII neighbours and once next to a CJK character. If the glyph takes ONE cell, the two `|`
// of a row line up with the `|` of the ruler row on top; a glyph drawn wide pushes the second `|` one cell to the right, a clipped one pulls it left.
// Report which glyphs look off. Nothing is written; GLYPHS.verified in ui.ts was `pending-owner` until the owner ran this on 2026-10-13 (ssh + tmux: all ten single-cell).
const GLYPHS = ['⊘', '△', '○', '◌', '∅', '◦', '›', '━', '◐', '◍', '↓', '★']
const out = []
out.push('one cell each: the | after the glyph must sit exactly under the | of the ruler')
out.push('ruler     |   |   |   |   |   |   |   |   |   |   |   |   |')
out.push('ascii     ' + GLYPHS.map(g => '|' + g + '  ').join('') + '|')
out.push('cjk       ' + GLYPHS.map(g => '|' + g + '現').join('') + '|')
out.push('')
out.push('glyph  U+     cells-by-the-pane-table')
for (const g of GLYPHS) out.push(g + '      U+' + g.codePointAt(0).toString(16).toUpperCase().padStart(4, '0') + '  1')
out.push('')
out.push('fallbacks if one fails: ⊘ -> ◍, △ -> !')
process.stdout.write(out.join('\n') + '\n')
