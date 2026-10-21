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
#   suffixed arm (-v9) with matching packs                      -> exit 0
#   suffixed arm but the packs frozen are the unsuffixed ones   -> exit 1 (not frozen)
#   arm without the differing skill                             -> exit 1 (no change pack in the arm)
#   arm manifest for a non-change arm / unreadable --arm        -> exit 2

set -euo pipefail
# git env hygiene + scratch-dir ceilings only (this suite keeps its own TEST_TMP/trap).
AUTOPILOT_TEST_LIB_HELPERS_ONLY=1 . "$(dirname "$0")/lib.sh"

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
CHANGE_REF=$(git -C "$R" rev-parse HEAD)

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

# prereg: the real task/arm/threshold block, with a scratch guidance file set.
# RED at 170b420b0c0098ef1c4133fa659b283f3d90cce3: FAIL: matching must pass ... declared out_of_arm but unchanged
# The fixture repo does not contain those commits, so the copied list is dropped below.
PRE="$TEST_TMP/prereg.json"
node -e '
  const P = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  P.guidance.files = ["skills/dev-flow/SKILL.md", "references/plan-template.md", "references/hetero-dispatch.md"];
  delete P.guidance.out_of_arm;
  require("fs").writeFileSync(process.argv[2], JSON.stringify(P));
' "$REAL_PREREG" "$PRE"

# recorded results: SHIP (change 12/12, red = the 3 M briefs only, generic unchanged) or a weaker change arm
mk_results() { # $1 out $2 changePassCount $3 arm-manifest file the change rows ran under
  node -e '
    const fs = require("fs");
    const P = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const nPass = Number(process.argv[3]);
    const K = ["sg_size", "sg_bug", "sg_urgent", "sg_walk", "sg_rung", "sg_work", "sg_pass"];
    const mk = (v) => Object.fromEntries(K.map((k) => [k, v]));
    const armSha = require("crypto").createHash("sha256").update(fs.readFileSync(process.argv[4])).digest("hex");
    const row = (task, arm, rep, markers) => JSON.stringify({ task_id: task, arm, model: "sonnet", runner: "cc", runner_version: "9.9.9 (Claude Code)", rep, markers, failure_class: null, ...(arm === "change" ? { arm_manifest_sha256: armSha } : {}) });
    const out = [];
    P.tasks.forEach((t, i) => { for (let rep = 1; rep <= 3; rep++) {
      out.push(row(t, "base", rep, mk(false)));
      out.push(row(t, "change", rep, mk(i < nPass)));
      out.push(row(t, "red", rep, mk(P.mutation.keeps.includes(t))));
    } });
    for (const t of P.generic.tasks) for (let rep = 1; rep <= 3; rep++) for (const arm of ["base", "change"]) out.push(row(t, arm, rep, { f1_session_sha: true }));
    fs.writeFileSync(process.argv[2], out.join("\n") + "\n");
  ' "$PRE" "$1" "$2" "$3"
}
ARM="$TEST_TMP/arm.json"
echo '{"schema_version":1,"arm":"change","skills":{"dev-flow":"dev-flow-sg-change"},"files":"guidance-files-sg-change"}' > "$ARM"
mk_results "$TEST_TMP/ship.jsonl" 12 "$ARM"
mk_results "$TEST_TMP/weak.jsonl" 9 "$ARM"
gate() { # args... ; sets G_OUT G_RC (default --arm is last: a caller-supplied --arm wins, val() takes the first)
  set +e; G_OUT=$(node "$GATE" "$@" --arm "$ARM" 2>"$TEST_TMP/gate.err"); G_RC=$?; set -e
}
ok_field() { node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).ok))' "$G_OUT"; }

echo "=== matching pack + SHIP results -> 0 ==="
gate --base "$BASE_REF" --repo "$R" --prereg "$PRE" --packs-dir "$PK" --results "$TEST_TMP/ship.jsonl"
[ "$G_RC" -eq 0 ] && [ "$(ok_field)" = true ] || fail "matching must pass (rc=$G_RC): $G_OUT"
node -e 'const o=JSON.parse(process.argv[1]); if(o.differing.length!==2||o.differing.some(d=>d.ok!==true)||o.score.verdict!=="SHIP") process.exit(1)' "$G_OUT" || fail "expected 2 differing guidance files, both ok, scorer SHIP: $G_OUT"

