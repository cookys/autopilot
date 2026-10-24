// Recompute the derived evidence files from the committed excerpts and compare. Run inside this directory: node check-recompute.js
// Every missing input is a FAILURE (never skipped). Exit 0 only when all checks ran and passed.
'use strict';
const fs = require('fs');
const rd = (f) => fs.readFileSync(f, 'utf8');
let bad = 0, ran = 0;
const say = (ok, m) => { ran += 1; console.log((ok ? 'ok   ' : 'FAIL ') + m); if (!ok) bad = 1; };
const must = (f) => { if (fs.existsSync(f)) return true; say(false, 'missing input ' + f); return false; };

for (const f of ['readings.txt', 'call-times.txt', 'stop-events.txt', 'mishap-call.txt', 'README.md']) if (!must(f)) { console.log('FAILED: inputs missing'); process.exit(1); }
const readings = rd('readings.txt').split('\n');
const callRows = rd('call-times.txt').split('\n').filter((l) => /^t\d \|/.test(l)).map((l) => { const [t, sf, first] = l.split(' | '); return { t, sf, first, tag: (/^stream-(.*)\.jsonl$/.exec(sf) || [])[1] }; });
const stopLines = rd('stop-events.txt').split('\n').filter((l) => /^t\d /.test(l));
const trials = fs.readdirSync('raw-excerpts').filter((x) => /^t\d$/.test(x)).sort();
say(trials.length > 0, 'found trials: ' + trials.join(','));
let streamFiles = 0;
const results = []; // {t, tag, first, session, total}
for (const t of trials) {
  const d = 'raw-excerpts/' + t;
  // 1. hook decisions in readings.txt vs hook logs
  const sect = []; let on = false;
  for (const l of readings) { if (l === '## ' + t) { on = true; continue; } if (l.startsWith('## ')) on = false; if (on) sect.push(l); }
  const jl = sect.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
  const logs = fs.readdirSync(d).filter((x) => x.endsWith('hook.log'));
  const calc = [];
  for (const f of logs.sort()) for (const l of rd(d + '/' + f).trim().split('\n')) { const o = JSON.parse(l), s = o.stdin; calc.push({ call: o.call, decision: o.decision, session_id: s.session_id, prompt_id: s.prompt_id, stop_hook_active: s.stop_hook_active }); }
  say(JSON.stringify(jl) === JSON.stringify(calc), `${t}: ${calc.length} hook decision line(s) in readings.txt equal the hook logs`);
  // 2. per stream excerpt: debug partner must exist; first timestamp, stop-event count, result cost
  const streams = fs.readdirSync(d).filter((x) => /^stream-excerpt-.*\.jsonl$/.test(x)).sort();
  say(streams.length > 0, `${t}: ${streams.length} stream excerpt(s)`);
  for (const sx of streams) {
    streamFiles += 1;
    const tag = /^stream-excerpt-(.*)\.jsonl$/.exec(sx)[1];
    const dbgf = `${d}/debug-stop-lines-${tag}.txt`;
    if (!must(dbgf)) continue;
    const dbg = rd(dbgf);
    const row = callRows.find((r) => r.t === t && r.tag === tag);
    say(!!row, `${t}/${tag}: call-times.txt has a row`);
    const first = dbg.split('\n')[0].replace('first debug line: ', '');
    say(!!row && row.first === first, `${t}/${tag}: first debug timestamp ${first} equals call-times.txt`);
    const nDbg = (dbg.match(/Hooks: Stop \[.*finished with status/g) || []).length;
    const nStop = stopLines.filter((l) => l.startsWith(`${t} stream-${tag}.jsonl `)).reduce((a, l) => a + (l.match(/ status=\d+ /g) || []).length, 0);
    say(nDbg === nStop, `${t}/${tag}: ${nDbg} Stop hook execution(s) in debug excerpt equal ${nStop} in stop-events.txt`);
    const res = rd(`${d}/${sx}`).trim().split('\n').map(JSON.parse).filter((o) => o.type === 'result');
    say(res.length === 1, `${t}/${tag}: exactly one result event`);
    if (res.length === 1) results.push({ t, tag, first, session: res[0].session_id, total: res[0].total_cost_usd });
  }
}
say(streamFiles === callRows.length, `stream excerpts (${streamFiles}) equal call-times.txt rows (${callRows.length})`);
// 3. cost: per-call increment = total_cost_usd minus the previous total of the same session (ordered by start time)
results.sort((a, b) => (a.first < b.first ? -1 : 1));
const lastTotal = {}; let sum = 0; const parts = [];
for (const r of results) {
  const key = r.t + r.session; const inc = r.total - (lastTotal[key] || 0); lastTotal[key] = r.total;
  parts.push(`${r.t}/${r.tag}=${inc.toFixed(7)}`); sum += inc;
}
const m = /mishap_cost_usd=([0-9.]+)/.exec(rd('mishap-call.txt'));
say(!!m, 'mishap-call.txt carries mishap_cost_usd');
const mishap = m ? Number(m[1]) : 0; sum += mishap;
const costLine = readings.find((l) => l.startsWith('costs'));
const ms = costLine && /sum=([0-9.]+)/.exec(costLine);
say(!!ms && Math.abs(Number(ms[1]) - sum) < 1e-9, `readings.txt cost sum ${ms && ms[1]} equals recomputed ${sum.toFixed(7)} (${parts.join(', ')}, mishap ${mishap})`);
say(rd('README.md').includes(sum.toFixed(4)), `README.md states the total ${sum.toFixed(4)}`);
say(sum < 1, 'total below the 1 USD cap');
console.log(`${ran} checks ran, ${bad ? 'FAILED' : 'all passed'}`);
process.exit(bad);
