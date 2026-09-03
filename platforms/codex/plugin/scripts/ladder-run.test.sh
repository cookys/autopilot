#!/usr/bin/env bash
set -euo pipefail
# Self-test for ladder-run.sh — sampling, emission, per-class report/promotion, state
# persistence, plus the depth-0 QC regressions: C1 endorsement-as-fraction gate, C2 escape
# recorded via `audit` counts as a class escape, H1 sampling not evadable via change_id, H2
# calculator-failure is fail-closed (no PROMOTE) with no store/state divergence. Uses the
# --mock-verdict TEST seam (no live engine) + the authoritative qc_metric.py.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LADDER="$HERE/ladder-run.sh"; EMIT="$HERE/qc-metric-emit.js"
QC_PY="${QC_METRIC_PY:-$HOME/projects/llm-playground/qc-metrics/qc_metric.py}"
FAIL=0
note() { printf '  %s\n' "$*"; }
ok()   { printf 'ok   %s\n' "$*"; }
bad()  { printf 'FAIL %s\n' "$*"; FAIL=1; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# Regression: the live implementer path must verify the implementer's returned commit,
# not the caller's current HEAD. dispatch-hetero removes successful worktrees by default
# and emits worktree:null, so ladder-run must use `.commit` directly.
IMPL_SBX="$TMP/impl-repo"
mkdir -p "$IMPL_SBX"
git -C "$IMPL_SBX" init -q -b develop
git -C "$IMPL_SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
IMPL_BASE="$(git -C "$IMPL_SBX" rev-parse HEAD)"
IMPL_PROMPT="$TMP/impl-prompt.md"; echo "make one committed change" > "$IMPL_PROMPT"
IMPL_STATE="$TMP/impl-state.json"
cat > "$IMPL_STATE" <<'JSON'
{ "version":1, "policy":{ "escape_rate_max":0.10, "endorsement_rate_min":0.90,
  "min_samples":5, "t1_sample_rate":0.30, "demote_on_escape":true },
  "classes":{ "doc-sync":{ "tier":"T0","description":"t","change_ids":[],"cycles":[] } } }
JSON
IMPL_BIN="$TMP/impl-bin"
mkdir -p "$IMPL_BIN"
cp "$LADDER" "$IMPL_BIN/ladder-run.sh"
: > "$IMPL_BIN/qc-metric-emit.js"
cat > "$IMPL_BIN/dispatch-hetero.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
branch=""; base=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --branch) branch="$2"; shift 2 ;;
    --base) base="$2"; shift 2 ;;
    *) if [ "$#" -ge 2 ] && [[ "${2:-}" != --* ]]; then shift 2; else shift; fi ;;
  esac
done
[ -n "$branch" ] && [ -n "$base" ] || exit 2
idx="$(mktemp)"
GIT_INDEX_FILE="$idx" git read-tree "$base"
blob="$(printf 'implemented\n' | git hash-object -w --stdin)"
GIT_INDEX_FILE="$idx" git update-index --add --cacheinfo "100644,$blob,implemented.txt"
tree="$(GIT_INDEX_FILE="$idx" git write-tree)"
impl_commit="$(GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t git commit-tree "$tree" -p "$base" -m "test: implement")"
rm -f "$idx"
out_commit="$impl_commit"
case "${FAKE_IMPL_MODE:-ok}" in
  stale-tip)
    stale_idx="$(mktemp)"
    GIT_INDEX_FILE="$stale_idx" git read-tree "$base"
    stale_blob="$(printf 'stale\n' | git hash-object -w --stdin)"
    GIT_INDEX_FILE="$stale_idx" git update-index --add --cacheinfo "100644,$stale_blob,stale.txt"
    stale_tree="$(GIT_INDEX_FILE="$stale_idx" git write-tree)"
    out_commit="$(GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t git commit-tree "$stale_tree" -p "$base" -m "test: stale")"
    rm -f "$stale_idx"
    ;;
  unrelated)
    unrelated_idx="$(mktemp)"
    GIT_INDEX_FILE="$unrelated_idx" git read-tree --empty
    unrelated_blob="$(printf 'unrelated\n' | git hash-object -w --stdin)"
    GIT_INDEX_FILE="$unrelated_idx" git update-index --add --cacheinfo "100644,$unrelated_blob,unrelated.txt"
    unrelated_tree="$(GIT_INDEX_FILE="$unrelated_idx" git write-tree)"
    out_commit="$(GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t git commit-tree "$unrelated_tree" -m "test: unrelated")"
    rm -f "$unrelated_idx"
    ;;
