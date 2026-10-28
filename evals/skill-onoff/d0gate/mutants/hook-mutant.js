'use strict';
// hook-mutant.js - a stand-in Stop hook for negative controls (NOT the real hooks/per-turn-gate.js).
//   node hook-mutant.js always-block   every Stop is blocked (the "wedged worker" mutation: no cap, never an allow)
//   node hook-mutant.js always-allow   every Stop is allowed (the "dead gate" mutation: the gate never bites)
// It writes the same record shape as the real hook ({session, turn, prompt_id, decision, reason, counter, source}) into
// $AUTOPILOT_LIVE_DIR/per-turn-gate/<session>.jsonl so the markers read it exactly like a real record.
const fs = require('fs');
const path = require('path');
const mode = process.argv[2];
let payload = {};
try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { /* none */ }
const dir = path.join(process.env.AUTOPILOT_LIVE_DIR, 'per-turn-gate');
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const block = mode === 'always-block';
const file = path.join(dir, `${payload.session_id}.jsonl`);
let n = 0;
try { n = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length; } catch { /* first */ }
fs.appendFileSync(file, `${JSON.stringify({ session: payload.session_id, turn: 1, prompt_id: payload.prompt_id || null, decision: block ? 'block' : 'allow', reason: block ? 'block' : 'clean', counter: block ? n + 1 : 0, source: 'session' })}\n`);
if (block) process.stdout.write(`${JSON.stringify({ decision: 'block', reason: 'mutant: always block' })}\n`);
