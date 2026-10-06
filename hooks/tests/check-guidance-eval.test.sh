#!/usr/bin/env bash
# hooks/tests/check-guidance-eval.test.sh — fixtures for scripts/check-guidance-eval.js (plan §2.8, P0).
# A scratch git repo stands in for the cut (base commit + change commit), a scratch packs dir for the
# evaluated change pack, and synthetic recorded results for the scorer. No live cell, no real packs.
#   matching                           -> exit 0
#   shipped file != its pack copy      -> exit 1 (digest)      pack bytes tampered -> exit 1 (bytes)
#   a differing file outside the prereg file set                -> exit 1
#   results that do not reproduce SHIP                          -> exit 1
#   manifest files differ but no --results                      -> exit 1
#   nothing differs from the base                               -> exit 0, score null
#   deleted file still in the pack                              -> exit 1
#   a change outside the manifest paths                         -> ignored

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GATE="$REPO_ROOT/scripts/check-guidance-eval.js"
REAL_PREREG="$REPO_ROOT/evals/skill-onoff/prereg/stage-graph.json"
TEST_TMP=$(mktemp -d -t "check-guidance-eval-test-XXXXXX")
trap 'rm -rf "$TEST_TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

R="$TEST_TMP/repo"; mkdir -p "$R/skills/dev-flow" "$R/references" "$R/agents" "$R/scripts"
git -C "$R" init -q
git -C "$R" config user.name T; git -C "$R" config user.email t@t; git -C "$R" config commit.gpgsign false
printf 'skill v0\n' > "$R/skills/dev-flow/SKILL.md"
printf 'plan v0\n' > "$R/references/plan-template.md"
printf 'doomed\n' > "$R/references/hetero-dispatch.md"
printf 'x\n' > "$R/scripts/helper.js"
git -C "$R" add -A; git -C "$R" commit -qm base
BASE_REF=$(git -C "$R" rev-parse HEAD)
printf 'skill v1\n' > "$R/skills/dev-flow/SKILL.md"
printf 'plan v1\n' > "$R/references/plan-template.md"
printf 'x2\n' > "$R/scripts/helper.js"   # outside the guidance manifest: must be ignored
git -C "$R" add -A; git -C "$R" commit -qm change

sha() { sha256sum "$1" | cut -d' ' -f1; }
PK="$TEST_TMP/packs"
mkdir -p "$PK/dev-flow-sg-change" "$PK/guidance-files-sg-change/references"
cp "$R/skills/dev-flow/SKILL.md" "$PK/dev-flow-sg-change/SKILL.md"
cp "$R/references/plan-template.md" "$PK/guidance-files-sg-change/references/plan-template.md"
write_manifest() {
  node -e '
    const [pk, a, b] = process.argv.slice(1);
    require("fs").writeFileSync(pk + "/manifest.json", JSON.stringify({ schema_version: 1, packs: {
      "dev-flow-sg-change": { "dev-flow-sg-change/SKILL.md": a },
      "guidance-files-sg-change": { "guidance-files-sg-change/references/plan-template.md": b } } }));
  ' "$PK" "$(sha "$R/skills/dev-flow/SKILL.md")" "$(sha "$R/references/plan-template.md")"
}
write_manifest

# prereg: the real task/arm/threshold block, with a scratch guidance file set
PRE="$TEST_TMP/prereg.json"
node -e '
  const P = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  P.guidance.files = ["skills/dev-flow/SKILL.md", "references/plan-template.md", "references/hetero-dispatch.md"];
  require("fs").writeFileSync(process.argv[2], JSON.stringify(P));
' "$REAL_PREREG" "$PRE"

# recorded results: SHIP (change 12/12, red = the 3 M briefs only, generic unchanged) or a weaker change arm
mk_results() { # $1 out $2 changePassCount
  node -e '
    const fs = require("fs");
    const P = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const nPass = Number(process.argv[3]);
    const K = ["sg_size", "sg_bug", "sg_urgent", "sg_walk", "sg_rung", "sg_work", "sg_pass"];
    const mk = (v) => Object.fromEntries(K.map((k) => [k, v]));
    const row = (task, arm, rep, markers) => JSON.stringify({ task_id: task, arm, model: "sonnet", runner: "cc", runner_version: "9.9.9 (Claude Code)", rep, markers, failure_class: null });
    const out = [];
    P.tasks.forEach((t, i) => { for (let rep = 1; rep <= 3; rep++) {
      out.push(row(t, "base", rep, mk(false)));
      out.push(row(t, "change", rep, mk(i < nPass)));
      out.push(row(t, "red", rep, mk(P.mutation.keeps.includes(t))));
    } });
    for (const t of P.generic.tasks) for (let rep = 1; rep <= 3; rep++) for (const arm of ["base", "change"]) out.push(row(t, arm, rep, { f1_session_sha: true }));
    fs.writeFileSync(process.argv[2], out.join("\n") + "\n");
  ' "$PRE" "$1" "$2"
}
mk_results "$TEST_TMP/ship.jsonl" 12
mk_results "$TEST_TMP/weak.jsonl" 9

gate() { # args... ; sets G_OUT G_RC
  set +e; G_OUT=$(node "$GATE" "$@" 2>"$TEST_TMP/gate.err"); G_RC=$?; set -e
}
ok_field() { node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).ok))' "$G_OUT"; }

