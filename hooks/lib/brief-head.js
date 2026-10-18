'use strict';

// First N lines of a brief, the same way hooks/subagent-budget.js reads Lane: / Budget-Ack:.
// CRLF is normalized so a line-anchored regex sees one line per row.
function headLines(text, n) {
  return String(text || '').replace(/\r\n/g, '\n').split('\n').slice(0, n);
}

module.exports = { headLines };
