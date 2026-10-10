// mods/live/i18n.ts — the live mod's string tables and locale choice (docs/plans/evidence/2026-10-10-tui-v2/i18n.md).
//
// A hooks module can import only code files, never .json, so `locales/en.json` and `locales/zh-TW.json` (the editable sources) are
// compiled into `locales.ts` by `gen-locales.js` (`node mods/live/gen-locales.js` writes it, `--check` fails on drift, a missing id,
// a placeholder mismatch or an id the code uses but en lacks; run-tests.sh runs the check first). This file stays pure: no `$`,
// no fs. register.ts reads the config / env / Claude Code language once per tick and hands the answer to `resolveLocale`.

import { EN, ZH_TW } from './locales'

export type Locale = 'en' | 'zh-TW'
export type Vars = Record<string, string | number>
export type T = (id: string, vars?: Vars) => string

const TABLES: Record<Locale, Record<string, string>> = { en: EN, 'zh-TW': ZH_TW }

// The text of one id. Order: the active locale, then en, then the id itself (visible and greppable, never throws).
// `{name}` placeholders take a value from `vars`; an unknown placeholder stays as written. A counted noun has `<id>.one` / `<id>.other`
// in the table, chosen by `vars.n` (en: 1 = one, else other; zh-TW repeats the same text for both).
export function makeT(locale: Locale): T {
  const own = TABLES[locale]
  return (id: string, vars?: Vars): string => {
    let key = id
    if (vars !== undefined && typeof vars.n === 'number') {
      const form = id + (vars.n === 1 ? '.one' : '.other')
      if (own[form] !== undefined || EN[form] !== undefined) key = form
    }
    const text = own[key] ?? EN[key] ?? key
    return vars === undefined ? text : text.replace(/\{(\w+)\}/g, (m, name: string) => (vars[name] === undefined ? m : String(vars[name])))
  }
}

export const T_EN: T = makeT('en')

// Claude Code's own language setting is free text ("正體中文台灣用語", "Traditional Chinese", "zh-TW", "English"…): map by pattern.
// No other Chinese variant is claimed until someone ships it, so everything else is en.
export function localeFromLanguage(text: string): Locale {
  return /正體|繁體|台灣|zh[-_]?tw|zh[-_]?hant|traditional/i.test(text) ? 'zh-TW' : 'en'
}

// LANG / LC_ALL style value: zh_TW.UTF-8, zh_TW, zh-TW -> zh-TW; anything else -> en
export function localeFromPosix(text: string): Locale {
  return /^zh[-_]TW/i.test(text) ? 'zh-TW' : 'en'
}

const asLocale = (v: unknown): Locale | null => (v === 'en' || v === 'zh-TW' ? v : null)

export type LocaleInputs = {
  config: unknown // ~/.autopilot/config.json ui.locale: "en" | "zh-TW" | "auto"
  env: string | null | undefined // AUTOPILOT_LOCALE
  language: string | null | undefined // Claude Code's language setting (the /config row or settings.json)
  lang: string | null | undefined // LC_ALL, else LANG
}

// ui.locale (explicit) > AUTOPILOT_LOCALE (explicit) > the Claude Code language setting > LC_ALL / LANG > en. "auto" / absent / unknown falls through.
export function resolveLocale(i: LocaleInputs): Locale {
  const c = asLocale(i.config)
  if (c !== null) return c
  const e = asLocale(i.env)
  if (e !== null) return e
  if (typeof i.language === 'string' && i.language.trim() !== '') return localeFromLanguage(i.language)
  if (typeof i.lang === 'string' && i.lang.trim() !== '') return localeFromPosix(i.lang.trim())
  return 'en'
}
