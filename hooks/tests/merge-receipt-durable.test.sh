#!/usr/bin/env bash
# BL-0075 — optional write-ahead merge receipt. Default stays off.
# RED at 3021f434d: FAIL 35 passed, 13 failed — crash var without AUTOPILOT_TEST_SEAMS killed the process (exit 137, in_progress receipt with only edge 1); inspect rejected the completed receipt (not an in-progress execution receipt); preflight halt wrote no receipt so inspect could not classify edges.
. "$(dirname "$0")/lib.sh"

SBX="$TEST_TMP/repo"
git init -q -b target "$SBX"
git -C "$SBX" config user.name "BL0075 Fixture"
git -C "$SBX" config user.email "bl0075@example.invalid"
printf 'base\n' >"$SBX/base.txt"
git -C "$SBX" add .
git -C "$SBX" commit -qm base
git -C "$SBX" branch edge-a
git -C "$SBX" branch edge-b
WT_A="$TEST_TMP/edge-a"
WT_B="$TEST_TMP/edge-b"
git -C "$SBX" worktree add -q "$WT_A" edge-a
git -C "$SBX" worktree add -q "$WT_B" edge-b
printf 'a\n' >"$WT_A/a.txt"
git -C "$WT_A" add a.txt
git -C "$WT_A" commit -qm edge-a
printf 'b\n' >"$WT_B/b.txt"
git -C "$WT_B" add b.txt
git -C "$WT_B" commit -qm edge-b

visible_files() {
  find "$SBX" "$WT_A" "$WT_B" \( -path '*/.git' -o -path '*/.git/*' \) -prune -o -type f -print | sort
}

build_request() {
  local out="$1"
  node - "$REPO_ROOT" "$SBX" "$WT_A" "$WT_B" "$out" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const repo = process.argv[3];
const sourceA = process.argv[4];
const sourceB = process.argv[5];
const out = process.argv[6];
const { buildMergeIntent, preflightMergeIntent } = require(path.join(root, 'src/status/merge-intent'));
const sealed = buildMergeIntent({
  repo,
  root_run_id: 'bl0075-receipt',
  edges: [
    {
      source_ref: 'refs/heads/edge-a',
      source_worktree: sourceA,
      target_ref: 'refs/heads/target',
      target_worktree: repo,
      mode: 'no-ff',
      required_result: 'source-contained',
    },
    {
      source_ref: 'refs/heads/edge-b',
      source_worktree: sourceB,
      target_ref: 'refs/heads/target',
      target_worktree: repo,
      mode: 'no-ff',
      required_result: 'source-contained',
    },
  ],
  forbidden_reverse_edges: [],
  preservation_policy: { allowed_path_prefixes: ['consumer/'] },
});
const preflight = preflightMergeIntent(sealed);
if (!['safe', 'overlapping'].includes(preflight.status) || preflight.blockers.length !== 0) {
  console.error(JSON.stringify(preflight));
  process.exit(2);
}
fs.writeFileSync(out, `${JSON.stringify({
  sealed_manifest: sealed,
  manifest_seal: sealed.seal,
  preflight,
  approved_preservation: [],
})}\n`);
NODE
}

REQUEST="$TEST_TMP/request.json"
build_request "$REQUEST"
assert_eq "$?" "0" "fixture request builds"

REF_A="$(git -C "$SBX" rev-parse refs/heads/edge-a)"
REF_B="$(git -C "$SBX" rev-parse refs/heads/edge-b)"
REF_TARGET="$(git -C "$SBX" rev-parse refs/heads/target)"
PORCELAIN="$(git -C "$SBX" status --porcelain=v1 --untracked-files=all)"
VISIBLE_BEFORE="$(visible_files)"

# (a) crash after edge 1 leaves an in_progress receipt; inspect is read-only.
# The seam is inert unless AUTOPILOT_TEST_SEAMS=1 is also set.
CRASH_DIR="$TEST_TMP/crash-receipts"
mkdir -p "$CRASH_DIR"
AUTOPILOT_TEST_SEAMS=1 AUTOPILOT_MERGE_CRASH_AFTER_EDGE=1 \
  node "$REPO_ROOT/bin/autopilot.js" merge execute \
    --request "$REQUEST" --receipt-dir "$CRASH_DIR" --json \
    >"$TEST_TMP/crash.out" 2>"$TEST_TMP/crash.err" || CRASH_RC=$?
