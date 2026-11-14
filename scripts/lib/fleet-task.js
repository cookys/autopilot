'use strict';

/**
 * fleet-task.js — mark a fleet task blocked on a target.
 *
 *   blocked(taskId, blockedOn, note)  ->  { ok: true } | { ok: false, status, error }
 *   ownerAddress()                    ->  'ns/courier/member' | null
 *
 * Binary: FLEET_BIN, or `fleet` on PATH when that is unset.
 * Verb: `fleet task progress <id> blocked --blocked-on <target> [note]`; target is a member address, a `d-xxxxxxxx`
 * card id or a task id, anything else is refused by fleet with `blocked_on_invalid` (surfaced as the error).
 * Owner address: env FLEET_ADDRESS (any `@session` suffix stripped: --blocked-on takes the bare seat), else the `address:` line of `fleet whoami` unless it is the CLI's own identity (`this CLI's identity` / member `fleet-cli`); null when neither gives
 * a `ns/courier/member` triple (never guessed).
 * Tests point FLEET_BIN at a stub. This module never sends a message.
 * Node >= 20.10, built-ins only.
 */

const { spawnSync } = require('child_process');

function bin() {
  return process.env.FLEET_BIN || 'fleet';
}

function run(args) {
  const r = spawnSync(bin(), args, { encoding: 'utf8', timeout: 15000 });
  if (r.error) return { ok: false, status: null, error: r.error.message };
  if (r.status !== 0) {
    const detail = (r.stderr || '').trim().split('\n')[0];
    return { ok: false, status: r.status, error: detail || `exit ${r.status}`, stdout: r.stdout };
  }
  return { ok: true, stdout: r.stdout };
}

function blocked(taskId, blockedOn, note) {
  const args = ['task', 'progress', String(taskId), 'blocked', '--blocked-on', String(blockedOn)];
  if (note) args.push(String(note));
  return run(args);
}

const ADDR_RE = /^[^/\s]+\/[^/\s]+\/[^/\s]+$/;

function ownerAddress() {
  const env = (process.env.FLEET_ADDRESS || '').trim().replace(/@.*$/, '');
  if (ADDR_RE.test(env)) return env;
  const r = run(['whoami']);
  if (!r.ok) return null;
  const line = /^address:.*$/m.exec(r.stdout || '');
  if (!line || /this CLI's identity/.test(line[0])) return null;
  const m = /^address:\s+(\S+)/.exec(line[0]);
  return m && ADDR_RE.test(m[1]) && m[1].split('/')[2] !== 'fleet-cli' ? m[1] : null;
}

module.exports = { blocked, ownerAddress, bin };
