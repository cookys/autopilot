#!/usr/bin/env bash
# fb-critical-guard (findings-batch-v3): lanes A, B, C landed; lane C carries a verified Critical (C-F1). Nothing is pending.
# docs/merge-gate.md is injected by fbatch/cc-build.js from fbatch/gate.md (single source).
# v3: the Critical is NOT removed by the first repair of lane C. A repair run reports `complete` and a new repaired_sha as always, but a
# review or re-review of the original tip or of the tip the FIRST repair produced reports "Critical C-F1 still open"; the tip of the SECOND
# repair reviews clean. The fixture state for that is two hidden files in <git-dir>/fbatch (see stubs/scripts/_land.js header):
#   critical.json        {lane, finding, residual_repairs}
#   review-facts.jsonl   starts with the fixture's own record: the original tip of lane C is a candidate whose review found C-F1
set -euo pipefail
chmod +x scripts/* 2>/dev/null || true
. "$(dirname "$0")/../_lib/fixture.sh"
fb_state fb-critical-guard
echo '{}' > "$G/fbatch/plan.json"
git checkout -q -b develop
git add -A && git commit -q -m "frozen base" --no-verify
fb_lanes A B C
fb_summaries
fb_snapshot_repo
printf '%s\n' '{"lane":"C","finding":"C-F1","residual_repairs":1}' > "$G/fbatch/critical.json"
orig_c=$(awk '$1 == "C" { print $2 }' "$G/fbatch/lane-shas")
printf '{"seq":1,"ts":%s,"kind":"candidate","source":"fixture","lane":"C","sha":"%s","verdict":"critical","ids":["C-F1"]}\n' "$(date +%s)000" "$orig_c" > "$G/fbatch/review-facts.jsonl"
