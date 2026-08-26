# shellcheck shell=bash
# cursor-model.sh — resolve a Cursor CLI (`cursor-agent`) family alias
# (grok46 | codex53) plus autopilot's effort scale to a full model id, and
# expose the id table as an executable single source of truth for the
# `--runner cursor` auto-routing guard in dispatch-hetero.sh.
#
# Provides:
#   cursor_model_for <bin> <family> <effort> <fast>  → prints a full model id
#   cursor_enabled_ids                                → one id per line, ALL
#                                                        ids the table can
#                                                        produce (fast-closed)
#   cursor_is_enabled_id <id>                          → 0/1 exact-match test
#
# WHY THIS EXISTS
# ---------------
# Sibling of `lib/grok-effort.sh`, different mechanism. grok-effort clamps a
# 5-level scale onto a 4-level CLI enum the grok binary itself validates.
# cursor-agent has no `--reasoning-effort` flag at all (Global Constraint 3,
# docs/plans/2026-08-26-cursor-cli-adaptor.md §2.5) — effort IS the model-id
# suffix, and the id ladder is not uniform across families (some families
# stop at `-high`). So this file does two jobs grok-effort.sh doesn't:
#   1. maps (family, effort) → a full id, not just a clamped effort word.
#   2. validates that id against a LIVE `cursor-agent --list-models`, because
#      the ladder moves and a stale hardcoded id would silently misroute.
#
# THREE ENTRY POINTS OVER ONE TABLE
# ----------------------------------
# `cursor_model_for` is the only entry point that touches the network/binary
# (via --list-models). `cursor_enabled_ids` and `cursor_is_enabled_id` are
# PURE TABLE OPERATIONS — no binary argument, no subprocess, no network call.
# dispatch-hetero.sh's `auto` guard calls the predicate on EVERY invocation
# (docs/plans/2026-08-26-cursor-cli-adaptor.md §3a, R3/Generation 2 review
# finding), so a subprocess there would put a live network call on the path
# of every unrelated dispatch that never touches cursor at all. Keep it that
# way: any change here that makes cursor_enabled_ids or cursor_is_enabled_id
# shell out is a regression, not an enhancement.
#
# EQUALITY, NOT CONTAINMENT (P15)
# --------------------------------
# `cursor-grok-4.6-low` is a strict PREFIX of `cursor-grok-4.6-low-fast`.
# A substring/grep-containment test against the live inventory would let a
# REMOVED or RENAMED non-fast id still "validate" because its `-fast` sibling
# is still listed — silently voiding the fail-closed guarantee this file
# exists to provide. Every inventory check here is full-token string
# equality against a set built from complete `<id>` fields, never `grep`
# without anchors and never a shell `case *"$id"*` glob.
#
# LIVE INVENTORY, CACHED PER PROCESS + PER BINARY
# -------------------------------------------------
# `cursor_model_for` takes the resolved binary as an explicit first
# argument (not a global) so `--cursor-bin` retargets validation and
# execution together, and so tests can point it at a stub. The parsed
# inventory is cached per (bin) for the lifetime of the process — a miss is
# a HARD failure, never a silent downgrade to an unvalidated id.
#
# HONESTY REQUIREMENT
# -------------------
# `max` has no cursor level of its own; every family clamps it to `xhigh`
# (a ceiling, not a genuine level). That MUST be visible on stderr, exactly
# like grok_effort_note — silence it with DISPATCH_QUIET=1, same convention
# as every other dispatch heads-up.

[ -n "${_AUTOPILOT_CURSOR_MODEL_SH:-}" ] && return 0
_AUTOPILOT_CURSOR_MODEL_SH=1

# ---------------------------------------------------------------------------
# The table. Two families, four genuine effort levels each; `max` clamps to
# each family's `xhigh` ceiling (not a distinct table row).
# ---------------------------------------------------------------------------

# _cursor_model_base <family> <effort> → base (non-fast) id on stdout.
# Returns 2 for an unknown family, 1 for an unknown effort within a known
# family (both are caller-facing "fail closed", but kept distinct so a
# future caller can tell "no such family" from "no such level").
_cursor_model_base() {
  local family="$1" effort="$2"
  case "$family" in
    grok46)
      case "$effort" in
        low)    printf 'cursor-grok-4.6-low' ;;
        medium) printf 'cursor-grok-4.6-medium' ;;
        high)   printf 'cursor-grok-4.6-high' ;;
        xhigh)  printf 'cursor-grok-4.6-xhigh' ;;
        max)    printf 'cursor-grok-4.6-xhigh' ;;   # ceiling, see header
        *)      return 1 ;;
      esac
      ;;
    codex53)
      case "$effort" in
        low)    printf 'gpt-5.3-codex-low' ;;
        medium) printf 'gpt-5.3-codex' ;;
        high)   printf 'gpt-5.3-codex-high' ;;
        xhigh)  printf 'gpt-5.3-codex-xhigh' ;;
        max)    printf 'gpt-5.3-codex-xhigh' ;;     # ceiling, see header
        *)      return 1 ;;
      esac
      ;;
    *)
      return 2
      ;;
  esac
}

# _cursor_families / _cursor_efforts — enumeration primitives shared by
# cursor_enabled_ids and cursor_model_for's clamp-note logic. Genuine levels
# only (excludes `max`, which is a caller-facing alias for `xhigh`, not a
# distinct id-producing row — including it would double-count xhigh).
_cursor_families() { printf 'grok46\ncodex53\n'; }
_cursor_efforts()  { printf 'low\nmedium\nhigh\nxhigh\n'; }

