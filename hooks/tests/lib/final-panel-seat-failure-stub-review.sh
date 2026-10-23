#!/usr/bin/env bash
# Stub for scripts/dispatch-review.sh (BL-0246): the model named in FP_FAIL_MODEL fails like a
# cleanroom codex transport failure (no_verdict JSON carrying exit_code/stage/stderr_tail, rc 1);
# every other seat returns a bound SHIP-AS-IS.
model=""
while [ "$#" -gt 0 ]; do
  [ "$1" = "--model" ] && model="$2"
  shift
done
printf '%s\n' "$model" >> "$FP_LOG"
if [ -n "$FP_FAIL_MODEL" ] && [ "$model" = "$FP_FAIL_MODEL" ]; then
  printf '{"runner":"cc-shim","model":"%s","status":"no_verdict","verdict":null,"findings":"","no_finding_proof":null,"raw_log":null,"error":"cleanroom codex exited non-zero (rc=5)","usage":null,"unratified_verdict":null,"exit_code":5,"stage":"cleanroom","stderr_tail":"bwrap: setting up uid map: Permission denied"}\n' "$model"
  exit 1
fi
printf '{"runner":"cc-shim","model":"%s","status":"reviewed","verdict":"SHIP-AS-IS","findings":"[]","no_finding_proof":"checked=src/value.txt hunk; evidence=read diff.patch lines; conclusion=change satisfies acceptance","raw_log":null,"error":null,"usage":null}\n' "$model"
