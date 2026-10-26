#!/usr/bin/env node
'use strict';
// summarize.js <OUT> : writes OUT/summary.json (produced / not produced per probe case) and prints it.
const fs = require('fs'), path = require('path');
const OUT = process.argv[2]; const cases = {};
const spend = JSON.parse(fs.readFileSync(path.join(OUT, 'spend.json'), 'utf8'));
const cap = parseFloat(process.env.PROBE_MAX_USD || '1.0');
for (const p of fs.readdirSync(OUT)) {
  const pd = path.join(OUT, p); if (!fs.statSync(pd).isDirectory()) continue;
  for (const c of fs.readdirSync(pd)) {
    const cd = path.join(pd, c); const rj = path.join(cd, 'run.json'), sk = path.join(cd, 'skipped.json');
    if (fs.existsSync(sk)) { cases[c] = { status: 'not run', reason: JSON.parse(fs.readFileSync(sk)).reason }; continue; }
    if (!fs.existsSync(rj)) { cases[c] = { status: 'not produced', reason: 'no run.json' }; continue; }
    const r = JSON.parse(fs.readFileSync(rj));
    const armed = /_armed$/.test(c);
    const fired = r.hook_calls > 0;
    let status = 'not produced', note = '';
    if (r.is_error === null) note = 'no result event';
    else if (armed) status = fired && r.blocked > 0 && r.continued_after_block ? 'produced' : 'not produced';
    else { status = fired && r.blocked === 0 ? 'produced' : 'not produced'; if (!fired) note = 'hook did not fire, so "not blocked" proves nothing'; }
    cases[c] = { status, note, hook_calls: r.hook_calls, blocked: r.blocked, continued_after_block: r.continued_after_block, decisions: r.decisions,
      session_id_init: r.session_id_init, hook_stdin_matches_expected: r.hook_stdin_matches_expected, first_fire_calls_by_wiring: r.first_fire_calls_by_wiring,
      agent_id_equal: r.agent_id_equal, hook_agent_ids: r.hook_agent_ids, tool_result_agent_ids: r.tool_result_agent_ids,
      parent_session_in_subagent_hook: r.parent_session_in_subagent_hook, stdin_has_cwd: r.stdin_has_cwd, hook_wall_ms: r.hook_wall_ms,
      hook_stdin_keys: r.hook_stdin_keys, cost_usd: r.total_cost_usd };
  }
}
const s = { total_cost_usd: spend.total, cap_usd: cap, cap_reached: spend.total >= cap, cases };
try { s.note = fs.readFileSync(path.join(OUT, 'note.txt'), 'utf8').trim(); } catch (e) {}
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(s, null, 2) + '\n');
process.stdout.write(JSON.stringify(s, null, 2) + '\n');