CRASH_RC="${CRASH_RC:-0}"
# SIGKILL is 137. Any death after a partial merge is acceptable as long as the receipt landed.
assert_neq "$CRASH_RC" "0" "crash seam does not exit 0"
RECEIPT="$CRASH_DIR/merge-execution-receipt.json"
assert_file_exists "$RECEIPT" "in_progress receipt exists after the crash seam"
STATE="$(node -e 'const r=require(process.argv[1]); console.log(r.state); console.log(r.edges.map(e=>e.sequence+":"+e.status).join(","));' "$RECEIPT")"
assert_eq "$(printf '%s\n' "$STATE" | head -n 1)" "in_progress" "crashed receipt state is in_progress"
assert_eq "$(printf '%s\n' "$STATE" | tail -n 1)" "1:executed" "crashed receipt records only edge 1 as executed"
node "$REPO_ROOT/scripts/validate-json-schema.js" \
  --schema "$REPO_ROOT/schemas/merge-execution-receipt.schema.json" \
  --document "$RECEIPT"
assert_eq "$?" "0" "in_progress receipt validates against the schema"
BEFORE_INSPECT="$(sha256sum "$RECEIPT" && visible_files && git -C "$SBX" status --porcelain=v1 --untracked-files=all && find "$CRASH_DIR" -printf '%p %s\n' | sort)"
INSPECT="$(node "$REPO_ROOT/bin/autopilot.js" merge execute --inspect-receipt "$RECEIPT" 2>"$TEST_TMP/inspect.err")"
assert_eq "$?" "0" "inspect exits 0"
assert_contains "$INSPECT" "edge 1 merged" "inspect marks edge 1 merged"
assert_contains "$INSPECT" "edge 2 not_merged" "inspect marks edge 2 not merged"
assert_eq "$(cat "$TEST_TMP/inspect.err")" "" "inspect writes nothing to stderr"
AFTER_INSPECT="$(sha256sum "$RECEIPT" && visible_files && git -C "$SBX" status --porcelain=v1 --untracked-files=all && find "$CRASH_DIR" -printf '%p %s\n' | sort)"
assert_eq "$AFTER_INSPECT" "$BEFORE_INSPECT" "inspect writes nothing"
assert_eq "$(git -C "$SBX" rev-parse refs/heads/edge-a)" "$REF_A" "crash leaves source edge-a untouched"
assert_eq "$(git -C "$SBX" rev-parse refs/heads/edge-b)" "$REF_B" "crash leaves source edge-b untouched"
assert_neq "$(git -C "$SBX" rev-parse refs/heads/target)" "$REF_TARGET" "crash leaves edge 1 merged on target"

# (b) a normal run ends with a completed terminal receipt.
git -C "$SBX" reset --hard -q "$REF_TARGET"
DONE_DIR="$TEST_TMP/done-receipts"
mkdir -p "$DONE_DIR"
node "$REPO_ROOT/bin/autopilot.js" merge execute \
  --request "$REQUEST" --receipt-dir "$DONE_DIR" --json \
  >"$TEST_TMP/done.out" 2>"$TEST_TMP/done.err"
assert_eq "$?" "0" "normal receipt run exits 0"
DONE_RECEIPT="$DONE_DIR/merge-execution-receipt.json"
assert_file_exists "$DONE_RECEIPT" "terminal receipt exists"
DONE_STATE="$(node -e 'const r=require(process.argv[1]); if(!r.receipt_digest) process.exit(2); console.log([r.state,r.status,r.edges.length,r.edges.every(e=>e.status==="executed")].join("\t"));' "$DONE_RECEIPT")"
assert_eq "$DONE_STATE" "completed	complete	2	true" "terminal receipt is completed with both edges"
DONE_INSPECT="$(node "$REPO_ROOT/bin/autopilot.js" merge execute --inspect-receipt "$DONE_RECEIPT" 2>"$TEST_TMP/done-inspect.err")"
assert_eq "$?" "0" "inspect of a completed receipt exits 0"
assert_contains "$DONE_INSPECT" "edge 1 merged" "completed inspect marks edge 1 merged"
assert_contains "$DONE_INSPECT" "edge 2 merged" "completed inspect marks edge 2 merged"
assert_eq "$(cat "$TEST_TMP/done-inspect.err")" "" "completed inspect writes nothing to stderr"
node "$REPO_ROOT/scripts/validate-json-schema.js" \
  --schema "$REPO_ROOT/schemas/merge-execution-receipt.schema.json" \
  --document "$DONE_RECEIPT"
assert_eq "$?" "0" "terminal receipt validates against the schema"

