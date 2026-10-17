// mods/viewer/strings.ts — the viewer pane's words (the pane is for the owner; the one line the MODEL reads is English and lives in model.ts).
// Locale choice is the live mod's rule (live/i18n.ts resolveLocale): ~/.autopilot/config.json ui.locale > AUTOPILOT_LOCALE > Claude Code's language > LC_ALL / LANG > en.

import type { Locale, Vars } from '../live/i18n'

const EN: Record<string, string> = {
  'viewer.lines': 'lines {a} to {b} of {n}',
  'viewer.whole': '{n} lines',
  'viewer.hint': 'Esc closes   Tab picks a button, Enter presses it   arrows, PgUp, PgDn, Home, End scroll',
  'viewer.prev': 'previous part',
  'viewer.next': 'next part',
  'viewer.empty': 'the file is empty',
  'viewer.diff.head': '{files} files, {hunks} hunks',
  'viewer.diff.none': 'no difference',
  'viewer.diff.cut': 'too long: the rest is not shown',
  'viewer.failed': 'cannot show it: {why}',
  'viewer.waiting': 'The window did not open (terminal too narrow). Type /show to open it.',
  'viewer.nothing': 'Nothing to show yet. Type /show <path> or /show diff <arguments>.',
  'viewer.ai.summarize': 'summary',
  'viewer.ai.cancel': 'cancel',
  'viewer.ai.ask': 'ask',
  'viewer.ai.send': 'send to chat',
  'viewer.ai.hide': 'original only',
  'viewer.ai.show': 'show answer',
  'viewer.ai.askLabel': 'Ask',
  'viewer.ai.askPlaceholder': 'a question about this text',
  'viewer.ai.askGo': 'ask',
  'viewer.ai.working': 'Summarising...',
  'viewer.ai.asking': 'Asking...',
  'viewer.ai.title.summary': 'Summary ({subject})',
  'viewer.ai.title.answer': 'Answer ({subject})',
  'viewer.ai.question': 'Question: {q}',
  'viewer.ai.lines': '{path} lines 1-{n}',
  'viewer.ai.cut': 'Only the first {n} of {total} lines were read.',
  'viewer.ai.usage': 'haiku: {inn} in, {out} out, {total} tokens in all',
  'viewer.ai.usageCached': 'haiku: reused the saved answer (no call); it cost {total} tokens when made',
  'viewer.ai.cancelled': 'Cancelled.',
  'viewer.ai.busy': 'Working: press [ cancel ] to stop it.',
  'viewer.ai.failed': 'Could not get an answer: {why}',
  'viewer.ai.why.api': 'the service answered with an error ({kind}, status {status})',
  'viewer.ai.why.empty': 'the model sent no text',
  'viewer.ai.why.refused': 'the request was refused ({what})',
  'viewer.ai.nosummary': 'Nothing to send yet: press summary or ask first.',
  'viewer.ai.filled': 'Put in the prompt box. Press Enter yourself to send it.',
  'viewer.ai.notfilled': 'The prompt box did not take the text ({why}).',
  'viewer.ai.tagSummary': '[Viewer summary]',
  'viewer.ai.tagAnswer': '[Viewer answer]',
  'viewer.ai.q': 'Question:',
  'viewer.ai.a': 'Answer:',
  'viewer.ai.emptyQuestion': 'Type a question first.',
}

const ZH_TW: Record<string, string> = {
  'viewer.lines': '第 {a} 到 {b} 行，共 {n} 行',
  'viewer.whole': '共 {n} 行',
  'viewer.hint': 'Esc 關閉   Tab 選按鈕、Enter 按下   方向鍵、PgUp、PgDn、Home、End 捲動',
  'viewer.prev': '上一段',
  'viewer.next': '下一段',
  'viewer.empty': '這個檔案是空的',
  'viewer.diff.head': '{files} 個檔案，{hunks} 處變更',
  'viewer.diff.none': '沒有差異',
  'viewer.diff.cut': '內容太長，後面的沒有顯示',
  'viewer.failed': '無法顯示：{why}',
  'viewer.waiting': '終端機太窄，視窗沒有自動打開。輸入 /show 就會打開。',
  'viewer.nothing': '還沒有可以顯示的內容。輸入 /show <路徑> 或 /show diff <參數>。',
  'viewer.ai.summarize': '摘要',
  'viewer.ai.cancel': '取消',
  'viewer.ai.ask': '問一句',
  'viewer.ai.send': '送進對話',
  'viewer.ai.hide': '只看原文',
  'viewer.ai.show': '看摘要',
  'viewer.ai.askLabel': '問',
  'viewer.ai.askPlaceholder': '針對這段內容問一個問題',
  'viewer.ai.askGo': '送出',
  'viewer.ai.working': '摘要中…',
  'viewer.ai.asking': '回答中…',
  'viewer.ai.title.summary': '摘要（{subject}）',
  'viewer.ai.title.answer': '回答（{subject}）',
  'viewer.ai.question': '問題：{q}',
  'viewer.ai.lines': '{path} 第 1–{n} 行',
  'viewer.ai.cut': '只讀了前 {n} 行（共 {total} 行）。',
  'viewer.ai.usage': 'haiku：輸入 {inn}、輸出 {out}，共 {total} tokens',
  'viewer.ai.usageCached': 'haiku：沿用先前的結果，沒有再呼叫；當初花了 {total} tokens',
  'viewer.ai.cancelled': '已取消。',
  'viewer.ai.busy': '處理中，要停就按 [ 取消 ]。',
  'viewer.ai.failed': '沒有拿到回答：{why}',
  'viewer.ai.why.api': '服務回了錯誤（{kind}，狀態 {status}）',
  'viewer.ai.why.empty': '模型沒有回文字',
  'viewer.ai.why.refused': '請求被拒絕（{what}）',
  'viewer.ai.nosummary': '還沒有可以送的內容：先按摘要或問一句。',
  'viewer.ai.filled': '已填進輸入框。請自己按 Enter 送出。',
  'viewer.ai.notfilled': '輸入框沒有收下文字（{why}）。',
  'viewer.ai.tagSummary': '[檢視摘要]',
  'viewer.ai.tagAnswer': '[檢視問答]',
  'viewer.ai.q': '問：',
  'viewer.ai.a': '答：',
  'viewer.ai.emptyQuestion': '先輸入問題。',
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