echo "=== results produced under a different arm manifest -> 1 ==="
ARMOTHER="$TEST_TMP/arm-other.json"
echo '{"schema_version":1,"arm":"change","skills":{"dev-flow":"dev-flow-sg-change"},"files":"guidance-files-sg-change","note":"other arm"}' > "$ARMOTHER"
mk_results "$TEST_TMP/other-arm.jsonl" 12 "$ARMOTHER"
gate --base "$BASE_REF" --repo "$R" --prereg "$PRE" --packs-dir "$PK" --results "$TEST_TMP/other-arm.jsonl"
[ "$G_RC" -eq 1 ] && grep -q 'produced under a different arm manifest' <<<"$G_OUT" || fail "results from a different arm must fail (rc=$G_RC): $G_OUT"

echo "=== change rows that carry no arm digest -> 1 ==="
node -e 'const fs=require("fs");fs.writeFileSync(process.argv[2],fs.readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean).map(l=>{const r=JSON.parse(l);delete r.arm_manifest_sha256;return JSON.stringify(r)}).join("\n")+"\n")' "$TEST_TMP/ship.jsonl" "$TEST_TMP/unstamped.jsonl"
gate --base "$BASE_REF" --repo "$R" --prereg "$PRE" --packs-dir "$PK" --results "$TEST_TMP/unstamped.jsonl"
[ "$G_RC" -eq 1 ] && grep -q 'carry no arm_manifest_sha256' <<<"$G_OUT" || fail "unstamped change rows must fail (rc=$G_RC): $G_OUT"

echo "=== legacy results bound by an arm-binding sidecar ==="
LG="$TEST_TMP/legacy"; mkdir -p "$LG"
node -e 'const fs=require("fs");fs.writeFileSync(process.argv[2],fs.readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean).map(l=>{const r=JSON.parse(l);delete r.arm_manifest_sha256;return JSON.stringify(r)}).join("\n")+"\n")' "$TEST_TMP/ship.jsonl" "$LG/old.jsonl"
write_sidecar() { # $1 results-sha $2 arm-sha
  printf '{"schema":"autopilot.results-arm-binding/1","results":"old.jsonl","results_sha256":"%s","arm_manifest_sha256":"%s"}\n' "$1" "$2" > "$LG/old.arm-binding.json"
}
write_sidecar "$(sha "$LG/old.jsonl")" "$(sha "$ARM")"
gate --base "$BASE_REF" --repo "$R" --prereg "$PRE" --packs-dir "$PK" --results "$LG/old.jsonl"
[ "$G_RC" -eq 0 ] || fail "good sidecar must pass (rc=$G_RC): $G_OUT"
write_sidecar "0000000000000000000000000000000000000000000000000000000000000000" "$(sha "$ARM")"
gate --base "$BASE_REF" --repo "$R" --prereg "$PRE" --packs-dir "$PK" --results "$LG/old.jsonl"
[ "$G_RC" -eq 1 ] && grep -q 'results_sha256 is stale' <<<"$G_OUT" || fail "stale sidecar results sha must fail (rc=$G_RC): $G_OUT"
write_sidecar "$(sha "$LG/old.jsonl")" "$(sha "$ARMOTHER")"
gate --base "$BASE_REF" --repo "$R" --prereg "$PRE" --packs-dir "$PK" --results "$LG/old.jsonl"
[ "$G_RC" -eq 1 ] && grep -q 'sidecar names a different arm manifest' <<<"$G_OUT" || fail "sidecar naming a different arm must fail (rc=$G_RC): $G_OUT"

echo "=== mixed rows (one stamped, the rest unstamped) -> 1 ==="
node -e 'const fs=require("fs");let first=true;fs.writeFileSync(process.argv[2],fs.readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean).map(l=>{const r=JSON.parse(l);if(r.arm==="change"){if(first){first=false}else delete r.arm_manifest_sha256}return JSON.stringify(r)}).join("\n")+"\n")' "$TEST_TMP/ship.jsonl" "$TEST_TMP/mixed.jsonl"
gate --base "$BASE_REF" --repo "$R" --prereg "$PRE" --packs-dir "$PK" --results "$TEST_TMP/mixed.jsonl"
[ "$G_RC" -eq 1 ] && grep -q 'partially stamped results' <<<"$G_OUT" || fail "mixed stamped/unstamped rows must fail (rc=$G_RC): $G_OUT"

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

