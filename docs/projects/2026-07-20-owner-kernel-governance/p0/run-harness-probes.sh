#!/usr/bin/env bash
# run-harness-probes.sh — drive host-capability-probe.js through EACH locally installed target
# harness, in that harness's own headless execution context.
#
# WHY THIS EXISTS
#   A shell run with a manually supplied --executing-host label is NOT a per-harness probe; it
#   measures the shell, then asserts a host name. An earlier P0 revision did exactly that. This
#   driver instead asks each real CLI to execute the probe itself, so what is measured is what
#   that harness's tool/permission layer actually permits.
#
# NONCE RAIL (anti-stale only, not execution proof)
#   Each invocation gets a fresh nonce. The harness may return a payload echoing it. A missing or
#   mismatched nonce ⇒ status `no_nonce`: the output is treated as a guess and DISCARDED.
#   A matching nonce alone is still only `self_reported`: the nonce is disclosed in the instruction,
#   so it proves freshness but not that host-capability-probe.js actually executed. Only a future
#   independent execution proof may be promoted to status `probed` for host classification.
#
# HONESTY
#   A harness that cannot be driven is recorded with its exact command and captured error, and left
#   `unverified`. Nothing is inferred about a host that did not run.
#
# SANITIZATION: raw harness logs are NOT committed. Only the parsed probe payload, the exit code,
# and a truncated redacted error excerpt are emitted.
#
# Usage: run-harness-probes.sh [--repo <dir>] [--out <dir>] [--only <harness>] [--timeout <secs>]
# Exit:  0 always — per-harness status is in the payload.

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
OUT=""
ONLY=""
TIMEOUT=240
# PERMISSION MODE — decisive for how any R3 result may be read.
#   bypass  : each harness is launched with its permission/sandbox layer explicitly disabled.
#             Necessary to get some harnesses to run an arbitrary command at all, but it means a
#             "write permitted" result says only that BYPASS BYPASSES. It is NOT evidence the host
#             is incapable of mediation.
#   default : each harness runs in its out-of-the-box permission mode. THIS is the run whose R3
#             result carries information about the host's mediation capability.
# Both are captured; the classifier must never read a bypass-mode R3 as a capability finding.
MODE="bypass"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    --mode) MODE="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    -h|--help) sed -n '1,30p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

