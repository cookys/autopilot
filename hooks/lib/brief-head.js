'use strict';

const BRIEF_HEAD_WINDOW = 10;

// First N lines of a brief, the same way hooks/subagent-budget.js reads Lane: / Budget-Ack:.
// CRLF is normalized so a line-anchored regex sees one line per row.
function headLines(text, n) {
  return String(text || '').replace(/\r\n/g, '\n').split('\n').slice(0, n);
}

function findHeadMatch(text, re, n = BRIEF_HEAD_WINDOW) {
  for (const line of headLines(text, n)) {
    const m = re.exec(line);
    if (m) return m;
  }
  return null;
}

module.exports = { BRIEF_HEAD_WINDOW, headLines, findHeadMatch };