echo "=== suffixed arm (-v9) with matching packs -> 0 ==="
ARM9="$TEST_TMP/arm9.json"; PK9="$TEST_TMP/packs9"
echo '{"schema_version":1,"arm":"change","skills":{"dev-flow":"dev-flow-sg-change-v9"},"files":"guidance-files-sg-change-v9"}' > "$ARM9"
mkdir -p "$PK9/dev-flow-sg-change-v9" "$PK9/guidance-files-sg-change-v9/references"
cp "$R/skills/dev-flow/SKILL.md" "$PK9/dev-flow-sg-change-v9/SKILL.md"
cp "$R/references/plan-template.md" "$PK9/guidance-files-sg-change-v9/references/plan-template.md"
node -e '
  const [pk, a, b] = process.argv.slice(1);
  require("fs").writeFileSync(pk + "/manifest.json", JSON.stringify({ schema_version: 1, packs: {
    "dev-flow-sg-change-v9": { "dev-flow-sg-change-v9/SKILL.md": a },
    "guidance-files-sg-change-v9": { "guidance-files-sg-change-v9/references/plan-template.md": b } } }));
' "$PK9" "$(sha "$R/skills/dev-flow/SKILL.md")" "$(sha "$R/references/plan-template.md")"
mk_results "$TEST_TMP/ship9.jsonl" 12 "$ARM9"
gate --arm "$ARM9" --base "$BASE_REF" --repo "$R" --prereg "$PRE" --packs-dir "$PK9" --results "$TEST_TMP/ship9.jsonl"
[ "$G_RC" -eq 0 ] && node -e 'const o=JSON.parse(process.argv[1]); if(!o.arm.endsWith("arm9.json")||o.differing.some(d=>!d.pack.endsWith("-v9"))) process.exit(1)' "$G_OUT" || fail "suffixed arm must pass (rc=$G_RC): $G_OUT"

echo "=== suffixed arm against the unsuffixed packs -> 1 ==="
gate --arm "$ARM9" --base "$BASE_REF" --repo "$R" --prereg "$PRE" --packs-dir "$PK" --results "$TEST_TMP/ship.jsonl"
[ "$G_RC" -eq 1 ] && grep -q 'not frozen in packs/manifest.json' <<<"$G_OUT" || fail "arm/pack id mismatch must fail (rc=$G_RC): $G_OUT"

echo "=== arm missing the dev-flow skill -> 1 ==="
ARMX="$TEST_TMP/armx.json"
echo '{"schema_version":1,"arm":"change","skills":{},"files":"guidance-files-sg-change"}' > "$ARMX"
gate --arm "$ARMX" --base "$BASE_REF" --repo "$R" --prereg "$PRE" --packs-dir "$PK" --results "$TEST_TMP/ship.jsonl"
[ "$G_RC" -eq 1 ] && grep -q 'skill dev-flow has no change pack in the arm manifest' <<<"$G_OUT" || fail "skill absent from arm must fail (rc=$G_RC): $G_OUT"

echo "=== arm manifest for the red arm -> 2 ==="
ARMR="$TEST_TMP/armr.json"
echo '{"schema_version":1,"arm":"red","skills":{"dev-flow":"dev-flow-sg-change"},"files":"guidance-files-sg-change"}' > "$ARMR"
gate --arm "$ARMR" --base "$BASE_REF" --repo "$R" --prereg "$PRE" --packs-dir "$PK" --results "$TEST_TMP/ship.jsonl"
[ "$G_RC" -eq 2 ] || fail "non-change arm must exit 2 (got $G_RC)"

echo "=== unreadable --arm -> 2 ==="
gate --arm "$TEST_TMP/no-such-arm.json" --base "$BASE_REF" --repo "$R" --prereg "$PRE" --packs-dir "$PK" --results "$TEST_TMP/ship.jsonl"
[ "$G_RC" -eq 2 ] || fail "unreadable arm must exit 2 (got $G_RC)"

echo "=== usage ==="
set +e; node "$GATE" >/dev/null 2>&1; rc=$?; set -e
[ "$rc" -eq 2 ] || fail "missing --base must exit 2 (got $rc)"