esac
git update-ref "refs/heads/$branch" "$impl_commit"
[ "${FAKE_IMPL_MODE:-ok}" = "unrelated" ] && git update-ref "refs/heads/$branch" "$out_commit"
printf '{ "status": "committed", "runner": "fake", "model": "fake", "branch": "%s", "base": "%s", "commit": "%s", "files_changed": 1, "insertions": 1, "deletions": 0, "worktree": null, "agent_log": "/tmp/fake", "error": null }\n' "$branch" "$base" "$out_commit"
EOF
chmod +x "$IMPL_BIN/dispatch-hetero.sh"
set +e
IMPL_OUT="$(cd "$IMPL_SBX" && "$IMPL_BIN/ladder-run.sh" run --task-class doc-sync --change-id impl-null-wt \
  --repo testrepo --base-sha "$IMPL_BASE" --head-sha "$IMPL_BASE" --impl-prompt-file "$IMPL_PROMPT" \
  --branch feat/impl-null-wt --state-file "$IMPL_STATE" --mock-verdict SHIP-AS-IS --dry-run 2>&1)"
IMPL_RC=$?
set -e
if [ "$IMPL_RC" = "0" ] && grep -q 'DRY-RUN: would emit' <<<"$IMPL_OUT"; then
  ok "impl path uses returned commit when dispatch-hetero emits worktree:null"
else
  bad "impl path failed with worktree:null returned commit (rc=$IMPL_RC): $IMPL_OUT"
fi
set +e
STALE_OUT="$(cd "$IMPL_SBX" && FAKE_IMPL_MODE=stale-tip "$IMPL_BIN/ladder-run.sh" run --task-class doc-sync --change-id impl-stale-tip \
  --repo testrepo --base-sha "$IMPL_BASE" --head-sha "$IMPL_BASE" --impl-prompt-file "$IMPL_PROMPT" \
  --branch feat/impl-stale-tip --state-file "$IMPL_STATE" --mock-verdict SHIP-AS-IS --dry-run 2>&1)"
STALE_RC=$?
set -e
if [ "$STALE_RC" != "0" ] && grep -q 'but refs/heads/feat/impl-stale-tip points to' <<<"$STALE_OUT"; then
  ok "impl path rejects returned commits that are not the requested branch tip"
else
  bad "impl path accepted a stale non-tip commit (rc=$STALE_RC): $STALE_OUT"
fi
set +e
UNRELATED_OUT="$(cd "$IMPL_SBX" && FAKE_IMPL_MODE=unrelated "$IMPL_BIN/ladder-run.sh" run --task-class doc-sync --change-id impl-unrelated \
  --repo testrepo --base-sha "$IMPL_BASE" --head-sha "$IMPL_BASE" --impl-prompt-file "$IMPL_PROMPT" \
  --branch feat/impl-unrelated --state-file "$IMPL_STATE" --mock-verdict SHIP-AS-IS --dry-run 2>&1)"
UNRELATED_RC=$?
set -e
if [ "$UNRELATED_RC" != "0" ] && grep -q 'does not descend from base' <<<"$UNRELATED_OUT"; then
  ok "impl path rejects returned commits that do not descend from base"
else
  bad "impl path accepted an unrelated returned commit (rc=$UNRELATED_RC): $UNRELATED_OUT"
fi

[ -f "$QC_PY" ] || {
  echo "SKIP qc_metric-dependent ladder tests — qc_metric.py not found at $QC_PY"
  [ "$FAIL" = "0" ] && exit 0 || exit 1
}

