#!/usr/bin/env bash
# Stub for scripts/dispatch-review.sh: logs the --model it was dispatched for; the model named
# in FP_FAIL_MODEL fails the transport (no JSON), every other seat returns a bound SHIP-AS-IS.
model=""
while [ "$#" -gt 0 ]; do
  [ "$1" = "--model" ] && model="$2"
  shift
done
printf '%s\n' "$model" >> "$FP_LOG"
[ -n "$FP_FAIL_MODEL" ] && [ "$model" = "$FP_FAIL_MODEL" ] && exit 3
printf '{"runner":"cc-shim","model":"%s","status":"reviewed","verdict":"SHIP-AS-IS","findings":"[]","no_finding_proof":"checked=src/value.txt hunk; evidence=read diff.patch lines; conclusion=change satisfies acceptance","raw_log":null,"error":null,"usage":null}\n' "$model"
