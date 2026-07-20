#!/usr/bin/env bash
# probe-host-trust-roots.sh — P0 host observability/trust-root probe (Owner Kernel gate).
#
# Answers ONE question mechanically, per host:
#   Does this host provide the four trust roots the Owner Kernel plan requires before a
#   host may be classified `full` or `partial`?
#
#     R1 authenticated user channel  — user intent/approval witnessed via a key or channel
#                                      outside the model-readable environment and repository
#     R2 active-owner capability     — a per-run decision capability held in host memory or a
#                                      broker/IPC handle inaccessible to model tools and workers
#     R3 pre-action mediation        — a gate that blocks a red-line side effect BEFORE it
#                                      happens, which the model cannot disable or rewrite
#     R4 append-only witness root    — an event/witness log the model cannot rewrite or truncate
#
# Plan reference: docs/plans/2026-07-20-owner-kernel-evolution.md § P0 step 4 and step 7.
# The plan's pass criterion is explicit: "A host capability passes only when the owner handle
# stays in host memory or a broker/IPC handle inaccessible to model tools and worker processes;
# a prose promise is not evidence."
#
# METHOD / HONESTY CONTRACT
#   - Every verdict below is derived from a LIVE PROBE on this machine (filesystem reachability,
#     process identity, kernel capability) or from a NAMED capability record artifact.
#     Nothing is asserted from documentation or memory.
#   - The decisive test is REACHABILITY BY THE MODEL'S OWN TOOL, not file mode. This script runs
#     in the same process context a model's Bash tool runs in, so what it can reach, the model
#     can reach. Mode 600 restricts OTHER uids; it does not restrain the owner.
#   - NON-DESTRUCTIVE: writability is tested with `test -w` and a create-then-remove probe of a
#     dotfile. No real hook, setting, ledger, or credential is ever modified.
#
# Usage: probe-host-trust-roots.sh [--repo <dir>] [--json]
# Exit:  0 always (telemetry probe; the verdict is in the payload, not the exit code)

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
JSON_ONLY=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --json) JSON_ONLY=1; shift ;;
    -h|--help) sed -n '1,32p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

note() { [ "$JSON_ONLY" -eq 1 ] || echo "$@" >&2; }

# ---------------------------------------------------------------------------
# Live probes (this host = whatever harness is executing this script)
# ---------------------------------------------------------------------------

PROBE_UID="$(id -u)"
PROBE_USER="$(id -un)"

# R4a — can this uid SET an append-only attribute? If yes, it can also clear it, so the
# attribute cannot bind the model. If no (EPERM), a root-installed append-only witness would
# be genuinely unforgeable by the model — establishing that the mechanism is *available* even
# when it is not currently *deployed*. This distinction matters: it separates
# "architecturally impossible" from "not built yet".
CHATTR_SETTABLE="unknown"
_t="$(mktemp)" || _t=""   # bare mktemp already honours TMPDIR
if [ -n "$_t" ]; then
  echo seed > "$_t" 2>/dev/null
  if chattr +a "$_t" 2>/dev/null; then
    CHATTR_SETTABLE="yes"
    chattr -a "$_t" 2>/dev/null
  else
    CHATTR_SETTABLE="no"
  fi
  rm -f "$_t" 2>/dev/null
fi

# R3 — hook source + hook wiring + harness settings reachability.
HOOK_SRC_WRITABLE="no"
for f in "$REPO/hooks/orchestrator-edit-gate.js" "$REPO/hooks/audit-log.js"; do
  [ -w "$f" ] && HOOK_SRC_WRITABLE="yes"
done

HOOK_DIR_WRITABLE="no"
if [ -d "$REPO/hooks" ]; then
  _probe="$REPO/hooks/.p0-trust-root-probe.$$"
  if touch "$_probe" 2>/dev/null; then HOOK_DIR_WRITABLE="yes"; rm -f "$_probe"; fi
fi

SETTINGS_WRITABLE="no"
for f in "$HOME/.claude/settings.json" "$HOME/.claude/settings.local.json" "$REPO/.claude/settings.json"; do
  [ -e "$f" ] && [ -w "$f" ] && SETTINGS_WRITABLE="yes"
