#!/usr/bin/env bash
# BL-0187: the Kimi Code engine has two spellings (`kimi-code-k3` / `kimi-code/k3`). The scorecard
# READ side (BL-0157) already treats them as one seat; this pins the remaining comparators --
# adopt's --seat filter and local-evidence collision check, adopt's advertised seat_hash check,
# and the scorecard `current` grouping -- plus the negative controls (different models stay two
# seats) and the no-drift rule (seat_hash inputs are NOT rewritten). Fixture stores only.
. "$(dirname "$0")/lib.sh"

ARTIFACT="$REPO_ROOT/references/official-qualification-defaults.json"
ADOPT="$REPO_ROOT/scripts/adopt-qualification-defaults.js"
SCORECARD="$REPO_ROOT/scripts/engine-scorecard.js"
HELPER="$TEST_TMP/helper.js"

cat >"$HELPER" <<'JS'
const fs = require('fs');
const crypto = require('crypto');
const [cmd, ...a] = process.argv.slice(2);
if (cmd === 'hash') {
  const [engine, runner, role, effort] = a;
  const o = { engine, runner, role, ...(effort ? { effort } : {}) };
  process.stdout.write(crypto.createHash('sha256').update(JSON.stringify(o, Object.keys(o).sort()), 'utf8').digest('hex'));
} else if (cmd === 'artifact') {
  // artifact <src> <out> <advertised-hash>: the grok-4.5 implementer entry re-labelled kimi-code/k3.
  const art = JSON.parse(fs.readFileSync(a[0], 'utf8'));
  const e = art.defaults.find((d) => d.seat.engine === 'grok-4.5' && d.role === 'implementer');
  e.seat.engine = 'kimi-code/k3';
  e.row.engine = 'kimi-code/k3';
  e.seat_hash = a[2];
  art.defaults = [e];
  fs.writeFileSync(a[1], JSON.stringify(art));
} else if (cmd === 'feed') {
  // feed <sample-feed> <out> <advertised-hash>: its first default re-labelled kimi-code/k3.
  const feed = JSON.parse(fs.readFileSync(a[0], 'utf8'));
  const e = feed.defaults[0];
  e.seat.engine = 'kimi-code/k3';
  e.row.engine = 'kimi-code/k3';
  const eff = e.seat.effort === undefined ? e.administration.effort : e.seat.effort;
  const o = { engine: a[2], runner: e.seat.runner, role: e.seat.role, ...(eff ? { effort: eff } : {}) };
  e.seat_hash = crypto.createHash('sha256').update(JSON.stringify(o, Object.keys(o).sort()), 'utf8').digest('hex');
  feed.defaults = [e];
  feed.strikes = [];
  feed.priors = [];
  fs.writeFileSync(a[1], JSON.stringify(feed));
} else if (cmd === 'basis') {
  // basis: stdin = `list --json`; prints defaults[0].applicability.seat_hash_basis.
  const d = JSON.parse(fs.readFileSync(0, 'utf8'));
  const o = d.defaults[0].applicability;
  process.stdout.write(`${o.seat_hash_basis},${o.seat_hash_derived === d.defaults[0].seat_hash ? 'same' : 'differs'}`);
} else if (cmd === 'localrow') {
  // localrow <artifact> <engine> <out>: a local self-qualified row for that engine spelling.
  const art = JSON.parse(fs.readFileSync(a[0], 'utf8'));
  const row = { ...art.defaults[0].row };
  delete row.provenance;
  row.engine = a[1];
  row.event_id = 1;
  fs.writeFileSync(a[2], JSON.stringify(row) + '\n');
} else if (cmd === 'scorecard') {
  const mk = (id, engine) => JSON.stringify({
    event_id: id, engine, runner: 'kimi', role: 'reviewer', status: 'failed', date: '2026-10-01',
    capability_score: 0.5, family: 'x', cost: { source: 'unknown' }, model_version: 'v1',
    corpus_version: 'c1', harness_version: 'h1', runner_version: 'r1', prompt_config_hash: 'p1',
  });
  fs.writeFileSync(a[0], [mk(1, 'kimi-code-k3'), mk(2, 'kimi-code/k3'), mk(3, 'kimi-code/a'), mk(4, 'kimi-code/b')].join('\n') + '\n');
} else if (cmd === 'count') {
  // count: stdin = `current` JSON; prints "<k3 rows>,<total rows>".
  const d = JSON.parse(fs.readFileSync(0, 'utf8'));
  const rows = Array.isArray(d) ? d : (d.rows || d.current || []);
  process.stdout.write(`${rows.filter((r) => /^kimi-code[/-]k3$/.test(r.engine)).length},${rows.length}`);
}
JS