STORE="$TMP/events.jsonl"; : > "$STORE"
STATE="$TMP/state.json"
mkstate() { cat > "$STATE" <<JSON
{ "version":1, "policy":{ "escape_rate_max":0.10, "endorsement_rate_min":0.90,
  "min_samples":5, "t1_sample_rate":0.30, "demote_on_escape":true },
  "classes":{ "doc-sync":{ "tier":"T0","description":"t","change_ids":[],"cycles":[] },
              "endtest":{ "tier":"T1","description":"t","change_ids":$1,"cycles":[] } } }
JSON
}
mkstate '[]'
DIFF="$TMP/change.diff"; printf -- '--- a/x.md\n+++ b/x.md\n@@ -1 +1 @@\n-old\n+new\n' > "$DIFF"
run() { "$LADDER" run --task-class doc-sync --repo testrepo --base-sha B --head-sha H \
  --diff-file "$DIFF" --state-file "$STATE" --store "$STORE" --qc-metric-py "$QC_PY" --lenses doc-accuracy "$@"; }

# 1. pass verdict emits + updates state
OUT=$(run --change-id chg-1 --mock-verdict SHIP-AS-IS 2>&1) || true
{ grep -q 'committed .*event' <<<"$OUT" && grep -q 'chg-1' "$STORE"; } && ok "pass verdict emits QC event (atomically committed)" || bad "no emit on pass ($OUT)"
[ "$(jq -r '.classes["doc-sync"].change_ids | length' "$STATE")" = "1" ] && ok "state records change_id" || bad "change_id not recorded"
[ "$(jq -r '[.classes["doc-sync"].cycles[]|select(.verdict=="pass")]|length' "$STATE")" = "1" ] && ok "cycle verdict=pass persisted" || bad "verdict wrong"

# 2. HOLD@T0 on a single clean cycle (no premature promote)
grep -q 'HOLD@T0' <<<"$(jq -r '.classes["doc-sync"].cycles[0].promotion' "$STATE")" \
  && ok "single clean cycle HOLDs at T0" || bad "expected HOLD@T0 on first cycle"

# 3. dry-run writes nothing
BEFORE=$(wc -l < "$STORE"); run --change-id dry-1 --mock-verdict SHIP-AS-IS --dry-run >/dev/null 2>&1 || true
[ "$BEFORE" = "$(wc -l < "$STORE")" ] && ok "dry-run does not write the store" || bad "dry-run wrote store"

# 4. L1: a FAIL verdict is autonomous=false (does not dilute endorsement denominator)
run --change-id chg-fail --mock-verdict FIX-THEN-SHIP >/dev/null 2>&1 || true
# absent `autonomous` == false to the calculator; the point is it must NOT be an autonomous
# ship (else a rejected change dilutes the endorsement denominator).
AUTON_FAIL=$(jq -r 'select(.change_id=="chg-fail").autonomous // false' "$STORE" 2>/dev/null | head -1)
[ "$AUTON_FAIL" != "true" ] \
  && ok "L1: FAIL verdict not an autonomous ship (autonomous=${AUTON_FAIL}) — excluded from endorsement denom" \
  || bad "L1: FAIL wrongly recorded autonomous=true"

# 4b. --gate-cmd: MECHANICAL oracle in-cycle, union with the LLM verdict (2026-09-03)
#     (a) LLM pass + gate pass  → panel pass, gate_verdict recorded
#     (b) LLM pass + gate FAIL  → panel FAIL with a `mechanical-gate-failed` finding carrying
#         the gate's output tail — the diff-only verifier's blind spot (a claim outside the diff)
#     (c) gate runs in --gate-dir (cwd), not wherever ladder-run was invoked from
#     (d) no --gate-cmd → gate_verdict "n/a", behaviour unchanged
run --change-id gate-ok --mock-verdict SHIP-AS-IS --gate-cmd 'true' >/dev/null 2>&1 || true
[ "$(jq -r '.classes["doc-sync"].cycles[]|select(.change_id=="gate-ok")|.verdict+"/"+.gate_verdict' "$STATE")" = "pass/pass" ] \
  && ok "gate: LLM pass + gate pass → panel pass, gate_verdict=pass persisted" || bad "gate pass not recorded"