done

# R1 — user-channel artifacts. If the transcript/history the harness treats as the user channel
# is model-writable, a model can forge a user intent/approval event.
USER_CHANNEL_WRITABLE="no"
USER_CHANNEL_EVIDENCE=""
for f in "$HOME/.claude/history.jsonl" "$HOME/.claude/projects" "$HOME/.claude/sessions"; do
  if [ -e "$f" ] && [ -w "$f" ]; then
    USER_CHANNEL_WRITABLE="yes"
    USER_CHANNEL_EVIDENCE="${USER_CHANNEL_EVIDENCE}${USER_CHANNEL_EVIDENCE:+,}$(basename "$f")"
  fi
done

# R2 — is any owner/decision capability held outside model reach? Autopilot's nearest analogue
# is the session-mode marker; probe whether it is a plain model-writable file.
CAPABILITY_MARKER_WRITABLE="no"
CAPABILITY_BROKER="absent"
if [ -d "$HOME/.autopilot/session-mode" ] && [ -w "$HOME/.autopilot/session-mode" ]; then
  CAPABILITY_MARKER_WRITABLE="yes"
fi
# A real capability broker would be a socket/IPC endpoint the model cannot open or forge.
for s in "$HOME/.autopilot/owner-kernel.sock" "/run/owner-kernel.sock"; do
  [ -S "$s" ] && CAPABILITY_BROKER="present:$s"
done

