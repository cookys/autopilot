// mods/tux/width.ts — terminal cell width. One copy; mods/live/ui.ts re-exports it.
// East Asian Wide / Fullwidth = 2, combining and zero-width = 0, everything else (including East Asian Ambiguous) = 1.
// An ANSI escape sequence is not drawn: it is 0 cells. Width is per code point, not per grapheme cluster.

export function cellWidth(c: number): number {
  if (c === 0 || (c >= 0x0300 && c <= 0x036f) || (c >= 0x200b && c <= 0x200f) || (c >= 0xfe00 && c <= 0xfe0f) || (c >= 0x20d0 && c <= 0x20ff)) return 0
  if ((c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0x303e) || (c >= 0x3041 && c <= 0x33ff) || (c >= 0x3400 && c <= 0x4dbf)
    || (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xa000 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff)
    || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6)
    || (c >= 0x1f300 && c <= 0x1f64f) || (c >= 0x1f900 && c <= 0x1f9ff) || (c >= 0x20000 && c <= 0x3fffd)) return 2
  return 1
}

export const ANSI_RE = /\u001b(?:\[[0-?]*[ -\/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/gu
const ANSI_ALL = new RegExp(ANSI_RE.source, 'gu')

export function displayWidth(text: string): number {
  let w = 0
  for (const ch of text.includes('\u001b') ? text.replace(ANSI_ALL, '') : text) w += cellWidth(ch.codePointAt(0) as number)
  return w
}
