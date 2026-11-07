#!/usr/bin/env node
'use strict';
/**
 * decision-claim.js — the live pane's send step claims one decision card's answer with the fleet courier and prints the result as JSON.
 * Thin wrapper over scripts/lib/fleet-decision.js claim(); the pane (mods/live/register.ts, CLAIM_SCRIPTS) runs it by argument vector.
 *
 *   node scripts/decision-claim.js <card_id> --option <label>      # the picked option's label
 *   node scripts/decision-claim.js <card_id> --free-text <text>    # a typed answer
 * (the same pair as mods/live/model.ts decideAnswer: {option} | {freeText}.)
 *
 * stdout, one JSON line, exit 0 whenever it answered: { "ok": boolean, "answer_id": string|null, "reason": string|null }
 *   claimed                        -> ok true,  answer_id <id>,  reason null
 *   no courier that speaks `fleet decision` (probe 'unsupported') -> ok true, answer_id null: the pane sends the line without an id and the hook does not close the card (today's behaviour)
 *   probe failed / already answered / unknown card / card closed / courier unreachable / any other failure -> ok false, answer_id null, reason <short text>
 * Bad arguments exit 2 with {ok:false,...}. Node built-ins only. AUTOPILOT_FLEET_BIN, AUTOPILOT_CLAIM_RETRIES and AUTOPILOT_CLAIM_RETRY_MS are read by fleet-decision.js.
 */
const fd = require('./lib/fleet-decision');

const REASON = {
  already_answered: 'already answered',
  unknown: 'unknown card',
  card_closed: 'card closed',
  unreachable: 'courier unreachable',
};
const out = (o, rc) => { require('fs').writeSync(1, JSON.stringify(o) + '\n'); process.exit(rc); };

function main(argv) {
  const [card, flag, value, ...rest] = argv;
  if (!card || rest.length || value === undefined || (flag !== '--option' && flag !== '--free-text')) {
    return out({ ok: false, answer_id: null, reason: 'usage: decision-claim.js <card_id> --option <label> | --free-text <text>' }, 2);
  }
  const state = fd.probe();
  if (state === 'unsupported') return out({ ok: true, answer_id: null, reason: null }, 0);
  if (state !== 'supported') return out({ ok: false, answer_id: null, reason: 'courier probe failed' }, 0);
  const r = fd.claim(card, flag === '--option' ? { option: value } : { freeText: value });
  if (r.outcome === 'claimed') return out({ ok: true, answer_id: r.answer_id, reason: null }, 0);
  const reason = REASON[r.outcome] || (r.detail ? r.detail.split('\n')[0].slice(0, 120) : 'claim failed');
  return out({ ok: false, answer_id: null, reason }, 0);
}

main(process.argv.slice(2));