# R4b — witness/ledger roots actually in use.
WITNESS_APPEND_ONLY="no"
WITNESS_WRITABLE="unknown"
_ledger_dir="${AUTOPILOT_DISPATCH_RUNS_DIR:-${TMPDIR:-/tmp}/autopilot-dispatch-runs}"
if [ -d "$_ledger_dir" ]; then
  [ -w "$_ledger_dir" ] && WITNESS_WRITABLE="yes" || WITNESS_WRITABLE="no"
  # If ANY ledger carries the append-only attr, report it.
  # lsattr's flag field is positional: each slot holds either that slot's own flag letter or `-`
  # (e.g. `----a--------e-------`). Lowercase `a` is used by exactly one flag, append-only, and no
  # other flag letter contains an `a`. So an unanchored match for `a` is precise here, not loose.
  # (A review pass flagged this as needing anchoring; verified against the lsattr flag set and
  # kept as-is, since anchoring by position would be brittle across e2fsprogs versions.)
  if command -v lsattr >/dev/null 2>&1; then
    if lsattr "$_ledger_dir"/*.jsonl 2>/dev/null | awk '{print $1}' | grep -q 'a'; then
      WITNESS_APPEND_ONLY="yes"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Per-root verdicts for the executing host
# ---------------------------------------------------------------------------

r1="fail"; [ "$USER_CHANNEL_WRITABLE" = "no" ] && r1="pass"
r2="fail"; [ "$CAPABILITY_BROKER" != "absent" ] && r2="pass"
r3="fail"
if [ "$HOOK_SRC_WRITABLE" = "no" ] && [ "$HOOK_DIR_WRITABLE" = "no" ] && [ "$SETTINGS_WRITABLE" = "no" ]; then
  r3="pass"
fi
r4="fail"; [ "$WITNESS_APPEND_ONLY" = "yes" ] && r4="pass"

tier="none"
if [ "$r1" = "pass" ] && [ "$r2" = "pass" ] && [ "$r3" = "pass" ] && [ "$r4" = "pass" ]; then
  tier="full"
elif [ "$r3" = "pass" ] && [ "$r4" = "pass" ] && [ "$r1" = "pass" ]; then
  # partial still requires an enforceable mediator path + witness + authentic user channel;
  # a missing owner-capability handle alone caps the host at partial, never full.
  tier="partial"
fi

# ---------------------------------------------------------------------------
# Non-executing target hosts: read the capability records (named artifacts, not memory).
# These records are the repo's own single source of truth for harness capability.
# ---------------------------------------------------------------------------

record_field() {
  local id="$1" field="$2"
  node -e '
    try {
      const j = require(process.argv[1]);
      const f = process.argv[2];
      const v = f.split(".").reduce((a,k)=>a&&a[k], j);
      process.stdout.write(v === undefined || v === null ? "unknown" : String(v));
    } catch (e) { process.stdout.write("unknown"); }
  ' "$REPO/src/harness/capabilities/${id}.json" "$field" 2>/dev/null || echo unknown
}

hosts_json=""
ANY_TARGET_QUALIFIES=false
for h in claude-code codex opencode agy; do
  lvl="$(record_field "$h" harness_level)"
  st="$(record_field "$h" status)"
  bg="$(record_field "$h" capabilities.blocking_gate)"
  hk="$(record_field "$h" capabilities.hooks)"
  [ "$hk" = "unknown" ] && hk="$(record_field "$h" capabilities.tool_hooks)"
  # A host cannot reach `full`/`partial` without a VERIFIED blocking gate (R3), regardless of
  # what its hooks can observe. Observation is not prevention.
  htier="none"
  if [ "$bg" = "verified" ]; then
    htier="candidate-requires-live-probe"
    ANY_TARGET_QUALIFIES=true
  fi
  hosts_json="${hosts_json}${hosts_json:+,}$(printf '{"host":"%s","harness_level":"%s","status":"%s","blocking_gate":"%s","hooks":"%s","tier":"%s"}' "$h" "$lvl" "$st" "$bg" "$hk" "$htier")"
done

cat <<EOF
{
  "probe": "owner-kernel-p0-host-trust-roots",
  "executing_host": {
    "uid": $PROBE_UID,
    "user": "$PROBE_USER",
    "note": "This script runs in the same identity a model Bash tool runs in; its reach IS the model's reach."
  },
  "trust_roots_executing_host": {
    "R1_authenticated_user_channel": {
      "verdict": "$r1",
      "user_channel_writable_by_model": "$USER_CHANNEL_WRITABLE",
      "writable_artifacts": "$USER_CHANNEL_EVIDENCE"
    },
    "R2_active_owner_capability": {
      "verdict": "$r2",
      "capability_broker": "$CAPABILITY_BROKER",
      "session_marker_writable_by_model": "$CAPABILITY_MARKER_WRITABLE"
    },
    "R3_pre_action_mediation": {
      "verdict": "$r3",
      "hook_source_writable": "$HOOK_SRC_WRITABLE",
      "hook_dir_writable": "$HOOK_DIR_WRITABLE",
      "harness_settings_writable": "$SETTINGS_WRITABLE"
    },
    "R4_append_only_witness": {
      "verdict": "$r4",
      "witness_dir_writable": "$WITNESS_WRITABLE",
      "witness_append_only_attr": "$WITNESS_APPEND_ONLY",
      "append_only_settable_by_this_uid": "$CHATTR_SETTABLE",
      "interpretation": "append_only_settable_by_this_uid=no means a ROOT-installed append-only witness would be unforgeable by the model. It is a mechanism that is available but not currently deployed."
    }
  },
  "executing_host_tier": "$tier",
  "target_hosts_from_capability_records": [ $hosts_json ],
  "gate": {
    "criterion": "P0 stops if no target host achieves full or partial with authenticated user channel, active-owner capability, mediator/pre-action enforcement, and append-only witness roots.",
    "executing_host_qualifies": $( [ "$tier" = "none" ] && echo false || echo true ),
    "any_target_host_qualifies": $ANY_TARGET_QUALIFIES,
    "any_host_full_or_partial": $( { [ "$tier" != "none" ] || [ "$ANY_TARGET_QUALIFIES" = true ]; } && echo true || echo false ),
    "field_semantics": "any_host_full_or_partial is the UNION over the live-probed executing host AND the four record-derived target hosts. executing_host_qualifies and any_target_host_qualifies are the two disjuncts, reported separately so the union is auditable rather than implied."
  }
}
EOF

exit 0