OUT=$(run --change-id gate-bad --mock-verdict SHIP-AS-IS --gate-cmd 'echo VERSION-DRIFT v2.35.5 vs 2.35.8; exit 7' 2>&1) || true
[ "$(jq -r '.classes["doc-sync"].cycles[]|select(.change_id=="gate-bad")|.verdict+"/"+.gate_verdict' "$STATE")" = "fail/fail" ] \
  && ok "gate: LLM pass + gate FAIL → panel FAIL (union of catches)" || bad "gate fail did not fail the panel: $OUT"
F=$(jq -c 'select(.change_id=="gate-bad").findings' "$STORE" | tail -1)
grep -q '"id":"mechanical-gate-failed"' <<<"$F" && grep -q 'VERSION-DRIFT' <<<"$F" && grep -q 'rc=7' <<<"$F" \
  && ok "gate: finding carries gate output tail + rc (actionable without a re-run)" || bad "gate finding missing detail: $F"
AUTON_G=$(jq -r 'select(.change_id=="gate-bad").autonomous // false' "$STORE" | tail -1)
[ "$AUTON_G" != "true" ] && ok "gate: a gate-failed cycle is not an autonomous ship" || bad "gate fail recorded autonomous=true"
GD="$TMP/gatedir"; mkdir -p "$GD"; echo marker > "$GD/here"
run --change-id gate-cwd --mock-verdict SHIP-AS-IS --gate-dir "$GD" --gate-cmd 'test -f here' >/dev/null 2>&1 || true
[ "$(jq -r '.classes["doc-sync"].cycles[]|select(.change_id=="gate-cwd")|.gate_verdict' "$STATE")" = "pass" ] \
  && ok "gate: runs with cwd = --gate-dir" || bad "gate did not run in --gate-dir"
[ "$(jq -r '.classes["doc-sync"].cycles[]|select(.change_id=="chg-1")|.gate_verdict' "$STATE")" = "n/a" ] \
  && ok "gate: absent → gate_verdict n/a (no behaviour change)" || bad "gate_verdict default wrong"
# findings text from a mock FIX-THEN-SHIP is empty (mock has no text) but the key must exist
jq -e '.classes["doc-sync"].cycles[]|select(.change_id=="chg-fail")|.findings|type=="array"' "$STATE" >/dev/null \
  && ok "cycle record carries findings[] (verifier reasons no longer discarded)" || bad "findings not on cycle record"

# 5. codex-Minor: ambiguous artifact input rejected
if run --change-id amb --impl-prompt-file "$DIFF" --mock-verdict SHIP-AS-IS >/dev/null 2>&1; then
  bad "ambiguous --diff-file + --impl-prompt-file should be rejected"; else ok "ambiguous artifact input rejected"; fi

# ---- H1: sampling NOT evadable via change_id (keyed on head_sha) ----
B_a=$(run --change-id evade-AAAA --mock-verdict SHIP-AS-IS --dry-run 2>&1 | grep -oE 'bucket=[0-9.]+')
B_b=$(run --change-id evade-ZZZZ --mock-verdict SHIP-AS-IS --dry-run 2>&1 | grep -oE 'bucket=[0-9.]+')
[ "$B_a" = "$B_b" ] && [ -n "$B_a" ] && ok "H1: same head_sha, different change_id → same sample bucket ($B_a) — cannot dodge by renaming" \
  || bad "H1: change_id changed the bucket ($B_a vs $B_b) — sampling evadable"
B_salt=$(LADDER_SAMPLE_SALT=secret run --change-id evade-AAAA --mock-verdict SHIP-AS-IS --dry-run 2>&1 | grep -oE 'bucket=[0-9.]+')
[ "$B_salt" != "$B_a" ] && ok "H1: secret salt shifts the bucket → unpredictable to implementer" || bad "H1: salt had no effect"

