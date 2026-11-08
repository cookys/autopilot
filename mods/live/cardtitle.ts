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
// a name the band's 待決 list or the card heading draws is wrapped and drawn whole (bandpolish), so only the console feed (commandtab.ts) takes cardTitleOf's "…".
export const cardNameOf = (d: { title?: string | null; question: string }): string =>
  typeof d.title === 'string' && d.title !== '' && !/[\u0000-\u001f\u007f\u2028\u2029]/.test(d.title) ? d.title : d.question