# out_of_arm — negative controls. RED at 787f8ab39682a207eacec93f044b7b0d5522e5b5 on the
# unmodified gate (every new case below exited 1 for the wrong reason, or 0 where a pass
# is required: the gate has no guidance.out_of_arm and treats every unlisted manifest
# drift as "not in the prereg guidance file set").
echo "=== out_of_arm declarations ==="
OBASE=$(git -C "$R" rev-parse HEAD)
mkdir -p "$R/skills/handoff" "$R/skills/dev-flow/references"
printf 'other\n' > "$R/scripts/helper.js"
git -C "$R" add -A; git -C "$R" commit -qm "touch helper only"
C_OTHER=$(git -C "$R" rev-parse HEAD)
printf 'handoff v1\n' > "$R/skills/handoff/SKILL.md"
git -C "$R" add -A; git -C "$R" commit -qm "handoff skill"
C_HAND=$(git -C "$R" rev-parse HEAD)
printf 'extra ref\n' > "$R/skills/dev-flow/references/extra.md"
git -C "$R" add -A; git -C "$R" commit -qm "dev-flow extra ref"
C_SKILL=$(git -C "$R" rev-parse HEAD)
printf 'packed note\n' > "$R/references/packed-note.md"
git -C "$R" add -A; git -C "$R" commit -qm "packed note"
C_PACK=$(git -C "$R" rev-parse HEAD)
node -e '
  const fs = require("fs"); const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  m.packs["guidance-files-sg-change"]["guidance-files-sg-change/references/packed-note.md"] = "aa";
  fs.writeFileSync(process.argv[1], JSON.stringify(m));' "$PK/manifest.json"

ooa_prereg() { # $1=dest json, then one JSON object per entry; pass --omit as the only extra to drop the field
  node -e '
    const fs = require("fs");
    const [src, dest, ...rest] = process.argv.slice(1);
    const P = JSON.parse(fs.readFileSync(src, "utf8"));
    if (rest.length === 1 && rest[0] === "--omit") delete P.guidance.out_of_arm;
    else P.guidance.out_of_arm = rest.map((s) => JSON.parse(s));
    fs.writeFileSync(dest, JSON.stringify(P));
  ' "$PRE" "$@"
}
OOA="$TEST_TMP/prereg-ooa.json"

echo "=== undeclared drifted file outside the prereg set -> 1 ==="
ooa_prereg "$OOA" --omit
gate --base "$OBASE" --head "$C_HAND" --repo "$R" --prereg "$OOA" --packs-dir "$PK" --results "$TEST_TMP/ship.jsonl"
[ "$G_RC" -eq 1 ] && grep -q 'not in the prereg guidance file set' <<<"$G_OUT" || fail "undeclared out-of-set drift must fail (rc=$G_RC): $G_OUT"

echo "=== out_of_arm commit that did not touch the path -> 1 ==="
ooa_prereg "$OOA" "$(printf '{"path":"skills/handoff/SKILL.md","commit":"%s","reason":"helper commit never touched handoff"}' "$C_OTHER")"
gate --base "$OBASE" --head "$C_HAND" --repo "$R" --prereg "$OOA" --packs-dir "$PK" --results "$TEST_TMP/ship.jsonl"
[ "$G_RC" -eq 1 ] && grep -q 'did not change the path' <<<"$G_OUT" || fail "wrong commit must fail (rc=$G_RC): $G_OUT"

echo "=== out_of_arm commit before base (not in base..head) -> 1 ==="
ooa_prereg "$OOA" "$(printf '{"path":"skills/handoff/SKILL.md","commit":"%s","reason":"base itself is outside the range"}' "$BASE_REF")"
gate --base "$OBASE" --head "$C_HAND" --repo "$R" --prereg "$OOA" --packs-dir "$PK" --results "$TEST_TMP/ship.jsonl"
[ "$G_RC" -eq 1 ] && grep -q 'not in base..head' <<<"$G_OUT" || fail "commit before base must fail (rc=$G_RC): $G_OUT"

echo "=== out_of_arm path loaded because its skill is an arm key -> 1 ==="
ooa_prereg "$OOA" "$(printf '{"path":"skills/dev-flow/references/extra.md","commit":"%s","reason":"dev-flow is on the arm"}' "$C_SKILL")"
gate --base "$C_HAND" --head "$C_SKILL" --repo "$R" --prereg "$OOA" --packs-dir "$PK" --results "$TEST_TMP/ship.jsonl"
[ "$G_RC" -eq 1 ] && grep -q 'loaded by an arm' <<<"$G_OUT" || fail "skill-key path must fail (rc=$G_RC): $G_OUT"

