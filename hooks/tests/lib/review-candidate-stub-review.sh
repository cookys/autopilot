#!/usr/bin/env bash
# Stub for scripts/dispatch-review.sh used by review-candidate.test.sh. Logs the --model, copies the
# diff file the seat received to $RC_DIFF_DIR/<model>.diff (RO2 parity), and answers per RC_VERDICT:
#   ship (default) -> SHIP-AS-IS, no findings
#   fix            -> FIX-THEN-SHIP with one critical finding
model=""
diff=""
while [ "$#" -gt 0 ]; do
  [ "$1" = "--model" ] && model="$2"
  [ "$1" = "--diff-file" ] && diff="$2"
  shift
done
printf '%s\n' "$model" >> "$RC_LOG"
[ -n "${RC_FAIL_MODEL:-}" ] && [ "$model" = "$RC_FAIL_MODEL" ] && exit 3
if [ -n "${RC_DIFF_DIR:-}" ] && [ -n "$diff" ] && [ -f "$diff" ]; then
  cp "$diff" "$RC_DIFF_DIR/$model.diff"
fi
# BL-0146 D4: what the packet around the diff holds (tree listing, delta.diff), kept apart from
# RC_DIFF_DIR whose every file the driver reads as a seat diff.
if [ -n "${RC_PACKET_DIR:-}" ] && [ -n "$diff" ] && [ -f "$diff" ]; then
  pdir="$(dirname "$diff")"
  mkdir -p "$RC_PACKET_DIR"
  if [ -d "$pdir/tree" ]; then (cd "$pdir/tree" && find . -type f | sort) > "$RC_PACKET_DIR/$model.tree"; fi
  if [ -f "$pdir/delta.diff" ]; then cp "$pdir/delta.diff" "$RC_PACKET_DIR/$model.delta"; fi
  if [ -f "$pdir/spec.md" ]; then cp "$pdir/spec.md" "$RC_PACKET_DIR/$model.spec"; fi
fi
if [ "${RC_VERDICT:-ship}" = "fix" ]; then
  printf '{"runner":"cc-shim","model":"%s","status":"reviewed","verdict":"FIX-THEN-SHIP","findings":"🔴 [rc-001] src/value.txt:1 planted defect: the value is wrong","no_finding_proof":null,"raw_log":null,"error":null,"usage":null}\n' "$model"
  exit 0
fi
printf '{"runner":"cc-shim","model":"%s","status":"reviewed","verdict":"SHIP-AS-IS","findings":"[]","no_finding_proof":"checked=src/value.txt hunk; evidence=read diff.patch lines; conclusion=change satisfies acceptance","raw_log":null,"error":null,"usage":null}\n' "$model"