H_SLASH="$(node "$HELPER" hash kimi-code/k3 grok implementer high)"
H_HYPHEN="$(node "$HELPER" hash kimi-code-k3 grok implementer high)"
H_OTHER="$(node "$HELPER" hash kimi-code/other grok implementer high)"
assert_neq "$H_SLASH" "$H_HYPHEN" "premise: the two spellings hash differently"

ART="$TEST_TMP/art.json"
node "$HELPER" artifact "$ARTIFACT" "$ART" "$H_HYPHEN"

# --- adopt --seat: either spelling selects the entry; a different model does not ---------------
OUT=$(node "$ADOPT" adopt --seat kimi-code/k3:grok --role implementer --artifact "$ART" \
  --store "$TEST_TMP/s1" --capability-store "$TEST_TMP/c1" --dry-run 2>&1)
assert_not_contains "$OUT" "nothing_to_adopt" "adopt --seat kimi-code/k3 selects the entry (dry-run)"
OUT=$(node "$ADOPT" adopt --seat kimi-code-k3:grok --role implementer --artifact "$ART" \
  --store "$TEST_TMP/s2" --capability-store "$TEST_TMP/c2" --dry-run 2>&1)
assert_not_contains "$OUT" "nothing_to_adopt" "adopt --seat kimi-code-k3 selects the same entry (dry-run)"
OUT=$(node "$ADOPT" adopt --seat kimi-code/other:grok --role implementer --artifact "$ART" \
  --store "$TEST_TMP/s3" --capability-store "$TEST_TMP/c3" --dry-run 2>&1)
assert_contains "$OUT" "nothing_to_adopt" "NEG: --seat kimi-code/other selects nothing (a different model is a different seat)"

# --- adopt collision: a local row under the OTHER spelling is local evidence on the same seat ---
mkdir -p "$TEST_TMP/s-hy" "$TEST_TMP/s-other"
node "$HELPER" localrow "$ART" kimi-code-k3 "$TEST_TMP/s-hy/scorecard.jsonl"
OUT=$(node "$ADOPT" adopt --seat kimi-code/k3:grok --role implementer --artifact "$ART" \
  --store "$TEST_TMP/s-hy" --capability-store "$TEST_TMP/c-hy" 2>&1)
assert_exit_code "$?" "1" "a hyphen-spelled local row blocks adopting the slash-spelled default"
assert_contains "$OUT" "refused_local_evidence_present" "the refusal names local evidence"
node "$HELPER" localrow "$ART" kimi-code/other "$TEST_TMP/s-other/scorecard.jsonl"
OUT=$(node "$ADOPT" adopt --seat kimi-code/k3:grok --role implementer --artifact "$ART" \
  --store "$TEST_TMP/s-other" --capability-store "$TEST_TMP/c-other" --dry-run 2>&1)
assert_not_contains "$OUT" "refused_local_evidence_present" "NEG: a local kimi-code/other row does not collide with kimi-code/k3"

# --- advertised seat_hash (feed path): either spelling's hash agrees; a different model's does not
SAMPLE="$REPO_ROOT/docs/plans/evidence/2026-09-02-qualification-feed/sample-feed.json"
node "$HELPER" feed "$SAMPLE" "$TEST_TMP/feed-ok.json" kimi-code-k3
node "$HELPER" feed "$SAMPLE" "$TEST_TMP/feed-bad.json" kimi-code/other
OUT=$(node "$ADOPT" list --from "$TEST_TMP/feed-ok.json" --feed-cache-dir "$TEST_TMP/fc" --json 2>&1 | node "$HELPER" basis)
assert_eq "${OUT%%,*}" "agrees" "a hyphen-spelled advertised hash on a slash-spelled seat agrees"
assert_eq "${OUT#*,}" "differs" "no drift: the re-derived seat_hash is still the raw slash-spelling hash, not the advertised hyphen one"
OUT=$(node "$ADOPT" list --from "$TEST_TMP/feed-bad.json" --feed-cache-dir "$TEST_TMP/fc" --json 2>&1 | node "$HELPER" basis)
assert_eq "${OUT%%,*}" "unknown" "NEG: a kimi-code/other advertised hash is still a mismatch"

# --- scorecard current: both spellings of one seat are ONE row; different models stay separate --
mkdir -p "$TEST_TMP/sc"
node "$HELPER" scorecard "$TEST_TMP/sc/scorecard.jsonl"
CUR=$(ENGINE_SCORECARD_DIR="$TEST_TMP/sc" ENGINE_CAPABILITY_DIR="$TEST_TMP/cap" \
  node "$SCORECARD" current --role reviewer --now 2026-10-15 2>&1)
assert_eq "$(printf '%s' "$CUR" | node "$HELPER" count)" "1,3" \
  "scorecard current: k3 spellings collapse to one row; kimi-code/a and kimi-code/b stay separate"

finalize_test