# ---- C2: an escape recorded via `audit` counts as a class escape → blocks promotion ----
: > "$STORE"; mkstate '[]'
run --change-id esc-1 --mock-verdict SHIP-AS-IS >/dev/null 2>&1 || true
ESC_BEFORE=$(python3 "$QC_PY" --store <(grep esc-1 "$STORE") report 2>/dev/null | awk -F: '/OVERALL escape/{print $2}' | tr -dc '0-9.' )
"$LADDER" audit --task-class doc-sync --change-id esc-1 --repo testrepo --base-sha B --head-sha H \
  --state-file "$STATE" --store "$STORE" --qc-metric-py "$QC_PY" \
  --finding-id incomplete-fix --severity medium --lens doc-accuracy --caught-at-stage cookys_audit >/dev/null 2>&1 || true
ESC_AFTER=$(python3 "$QC_PY" --store <(grep esc-1 "$STORE") report 2>/dev/null | awk -F: '/OVERALL escape/{print $2}' | tr -dc '0-9.')
{ [ "${ESC_BEFORE:-0}" = "0" ] || [ -z "$ESC_BEFORE" ]; } && awk -v e="${ESC_AFTER:-0}" 'BEGIN{exit !(e>0)}' \
  && ok "C2: audit turns an in-cycle pass into a counted class escape (${ESC_BEFORE:-0}% → ${ESC_AFTER}%)" \
  || bad "C2: audited escape not counted (before=${ESC_BEFORE} after=${ESC_AFTER})"
grep -q 'HOLD@T0' <<<"$(jq -r '.classes["doc-sync"].cycles[-1].promotion' "$STATE")" \
  && ok "C2: post-escape promotion correctly HOLDs (not T1-eligible)" || bad "C2: escape did not block promotion"

# ---- C1: endorsement compared as a FRACTION — 40%→0.4 < 0.90 must NOT promote ----
: > "$STORE"; mkstate '["e1","e2","e3","e4","e5"]'
for e in e1 e2; do node "$EMIT" --store "$STORE" --change-id "$e" --repo r --base-sha b --head-sha h \
  --verdict pass --stage depth0_panel --lenses doc-accuracy --findings '[]' --autonomous --endorsed true >/dev/null; done
for e in e3 e4 e5; do node "$EMIT" --store "$STORE" --change-id "$e" --repo r --base-sha b --head-sha h \
  --verdict pass --stage depth0_panel --lenses doc-accuracy --findings '[]' --autonomous --endorsed false >/dev/null; done
# class endtest is T1, 5 distinct cycles, escape 0%, endorsement 2/5=40%. A 6th clean cycle keeps
# endorsement < 90% → must HOLD@T1 (pre-fix bug compared 40.0 > 0.90 → wrongly PROMOTE→T2).
OUT=$("$LADDER" run --task-class endtest --change-id e6 --repo r --base-sha b --head-sha h6 \
  --diff-file "$DIFF" --state-file "$STATE" --store "$STORE" --qc-metric-py "$QC_PY" \
  --lenses doc-accuracy --mock-verdict SHIP-AS-IS 2>&1) || true
grep -q 'HOLD@T1' <<<"$OUT" && ! grep -q 'PROMOTE' <<<"$OUT" \
  && ok "C1: endorsement 40% (<0.90 as fraction) HOLDs at T1 (no vacuous promote)" \
  || bad "C1: endorsement gate wrong — $(grep -oE 'promotion *: .*' <<<"$OUT")"

# ---- H2: calculator failure is FAIL-CLOSED (no PROMOTE) with NO store/state divergence ----
: > "$STORE"; mkstate '[]'
set +e
OUT=$("$LADDER" run --task-class doc-sync --change-id h2-1 --repo r --base-sha b --head-sha h2 \
  --diff-file "$DIFF" --state-file "$STATE" --store "$STORE" --qc-metric-py "$TMP/nonexistent-qc.py" \
  --lenses doc-accuracy --mock-verdict SHIP-AS-IS 2>&1); RC=$?
set -e
grep -q 'HOLD-ERROR' <<<"$OUT" && ! grep -q 'PROMOTE' <<<"$OUT" && ok "H2: calculator failure → HOLD-ERROR (fail-closed, no PROMOTE)" \
  || bad "H2: broken calculator did not fail closed — $OUT"