# cursor_enabled_ids — every id the table can produce, closed under `fast`.
# PURE: no binary argument, no subprocess, no network call. See header.
cursor_enabled_ids() {
  local family effort base
  while IFS= read -r family; do
    while IFS= read -r effort; do
      base="$(_cursor_model_base "$family" "$effort")" || continue
      printf '%s\n' "$base"
      printf '%s-fast\n' "$base"
    done < <(_cursor_efforts)
  done < <(_cursor_families)
}

# cursor_is_enabled_id <id> — exact-match membership predicate over
# cursor_enabled_ids. PURE: no binary argument, no subprocess, no network
# call. Full-line equality only (never substring) — same P15 discipline as
# the live-inventory check in cursor_model_for.
cursor_is_enabled_id() {
  local id="$1" line
  while IFS= read -r line; do
    [ "$line" = "$id" ] && return 0
  done < <(cursor_enabled_ids)
  return 1
}

# ---------------------------------------------------------------------------
# Live inventory validation (cursor_model_for only).
# ---------------------------------------------------------------------------

# Cache keyed by binary path/name: one associative array of
# "$bin" -> newline-joined set of complete id tokens actually seen in
# `"$bin" --list-models`. Populated lazily, once per (bin) per process.
declare -A _CURSOR_INVENTORY_CACHE=()

# _cursor_load_inventory <bin> — populate _CURSOR_INVENTORY_CACHE[$bin] if
# not already cached. Returns non-zero (and leaves the cache unset for this
# bin) if the --list-models call fails or produces no id tokens at all —
# both are hard failures for the caller, never a silent downgrade.
_cursor_load_inventory() {
  local bin="$1" raw ids line first_field
  [ -n "${_CURSOR_INVENTORY_CACHE[$bin]+set}" ] && return 0

  if ! raw="$("$bin" --list-models 2>/dev/null)"; then
    return 1
  fi

  # P14 shape: line 1 "Available models", line 2 blank, then entries of the
  # exact form "<id> - <display name>". Skip the header and the blank line;
  # take field 1 (the complete id token) of every remaining non-blank line.
  ids=""
  while IFS= read -r line; do
    case "$line" in
      ''|'Available models') continue ;;
    esac
    first_field="${line%% -*}"
    [ -n "$first_field" ] && ids="${ids}${first_field}"$'\n'
  done <<< "$raw"

  [ -n "$ids" ] || return 1

  _CURSOR_INVENTORY_CACHE["$bin"]="$ids"
  return 0
}

# _cursor_inventory_has <bin> <id> — full-token string equality against the
# cached inventory set for <bin>. Never substring/grep containment (P15):
# `cursor-grok-4.6-low` is a strict prefix of `cursor-grok-4.6-low-fast`, so
# a containment test would validate a removed/renamed non-fast id against
# its still-present -fast sibling.
_cursor_inventory_has() {
  local bin="$1" id="$2" line
  while IFS= read -r line; do
    [ "$line" = "$id" ] && return 0
  done <<< "${_CURSOR_INVENTORY_CACHE[$bin]:-}"
  return 1
}

# _cursor_clamp_note <requested-effort> <context> — stderr heads-up IFF the
# request was clamped (only `max`, which has no cursor level of its own).
# Mirrors grok_effort_note's posture; suppressible with DISPATCH_QUIET=1.
_cursor_clamp_note() {
  local requested="$1" context="${2:-cursor}"
  [ "$requested" = "max" ] || return 0
  [ -n "${DISPATCH_QUIET:-}" ] && return 0
  printf '%s: effort max is not a cursor level (accepts low|medium|high|xhigh) — running at xhigh.\n' \
    "$context" >&2
}

# cursor_model_for <bin> <family> <effort> <fast> — resolve a family alias
# to a full model id, validated against a LIVE `"$bin" --list-models`.
# THIS EXACT SIGNATURE AND ARG ORDER IS A CROSS-UNIT CONTRACT (called from
# dispatch-hetero.sh as `cursor_model_for "$CURSOR_BIN" "$MODEL" "$EFFORT"
# "$CURSOR_FAST"`) — do not change it.
#
# Prints the resolved id on stdout and returns 0 on success. On any failure
# (unknown family, inventory-miss, or the --list-models call itself
# failing/returning empty) prints a message to stderr and returns non-zero.
# A miss is a hard failure, never a silent downgrade to an unvalidated id.
cursor_model_for() {
  local bin="$1" family="$2" effort="$3" fast="${4:-0}"
  local base id

  if ! base="$(_cursor_model_base "$family" "$effort")"; then
    printf 'cursor-model: unknown family "%s" (expected grok46|codex53)\n' "$family" >&2
    return 2
  fi

  _cursor_clamp_note "$effort" "cursor-model"

  id="$base"
  [ "$fast" = "1" ] && id="${base}-fast"

  if ! _cursor_load_inventory "$bin"; then
    printf 'cursor-model: "%s --list-models" failed or returned no models — cannot validate "%s"\n' \
      "$bin" "$id" >&2
    return 1
  fi

  if ! _cursor_inventory_has "$bin" "$id"; then
    printf 'cursor-model: "%s" is not in the live inventory of "%s" (--list-models) — refusing to dispatch an unvalidated id\n' \
      "$id" "$bin" >&2
    return 1
  fi

  printf '%s\n' "$id"
}
