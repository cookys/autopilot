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
# FAIL-CLOSED VERDICT ALGEBRA (revised after depth-0 QC of commit db31aee)
#
#   An earlier revision of this script derived `pass` from the ABSENCE of a disproof — e.g. R1
#   passed merely because known user-channel artifacts were not writable, and R4 passed merely
#   because some ledger carried an append-only attribute. That is unsound: not finding the hole
#   you looked for is not proof of the property. Those branches were unreachable today but would
#   have silently minted a false `pass` on a future host. Each root now emits one of four values:
#
#     fail        — a live probe POSITIVELY DEMONSTRATED the root is broken (model-reachable /
#                   forgeable). This is proof of absence, not absence of proof.
#     candidate   — a partial positive signal exists, but the plan-defined proof is incomplete.
#                   NEVER sufficient to qualify a host.
#     unverified  — no evidence either way. Evidence INSUFFICIENCY, not incapability.
#     pass        — the COMPLETE plan-defined live proof was executed and succeeded.
#
#   `pass` requires a positive proof probe. Those probes are NOT IMPLEMENTED in this script
#   (each is named in `required_proof`), so no root can currently return `pass`. That is
#   deliberate and honest: the gate must not be satisfiable by a probe that never looked.
#
#   A host is `qualified` ONLY when all four roots are `pass`. Anything else is `not_qualified`.
#   `not_qualified` explicitly does NOT mean "incapable" — it means "not proven capable".
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

# Each root: a disproof yields `fail`; a partial positive signal yields `candidate`; silence
# yields `unverified`. `pass` is reachable ONLY through the named positive proof, none of which
# is implemented here — so the ceiling is `candidate` by construction.

# R1 — writable user channel is a positive disproof. Unwritable proves nothing about whether an
# authenticated witness key/channel exists at all.
if [ "$USER_CHANNEL_WRITABLE" = "yes" ]; then r1="fail"; else r1="unverified"; fi
R1_PROOF="Forge attempt against a harness-witnessed user-input envelope must be REJECTED, with the witness key/channel demonstrably outside model-readable env and repo. Not implemented."

# R2 — a socket existing is not an authenticated, worker-unreachable capability. Its absence is
# not a disproof either: the plan also permits a capability held in host memory, which cannot be
# observed from outside the host process.
if [ "$CAPABILITY_BROKER" = "absent" ]; then r2="unverified"; else r2="candidate"; fi
R2_PROOF="Authenticate the handle, then prove a worker process and a model tool can neither open, read, nor forge it. Socket presence alone is not evidence. Not implemented."

# R3 — any writable control surface is a positive disproof. All-unwritable is only a candidate:
# it says nothing about whether a red-line action is actually denied before its side effect.
if [ "$HOOK_SRC_WRITABLE" = "yes" ] || [ "$HOOK_DIR_WRITABLE" = "yes" ] || [ "$SETTINGS_WRITABLE" = "yes" ]; then
  r3="fail"
else
  r3="candidate"
fi
R3_PROOF="Active deny-before-action smoke: attempt a red-line side effect with no approved matching decision and observe it BLOCKED before the effect occurs, with the gate non-disableable by the governed party. Not implemented."

# R4 — no append-only attribute is a positive disproof. Having one is only a candidate: the
# append-only attr still permits same-UID APPENDS, so a model can extend the ledger with forged
# rows even when it cannot rewrite history. Detecting that needs an external receipt chain.
if [ "$WITNESS_APPEND_ONLY" = "yes" ]; then r4="candidate"; else r4="fail"; fi
R4_PROOF="Prove (a) a forged same-UID APPEND is rejected or externally detectable, and (b) an external witness receipt/hash-chain exists that a full-chain recomputation cannot satisfy. The append-only attr alone blocks rewrite, not append. Not implemented."

