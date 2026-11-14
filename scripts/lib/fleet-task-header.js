#!/usr/bin/env node
// fleet-task-header.js — the one shared X-Fleet-Task validator (S2 gateway join, 2026-11-14).
//
// A GPU-host model gateway logs per-request speed and joins it to fleet tasks by the HTTP
// header `X-Fleet-Task: <fleet task id>`. The id reaches the rails as the env var
// AUTOPILOT_UPSTREAM_TASK_ID (the same value dispatch-usage.js records as upstream.task_id).
// Every gateway-bound call site resolves the header HERE; the ULID check is never inlined
// elsewhere — ANTHROPIC_CUSTOM_HEADERS is newline-separated, so an unvalidated value could
// inject extra headers onto every request a child makes.
//
// Rule (V = AUTOPILOT_UPSTREAM_TASK_ID):
//   V is a ULID (Crockford base32, 26 chars) -> the request carries X-Fleet-Task: V.
//   V unset or empty                          -> no X-Fleet-Task header at all.
//   V set but not a ULID                      -> no header, and one stderr line
//       `<rail>: AUTOPILOT_UPSTREAM_TASK_ID is not a ULID; X-Fleet-Task not sent`.
//
// CLI (the bash rails): node lib/fleet-task-header.js --rail <rail-name>
//   stdout: the ANTHROPIC_CUSTOM_HEADERS value (`X-Fleet-Task: V`) or nothing.
//   stderr: the refusal line above when V is set but invalid.
//   exit 0 in every case — a bad id degrades to no header, never a failed dispatch.
//
// API (the Node dispatchers):
//   resolveFleetTask(value) -> { ok: boolean, id: string }
//     ok:true,  id:''       unset/empty — send no header
//     ok:true,  id:'<ULID>' send `X-Fleet-Task: <ULID>`
//     ok:false, id:''       send nothing; print warnLine('<rail>') once
//   headerLine(id) -> 'X-Fleet-Task: <id>' or '' (the ANTHROPIC_CUSTOM_HEADERS value)
//   warnLine(rail) -> the exact stderr refusal line
'use strict';

// Crockford base32: digits and letters minus I, L, O, U.
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const HEADER_NAME = 'X-Fleet-Task';
const SOURCE_ENV = 'AUTOPILOT_UPSTREAM_TASK_ID';

function resolveFleetTask(value) {
  if (value === undefined || value === null || value === '') return { ok: true, id: '' };
  return ULID_RE.test(value) ? { ok: true, id: value } : { ok: false, id: '' };
}

function headerLine(id) {
  return id ? `${HEADER_NAME}: ${id}` : '';
}

function warnLine(rail) {
  return `${rail}: ${SOURCE_ENV} is not a ULID; ${HEADER_NAME} not sent`;
}

module.exports = { HEADER_NAME, SOURCE_ENV, resolveFleetTask, headerLine, warnLine };

if (require.main === module) {
  const railIndex = process.argv.indexOf('--rail');
  const rail = (railIndex !== -1 && process.argv[railIndex + 1]) || 'dispatch';
  const { ok, id } = resolveFleetTask(process.env[SOURCE_ENV]);
  if (!ok) process.stderr.write(`${warnLine(rail)}\n`);
  const line = headerLine(id);
  if (line) process.stdout.write(`${line}\n`);
}
