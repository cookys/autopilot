// mods/roundtable/strings.ts — pane words. The owner reads zh-TW. Locale choice is the live mod's rule.

import type { Locale, Vars } from '../live/i18n'

const EN: Record<string, string> = {
  'rt.head': '{room} · {n} rows',
  'rt.sayLabel': 'Say',
  'rt.send': 'send',
  'rt.empty': 'No room yet. Type /rt-room <id>.',
  'rt.unresolved': 'Rooms directory is unknown (HOME is unset and AUTOPILOT_ROOMS_DIR is unset).',
  'rt.missing': 'This room has no log yet.',
  'rt.hint': 'Enter sends. Arrows scroll. Esc leaves the keyboard and does not close this pane.',
  'rt.badRoom': 'Room id must be lowercase letters, digits, and hyphen.',
}

const ZH_TW: Record<string, string> = {
  'rt.head': '{room} · {n} 則',
  'rt.sayLabel': '發言',
  'rt.send': '送出',
  'rt.empty': '還沒有房間。輸入 /rt-room <房間代號>。',
  'rt.unresolved': '找不到房間目錄（沒有 HOME，也沒有設定 AUTOPILOT_ROOMS_DIR）。',
  'rt.missing': '這個房間還沒有紀錄。',
  'rt.hint': 'Enter 送給各席位。方向鍵捲動。Esc 只交回鍵盤，不會關掉這個窗。',
  'rt.badRoom': '房間代號只能用小寫英數和連字號。',
}

export type RT = (id: string, vars?: Vars) => string

export function makeRT(locale: Locale): RT {
  const own = locale === 'zh-TW' ? ZH_TW : EN
  return (id, vars) => {
    const text = own[id] ?? EN[id] ?? id
    return vars === undefined ? text : text.replace(/\{(\w+)\}/g, (m, name: string) => (vars[name] === undefined ? m : String(vars[name])))
  }
}
