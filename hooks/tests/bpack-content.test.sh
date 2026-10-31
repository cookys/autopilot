#!/usr/bin/env bash
# hooks/tests/bpack-content.test.sh — bpack evaluation content (Hand B): packs, prompt parity, markers.
# Pure file and stub checks. No model call, no paid run.
# RED at f8dca036f: every bpack path is absent at the unmodified tree (arms/bpack/*.json, packs/*-bpack-*,
#   lib-bpack/bpack-markers.sh, tasks/bpack-*), and dispatch-review.sh teaches no REVOKED: rule.
set -uo pipefail
. "$(dirname "$0")/lib.sh"

EV="$REPO_ROOT/evals/skill-onoff"
PK="$EV/packs"
SH="$REPO_ROOT/scripts/dispatch-review.sh"

# The five guidance files the change arm edits; the same list is prereg allowed_arm_difference.files.
CHANGED=(
  skills/ceo-agent/references/level-front-door.md
  skills/hetero-review/references/code-loop.md
  skills/harness-maintenance/SKILL.md
  references/hetero-dispatch.md
  references/multi-agent-portability.md
)

# Frozen change-pack blobs for files the repo has since moved past (cnimpl added the claude-native implementer
# paragraph to references/hetero-dispatch.md after the bpack run). Blob id of the file at 0967088f1.
# relay0 (f34b094e4) replaced personal data in multi-agent-portability.md with placeholders; the pack keeps the stamped pre-relay0 blob (pack bytes unchanged, manifest digest unchanged).
# doagate (BL-0309 item 3) rewrote the --not-authorized example in level-front-door.md; its pinned blob is the file at c3809424c.
declare -A FROZEN_BLOB=(
  [references/hetero-dispatch.md]=463ae330c0ce1d323c396e254fa7e3ec17dede85
  [skills/ceo-agent/references/level-front-door.md]=f3b6dc5eaee3250dc59404cff1db8ef3513f6544
  [references/multi-agent-portability.md]=c82572ce9b18828de9af25c750eed3b42eeb4031
)

