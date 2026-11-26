// Match the design's reply wrapping: keep ASCII runs and punctuation together,
// then balance a very short last line without increasing the line count.
import { displayWidth } from '../../tux/width'
import { BAND_REPLY_COLS } from './geometry'

export function wrapText(text: string, width: number): string[] {
  const tokens: string[] = []
  let ascii = ''
  for (const ch of text) {
    if (/^[\x21-\x7e]$/.test(ch)) { ascii += ch; continue }
    if (ascii) { tokens.push(ascii); ascii = '' }
    if ('，。；：、？！）」'.includes(ch) && tokens.length) tokens[tokens.length - 1] += ch
    else tokens.push(ch)
  }
  if (ascii) tokens.push(ascii)
  const atWidth = (limit: number): string[] => {
    const lines: string[] = []
    let line = ''
    for (const token of tokens) {
      if (displayWidth(line) + displayWidth(token) > limit && line) {
        lines.push(line.trimEnd()); line = token.trimStart()
      } else line += token
    }
    if (line) lines.push(line.trimEnd())
    return lines
  }
  const lines = atWidth(width)
  if (lines.length > 1 && displayWidth(lines[lines.length - 1]) <= 6) {
    for (let w = width - 1; w > Math.floor(width * 2 / 3); w--) {
      const balanced = atWidth(w)
      if (balanced.length === lines.length && displayWidth(balanced[balanced.length - 1]) > 6) return balanced
    }
  }
  return lines
}

export function wrapReply(row: string): string[] {
  if (row.trim() === '') return [row]
  const indent = row.length - row.trimStart().length
  return wrapText(row.trimStart(), BAND_REPLY_COLS - indent).map(line => ' '.repeat(indent) + line)
}
