#!/usr/bin/env bash
# 2026-08-20 G1 transport-incident fixes: exit-first classification in the plan-review
# normalizer, and effort-derived seat-timeout defaults.
. "$(dirname "$0")/lib.sh"

# ── 2a: a failed runner reports ITS classification, not raw_binding_mismatch ──
OUT=$(node -e '
const { createRunnerTransportEnvelope } = require(process.argv[1] + "/src/transport/runner-envelope");
const { normalizePlanReviewPayload } = require(process.argv[1] + "/scripts/lib/plan-review-normalize");
const expected = { runner: "codex", model: "gpt-x", operation: "plan-review" };
const mk = (child, privateRawReference) => createRunnerTransportEnvelope({
  runner: "codex", model: "gpt-x", operation: "plan-review",
  argv: ["t"], cwd: "/", child, privateRawReference,
});
// timeout-killed seat: nonzero exit, 0-byte stdout, NO raw reference (the incident shape)
const dead = mk({ status: 3, signal: null, error: null, stdout: Buffer.alloc(0), stderr: "" }, null);
const r1 = normalizePlanReviewPayload({ envelope: dead, raw: Buffer.alloc(0), expected });
// successful run whose raw bytes do NOT match the receipt digest → binding still guards
const okChild = { status: 0, signal: null, error: null, stdout: Buffer.from("{}"), stderr: "" };
const bound = mk(okChild, { kind: "private-file", locator: "/x", digest: "0".repeat(64) });
const r2 = normalizePlanReviewPayload({ envelope: bound, raw: Buffer.from("{}"), expected });
console.log(JSON.stringify({ dead: r1.transport_status, mismatch: r2.transport_status }));
' "$REPO_ROOT")
assert_eq "$(node -e 'console.log(JSON.parse(process.argv[1]).dead)' "$OUT")" "exit_failure" \
  "failed runner classifies as exit_failure, not raw_binding_mismatch"
assert_eq "$(node -e 'console.log(JSON.parse(process.argv[1]).mismatch)' "$OUT")" "raw_binding_mismatch" \
  "digest mismatch on a SUCCESSFUL run is still caught"

# ── 2b: effort-derived seat timeout defaults; explicit --timeout always wins ──
T() { node -e 'const {effortSeatTimeoutSeconds}=require(process.argv[1]+"/scripts/lib/plan-review-timeout");console.log(effortSeatTimeoutSeconds(process.argv[2], process.argv[3]==="null"?null:Number(process.argv[3])))' "$REPO_ROOT" "$1" "$2"; }
assert_eq "$(T max null)"    "1200" "max defaults to 20m"
assert_eq "$(T xhigh null)"  "1200" "xhigh defaults to 20m"
assert_eq "$(T high null)"   "600"  "high defaults to 10m"
assert_eq "$(T medium null)" "300"  "unknown/medium keeps 5m"
assert_eq "$(T max 300)"     "300"  "explicit timeout overrides the effort default"

# L1 drift guard: the dispatcher actually consults the policy at the bounded-seat site.
assert_contains "$(grep -c 'effortSeatTimeoutSeconds(selected.effort' "$REPO_ROOT/scripts/dispatch-plan-review.js")" "1" \
  "dispatch-plan-review wires the per-seat timeout policy"

finalize_test
