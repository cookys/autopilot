'use strict';
/**
 * card-notice.js — the one-line fleet message a card open/close sends to the program PM, and the strict parser of it (fleetcards phase 1).
 *
 *   AUTOPILOT-CARD/1 {"event":"open"|"close","card_id":"d-xxxxxxxx","question":"...","state":"...","at":"<ISO>","session":"<id>"|null[,"title":"<=20 chars"]}
 *
 * `title` is optional (only an `open` of a card that has one carries it); both key sets parse. ROLLOUT ORDER: upgrade the PM host first (its mirror parses
 * both), then the sending hosts: an old PM mirror refuses a notice that carries `title` whole (strict key set), so a new sender before a new PM loses those opens.
 *
 * Signing: run inside a Claude session, the shell `fleet send` carries that session in `from` (namespace/courier/member@session); run outside one (cron, say)
 * there is no session, and the panel shows the session as unknown.
 *
 * One line: the fixed prefix, one space, one JSON object, nothing after it. The session that opened the card is NOT taken from the body: the shell
 * `fleet send` inside a Claude session signs as that session (courier-attested `from`, namespace/courier/member@session), and the receiver reads the
 * session from `from`. `session` in the body is only a cross-check against a forged sender.
 *
 *   encode(event, fields)   -> the message text (question cut to QUESTION_MAX)
 *   parse(content)          -> { ok: true, notice } | { ok: false, reason }   exact keys, exact shapes; anything else is refused whole
 *   parseFrom(from)         -> { namespace, courier, member, session } | null
 *   notify(event, fields)   -> { sent: boolean, why } ; never throws, never blocks long. Silent when there is no courier.
 *
 * Knobs: AUTOPILOT_CARD_NOTIFY=off|0|false|no (no send; the hook suites export it), AUTOPILOT_CARD_NOTIFY_TO (target address; NO default: unset or empty sends nothing, each host supplies the PM address itself),
 * AUTOPILOT_FLEET_BIN (the fleet binary, as in fleet-decision.js). Node built-ins only.
 */
const { spawnSync } = require('child_process');

const PREFIX = 'AUTOPILOT-CARD/1 ';
const QUESTION_MAX = 300;
const STATES = ['open', 'awaiting_operator_action', 'pending_dispatch', 'closed'];
const EVENTS = ['open', 'close'];
const KEYS = ['at', 'card_id', 'event', 'question', 'session', 'state'];
const KEYS_TITLED = ['at', 'card_id', 'event', 'question', 'session', 'state', 'title'];
const TITLE_MAX = 20;
const CARD_ID = /^d-[0-9a-f]{8}$/;
const SESSION = /^[A-Za-z0-9_-]{1,64}$/;
const FROM = /^([A-Za-z0-9][A-Za-z0-9._-]{0,63})\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})(?:@([A-Za-z0-9_-]{1,64}))?$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/;

const bin = () => process.env.AUTOPILOT_FLEET_BIN || 'fleet';
const off = () => /^(off|0|false|no)$/i.test(String(process.env.AUTOPILOT_CARD_NOTIFY || '').trim());

function clean(q) {
  const s = String(q).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim();
  return s.length > QUESTION_MAX ? `${s.slice(0, QUESTION_MAX - 1)}…` : s;
}

function encode(event, { card_id, question, state, at, session, title }) {
  const body = { at: at || new Date().toISOString(), card_id, event, question: clean(question), session: session || null, state };
  if (typeof title === 'string' && title !== '') body.title = title;
  return `${PREFIX}${JSON.stringify(body)}`;
}

function parse(content) {
  if (typeof content !== 'string' || !content.startsWith(PREFIX)) return { ok: false, reason: 'no prefix' };
  const json = content.slice(PREFIX.length);
  if (json.includes('\n') || json.includes('\r') || json.length > 2000) return { ok: false, reason: 'not one short line' };
  let o;
  try { o = JSON.parse(json); } catch (_e) { return { ok: false, reason: 'not JSON' }; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, reason: 'not an object' };
  const keys = Object.keys(o).sort();
  const want = keys.includes('title') ? KEYS_TITLED : KEYS;
  if (keys.length !== want.length || keys.some((k, i) => k !== want[i])) return { ok: false, reason: 'keys differ from the contract' };
  if (keys.includes('title') && (typeof o.title !== 'string' || !o.title.trim() || Array.from(o.title).length > TITLE_MAX || CONTROL.test(o.title))) return { ok: false, reason: 'bad title' };
  if (!EVENTS.includes(o.event)) return { ok: false, reason: 'bad event' };
  if (typeof o.card_id !== 'string' || !CARD_ID.test(o.card_id)) return { ok: false, reason: 'bad card_id' };
  if (typeof o.question !== 'string' || !o.question.trim() || o.question.length > QUESTION_MAX || CONTROL.test(o.question)) return { ok: false, reason: 'bad question' };
  if (!STATES.includes(o.state)) return { ok: false, reason: 'bad state' };
  if ((o.event === 'open') !== (o.state === 'open')) return { ok: false, reason: 'event and state disagree' };
  if (typeof o.at !== 'string' || !ISO.test(o.at) || !Number.isFinite(Date.parse(o.at))) return { ok: false, reason: 'bad at' };
  if (o.session !== null && (typeof o.session !== 'string' || !SESSION.test(o.session))) return { ok: false, reason: 'bad session' };
  return { ok: true, notice: o };
}

function parseFrom(from) {
  const m = typeof from === 'string' ? FROM.exec(from) : null;
  return m ? { namespace: m[1], courier: m[2], member: m[3], session: m[4] || null } : null;
}

// Fire one `fleet send` (FYI: the PM needs no wake-up). Any failure is swallowed: opening or closing a card must never fail because of this.
function notify(event, fields) {
  if (off()) return { sent: false, why: 'off' };
  if (process.env.NODE_TEST_CONTEXT && !process.env.AUTOPILOT_FLEET_BIN) return { sent: false, why: 'node test without a stub' };
  const to = String(process.env.AUTOPILOT_CARD_NOTIFY_TO || '').trim();
  if (!to) return { sent: false, why: 'no target' };
  if (/^(off|0|none)$/i.test(to)) return { sent: false, why: 'off' };
  try {
    const r = spawnSync(bin(), ['send', to, encode(event, fields)], { encoding: 'utf8', timeout: 6000, env: { ...process.env, FLEET_FYI: '1', FLEET_SEND_WAIT_MS: '4000' } });
    if (r.error) return { sent: false, why: r.error.code === 'ENOENT' ? 'no fleet binary' : r.error.message };
    return r.status === 0 ? { sent: true, why: null } : { sent: false, why: `fleet send exit ${r.status}` };
  } catch (e) {
    return { sent: false, why: e.message };
  }
}

module.exports = { PREFIX, QUESTION_MAX, TITLE_MAX, CONTROL, STATES, encode, parse, parseFrom, notify };
