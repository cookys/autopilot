/**
 * permission-block-lib — the BLOCKED_ON_PERMISSION leg shared by hooks/awaiting-owner.js (Notification permission_prompt)
 * and scripts/permission-prompt-watch.js (pane-text fallback). Not a hook (`-lib.js` suffix). Built-ins + repo libs only.
 *
 * A session stopped at a Claude Code permission dialog (even under bypass: "Dangerous rm operation on statically-unresolvable
 * target") waits for the operator's own answer. DETECTION ONLY: nothing here sends keys, answers a prompt or approves anything.
 * The state is carried by the session's attention entry (state: "BLOCKED_ON_PERMISSION", pane_id, cwd, summary = the command) and
 * by ONE open-question card in the scope's decision file (the existing owner-panel leg of the notification ladder; the card's
 * later rungs belong to whatever reads those cards). The card is closed again when the prompt is gone.
 */
'use strict';

const STATE = 'BLOCKED_ON_PERMISSION';
const ORIGIN = 'permission_prompt'; // the card's `origin`: only cards with this origin and this session are ever closed here

const { sanitizeSessionId } = require('../scripts/lib/live-state-dir.js');

// -> { file, id } | null. null = the card could not be written (cwd outside a git repo, store error); the attention state stays.
function openBlockedCard({ cwd, sessionId, paneId, summary }) {
  if (typeof cwd !== 'string' || !cwd) return null;
  let root = null;
  try { root = require('./ask-decision.js').markerRoot(sessionId); } catch { /* unbound scope */ }
  const { openDecision } = require('../scripts/open-decision.js');
  const where = [`pane ${paneId || '(unknown)'}`, `cwd ${cwd}`, `session ${sessionId}`].join(' · ');
  const r = openDecision({
    cwd, root, session: sanitizeSessionId(sessionId),
    question: `工作階段卡在權限確認框，等你本人回應：${summary || '(指令不明)'}`,
    background: `${STATE}。${where}。這個框代表操作員本人的許可，模型與監看程式都不會替你按。`,
    blocks: '該 session 停在確認框，其餘工作不受影響',
    not_authorized: 'irreversible:權限確認框只有操作員本人能回答',
    source: 'Claude Code permission prompt', origin: ORIGIN,
  });
  return r.status === 'ok' ? { file: r.file, id: r.id } : null;
}

function closeBlockedCard(file, id, sessionId) {
  if (typeof file !== 'string' || typeof id !== 'string' || !file || !id) return;
  const session = sanitizeSessionId(sessionId);
  require('../scripts/open-decision.js').closeDecisionById(file, id, (v) => v.origin === ORIGIN && v.opened_by_session === session);
}

module.exports = { STATE, ORIGIN, openBlockedCard, closeBlockedCard };
