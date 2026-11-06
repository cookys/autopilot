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

// The tmux server a pane id belongs to: pane ids (%0) repeat across servers. The default socket is spelled the same whether it comes
// from $TMUX (a path) or from a watcher run without --socket (empty), so both normalise to '(default)'.
function socketOf(socket) {
  const s = typeof socket === 'string' ? socket : '';
  const dflt = `${process.env.TMUX_TMPDIR || '/tmp'}/tmux-${typeof process.getuid === 'function' ? process.getuid() : 0}/default`;
  return !s || s === dflt ? '(default)' : s;
}
// $TMUX = "<socket path>,<server pid>,<session>": the socket path is everything before the trailing ",<pid>,<n>".
const socketFromTmuxEnv = (tmux) => (typeof tmux === 'string' ? tmux.replace(/,\d+,\d+$/, '') : '');

const whereOf = (paneId, cwd, sessionId, socket) => [`pane ${paneId || '(unknown)'}`, `cwd ${cwd}`, `session ${sessionId}`, `socket ${socketOf(socket)}`].join(' · ');

// One prompt = one card, whichever signal (hook or pane watcher) got there first: an open permission_prompt card for the same
// pane, cwd, session AND tmux socket is that prompt's card. A card of another session (its owner died without SessionEnd) or of
// another tmux server with the same pane id is never reused, and never closed here. -> { file, id } | null. Needs a known pane id.
function findOpenCard(cwd, paneId, sessionId, socket) {
  if (!paneId) return null;
  const needle = `。${whereOf(paneId, cwd, sessionId, socket)}。`;
  try {
    const od = require('../scripts/open-decision.js');
    for (const file of od.projectScopeFiles(cwd)) {
      const hit = od.readEntries(file).find((e) => e.origin === ORIGIN && typeof e.background === 'string' && e.background.includes(needle));
      if (hit) return { file, id: hit.id };
    }
  } catch { /* store unreadable: fall through to opening a card */ }
  return null;
}

// -> { file, id } | null. null = the card could not be written (cwd outside a git repo, store error); the attention state stays.
// An open card for the same pane, cwd, session and socket (the other signal's) is returned instead of a second one; it stays owned by its opener.
function openBlockedCard({ cwd, sessionId, paneId, socket, summary }) {
  if (typeof cwd !== 'string' || !cwd) return null;
  const existing = findOpenCard(cwd, paneId, sessionId, socket);
  if (existing) return existing;
  let root = null;
  try { root = require('./ask-decision.js').markerRoot(sessionId); } catch { /* unbound scope */ }
  const { openDecision } = require('../scripts/open-decision.js');
  const where = whereOf(paneId, cwd, sessionId, socket);
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

module.exports = { STATE, ORIGIN, socketFromTmuxEnv, openBlockedCard, closeBlockedCard };
