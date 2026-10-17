#!/usr/bin/env bash
# Harness check stand-in for scripts/dispatch-review.sh (NO model call). Round 1 (no addendum in the spec):
# one critical finding at $RC_LOC. Return round (addendum present): every listed prior finding is answered
# `resolved` with evidence $RC_LOC, no new finding.
model=""; spec=""
while [ "$#" -gt 0 ]; do
  [ "$1" = "--model" ] && model="$2"
  [ "$1" = "--spec-file" ] && spec="$2"
  shift
done
if [ -n "$spec" ] && grep -q '^- \[prior:' "$spec"; then
  RC_MODEL="$model" RC_SPEC="$spec" node -e '
    const fs = require("fs");
    const ids = fs.readFileSync(process.env.RC_SPEC, "utf8").split("\n").map((l) => /^- \[([^\]]+)\] \|/.exec(l)).filter(Boolean).map((m) => m[1]);
    const answer = JSON.stringify({ findings: "none", resolutions: ids.map((id) => ({ finding_id: id, status: "resolved", evidence: process.env.RC_LOC })) });
    process.stdout.write(JSON.stringify({ runner: "cc-shim", model: process.env.RC_MODEL, status: "reviewed", verdict: "SHIP-AS-IS", findings: answer,
      no_finding_proof: "checked=src hunk; evidence=read diff.patch lines; conclusion=prior findings are gone", raw_log: null, error: null, usage: null }) + "\n");
  '
  exit 0
fi
printf '{"runner":"cc-shim","model":"%s","status":"reviewed","verdict":"FIX-THEN-SHIP","findings":"🔴 [rc-001] %s planted defect: the value is wrong","no_finding_proof":null,"raw_log":null,"error":null,"usage":null}\n' "$model" "$RC_LOC"
