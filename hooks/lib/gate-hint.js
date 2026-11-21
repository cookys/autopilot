/**
 * gate-hint — Fleet-Task 01M803Z0SF3MQG07WYWH3TH25T.
 *
 * Every gate block/deny message must tell the blocked session HOW to fix it, in one
 * sentence, and name the doc that governs the gate. gateHint(fix, doc) builds that
 * tail; it is appended to the gate's own explanation (which stays untouched):
 *
 *   emitDeny(reason + gateHint('補上 Fleet-Task: <id> 再派工', 'hooks/README.md'))
 *
 * `fix` is one concrete sentence (what to do instead). `doc` is a repo-relative
 * path (references/…, docs/…, hooks/README.md, CLAUDE.md) or a skill name
 * (e.g. autopilot:handoff) that must exist in the tree.
 *
 * The lint (hooks/tests/gate-block-hint.test.sh + hooks/tests/lib/gate-block-hint-audit.js)
 * fails when a gate's block message does not go through gateHint(), or when a cited
 * doc does not resolve. Fail-open by construction: this module never throws and
 * never changes a gate's decision — it only appends text.
 */
'use strict';

const FIX_MARK = '修正：';
const DOC_MARK = '參閱：';

function gateHint(fix, doc) {
  const f = String(fix || '').trim().replace(/\s+/g, ' ');
  const d = String(doc || '').trim();
  if (!f || !d) return '';
  return `${FIX_MARK}${f} ${DOC_MARK}${d}`;
}

// The doc cited in a message (used by the lint to check it resolves); null when absent.
function gateDoc(message) {
  const m = String(message || '').match(new RegExp(`${DOC_MARK}([\\w./:-]+)`));
  return m ? m[1] : null;
}

module.exports = { gateHint, gateDoc, FIX_MARK, DOC_MARK };