# Host qualification: ALL FOUR roots must be `pass`. Nothing else qualifies.
tier="not_qualified"
if [ "$r1" = "pass" ] && [ "$r2" = "pass" ] && [ "$r3" = "pass" ] && [ "$r4" = "pass" ]; then
  tier="qualified"
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
  # A capability record can never qualify a host. `blocking_gate: verified` is evidence about ONE
  # root (R3) and says nothing about R1, R2, or R4 — so on its own it is at most a candidate for
  # a live probe, never a qualification. Equally, `unverified` in a record is EVIDENCE
  # INSUFFICIENCY, not a live finding that the host is incapable.
  if [ "$bg" = "verified" ]; then
    htier="candidate_r3_only_requires_live_probe"
  else
    htier="unverified_no_live_probe"
  fi
  # ANY_TARGET_QUALIFIES stays false: qualification requires all four roots live-proven on that
  # host, which no record can establish. It is left in place so the union below is explicit
  # rather than implied, and so a future live per-host probe has an obvious place to set it.
  hosts_json="${hosts_json}${hosts_json:+,}$(printf '{"host":"%s","harness_level":"%s","status":"%s","blocking_gate":"%s","hooks":"%s","tier":"%s","qualified":false,"basis":"capability_record_only_no_live_probe"}' "$h" "$lvl" "$st" "$bg" "$hk" "$htier")"
done

cat <<EOF
{
  "probe": "owner-kernel-p0-host-trust-roots",
  "executing_host": {
    "uid": $PROBE_UID,
    "user": "$PROBE_USER",
    "note": "This script runs in the same identity a model Bash tool runs in; its reach IS the model's reach."
  },
  "verdict_algebra": {
    "values": ["fail", "candidate", "unverified", "pass"],
    "fail": "a live probe positively demonstrated the root is broken (proof of absence)",
    "candidate": "partial positive signal; plan-defined proof incomplete; never qualifies a host",
    "unverified": "no evidence either way — evidence insufficiency, NOT incapability",
    "pass": "the complete plan-defined live proof was executed and succeeded",
    "note": "No positive-proof probe is implemented in this script, so no root can currently return pass. This is deliberate: a gate must not be satisfiable by a probe that never looked."
  },
  "trust_roots_executing_host": {
    "R1_authenticated_user_channel": {
      "verdict": "$r1",
      "required_proof": "$R1_PROOF",
      "user_channel_writable_by_model": "$USER_CHANNEL_WRITABLE",
      "writable_artifacts": "$USER_CHANNEL_EVIDENCE"
    },
    "R2_active_owner_capability": {
      "verdict": "$r2",
      "required_proof": "$R2_PROOF",
      "capability_broker": "$CAPABILITY_BROKER",
      "session_marker_writable_by_model": "$CAPABILITY_MARKER_WRITABLE"
    },
    "R3_pre_action_mediation": {
      "verdict": "$r3",
      "required_proof": "$R3_PROOF",
      "hook_source_writable": "$HOOK_SRC_WRITABLE",
      "hook_dir_writable": "$HOOK_DIR_WRITABLE",
      "harness_settings_writable": "$SETTINGS_WRITABLE"
    },
    "R4_append_only_witness": {
      "verdict": "$r4",
      "required_proof": "$R4_PROOF",
      "witness_dir_writable": "$WITNESS_WRITABLE",
      "witness_append_only_attr": "$WITNESS_APPEND_ONLY",
      "append_only_settable_by_this_uid": "$CHATTR_SETTABLE",
      "interpretation": "append_only_settable_by_this_uid=no means a ROOT-installed append-only witness would resist model REWRITE. It would not by itself resist a same-UID forged APPEND, which is why the attribute alone is at most a candidate."
    }
  },
  "executing_host_tier": "$tier",
  "target_hosts_from_capability_records": [ $hosts_json ],
  "gate": {
    "criterion": "P0 stops if no target host achieves full or partial with authenticated user channel, active-owner capability, mediator/pre-action enforcement, and append-only witness roots.",
    "qualification_rule": "A host qualifies ONLY when all four roots return pass. candidate and unverified never qualify.",
    "executing_host_qualifies": $( [ "$tier" = "qualified" ] && echo true || echo false ),
    "any_target_host_qualifies": $ANY_TARGET_QUALIFIES,
    "any_host_qualified": $( { [ "$tier" = "qualified" ] || [ "$ANY_TARGET_QUALIFIES" = true ]; } && echo true || echo false ),
    "field_semantics": "any_host_qualified is the UNION over the live-probed executing host AND the four record-derived target hosts; the two disjuncts are reported separately so the union is auditable rather than implied. A false value means NO HOST IS PROVEN QUALIFIED. It does NOT assert that any host is incapable — the four target hosts have had no live probe at all, and their capability records are evidence insufficiency. Renamed from any_host_full_or_partial, which wrongly implied a measured full/partial tier where none was measured."
  }
}
EOF

exit 0
