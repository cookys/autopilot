'use strict';

// A ticket's spend is split across the new ledger (AUTOPILOT_STATE_DIR) and the legacy runtime ledger.
// The cap must see the sum, not whichever file happens to be readable first.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const HOOK = path.resolve(__dirname, '../subagent-budget.js');

function spend(ticket, newRows, oldRows) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-two-'));
  const state = path.join(tmp, 'state');
  const live = path.join(tmp, 'live');
  const write = (dir, rows) => {
    if (!rows) return;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'ticket-usage.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  };
  write(path.join(state, 'subagent-budget'), newRows);
  fs.mkdirSync(live, { recursive: true, mode: 0o700 });
  fs.chmodSync(live, 0o700);
  write(path.join(live, 'subagent-budget'), oldRows);
  const res = spawnSync(process.execPath, ['-e',
    `process.stdout.write(String(require(${JSON.stringify(HOOK)}).ticketLedgerSpend(${JSON.stringify(ticket)})))`], {
    encoding: 'utf8',
    env: { ...process.env, HOME: tmp, AUTOPILOT_LIVE_DIR: live, AUTOPILOT_STATE_DIR: state },
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.equal(res.status, 0, res.stderr);
  return Number(res.stdout);
}

const row = (session, subagent, usd, ticket = 'T1') => ({ ticket, session, subagent, usd });

test('ticket spend is the sum of the new and the legacy ledger', () => {
  assert.equal(spend('T1', [row('s1', 'a', 13.34)], [row('s2', 'b', 13.23)]).toFixed(2), '26.57');
});

test('the same session+subagent in both ledgers counts once, the new ledger wins', () => {
  assert.equal(spend('T1', [row('s1', 'a', 5)], [row('s1', 'a', 3)]), 5);
});

test('only one ledger present still works', () => {
  assert.equal(spend('T1', [row('s1', 'a', 2)], null), 2);
  assert.equal(spend('T1', null, [row('s1', 'a', 4)]), 4);
});
