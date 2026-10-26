#!/usr/bin/env node
'use strict';
// Throwaway probe hook (no autopilot code). argv: <event> <wired-by label>.
// Routing simulation: blocks only when P0_ARM=1 (and, if P0_ARM_SID is set, stdin.session_id equals it,
// "*" = any) AND stdin.stop_hook_active is not true AND (P0_ONLY unset or equals event).
// Every call appends one JSON line (full stdin, cwd facts, internal wall time) to $P0_LOG.
const fs = require('fs');
const t0 = Date.now();
const event = process.argv[2] || '?';
const wired = process.argv[3] || '?';
let raw = ''; try { raw = fs.readFileSync(0, 'utf8'); } catch (e) {}
let stdin; try { stdin = JSON.parse(raw); } catch (e) { stdin = { unparsed: raw }; }
const armed = process.env.P0_ARM === '1';
const sid = process.env.P0_ARM_SID;
const sidOk = !sid || sid === '*' || (stdin && stdin.session_id === sid);
const eventOk = !process.env.P0_ONLY || process.env.P0_ONLY === event;
let out = '', why = 'allow';
if (!armed) why = 'allow(unarmed)';
else if (!eventOk) why = 'allow(event-not-gated)';
else if (!sidOk) why = 'allow(session-id-mismatch)';
else if (stdin && stdin.stop_hook_active === true) why = 'allow(stop_hook_active)';
else { why = 'block'; out = JSON.stringify({ decision: 'block', reason: 'REASON: before stopping, reply with the single word ALPHA.' }); }
let cwdExists = null; try { cwdExists = !!(stdin && stdin.cwd && fs.existsSync(stdin.cwd)); } catch (e) {}
const rec = { ts: new Date(t0).toISOString(), event, wired_by: wired, decision: why, stdout: out, process_cwd: process.cwd(), stdin_cwd_exists: cwdExists, stdin, hook_wall_ms: Date.now() - t0 };
if (process.env.P0_LOG) fs.appendFileSync(process.env.P0_LOG, JSON.stringify(rec) + '\n');
if (out) process.stdout.write(out);
process.exit(0);