# (c) missing or unwritable receipt_dir fails before any merge.
FRESH="$TEST_TMP/fresh"
git init -q -b target "$FRESH"
git -C "$FRESH" config user.name "BL0075 Fresh"
git -C "$FRESH" config user.email "bl0075-fresh@example.invalid"
printf 'base\n' >"$FRESH/base.txt"
git -C "$FRESH" add .
git -C "$FRESH" commit -qm base
git -C "$FRESH" branch edge-a
git -C "$FRESH" branch edge-b
F_A="$TEST_TMP/fresh-a"
F_B="$TEST_TMP/fresh-b"
git -C "$FRESH" worktree add -q "$F_A" edge-a
git -C "$FRESH" worktree add -q "$F_B" edge-b
printf 'a\n' >"$F_A/a.txt"
git -C "$F_A" add a.txt
git -C "$F_A" commit -qm edge-a
printf 'b\n' >"$F_B/b.txt"
git -C "$F_B" add b.txt
git -C "$F_B" commit -qm edge-b
FRESH_REQUEST="$TEST_TMP/fresh-request.json"
build_request_fresh() {
  node - "$REPO_ROOT" "$FRESH" "$F_A" "$F_B" "$FRESH_REQUEST" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const repo = process.argv[3];
const sourceA = process.argv[4];
const sourceB = process.argv[5];
const out = process.argv[6];
const { buildMergeIntent, preflightMergeIntent } = require(path.join(root, 'src/status/merge-intent'));
const sealed = buildMergeIntent({
  repo,
  root_run_id: 'bl0075-fresh',
  edges: [
    {
      source_ref: 'refs/heads/edge-a', source_worktree: sourceA,
      target_ref: 'refs/heads/target', target_worktree: repo,
      mode: 'no-ff', required_result: 'source-contained',
    },
    {
      source_ref: 'refs/heads/edge-b', source_worktree: sourceB,
      target_ref: 'refs/heads/target', target_worktree: repo,
      mode: 'no-ff', required_result: 'source-contained',
    },
  ],
  forbidden_reverse_edges: [],
  preservation_policy: { allowed_path_prefixes: ['consumer/'] },
});
const preflight = preflightMergeIntent(sealed);
fs.writeFileSync(out, `${JSON.stringify({
  sealed_manifest: sealed, manifest_seal: sealed.seal, preflight, approved_preservation: [],
})}\n`);
NODE
}
build_request_fresh
FRESH_TARGET="$(git -C "$FRESH" rev-parse refs/heads/target)"
FRESH_PORCELAIN="$(git -C "$FRESH" status --porcelain=v1 --untracked-files=all)"
FRESH_REFS="$(git -C "$FRESH" for-each-ref --format='%(refname) %(objectname)')"
node "$REPO_ROOT/bin/autopilot.js" merge execute \
  --request "$FRESH_REQUEST" --receipt-dir "$TEST_TMP/does-not-exist" --json \
  >"$TEST_TMP/missing.out" 2>"$TEST_TMP/missing.err" || MISSING_RC=$?
MISSING_RC="${MISSING_RC:-0}"
assert_neq "$MISSING_RC" "0" "missing receipt_dir exits nonzero"
assert_contains "$(cat "$TEST_TMP/missing.err")" "receipt_dir" "missing receipt_dir explains itself on stderr"
assert_eq "$(git -C "$FRESH" rev-parse refs/heads/target)" "$FRESH_TARGET" "missing receipt_dir does not move target"
assert_eq "$(git -C "$FRESH" status --porcelain=v1 --untracked-files=all)" "$FRESH_PORCELAIN" \
  "missing receipt_dir leaves the worktree unchanged"
assert_eq "$(git -C "$FRESH" for-each-ref --format='%(refname) %(objectname)')" "$FRESH_REFS" \
  "missing receipt_dir leaves refs unchanged"
LOCKED="$TEST_TMP/locked-receipts"
mkdir -p "$LOCKED"
chmod 555 "$LOCKED"
node "$REPO_ROOT/bin/autopilot.js" merge execute \
  --request "$FRESH_REQUEST" --receipt-dir "$LOCKED" --json \
  >"$TEST_TMP/locked.out" 2>"$TEST_TMP/locked.err" || LOCKED_RC=$?
