// mods/viewer/strings.ts — the viewer pane's words (the pane is for the owner; the one line the MODEL reads is English and lives in model.ts).
// Locale choice is the live mod's rule (live/i18n.ts resolveLocale): ~/.autopilot/config.json ui.locale > AUTOPILOT_LOCALE > Claude Code's language > LC_ALL / LANG > en.

import type { Locale, Vars } from '../live/i18n'

const EN: Record<string, string> = {
  'viewer.lines': 'lines {a} to {b} of {n}',
  'viewer.whole': '{n} lines',
  'viewer.hint': 'Esc closes   arrows, PgUp, PgDn, Home, End scroll',
  'viewer.prev': 'previous part',
  'viewer.next': 'next part',
  'viewer.empty': 'the file is empty',
  'viewer.diff.head': '{files} files, {hunks} hunks',
  'viewer.diff.none': 'no difference',
  'viewer.diff.cut': 'too long: the rest is not shown',
  'viewer.failed': 'cannot show it: {why}',
  'viewer.waiting': 'The window did not open (terminal too narrow). Type /show to open it.',
  'viewer.nothing': 'Nothing to show yet. Type /show <path> or /show diff <arguments>.',
}

const ZH_TW: Record<string, string> = {
  'viewer.lines': '第 {a} 到 {b} 行，共 {n} 行',
  'viewer.whole': '共 {n} 行',
  'viewer.hint': 'Esc 關閉   方向鍵、PgUp、PgDn、Home、End 捲動',
  'viewer.prev': '上一段',
  'viewer.next': '下一段',
  'viewer.empty': '這個檔案是空的',
  'viewer.diff.head': '{files} 個檔案，{hunks} 處變更',
  'viewer.diff.none': '沒有差異',
  'viewer.diff.cut': '內容太長，後面的沒有顯示',
  'viewer.failed': '無法顯示：{why}',
  'viewer.waiting': '終端機太窄，視窗沒有自動打開。輸入 /show 就會打開。',
  'viewer.nothing': '還沒有可以顯示的內容。輸入 /show <路徑> 或 /show diff <參數>。',
}

export type VT = (id: string, vars?: Vars) => string

export function makeVT(locale: Locale): VT {
  const own = locale === 'zh-TW' ? ZH_TW : EN
  return (id, vars) => {
    const text = own[id] ?? EN[id] ?? id
    return vars === undefined ? text : text.replace(/\{(\w+)\}/g, (m, name: string) => (vars[name] === undefined ? m : String(vars[name])))
  }
}

export const IDS = { EN, ZH_TW }