[ "$RC" = "3" ] && ok "H2: fail-closed exits 3 (needs_human)" || bad "H2: expected exit 3, got $RC"
{ grep -q 'h2-1' "$STORE" && [ "$(jq -r '[.classes["doc-sync"].cycles[]|select(.change_id=="h2-1")]|length' "$STATE")" = "1" ]; } \
  && ok "H2: emit + state both recorded (no store/state divergence on calc failure)" \
  || bad "H2: store/state diverged on calculator failure"

# ---- #4: empty change-id set → cycle count is a single integer "0" (not "0\n0") ----
# mirrors class_metrics' DISTINCT-count pipeline; the old `grep -c . || echo 0` printed "0"
# AND exited 1 on empty input → "0\n0", an invalid number fed to awk / state JSON.
VC_EMPTY=$(printf '%s\n' "" | sed '/^$/d' | sort -u | wc -l | tr -d '[:space:]')
[ "$VC_EMPTY" = "0" ] && ok "#4: empty ids → count is a single 0 (no '0\\n0')" || bad "#4: empty-ids count malformed: [$VC_EMPTY]"

# ---- #3: post-emit atomicity — a store-emit failure AFTER the state write rolls BOTH back ----
# (both-or-neither). Seed one real cycle, snapshot store+state, then make the real store
# read-only so the FINAL store append fails; assert exit 4 and NO divergence.
: > "$STORE"; mkstate '[]'
run --change-id pre-1 --mock-verdict SHIP-AS-IS >/dev/null 2>&1 || true
STORE_LINES=$(wc -l < "$STORE"); STATE_SNAP=$(jq -S . "$STATE")
chmod 0444 "$STORE"
set +e
OUT=$(run --change-id diverge-1 --mock-verdict SHIP-AS-IS 2>&1); RC=$?
set -e
chmod 0644 "$STORE"
{ [ "$RC" = "4" ] && [ "$(wc -l < "$STORE")" = "$STORE_LINES" ] && [ "$(jq -S . "$STATE")" = "$STATE_SNAP" ]; } \
  && ok "#3: store-emit failure after state → BOTH rolled back (exit 4; store & state unchanged)" \
  || bad "#3: divergence on post-emit failure (rc=$RC storeΔ=$(( $(wc -l<"$STORE") - STORE_LINES )))"
grep -q 'both-or-neither' <<<"$OUT" && ok "#3: emits explicit needs_human reconcile message" || bad "#3: no reconcile message"

# ---- #3b: state-write failure → nothing emitted to the store (both-or-neither) ----
SUBDIR="$TMP/rodir"; mkdir -p "$SUBDIR"; STATE_RO="$SUBDIR/state.json"; cp "$STATE" "$STATE_RO"
: > "$STORE"; STORE_LINES=$(wc -l < "$STORE")
chmod 0555 "$SUBDIR"   # mv into this dir fails → state write fails
set +e
OUT=$("$LADDER" run --task-class doc-sync --change-id nostate-1 --repo r --base-sha b --head-sha h9 \
  --diff-file "$DIFF" --state-file "$STATE_RO" --store "$STORE" --qc-metric-py "$QC_PY" \
  --lenses doc-accuracy --mock-verdict SHIP-AS-IS 2>&1); RC=$?
set -e
chmod 0755 "$SUBDIR"
{ [ "$RC" = "4" ] && [ "$(wc -l < "$STORE")" = "$STORE_LINES" ] && ! grep -q 'nostate-1' "$STORE"; } \
  && ok "#3b: state-write failure → store NOT written (both-or-neither, exit 4)" \
  || bad "#3b: store written despite state-write failure (rc=$RC)"

# ---- calculator integration sanity ----
python3 "$QC_PY" --store "$STORE" report >/dev/null 2>&1 && ok "emitted events parse through qc_metric.py" || bad "qc_metric.py could not read store"

echo; [ "$FAIL" = "0" ] && { echo "ALL PASS"; exit 0; } || { echo "SOME FAILED"; exit 1; }