LOCKED_RC="${LOCKED_RC:-0}"
chmod 755 "$LOCKED" || true
assert_neq "$LOCKED_RC" "0" "unwritable receipt_dir exits nonzero"
assert_contains "$(cat "$TEST_TMP/locked.err")" "receipt_dir" "unwritable receipt_dir explains itself on stderr"
assert_eq "$(git -C "$FRESH" rev-parse refs/heads/target)" "$FRESH_TARGET" "unwritable receipt_dir does not move target"
assert_eq "$(git -C "$FRESH" status --porcelain=v1 --untracked-files=all)" "$FRESH_PORCELAIN" \
  "unwritable receipt_dir leaves the worktree unchanged"
assert_eq "$(git -C "$FRESH" for-each-ref --format='%(refname) %(objectname)')" "$FRESH_REFS" \
  "unwritable receipt_dir leaves refs unchanged"
assert_eq "$(find "$LOCKED" -type f | wc -l | tr -d ' ')" "0" "unwritable receipt_dir creates no receipt file"

# Halt at preflight, before any edge: a terminal halted receipt distinguishes
# "rejected" from "never started". Repo stays put. Inspect classifies edges.
HALT_REQ="$TEST_TMP/halt-request.json"
node - "$FRESH_REQUEST" "$HALT_REQ" <<'NODE'
'use strict';
const fs = require('fs');
const request = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
delete request.preflight.receipt_digest;
fs.writeFileSync(process.argv[3], `${JSON.stringify(request)}\n`);
NODE
HALT_DIR="$TEST_TMP/halt-receipts"
mkdir -p "$HALT_DIR"
node "$REPO_ROOT/bin/autopilot.js" merge execute \
  --request "$HALT_REQ" --receipt-dir "$HALT_DIR" --json \
  >"$TEST_TMP/halt.out" 2>"$TEST_TMP/halt.err" || HALT_RC=$?
HALT_RC="${HALT_RC:-0}"
assert_neq "$HALT_RC" "0" "preflight halt exits nonzero"
HALT_RECEIPT="$HALT_DIR/merge-execution-receipt.json"
assert_file_exists "$HALT_RECEIPT" "preflight halt writes a terminal receipt"
HALT_STATE="$(node -e 'const r=require(process.argv[1]); console.log([r.state,r.status,r.halt_reason,r.edges.length].join("\t"));' "$HALT_RECEIPT")"
assert_eq "$HALT_STATE" "halted	halted	preflight_missing	0" "preflight halt receipt is halted with no edges"
node "$REPO_ROOT/scripts/validate-json-schema.js" \
  --schema "$REPO_ROOT/schemas/merge-execution-receipt.schema.json" \
  --document "$HALT_RECEIPT"
assert_eq "$?" "0" "halted validation receipt validates against the schema"
assert_eq "$(git -C "$FRESH" rev-parse refs/heads/target)" "$FRESH_TARGET" "preflight halt does not move target"
HALT_INSPECT="$(node "$REPO_ROOT/bin/autopilot.js" merge execute --inspect-receipt "$HALT_RECEIPT" 2>"$TEST_TMP/halt-inspect.err")"
assert_eq "$?" "0" "inspect of a halted receipt exits 0"
assert_contains "$HALT_INSPECT" "edge 1 not_merged" "halted inspect marks edge 1 not merged"
assert_contains "$HALT_INSPECT" "edge 2 not_merged" "halted inspect marks edge 2 not merged"
assert_eq "$(cat "$TEST_TMP/halt-inspect.err")" "" "halted inspect writes nothing to stderr"

# Crash variable alone must not kill a production run.
NOSEAM_DIR="$TEST_TMP/noseam-receipts"
mkdir -p "$NOSEAM_DIR"
unset AUTOPILOT_TEST_SEAMS || true
AUTOPILOT_MERGE_CRASH_AFTER_EDGE=1 \
  node "$REPO_ROOT/bin/autopilot.js" merge execute \
    --request "$FRESH_REQUEST" --receipt-dir "$NOSEAM_DIR" --json \
    >"$TEST_TMP/noseam.out" 2>"$TEST_TMP/noseam.err"
assert_eq "$?" "0" "crash variable without the test switch still exits 0"
NOSEAM_STATE="$(node -e 'const r=require(process.argv[1]); console.log([r.state,r.status,r.edges.length].join("\t"));' "$NOSEAM_DIR/merge-execution-receipt.json")"
assert_eq "$NOSEAM_STATE" "completed	complete	2" "crash variable without the test switch writes a completed receipt"