echo "=== matching pack + SHIP results -> 0 ==="
gate --base "$BASE_REF" --repo "$R" --prereg "$PRE" --packs-dir "$PK" --results "$TEST_TMP/ship.jsonl"
[ "$G_RC" -eq 0 ] && [ "$(ok_field)" = true ] || fail "matching must pass (rc=$G_RC): $G_OUT"
node -e 'const o=JSON.parse(process.argv[1]); if(o.differing.length!==2||o.differing.some(d=>d.ok!==true)||o.score.verdict!=="SHIP") process.exit(1)' "$G_OUT" || fail "expected 2 differing guidance files, both ok, scorer SHIP: $G_OUT"

echo "=== results that do not reproduce SHIP -> 1 ==="
gate --base "$BASE_REF" --repo "$R" --prereg "$PRE" --packs-dir "$PK" --results "$TEST_TMP/weak.jsonl"
[ "$G_RC" -eq 1 ] && grep -q 'did not reproduce SHIP' <<<"$G_OUT" || fail "weak results must fail the gate (rc=$G_RC): $G_OUT"

echo "=== manifest files differ but no results given -> 1 ==="
gate --base "$BASE_REF" --repo "$R" --prereg "$PRE" --packs-dir "$PK"
[ "$G_RC" -eq 1 ] && grep -q 'results file required' <<<"$G_OUT" || fail "missing results must fail: $G_OUT"

echo "=== pack bytes tampered on disk (manifest digest still matches the shipped file) -> 1 ==="
cp "$PK/dev-flow-sg-change/SKILL.md" "$TEST_TMP/skill.keep"
printf 'tampered\n' > "$PK/dev-flow-sg-change/SKILL.md"
gate --base "$BASE_REF" --repo "$R" --prereg "$PRE" --packs-dir "$PK" --results "$TEST_TMP/ship.jsonl"
[ "$G_RC" -eq 1 ] && grep -q 'shipped bytes != pack bytes' <<<"$G_OUT" || fail "tampered pack bytes must fail: $G_OUT"
cp "$TEST_TMP/skill.keep" "$PK/dev-flow-sg-change/SKILL.md"

echo "=== a shipped file differs from its pack copy (edited after the eval) -> 1 ==="
printf 'skill v2 (edited after the eval)\n' > "$R/skills/dev-flow/SKILL.md"
git -C "$R" add -A; git -C "$R" commit -qm "edit after eval"
gate --base "$BASE_REF" --repo "$R" --prereg "$PRE" --packs-dir "$PK" --results "$TEST_TMP/ship.jsonl"
[ "$G_RC" -eq 1 ] && grep -q 'digest != pack manifest digest' <<<"$G_OUT" || fail "a drifted shipped file must fail: $G_OUT"
printf 'skill v1\n' > "$R/skills/dev-flow/SKILL.md"
git -C "$R" add -A; git -C "$R" commit -qm "revert to the evaluated text"
gate --base "$BASE_REF" --repo "$R" --prereg "$PRE" --packs-dir "$PK" --results "$TEST_TMP/ship.jsonl"
[ "$G_RC" -eq 0 ] || fail "reverting to the evaluated bytes must pass again: $G_OUT"

echo "=== a guidance file outside the prereg set changed -> 1 ==="
printf 'agent\n' > "$R/agents/new.md"
git -C "$R" add -A; git -C "$R" commit -qm "unevaluated guidance"
gate --base "$BASE_REF" --repo "$R" --prereg "$PRE" --packs-dir "$PK" --results "$TEST_TMP/ship.jsonl"
[ "$G_RC" -eq 1 ] && grep -q 'not in the prereg guidance file set' <<<"$G_OUT" || fail "unlisted guidance change must fail: $G_OUT"
git -C "$R" rm -q -f agents/new.md; git -C "$R" commit -qm "drop it"

echo "=== deleted manifest file still present in the pack -> 1; absent -> 0 ==="
git -C "$R" rm -q -f references/hetero-dispatch.md; git -C "$R" commit -qm "delete"
node -e '
  const fs = require("fs"); const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  m.packs["guidance-files-sg-change"]["guidance-files-sg-change/references/hetero-dispatch.md"] = "00";
  fs.writeFileSync(process.argv[1], JSON.stringify(m));' "$PK/manifest.json"
gate --base "$BASE_REF" --repo "$R" --prereg "$PRE" --packs-dir "$PK" --results "$TEST_TMP/ship.jsonl"
[ "$G_RC" -eq 1 ] && grep -q 'deleted at head but still present' <<<"$G_OUT" || fail "deleted-but-packed must fail: $G_OUT"
write_manifest
gate --base "$BASE_REF" --repo "$R" --prereg "$PRE" --packs-dir "$PK" --results "$TEST_TMP/ship.jsonl"
[ "$G_RC" -eq 0 ] || fail "deleted file absent from the pack must pass: $G_OUT"

echo "=== nothing differs from the base -> 0 without results ==="
HEAD_REF=$(git -C "$R" rev-parse HEAD)
gate --base "$HEAD_REF" --repo "$R" --prereg "$PRE" --packs-dir "$PK"
[ "$G_RC" -eq 0 ] && node -e 'const o=JSON.parse(process.argv[1]); if(o.score!==null||o.differing.length!==0) process.exit(1)' "$G_OUT" || fail "no guidance change vs base must pass vacuously: $G_OUT"

echo "=== usage ==="
set +e; node "$GATE" >/dev/null 2>&1; rc=$?; set -e
[ "$rc" -eq 2 ] || fail "missing --base must exit 2 (got $rc)"

echo "PASS: check-guidance-eval fixtures"
