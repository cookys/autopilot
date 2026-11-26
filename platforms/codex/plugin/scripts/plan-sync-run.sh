#!/usr/bin/env bash
# plan-sync-run.sh — rerunnable: freeze receipt -> coverage (before) -> [--sync] -> coverage (after) -> PLAN_GAPS line + audit line.
# Usage: plan-sync-run.sh --plan <repo-relative path> --repo <git dir> --verdict READY|adjudicated [--parent <task id>] [--sync]
# --verdict is passed in by the caller (the PM decides it); the receipt is built from HEAD of --repo and the plan must be committed and clean.
# Env: PLAN_TO_TASKS_FLEET_BIN (fleet binary), PLAN_SYNC_AUDIT (audit jsonl; default $XDG_RUNTIME_DIR/autopilot/plan-sync-audit.jsonl).
# Exit: 0 gaps_after == 0 and sync ok; 1 gaps remain or a step failed; 2 bad arguments.
set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
plan=""; repo=""; verdict=""; parent=""; sync=0
while [ $# -gt 0 ]; do
  case "$1" in
    --plan) plan="${2:-}"; shift 2 ;;
    --repo) repo="${2:-}"; shift 2 ;;
    --verdict) verdict="${2:-}"; shift 2 ;;
    --parent) parent="${2:-}"; shift 2 ;;
    --sync) sync=1; shift ;;
    *) echo "plan-sync-run: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$plan" ] && [ -n "$repo" ] || { echo "plan-sync-run: --plan and --repo are required" >&2; exit 2; }
case "$verdict" in READY|adjudicated) ;; *) echo "plan-sync-run: --verdict must be READY or adjudicated" >&2; exit 2 ;; esac
if [ "$sync" = 1 ] && [ -z "$parent" ]; then echo "plan-sync-run: --sync needs --parent" >&2; exit 2; fi
git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 || { echo "plan-sync-run: $repo is not a git repo" >&2; exit 2; }
if ! git -C "$repo" ls-files --error-unmatch -- "$plan" >/dev/null 2>&1 || [ -n "$(git -C "$repo" status --porcelain -- "$plan")" ]; then
  echo "plan-sync-run: $plan must be committed and clean in $repo" >&2; exit 2
fi
commit="$(git -C "$repo" rev-parse HEAD)"
sha="$(git -C "$repo" show "$commit:$plan" | sha256sum | cut -d' ' -f1)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
receipt="$tmp/receipt.json"
node -e 'const [c,p,s,v,o]=process.argv.slice(1);require("fs").writeFileSync(o,JSON.stringify({commit:c,path:p,sha256:s,verdict:v}))' "$commit" "$plan" "$sha" "$verdict" "$receipt"
args=(--receipt "$receipt" --repo "$repo"); [ -n "$parent" ] && args+=(--parent "$parent")
gaps() { node -e 'try{const j=JSON.parse(process.argv[1].trim().split("\n").pop());console.log(j.gaps)}catch(e){console.log("unknown")}' "$1"; }
before_out="$(node "$here/plan-to-tasks.js" "${args[@]}" --coverage 2>/dev/null)"; before="$(gaps "$before_out")"
sync_rc=0
if [ "$sync" = 1 ]; then
  node "$here/plan-to-tasks.js" "${args[@]}" --sync >"$tmp/sync.out" 2>"$tmp/sync.err"; sync_rc=$?
  [ "$sync_rc" = 0 ] || cat "$tmp/sync.err" >&2
fi
after_out="$(node "$here/plan-to-tasks.js" "${args[@]}" --coverage 2>/dev/null)"; after="$(gaps "$after_out")"
if [ "$sync" = 1 ]; then syncs="rc=$sync_rc"; else syncs="skipped"; fi
echo "PLAN_GAPS before=$before after=$after plan=$plan commit=${commit:0:12} sync=$syncs"
audit="${PLAN_SYNC_AUDIT:-${XDG_RUNTIME_DIR:-/tmp}/autopilot/plan-sync-audit.jsonl}"
mkdir -p "$(dirname "$audit")" && node -e 'const [f,...a]=process.argv.slice(1);require("fs").appendFileSync(f,JSON.stringify({ts:new Date().toISOString(),plan:a[0],commit:a[1],sha256:a[2],verdict:a[3],parent:a[4],before:a[5],after:a[6],sync_rc:a[7]})+"\n")' "$audit" "$plan" "$commit" "$sha" "$verdict" "$parent" "$before" "$after" "$sync_rc"
[ "$after" = 0 ] && [ "$sync_rc" = 0 ]
