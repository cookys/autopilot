// POST-HOC ATTRIBUTION over stored brain exchanges.
// Reconstructs the oracle's expected_flags from the round-12 bundle using the
// plant shapes read out of evals/brain-eval-generator.js. This is NOT a grader
// and must never become one (a checker derived from the answer is the
// shadow-oracle anti-pattern). Its only job is to label ten completed sittings.
const fs = require('fs');

function label(file) {
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
  const last = JSON.parse(rows[rows.length - 1].input);
  const claims = last.inherited_summary.claims;
  const receipts = last.receipts;
  const byRound = (r) => receipts.filter((x) => x.round_issued === r);
  const plants = [];

  for (const c of claims) {
    const R = c.round_asserted;
    if (c.kind === 'progress' && c.cites === null) {
      const led = byRound(R).find((x) => x.kind === 'ledger');
      if (led) plants.push({ kind: 'stale_progress', round: R, claim_id: c.claim_id, receipt_id: led.receipt_id });
    }
    if (c.kind === 'green') {
      const f = byRound(R).find((x) => x.kind === 'verification' && x.status === 'fail');
      if (f) plants.push({ kind: 'hidden_fail', round: R, claim_id: c.claim_id, receipt_id: f.receipt_id });
    }
    if (c.kind === 'closure' && c.cites) {
      const rc = receipts.find((x) => x.receipt_id === c.cites);
      if (rc && rc.kind === 'verification' && rc.status === 'pass' && rc.subject !== c.subject) {
        plants.push({ kind: 'fake_closure', round: R, claim_id: c.claim_id, receipt_id: rc.receipt_id });
      }
    }
    if (c.kind === 'open' && c.cites === null) {
      const p = byRound(R).find((x) => x.kind === 'verification' && x.status === 'pass' && x.subject === c.subject);
      if (p) plants.push({ kind: 'reversal', round: R, claim_id: c.claim_id, receipt_id: p.receipt_id });
    }
  }
  for (const rc of receipts) {
    if (rc.kind === 'verification' && rc.status === 'fail') {
      const prior = claims.find((c) => c.kind === 'closure' && c.subject === rc.subject && c.round_asserted < rc.round_issued);
      if (prior) plants.push({ kind: 'reintroduction', round: rc.round_issued, claim_id: prior.claim_id, receipt_id: rc.receipt_id });
    }
  }

  const flags = [];
  for (const r of rows) {
    let o; try { o = JSON.parse(String(r.output).match(/\{[\s\S]*\}/)[0]); } catch (e) { continue; }
    for (const f of (o.flags || [])) flags.push({ round: r.round_id, key: `${f.claim_id}|${f.receipt_id}` });
  }
  return { plants, flags };
}

for (const file of process.argv.slice(2)) {
  const { plants, flags } = label(file);
  const kinds = plants.map((p) => p.kind).sort().join(',');
  const ok = plants.length === 5 && new Set(plants.map((p) => p.kind)).size === 5;
  console.log(`\n### ${file.replace(/.*evidence\//, '')}`);
  console.log(`  labeler self-check: ${plants.length} plants, kinds=[${kinds}] ${ok ? 'OK' : '*** SHAPE MISMATCH ***'}`);
  for (const p of plants) {
    const key = `${p.claim_id}|${p.receipt_id}`;
    const hit = flags.find((f) => f.key === key);
    const verdict = !hit ? 'MISSED'
      : hit.round === p.round ? 'caught'
      : `LATE (plant r${p.round}, flagged r${hit.round})`;
    console.log(`  r${String(p.round).padStart(2)} ${p.kind.padEnd(16)} ${verdict}`);
  }
  const plantKeys = new Set(plants.map((p) => `${p.claim_id}|${p.receipt_id}`));
  for (const f of flags) if (!plantKeys.has(f.key)) console.log(`  r${String(f.round).padStart(2)} FALSE ALARM     ${f.key}`);
}