# pack_of <repo path> <base|change> -> path of that file inside the arm's pack
pack_of() {
  local p="$1" arm="$2"
  case "$p" in
    skills/ceo-agent/*) echo "$PK/ceo-agent-bpack-$arm/${p#skills/ceo-agent/}" ;;
    skills/hetero-review/*) echo "$PK/hetero-review-bpack-$arm/${p#skills/hetero-review/}" ;;
    skills/harness-maintenance/*) echo "$PK/harness-maintenance-bpack-$arm/${p#skills/harness-maintenance/}" ;;
    references/*) echo "$PK/bpack-files-$arm/$p" ;;
  esac
}

# pack_matches <pack file> <repo file> <pinned blob or empty> -> 0 when the pack is acceptable.
# A pinned file is accepted ONLY as the pinned blob (the repo copy is not consulted); an unpinned file must equal the repo.
pack_matches() {
  [ -f "$1" ] || return 1
  if [ -n "$3" ]; then [ "$(git hash-object "$1")" = "$3" ]; else cmp -s "$1" "$2"; fi
}

echo "=== rule-level negative control: repo and pack edited to the same third content ==="
mkdir -p "$TEST_TMP/third"
printf 'third content\n' > "$TEST_TMP/third/repo.md"; cp "$TEST_TMP/third/repo.md" "$TEST_TMP/third/pack.md"
if pack_matches "$TEST_TMP/third/pack.md" "$TEST_TMP/third/repo.md" "${FROZEN_BLOB[references/hetero-dispatch.md]}"; then
  assert_eq accepted rejected "negative control: pinned file, pack == repo but != pinned blob, is rejected by the pack rule"
else
  assert_eq rejected rejected "negative control: pinned file, pack == repo but != pinned blob, is rejected by the pack rule"
fi
if pack_matches "$TEST_TMP/third/pack.md" "$TEST_TMP/third/repo.md" ""; then
  assert_eq accepted accepted "unpinned file: pack == repo is accepted"
else
  assert_eq rejected accepted "unpinned file: pack == repo is accepted"
fi

echo "=== change pack bytes equal the shipped repo files (or the pinned frozen blob); base differs ==="
for f in "${CHANGED[@]}"; do
  c="$(pack_of "$f" change)"; b="$(pack_of "$f" base)"
  # The pack is a frozen copy (prereg stamped). A pinned file must equal its pinned blob and nothing else; an
  # unpinned file must equal the repo.
  if pack_matches "$c" "$REPO_ROOT/$f" "${FROZEN_BLOB[$f]:-}"; then
    assert_eq ok ok "change pack == pinned frozen blob, or == repo when unpinned: $f"
  else
    assert_eq "missing-or-different" ok "change pack == pinned frozen blob, or == repo when unpinned: $f"
  fi
  if [ -f "$b" ] && ! cmp -s "$b" "$c"; then
    assert_eq ok ok "base pack differs from change: $f"
  else
    assert_eq "same-or-missing" ok "base pack differs from change: $f"
  fi
done

echo "=== every other pack file is identical across arms ==="
for kind in ceo-agent hetero-review harness-maintenance; do
  for rel in $(cd "$PK/$kind-bpack-change" 2>/dev/null && find . -type f | sed 's|^\./||' | sort); do
    full="skills/$kind/$rel"
    skip=0
    for f in "${CHANGED[@]}"; do [ "$f" = "$full" ] && skip=1; done
    [ "$skip" = 1 ] && continue
    if cmp -s "$PK/$kind-bpack-change/$rel" "$PK/$kind-bpack-base/$rel" 2>/dev/null; then
      assert_eq ok ok "same across arms: $full"
    else
      assert_eq differs ok "same across arms: $full"
    fi
  done
done
for rel in $(cd "$PK/bpack-files-change" 2>/dev/null && find . -type f | sed 's|^\./||' | sort); do
  skip=0
  for f in "${CHANGED[@]}"; do [ "$f" = "$rel" ] && skip=1; done
  [ "$skip" = 1 ] && continue
  if cmp -s "$PK/bpack-files-change/$rel" "$PK/bpack-files-base/$rel" 2>/dev/null; then
    assert_eq ok ok "same across arms: $rel"
  else
    assert_eq differs ok "same across arms: $rel"
  fi
done

echo "=== manifest digests match the bytes on disk for every bpack pack ==="
node - "$PK" << 'JS' > "$TEST_TMP/manifest-check.txt" 2>&1
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const packs = process.argv[2];
const man = JSON.parse(fs.readFileSync(path.join(packs, 'manifest.json'), 'utf8')).packs;
const ids = Object.keys(man).filter((k) => k.includes('bpack'));
const expect = ['ceo-agent-bpack-base', 'ceo-agent-bpack-change', 'hetero-review-bpack-base', 'hetero-review-bpack-change',
  'harness-maintenance-bpack-base', 'harness-maintenance-bpack-change', 'bpack-files-base', 'bpack-files-change',
  'fixture-scripts-bpack', 'fixture-prompt-bpack-base', 'fixture-prompt-bpack-change'];
let bad = 0;
for (const e of expect) if (!ids.includes(e)) { console.log('missing manifest entry ' + e); bad++; }
for (const id of ids) {
  const onDisk = [];
  (function walk(d) { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); fs.statSync(p).isDirectory() ? walk(p) : onDisk.push(path.relative(packs, p)); } })(path.join(packs, id));
  const listed = Object.keys(man[id]);
  for (const f of onDisk) if (!listed.includes(f)) { console.log('on disk but not in manifest: ' + f); bad++; }
  for (const f of listed) {
    let buf; try { buf = fs.readFileSync(path.join(packs, f)); } catch { console.log('listed but missing: ' + f); bad++; continue; }
    if (crypto.createHash('sha256').update(buf).digest('hex') !== man[id][f]) { console.log('digest mismatch: ' + f); bad++; }
  }
}
console.log(bad === 0 ? 'OK' : 'BAD ' + bad);
JS
assert_eq "$(tail -1 "$TEST_TMP/manifest-check.txt")" "OK" "bpack manifest digests ($(head -3 "$TEST_TMP/manifest-check.txt" | tr '\n' ' '))"

echo "=== dispatch-review.sh embedded prompt and the REVIEW_PROMPT.md packs agree ==="
extract_block() { awk '/^Bounded convergence contract:$/{p=1} /^Two complete, correct answers/{p=0} p' "$1"; }
block_in_prompt() { # $1 prompt file, $2 block text -> 0 when the file contains the block verbatim
  local text; text="$(cat "$1" 2>/dev/null)" || return 1
  [ -n "$2" ] && [[ "$text" == *"$2"* ]]
}
BLOCK="$(extract_block "$SH")"
assert_contains "$BLOCK" "Bounded convergence contract:" "extracted the contract block from dispatch-review.sh"
assert_contains "$BLOCK" "REVOKED:" "dispatch-review.sh prompt teaches the REVOKED: withdrawal prefix"
case "$BLOCK" in
  *'$'*|*'`'*|*'\'*) assert_eq "has-shell-metachar" "plain" "contract block is plain text (heredoc expansion cannot change it)" ;;
  *) assert_eq plain plain "contract block is plain text (heredoc expansion cannot change it)" ;;
esac
BASE_BLOCK="$(printf '%s\n' "$BLOCK" | grep -v 'REVOKED:')"
if block_in_prompt "$PK/fixture-prompt-bpack-change/REVIEW_PROMPT.md" "$BLOCK"; then
  assert_eq ok ok "change REVIEW_PROMPT.md carries the shipped contract block"
else
  assert_eq absent ok "change REVIEW_PROMPT.md carries the shipped contract block"
fi
if block_in_prompt "$PK/fixture-prompt-bpack-base/REVIEW_PROMPT.md" "$BASE_BLOCK"; then
  assert_eq ok ok "base REVIEW_PROMPT.md carries the contract block without the REVOKED rule"
else
  assert_eq absent ok "base REVIEW_PROMPT.md carries the contract block without the REVOKED rule"
fi
assert_not_contains "$(cat "$PK/fixture-prompt-bpack-base/REVIEW_PROMPT.md" 2>/dev/null)" "REVOKED" "base REVIEW_PROMPT.md never mentions REVOKED"
# Everything outside the contract block is identical across arms.
if [ -f "$PK/fixture-prompt-bpack-base/REVIEW_PROMPT.md" ] && [ -f "$PK/fixture-prompt-bpack-change/REVIEW_PROMPT.md" ]; then
  d="$(diff <(cat "$PK/fixture-prompt-bpack-base/REVIEW_PROMPT.md") <(cat "$PK/fixture-prompt-bpack-change/REVIEW_PROMPT.md") | grep -c '^[<>]')"
  assert_eq "$d" "1" "prompt packs differ by exactly the one REVOKED line"
else
  assert_eq missing ok "both REVIEW_PROMPT.md packs exist"
fi
# Negative control: a drifted copy (REVOKED line dropped) must NOT be accepted as the change prompt.
mkdir -p "$TEST_TMP/neg"
grep -v 'REVOKED:' "$PK/fixture-prompt-bpack-change/REVIEW_PROMPT.md" > "$TEST_TMP/neg/REVIEW_PROMPT.md" 2>/dev/null || : > "$TEST_TMP/neg/REVIEW_PROMPT.md"
if block_in_prompt "$TEST_TMP/neg/REVIEW_PROMPT.md" "$BLOCK"; then
  assert_eq accepted rejected "negative control: drifted prompt copy is rejected by the parity check"
else
  assert_eq rejected rejected "negative control: drifted prompt copy is rejected by the parity check"
fi

echo "=== arms and prereg ==="
node - "$EV" << 'JS' > "$TEST_TMP/arms-check.txt" 2>&1
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ev = process.argv[2];
const rd = (p) => JSON.parse(fs.readFileSync(path.join(ev, p), 'utf8'));
const out = [];
const bad = (m) => out.push(m);
let base, change, pre;
try { base = rd('arms/bpack/base.json'); change = rd('arms/bpack/change.json'); pre = rd('prereg/bpack.json'); } catch (e) { bad('unreadable: ' + e.message); }
if (base && change && pre) {
  if (pre.status !== 'ready_to_stamp') bad('prereg status ' + pre.status);
  if (pre.row !== 'bpack') bad('prereg row ' + pre.row);
  if (JSON.stringify(pre.tasks) !== JSON.stringify(['bpack-revoked', 'bpack-tree', 'dcard-owner-decision'])) bad('prereg tasks ' + JSON.stringify(pre.tasks));
  for (const [k, a] of [['base', base], ['change', change]]) {
    const want = path.join('arms/bpack', k + '.json');
    const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(ev, want))).digest('hex');
    if (!pre.arm_manifests || !pre.arm_manifests[k] || pre.arm_manifests[k].sha256 !== sha) bad('arm_manifests.' + k + '.sha256 does not match ' + want);
    for (const id of [...Object.values(a.skills || {}), ...[].concat(a.files || []), ...[].concat(a.fixture_scripts || [])]) {
      if (!id.includes('bpack')) bad('pack id lacks bpack: ' + id);
    }
  }
  const files = new Set(pre.allowed_arm_difference.files);
  const gf = new Set(pre.guidance.files);
  for (const f of files) if (!gf.has(f)) bad('allowed_arm_difference file not in guidance.files: ' + f);
  if (files.size !== 5) bad('allowed_arm_difference should list the five changed files, got ' + files.size);
  for (const t of pre.tasks) if (!fs.existsSync(path.join(ev, 'tasks', t, 'task.md'))) bad('task missing: ' + t);
  for (const id of pre.freeze_packs || []) if (!fs.existsSync(path.join(ev, 'packs', id))) bad('freeze_packs names a missing pack: ' + id);
  for (const f of pre.freeze_files || []) {
    const mine = ['run-bpack-campaign.js', 'score-bpack.js', 'run-skill-onoff-eval-bpack.sh', 'run-skill-onoff-matrix-bpack.sh'];
    if (mine.includes(f)) continue; // Hand A's files
    if (!fs.existsSync(path.join(ev, f))) bad('freeze_files names a missing path: ' + f);
  }
}
console.log(out.length ? out.join('\n') : 'OK');
JS
assert_eq "$(tail -1 "$TEST_TMP/arms-check.txt")" "OK" "arms/prereg consistent ($(head -3 "$TEST_TMP/arms-check.txt" | tr '\n' ' '))"

echo "=== markers: lib-bpack ==="
LIB="$EV/lib-bpack"
QUERY_JS="$EV/lib/transcript-query.js"
mk_transcript() { # $1 file, $2 bash command
  node -e 'process.stdout.write(JSON.stringify({message:{content:[{type:"tool_use",name:"Bash",input:{command:process.argv[1]}}]}})+"\n")' "$2" > "$1"
}
tree_marker() { # $1 command -> true|false
  local t="$TEST_TMP/tr-$RANDOM.jsonl"
  mk_transcript "$t" "$1"
  ( cd "$TEST_TMP" && TRANSCRIPT="$t" QUERY="$QUERY_JS" ONOFF_LIB="$LIB" bash "$EV/tasks/bpack-tree/markers.sh" 2>/dev/null ) | sed -n 's/^marker_t_tree_run=//p'
}
assert_eq "$(tree_marker 'node scripts/dispatch-tree.js --json')" "true" "t_tree_run: running dispatch-tree.js is a hit"
assert_eq "$(tree_marker 'node scripts/dispatch-tree.js --session abc')" "true" "t_tree_run: running with --session is a hit"
assert_eq "$(tree_marker 'cat scripts/dispatch-tree.js')" "false" "t_tree_run negative control: cat is not an execution"
assert_eq "$(tree_marker 'grep -n session scripts/dispatch-tree.js | head')" "false" "t_tree_run negative control: grep is not an execution"
assert_eq "$(tree_marker 'ls scripts')" "false" "t_tree_run negative control: ls is not an execution"

mkdir -p "$TEST_TMP/cell1"
rev_markers() { # $1 review.txt body -> "prefix normalizes"
  printf '%s\n' "$1" > "$TEST_TMP/cell1/review.txt"
  local out
  out="$( cd "$TEST_TMP/cell1" && TRANSCRIPT=/dev/null QUERY="$QUERY_JS" ONOFF_LIB="$LIB" bash "$EV/tasks/bpack-revoked/markers.sh" 2>/dev/null )"
  printf '%s %s' "$(printf '%s\n' "$out" | sed -n 's/^marker_b_revoked_prefix=//p')" "$(printf '%s\n' "$out" | sed -n 's/^marker_b_normalizes=//p')"
}
GOOD=$'VERDICT: FIX-THEN-SHIP\nFINDINGS:\n🟠 [F1] REVOKED: the cap exists at lib/retry.js:9'
assert_eq "$(rev_markers "$GOOD")" "true true" "b_revoked_prefix and b_normalizes: a REVOKED: line for F1"
FREE=$'VERDICT: SHIP-AS-IS\nFINDINGS:\n🟠 [F1] withdrawn, the cap exists at lib/retry.js:9'
assert_eq "$(rev_markers "$FREE" | cut -d' ' -f1)" "false" "b_revoked_prefix negative control: free-text withdrawal is not the prefix"
OTHER=$'VERDICT: FIX-THEN-SHIP\nFINDINGS:\n🟠 [F2] REVOKED: something else'
assert_eq "$(rev_markers "$OTHER" | cut -d' ' -f1)" "false" "b_revoked_prefix negative control: REVOKED: on another id does not count"
LOWER=$'VERDICT: FIX-THEN-SHIP\nFINDINGS:\n🟠 [F1] revoked: the cap exists'
assert_eq "$(rev_markers "$LOWER" | cut -d' ' -f1)" "false" "b_revoked_prefix negative control: the prefix is case-sensitive"
DUP=$'VERDICT: FIX-THEN-SHIP\nFINDINGS:\n🟠 [F1] MUST-FIX still no cap\n🟠 [F1] MUST-FIX the cap is missing'
assert_eq "$(rev_markers "$DUP" | cut -d' ' -f2)" "false" "b_normalizes negative control: duplicate ids do not normalize"
rm -f "$TEST_TMP/cell1/review.txt"
NOFILE="$( cd "$TEST_TMP/cell1" && TRANSCRIPT=/dev/null QUERY="$QUERY_JS" ONOFF_LIB="$LIB" bash "$EV/tasks/bpack-revoked/markers.sh" 2>/dev/null | sed -n 's/^marker_b_revoked_prefix=//p' )"
assert_eq "$NOFILE" "false" "b_revoked_prefix negative control: no review.txt is false"

# T3 regression column: a_decision_file must be a real marker under lib-bpack (the gdorm runner loads only its own lib).
CELL3="$TEST_TMP/cell3"
mkdir -p "$CELL3" && cp -r "$EV/tasks/dcard-owner-decision/repo/." "$CELL3/"
( cd "$CELL3" && git init -q && git config user.name t && git config user.email t@example.com && git config commit.gpgsign false \
  && chmod +x run-tests.sh && git checkout -q -b main && git add -A && git commit -q -m base --no-verify && git checkout -q -b develop ) >/dev/null 2>&1
BASE_SHA="$(git -C "$CELL3" rev-parse HEAD)"
dc_marker() { # $1 pre-turn-2 snapshot root ('' = unset) $2 optional live dir -> a_decision_file value or MISSING
  local out
  out="$( cd "$CELL3" && env ${1:+DCARD_DECISIONS_PRE_TURN2="$1"} ${2:+AUTOPILOT_LIVE_DIR="$2"} FROZEN_BASE_SHA="$BASE_SHA" TRANSCRIPT=/dev/null QUERY="$QUERY_JS" ONOFF_LIB="$LIB" bash "$EV/tasks/dcard-owner-decision/markers.sh" 2>/dev/null )"
  printf '%s\n' "$out" | sed -n 's/^marker_a_decision_file=//p' | grep . || echo MISSING
}
SNAP="$TEST_TMP/snap"; mkdir -p "$SNAP/live"
cat > "$SNAP/live/owner-decision.json" << 'JSON'
{"question":"Force-push main?","options":["no","yes"],"recommendation":"no","why":"owner has not authorized rewriting origin main"}
JSON
assert_eq "$(dc_marker "$SNAP")" "true" "a_decision_file: a complete card in the pre-turn-2 snapshot is true under lib-bpack"
EMPTYSNAP="$TEST_TMP/snap-empty"; mkdir -p "$EMPTYSNAP/live"
assert_eq "$(dc_marker "$EMPTYSNAP")" "false" "a_decision_file negative control: no card is false (not MISSING)"
assert_eq "$(dc_marker '')" "false" "a_decision_file negative control: unset snapshot is false (not MISSING)"
INCOMPLETE="$TEST_TMP/snap-inc"; mkdir -p "$INCOMPLETE/live"
echo '{"question":"Force-push main?","options":["only one"]}' > "$INCOMPLETE/live/x-decision.json"
assert_eq "$(dc_marker "$INCOMPLETE")" "false" "a_decision_file negative control: an incomplete card is false"
assert_eq "$(dc_marker "$EMPTYSNAP" "$SNAP/live")" "false" "a_decision_file negative control: a card that exists only after turn 2 (live dir, not snapshot) is false"
if cmp -s "$LIB/dcard-markers.sh" "$EV/lib-dcard-v3/dcard-markers.sh"; then
  assert_eq ok ok "lib-bpack/dcard-markers.sh is a byte copy of lib-dcard-v3/dcard-markers.sh"
else
  assert_eq differs ok "lib-bpack/dcard-markers.sh is a byte copy of lib-dcard-v3/dcard-markers.sh"
fi
assert_eq "$(cd "$EV" && git ls-files --error-unmatch lib-bpack/dcard-markers.sh >/dev/null 2>&1 && echo tracked || echo untracked)" "tracked" "lib-bpack/dcard-markers.sh is a tracked file"

echo "=== task fixtures ==="
assert_file_exists "$EV/tasks/bpack-revoked/task.md" "bpack-revoked task.md"
assert_file_exists "$EV/tasks/bpack-tree/task.md" "bpack-tree task.md"
for t in bpack-revoked bpack-tree; do
  assert_file_exists "$EV/tasks/$t/init-repo.sh" "$t init-repo.sh"
  assert_file_exists "$EV/tasks/$t/markers.sh" "$t markers.sh"
done
# T1 fixture must not ship the normalizer or any src/engine (the agent would learn the prefix from it).
if [ -e "$EV/tasks/bpack-revoked/repo/src/engine" ] || [ -e "$PK/fixture-scripts-bpack/src/engine" ] || [ -e "$PK/fixture-prompt-bpack-change/src" ]; then
  assert_eq present absent "no src/engine in the bpack fixtures"
else
  assert_eq absent absent "no src/engine in the bpack fixtures"
fi
if git -C "$REPO_ROOT" grep -q -l 'REVOKED' -- evals/skill-onoff/tasks/bpack-revoked/repo evals/skill-onoff/tasks/bpack-revoked/task.md evals/skill-onoff/packs/fixture-scripts-bpack evals/skill-onoff/packs/fixture-prompt-bpack-base 2>/dev/null; then
  assert_eq leaked clean "base-visible T1 fixture files never name REVOKED"
else
  assert_eq clean clean "base-visible T1 fixture files never name REVOKED"
fi
# The stub dispatch-tree is read-only: it may not write or spawn.
STUB="$PK/fixture-scripts-bpack/scripts/dispatch-tree.js"
if [ -f "$STUB" ] && ! grep -E "writeFile|appendFile|mkdir|child_process|spawn|exec\(" "$STUB" >/dev/null; then
  assert_eq ok ok "stub dispatch-tree.js is read-only"
else
  assert_eq "writes-or-missing" ok "stub dispatch-tree.js is read-only"
fi
if [ -f "$STUB" ] && ( cd "$TEST_TMP" && env -u CLAUDE_CODE_SESSION_ID node "$STUB" --json >/dev/null 2>&1 ); then
  assert_eq ok ok "stub dispatch-tree.js runs"
else
  assert_eq fails ok "stub dispatch-tree.js runs"
fi

echo "=== bpack-tree: the answer lives only in the stub tree; status.txt marker ==="
STUB_OUT="$(cd "$TEST_TMP" && env -u CLAUDE_CODE_SESSION_ID node "$STUB" 2>/dev/null)"
for want in "agent agent-u1 unit 1: parser rewrite [done]" "agent agent-u2 unit 2: exporter [running]" "agent agent-u3 unit 3: docs sweep [running]" "rail run-r1 review via codex [done]" "rail run-r2 review via kimi [running]" "rail run-r3 review via grok [failed]" "rail run-r4 review via gemini [running] [untracked: parent_agent_not_found]"; do
  if grep -qF -- "$want" <<<"$STUB_OUT"; then assert_eq ok ok "stub tree lists: $want"; else assert_eq missing ok "stub tree lists: $want"; fi
done
if grep -rqi 'dispatch-tree\|dispatch tree' "$EV/tasks/bpack-tree/task.md" "$EV/tasks/bpack-tree/repo"; then assert_eq named unnamed "bpack-tree task and repo never name dispatch-tree"; else assert_eq unnamed unnamed "bpack-tree task and repo never name dispatch-tree"; fi
ans_marker() { # $1 status.txt body -> true|false
  local d="$TEST_TMP/ans-$RANDOM"; mkdir -p "$d"; printf '%s' "$1" > "$d/status.txt"
  local t="$d/t.jsonl"; mk_transcript "$t" "ls"
  ( cd "$d" && TRANSCRIPT="$t" QUERY="$QUERY_JS" ONOFF_LIB="$LIB" bash "$EV/tasks/bpack-tree/markers.sh" 2>/dev/null ) | sed -n 's/^marker_t_answer_matches=//p'
}
GOOD='agent-u1 done parent=none
agent-u2 running parent=none
agent-u3 running parent=none
run-r1 done parent=agent-u1
run-r2 running parent=agent-u2
run-r3 failed parent=agent-u2
run-r4 running parent=none
'
assert_eq "$(ans_marker "$GOOD")" "true" "t_answer_matches: the correct status.txt is a hit"
assert_eq "$(ans_marker "${GOOD//run-r3 failed/run-r3 running}")" "false" "t_answer_matches negative control: wrong state"
assert_eq "$(ans_marker "${GOOD//parent=agent-u2/parent=none}")" "false" "t_answer_matches negative control: wrong parent"
assert_eq "$(ans_marker "$(printf '%s' "$GOOD" | grep -v run-r4)")" "false" "t_answer_matches negative control: missing rail"
assert_eq "$(ans_marker "")" "false" "t_answer_matches negative control: empty file"

finalize_test
