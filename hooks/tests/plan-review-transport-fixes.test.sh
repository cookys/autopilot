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

# ── 3: unratified salvage on the envelope rail (verdict-bytes preservation, v2.34.33) ──
# Frozen admission matrix (plan R3 §3 + g2-adjudication #0/#3/#5): salvage runs the SAME
# purpose-bound parse over failure-classification bytes and lands in a non-authoritative
# `unratified` observation. Authoritative fields are byte-identical on every path.
OUT=$(node -e '
const { createRunnerTransportEnvelope } = require(process.argv[1] + "/src/transport/runner-envelope");
const { normalizePlanReviewPayload } = require(process.argv[1] + "/scripts/lib/plan-review-normalize");
const crypto = require("crypto");
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const expected = { runner: "codex", model: "gpt-x", operation: "plan-review" };
const mk = (child, ref, hints) => createRunnerTransportEnvelope({
  runner: "codex", model: "gpt-x", operation: "plan-review",
  argv: ["t"], cwd: "/", child, privateRawReference: ref, outcomeHints: hints,
});
const norm = (envelope, raw) => normalizePlanReviewPayload({ envelope, raw, expected });
const failChild = (out) => ({ status: 3, signal: null, error: null, stdout: out, stderr: "" });
const STOP = JSON.stringify({ verdict: "STOP", findings: [] });
const READY = JSON.stringify({ verdict: "READY", findings: [] });
const ref = (b) => ({ kind: "private-file", locator: "/x", digest: sha(b) });
const results = {};
// N1: exit_failure + digest-bound strict STOP payload → salvaged, classification preserved
{ const b = Buffer.from(STOP);
  const r = norm(mk(failChild(b), ref(b)), b);
  results.n1 = { t: r.transport_status, sem: r.semantic_status, p: r.payload,
    u: r.unratified ? r.unratified.payload.verdict : null,
    ps: r.unratified ? r.unratified.parser_status : null }; }
// N2 (C-incident, frozen 2026-08-20 shape): 0-byte, no reference → null salvage
{ const b = Buffer.alloc(0);
  const r = norm(mk(failChild(b), null), b);
  results.n2 = { t: r.transport_status, u: r.unratified }; }
// N3 (fixture D): failure + reference digest MISMATCH → null salvage, classification kept
{ const b = Buffer.from(STOP);
  const r = norm(mk(failChild(b), { kind: "private-file", locator: "/x", digest: "0".repeat(64) }), b);
  results.n3 = { t: r.transport_status, u: r.unratified }; }
// N4 (fixture K): timeout + complete READY + truncated STOP → dirty tail → null
{ const b = Buffer.from("chrome line\n" + READY + "\n" + STOP.slice(0, 12));
  const r = norm(mk(failChild(b), ref(b), { timedOut: true }), b);
  results.n4 = { t: r.transport_status, u: r.unratified }; }
// N5a: interrupted (signal) + chrome-wrapped payload → strict-only class → null
{ const b = Buffer.from("chrome\n" + STOP + "\ntail prose");
  const r = norm(mk({ status: null, signal: "SIGTERM", error: null, stdout: b, stderr: "" }, ref(b)), b);
  results.n5a = { t: r.transport_status, u: r.unratified }; }
// N5b: interrupted + EXACT strict payload + bound reference → salvaged
{ const b = Buffer.from(STOP);
  const r = norm(mk({ status: null, signal: "SIGTERM", error: null, stdout: b, stderr: "" }, ref(b)), b);
  results.n5b = { t: r.transport_status, u: r.unratified ? r.unratified.payload.verdict : null,
    ps: r.unratified ? r.unratified.parser_status : null }; }
// N6: successful run, digest mismatch → raw_binding_mismatch AND null salvage
{ const b = Buffer.from(STOP);
  const r = norm(mk({ status: 0, signal: null, error: null, stdout: b, stderr: "" },
    { kind: "private-file", locator: "/x", digest: "0".repeat(64) }), b);
  results.n6 = { t: r.transport_status, u: r.unratified }; }
// N7: exit_failure + chrome-wrapped payload with CLEAN tail prose → extracted salvage
{ const b = Buffer.from("chrome line\n" + STOP + "\ntrailing prose, no open object");
  const r = norm(mk(failChild(b), ref(b)), b);
  results.n7 = { t: r.transport_status, u: r.unratified ? r.unratified.payload.verdict : null,
    ps: r.unratified ? r.unratified.parser_status : null }; }
// N8: success path carries unratified:null (uniform shape, never non-null)
{ const b = Buffer.from(STOP);
  const r = norm(mk({ status: 0, signal: null, error: null, stdout: b, stderr: "" }, ref(b)), b);
  results.n8 = { t: r.transport_status, sem: r.semantic_status, u: r.unratified }; }
console.log(JSON.stringify(results));
' "$REPO_ROOT")
J() { node -e 'const r=JSON.parse(process.argv[1]);const p=process.argv[2].split(".");let v=r;for(const k of p)v=v?.[k];console.log(v===undefined?"undef":JSON.stringify(v))' "$OUT" "$1"; }
assert_eq "$(J n1.t)"  '"exit_failure"' "N1 salvage never rewrites the failure classification"
assert_eq "$(J n1.sem)" '"unavailable"' "N1 semantic_status stays unavailable on failure"
assert_eq "$(J n1.p)"  "null"           "N1 authoritative payload stays null on failure"
assert_eq "$(J n1.u)"  '"STOP"'         "N1 digest-bound strict payload is salvaged as unratified"
assert_eq "$(J n1.ps)" '"strict"'       "N1 salvage parser_status is strict"
assert_eq "$(J n2.u)"  "null"           "N2 (C-incident 0-byte no-reference) salvage stays null"
assert_eq "$(J n3.t)"  '"exit_failure"' "N3 digest mismatch keeps the failure classification"
assert_eq "$(J n3.u)"  "null"           "N3 (fixture D) contradicted evidence is never salvaged"
assert_eq "$(J n4.u)"  "null"           "N4 (fixture K) truncated trailing object blocks extract salvage"
assert_eq "$(J n5a.u)" "null"           "N5a interrupted is strict-only: chrome-wrapped extract refused"
assert_eq "$(J n5b.u)" '"STOP"'         "N5b interrupted + exact strict payload is salvaged"
assert_eq "$(J n5b.ps)" '"strict"'      "N5b interrupted salvage is strict"
assert_eq "$(J n6.t)"  '"raw_binding_mismatch"' "N6 binding mismatch classification unchanged"
assert_eq "$(J n6.u)"  "null"           "N6 raw_binding_mismatch is never salvaged"
assert_eq "$(J n7.u)"  '"STOP"'         "N7 chrome-wrapped payload with clean tail salvages on exit_failure"
assert_eq "$(J n7.ps)" '"extracted"'    "N7 salvage parser_status is extracted"
assert_eq "$(J n8.u)"  "null"           "N8 success path carries unratified:null"

finalize_test