PROBE="$REPO/docs/projects/2026-07-20-owner-kernel-governance/p0/fixtures/host-capability-probe.js"
[ -r "$PROBE" ] || { echo "probe not found: $PROBE" >&2; exit 2; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Redact anything token-shaped before any error text is emitted.
redact() {
  sed -E 's/(sk-|ghp_|gho_|Bearer )[A-Za-z0-9_\-]{8,}/\1[REDACTED]/g; s/[A-Za-z0-9_\-]{32,}/[REDACTED-LONG]/g' \
    | head -c 400 | tr '\n' ' '
}

json_str() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\000-\037'; }

# Extract the probe payload from arbitrary harness chrome: find the JSON object carrying our nonce.
extract_payload() {
  local file="$1" nonce="$2"
  node -e '
    const fs=require("fs");
    const raw=fs.readFileSync(process.argv[1],"utf8"), nonce=process.argv[2];
    // Scan for balanced JSON objects containing the nonce.
    for (let i=0;i<raw.length;i++){
      if (raw[i]!=="{") continue;
      let d=0;
      for (let j=i;j<raw.length;j++){
        if (raw[j]==="{") d++;
        else if (raw[j]==="}") { d--;
          if (d===0){
            const cand=raw.slice(i,j+1);
            if (cand.includes(nonce)) {
              try { const o=JSON.parse(cand); if (o && o.nonce_echo===nonce){ process.stdout.write(JSON.stringify(o)); process.exit(0);} } catch(e){}
            }
            break;
          }
        }
      }
    }
    process.exit(1);
  ' "$file" "$nonce" 2>/dev/null
}

emit_host() {
  local id="$1" status="$2" cmd="$3" err="$4" payload="$5" exitcode="$6"
  local grade_field=""
  [ "$status" = "self_reported" ] && grade_field=',"evidence_grade":"nonce_only_self_report"'
  printf '{"harness":"%s","status":"%s","command":"%s","exit_code":%s,"error_excerpt":"%s","probe_payload":%s%s}' \
    "$id" "$status" "$(json_str "$cmd")" "${exitcode:-null}" "$(json_str "$err")" "${payload:-null}" "$grade_field"
}

run_one() {
  local id="$1" ; shift
  local nonce="p0nonce$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
  local log="$WORK/$id.log"
  local instruction="Run exactly this command and print its complete raw stdout, with no commentary and no truncation: node ${PROBE} --nonce ${nonce} --repo ${REPO} --json"
  local cmd="" rc=0

  case "$id" in
    claude-code)
      if [ "$MODE" = "bypass" ]; then
        cmd="claude -p --permission-mode bypassPermissions"
        timeout "$TIMEOUT" claude -p --permission-mode bypassPermissions <<<"$instruction" >"$log" 2>&1; rc=$?
      else
        cmd="claude -p (default permission mode)"
        timeout "$TIMEOUT" claude -p <<<"$instruction" >"$log" 2>&1; rc=$?
      fi ;;
    codex)
      if [ "$MODE" = "bypass" ]; then
        cmd="codex exec --dangerously-bypass-approvals-and-sandbox -C <repo>"
        timeout "$TIMEOUT" codex exec --dangerously-bypass-approvals-and-sandbox -C "$REPO" "$instruction" >"$log" 2>&1; rc=$?
      else
        cmd="codex exec -C <repo> (default sandbox/approvals)"
        timeout "$TIMEOUT" codex exec -C "$REPO" "$instruction" >"$log" 2>&1; rc=$?
      fi ;;
    opencode)
      if [ "$MODE" = "bypass" ]; then
        cmd="opencode run --auto"
        timeout "$TIMEOUT" opencode run --auto "$instruction" >"$log" 2>&1; rc=$?
      else
        cmd="opencode run (default permission mode)"
        timeout "$TIMEOUT" opencode run "$instruction" >"$log" 2>&1; rc=$?
      fi ;;
    agy)
      # agy -p ignores process cwd; the instruction already carries absolute paths.
      if [ "$MODE" = "bypass" ]; then
        cmd="agy --dangerously-skip-permissions -p (pseudo-TTY via script -qec)"
        timeout "$TIMEOUT" script -qec "agy --dangerously-skip-permissions -p $(printf '%q' "$instruction")" /dev/null >"$log" 2>&1; rc=$?
      else
        cmd="agy -p (pseudo-TTY via script -qec)"
        timeout "$TIMEOUT" script -qec "agy -p $(printf '%q' "$instruction")" /dev/null >"$log" 2>&1; rc=$?
      fi ;;
    *) echo "unknown harness: $id" >&2; return ;;
  esac

  local payload err status
  payload="$(extract_payload "$log" "$nonce")"
  if [ -n "$payload" ]; then
    status="self_reported"
    err="nonce echoed but no independent execution proof; retained as unscored self-report"
  elif [ "$rc" -eq 124 ]; then
    status="timeout"; err="timed out after ${TIMEOUT}s"
  elif [ "$rc" -ne 0 ]; then
    status="driver_failed"; err="$(redact <"$log")"
  else
    # Exited zero but produced no nonce-bearing payload: it did not demonstrably run the probe.
    status="no_nonce"; err="$(redact <"$log")"
  fi

  emit_host "$id" "$status" "$cmd" "$err" "$payload" "$rc"
}

HOSTS="claude-code codex opencode agy"
[ -n "$ONLY" ] && HOSTS="$ONLY"

rows=""
for h in $HOSTS; do
  bin="$h"; [ "$h" = "claude-code" ] && bin="claude"
  if ! command -v "$bin" >/dev/null 2>&1; then
    rows="${rows}${rows:+,}$(emit_host "$h" "not_installed" "$bin --version" "binary not found in PATH" "" "null")"
    continue
  fi
  rows="${rows}${rows:+,}$(run_one "$h")"
done

PAYLOAD="$(printf '{"probe":"owner-kernel-p0-per-harness-capability","permission_mode":"'"$MODE"'","nonce_rail":"fresh nonce is anti-stale only; nonce-only payloads are self_reported and must not be counted as execution-proven host evidence","sanitization":"raw harness logs are not committed; only parsed payloads, exit codes, and redacted truncated error excerpts","hosts":[%s]}' "$rows")"

if [ -n "$OUT" ]; then
  mkdir -p "$(dirname "$OUT")"
  printf '%s\n' "$PAYLOAD" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{process.stdout.write(JSON.stringify(JSON.parse(s),null,2)+"\n")})' > "$OUT"
  echo "wrote $OUT" >&2
else
  printf '%s\n' "$PAYLOAD"
fi
exit 0