# Null request follows the same path as base a007fa65e (kind + message).
node - "$REPO_ROOT" <<'NODE'
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const root = process.argv[2];
const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'bl0075-base-'));
const src = path.join(shim, 'src');
fs.mkdirSync(path.join(src, 'merge'), { recursive: true });
for (const name of fs.readdirSync(path.join(root, 'src'))) {
  if (name === 'merge') continue;
  fs.symlinkSync(path.join(root, 'src', name), path.join(src, name));
}
fs.writeFileSync(
  path.join(src, 'merge', 'cli.js'),
  execFileSync('git', ['-C', root, 'show', 'a007fa65e:src/merge/cli.js']),
);
const base = require(path.join(src, 'merge', 'cli.js'));
const current = require(path.join(root, 'src', 'merge', 'cli.js'));
function summarize(fn) {
  try {
    const receipt = fn(null);
    return {
      kind: 'return',
      message: receipt && receipt.halt_reason ? String(receipt.halt_reason) : '',
      status: receipt && receipt.status ? String(receipt.status) : '',
    };
  } catch (error) {
    return {
      kind: 'throw',
      message: error && error.message ? String(error.message) : '',
      status: '',
    };
  }
}
const left = summarize(base.executeMergeIntent);
const right = summarize(current.executeMergeIntent);
if (left.kind !== right.kind || left.message !== right.message || left.status !== right.status) {
  console.error(JSON.stringify({ left, right }));
  process.exit(1);
}
NODE
assert_eq "$?" "0" "null request matches base a007fa65e by kind and message"

# (d) without receipt_dir the merge still runs and creates no receipt file.
NEG="$TEST_TMP/neg"
git init -q -b target "$NEG"
git -C "$NEG" config user.name "BL0075 Neg"
git -C "$NEG" config user.email "bl0075-neg@example.invalid"
printf 'base\n' >"$NEG/base.txt"
git -C "$NEG" add .
git -C "$NEG" commit -qm base
git -C "$NEG" branch edge-a
git -C "$NEG" branch edge-b
N_A="$TEST_TMP/neg-a"
N_B="$TEST_TMP/neg-b"
git -C "$NEG" worktree add -q "$N_A" edge-a
git -C "$NEG" worktree add -q "$N_B" edge-b
printf 'a\n' >"$N_A/a.txt"
git -C "$N_A" add a.txt
git -C "$N_A" commit -qm edge-a
printf 'b\n' >"$N_B/b.txt"
git -C "$N_B" add b.txt
git -C "$N_B" commit -qm edge-b
NEG_REQUEST="$TEST_TMP/neg-request.json"
node - "$REPO_ROOT" "$NEG" "$N_A" "$N_B" "$NEG_REQUEST" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const repo = process.argv[3];
const sourceA = process.argv[4];
const sourceB = process.argv[5];
const out = process.argv[6];
const { buildMergeIntent, preflightMergeIntent } = require(path.join(root, 'src/status/merge-intent'));
const sealed = buildMergeIntent({
  repo,
  root_run_id: 'bl0075-neg',
  edges: [
    {
      source_ref: 'refs/heads/edge-a', source_worktree: sourceA,
      target_ref: 'refs/heads/target', target_worktree: repo,
      mode: 'no-ff', required_result: 'source-contained',
    },
    {
      source_ref: 'refs/heads/edge-b', source_worktree: sourceB,
      target_ref: 'refs/heads/target', target_worktree: repo,
      mode: 'no-ff', required_result: 'source-contained',
    },
  ],
  forbidden_reverse_edges: [],
  preservation_policy: { allowed_path_prefixes: ['consumer/'] },
});
const preflight = preflightMergeIntent(sealed);
fs.writeFileSync(out, `${JSON.stringify({
  sealed_manifest: sealed, manifest_seal: sealed.seal, preflight, approved_preservation: [],
})}\n`);
NODE
node "$REPO_ROOT/bin/autopilot.js" merge execute --request "$NEG_REQUEST" --json \
  >"$TEST_TMP/neg.out" 2>"$TEST_TMP/neg.err"
assert_eq "$?" "0" "merge without receipt_dir still exits 0"
assert_eq "$(find "$TEST_TMP" -name 'merge-execution-receipt.json' -printf '%p\n' | grep -v -e crash-receipts -e done-receipts -e halt-receipts -e noseam-receipts | wc -l | tr -d ' ')" "0" \
  "without receipt_dir no receipt file is created"
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(Object.prototype.hasOwnProperty.call(r,"state")||Object.prototype.hasOwnProperty.call(r,"intent_edges")) process.exit(1);' "$TEST_TMP/neg.out"
assert_eq "$?" "0" "without receipt_dir the stdout receipt has no durable fields"

finalize_test
