// mods/live/cardtitle.ts — the card's short title as the live mod draws it. SAME RULE as cardTitle() in src/status/decision-input.js
// (a mod cannot require src/ JS): an explicit non-empty title wins verbatim; else the question with newline runs turned into spaces, the
// trailing （共 N 題） dropped, cut to 20 code points plus the ellipsis. mods/live/cardtitle.test.js loads both and compares the same inputs.
export const cardTitleOf = (d: { title?: string | null; question?: string | null }): string => {
  if (typeof d.title === 'string' && d.title !== '' && !/[\u0000-\u001f\u007f\u2028\u2029]/.test(d.title)) return d.title
  const q = (typeof d.question === 'string' ? d.question : '').replace(/[\r\n]+/g, ' ').trim().replace(/（共\s*\d+\s*題）$/, '').trim()
  if (Array.from(q).length <= 20) return q
  return Array.from(q).slice(0, 20).join('') + '…'
}

// the name a list or heading SHOWS for a card: its explicit short title when it has one, else the question verbatim. Never the 20-code-point cut above:
// a name the band's 待決 list draws is wrapped and drawn whole (bandpolish), so it takes cardNameOf; the 待決 tab heading, the fleet others card and the console feed (commandtab.ts) use cardTitleOf's "…".
export const cardNameOf = (d: { title?: string | null; question: string }): string =>
  typeof d.title === 'string' && d.title !== '' && !/[\u0000-\u001f\u007f\u2028\u2029]/.test(d.title) ? d.title : d.question

const cleanTitle = (title: string | null | undefined): string | null =>
  typeof title === 'string' && title !== '' && !/[\u0000-\u001f\u007f\u2028\u2029]/.test(title) ? title : null

// The left list and the card header, when the card has no title: the first sentence of the question.
// Cut at the first 。！？.!?;； or before a "(1)" / "1." list start. The main window still shows the whole question.
export const cardSentenceOf = (d: { title?: string | null; question?: string | null }): string => {
  const title = cleanTitle(d.title)
  if (title !== null) return title
  const q = (typeof d.question === 'string' ? d.question : '').replace(/[\r\n]+/g, ' ').trim()
  const at = q.search(/[。！？.!?;；]|\(\d+\)|(?:^|\s)\d+\./)
  if (at < 0) return q
  const mark = q.slice(at).match(/^[。！？.!?;；]|\(\d+\)|(?:^|\s)\d+\./)
  const cut = mark !== null && /^[。！？.!?;；]/.test(mark[0]) ? q.slice(0, at + mark[0].length).trim() : q.slice(0, at).trim()
  return cut === '' ? q : cut
}

// What follows the drawn title on a decision card's head row. A fleet card's title is often the first characters of its question, so the plain
// `<title>：<question>` drew the title twice. Equal -> ''; question starts with the title -> the rest of it (leading space dropped, no `：`);
// otherwise `：<question>` as before. Pure; the callers draw the title segment themselves.
export const questionAfterTitle = (title: string, question: string): string => {
  const t = title.trim()
  const q = question.trim()
  if (t !== '' && q === t) return ''
  if (t !== '' && q.startsWith(t)) return q.slice(t.length).replace(/^\s+/, '')
  return '：' + question
}