echo "=== out_of_arm path that is a file inside an arm files pack -> 1 ==="
ooa_prereg "$OOA" "$(printf '{"path":"references/packed-note.md","commit":"%s","reason":"sits in the files pack"}' "$C_PACK")"
gate --base "$C_SKILL" --head "$C_PACK" --repo "$R" --prereg "$OOA" --packs-dir "$PK" --results "$TEST_TMP/ship.jsonl"
[ "$G_RC" -eq 1 ] && grep -q 'loaded by an arm' <<<"$G_OUT" || fail "files-pack path must fail (rc=$G_RC): $G_OUT"

echo "=== out_of_arm declared but the file has no difference -> 1 ==="
ooa_prereg "$OOA" "$(printf '{"path":"skills/handoff/SKILL.md","commit":"%s","reason":"already at head"}' "$C_HAND")"
gate --base "$C_PACK" --head "$C_PACK" --repo "$R" --prereg "$OOA" --packs-dir "$PK"
[ "$G_RC" -eq 1 ] && grep -q 'declared out_of_arm but unchanged' <<<"$G_OUT" || fail "unchanged declaration must fail (rc=$G_RC): $G_OUT"

echo "=== out_of_arm also listed in guidance.files -> 1 ==="
ooa_prereg "$OOA" "$(printf '{"path":"skills/dev-flow/SKILL.md","commit":"%s","reason":"cannot be both"}' "$C_HAND")"
gate --base "$BASE_REF" --head "$C_HAND" --repo "$R" --prereg "$OOA" --packs-dir "$PK" --results "$TEST_TMP/ship.jsonl"
[ "$G_RC" -eq 1 ] && grep -q 'both in guidance.files and out_of_arm' <<<"$G_OUT" || fail "in-set declaration must fail (rc=$G_RC): $G_OUT"

echo "=== malformed out_of_arm entry (missing reason) -> 1, no crash ==="
ooa_prereg "$OOA" "$(printf '{"path":"skills/handoff/SKILL.md","commit":"%s"}' "$C_HAND")"
gate --base "$OBASE" --head "$C_HAND" --repo "$R" --prereg "$OOA" --packs-dir "$PK" --results "$TEST_TMP/ship.jsonl"
[ "$G_RC" -eq 1 ] && grep -q 'malformed out_of_arm' <<<"$G_OUT" || fail "malformed entry must fail without crashing (rc=$G_RC err=$(cat "$TEST_TMP/gate.err")): $G_OUT"

echo "=== correct out_of_arm (commit in range, no arm loads it) -> 0 ==="
ooa_prereg "$OOA" "$(printf '{"path":"skills/handoff/SKILL.md","commit":"%s","reason":"no eval arm loads handoff"}' "$C_HAND")"
gate --base "$OBASE" --head "$C_HAND" --repo "$R" --prereg "$OOA" --packs-dir "$PK"
[ "$G_RC" -eq 0 ] || fail "correct out_of_arm must pass (rc=$G_RC): $G_OUT"
node -e '
  const o = JSON.parse(process.argv[1]);
  const d = o.differing.find((x) => x.path === "skills/handoff/SKILL.md");
  const e = (o.out_of_arm || []).find((x) => x.path === "skills/handoff/SKILL.md");
  if (!d || d.ok !== true || d.out_of_arm !== true || d.commit !== process.argv[2] || d.reason !== "no eval arm loads handoff") process.exit(2);
  if (!e || e.ok !== true || e.commit !== process.argv[2] || e.reason !== "no eval arm loads handoff" || e.reason_failed) process.exit(3);
  if (o.score !== null) process.exit(4);
  if (o.differing.some((x) => x.path !== "skills/handoff/SKILL.md")) process.exit(5);
' "$G_OUT" "$C_HAND" || fail "correct out_of_arm must be listed ok with score null: $G_OUT"

# Array arm.files (pack id list) vs the historical string field.
# RED at b14e24663fef34f1dccf507eabf6760eb6959f24: FAIL: array-files arm whose shipped files equal their pack files must pass (rc=2):  check-guidance-eval: arm manifest: files must be a non-empty string
echo "=== array-files arm, shipped files equal their pack files -> 0 ==="
ARRPK="$TEST_TMP/packs-array"
mkdir -p "$ARRPK/dev-flow-sg-change" "$ARRPK/pack-a/references" "$ARRPK/pack-b/references"
cp "$R/skills/dev-flow/SKILL.md" "$ARRPK/dev-flow-sg-change/SKILL.md"
cp "$R/references/plan-template.md" "$ARRPK/pack-a/references/plan-template.md"
printf 'only in pack-b\n' > "$ARRPK/pack-b/references/other.md"
node -e '
  const [pk, a, b, c] = process.argv.slice(1);
  require("fs").writeFileSync(pk + "/manifest.json", JSON.stringify({ schema_version: 1, packs: {
    "dev-flow-sg-change": { "dev-flow-sg-change/SKILL.md": a },
    "pack-a": { "pack-a/references/plan-template.md": b },
    "pack-b": { "pack-b/references/other.md": c } } }));
' "$ARRPK" "$(sha "$R/skills/dev-flow/SKILL.md")" "$(sha "$R/references/plan-template.md")" "$(sha "$ARRPK/pack-b/references/other.md")"
ARMARR="$TEST_TMP/arm-array.json"
echo '{"schema_version":1,"arm":"change","skills":{"dev-flow":"dev-flow-sg-change"},"files":["pack-a","pack-b"]}' > "$ARMARR"
mk_results "$TEST_TMP/ship-array.jsonl" 12 "$ARMARR"
gate --arm "$ARMARR" --base "$BASE_REF" --head "$CHANGE_REF" --repo "$R" --prereg "$PRE" --packs-dir "$ARRPK" --results "$TEST_TMP/ship-array.jsonl"
[ "$G_RC" -eq 0 ] && [ "$(ok_field)" = true ] || fail "array-files arm whose shipped files equal their pack files must pass (rc=$G_RC): $G_OUT $(cat "$TEST_TMP/gate.err")"

echo "=== array-files arm, one shipped file changed by one character -> 1 ==="
R2="$TEST_TMP/repo-char"
cp -a "$R" "$R2"
git -C "$R2" reset -q --hard "$CHANGE_REF"
printf 'plan v1x\n' > "$R2/references/plan-template.md"
git -C "$R2" add -A && git -C "$R2" commit -qm 'one character'
gate --arm "$ARMARR" --base "$BASE_REF" --repo "$R2" --prereg "$PRE" --packs-dir "$ARRPK" --results "$TEST_TMP/ship-array.jsonl"
[ "$G_RC" -eq 1 ] || fail "array-files arm with a one-character shipped change must fail (rc=$G_RC): $G_OUT $(cat "$TEST_TMP/gate.err")"

echo "=== array-files arm, one non-skills path in two packs -> 1 ==="
BOTHP="$TEST_TMP/packs-both"
mkdir -p "$BOTHP/dev-flow-sg-change" "$BOTHP/pack-a/references" "$BOTHP/pack-b/references"
cp "$R/skills/dev-flow/SKILL.md" "$BOTHP/dev-flow-sg-change/SKILL.md"
cp "$R/references/plan-template.md" "$BOTHP/pack-a/references/plan-template.md"
cp "$R/references/plan-template.md" "$BOTHP/pack-b/references/plan-template.md"
PLAN_SHA="$(sha "$R/references/plan-template.md")"
node -e '
  const [pk, a, b] = process.argv.slice(1);
  require("fs").writeFileSync(pk + "/manifest.json", JSON.stringify({ schema_version: 1, packs: {
    "dev-flow-sg-change": { "dev-flow-sg-change/SKILL.md": a },
    "pack-a": { "pack-a/references/plan-template.md": b },
    "pack-b": { "pack-b/references/plan-template.md": b } } }));
' "$BOTHP" "$(sha "$R/skills/dev-flow/SKILL.md")" "$PLAN_SHA"
gate --arm "$ARMARR" --base "$BASE_REF" --head "$CHANGE_REF" --repo "$R" --prereg "$PRE" --packs-dir "$BOTHP" --results "$TEST_TMP/ship-array.jsonl"
[ "$G_RC" -eq 1 ] && grep -q 'more than one arm pack' <<<"$G_OUT" || fail "path in two arm packs must fail (rc=$G_RC): $G_OUT $(cat "$TEST_TMP/gate.err")"

echo "=== string-files arm still matches its pack -> 0 ==="
gate --base "$BASE_REF" --head "$CHANGE_REF" --repo "$R" --prereg "$PRE" --packs-dir "$PK" --results "$TEST_TMP/ship.jsonl"
[ "$G_RC" -eq 0 ] && [ "$(ok_field)" = true ] || fail "string-files arm must still pass (rc=$G_RC): $G_OUT $(cat "$TEST_TMP/gate.err")"

echo "PASS: check-guidance-eval fixtures"
