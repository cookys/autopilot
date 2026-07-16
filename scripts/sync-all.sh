#!/usr/bin/env bash
# sync-all.sh — one entry point for the repo's scattered sync/check rituals.
#
# The rituals (5 generators + membership/parity checks) used to be hand-copied into
# FOUR consumers (.githooks/pre-commit, .github/workflows/test.yml,
# preflight-portability.sh, preflight-release.sh). This driver reads them from the
# single manifest scripts/sync-manifest.json so a new ritual is wired in ONE place.
#
# Usage:
#   scripts/sync-all.sh                        # run every generator (regenerate derived artifacts)
#   scripts/sync-all.sh --check                # run every check (full; CI / preflight)
#   scripts/sync-all.sh --check --changed [B]  # run checks for triggered rituals only
#                                              #   no B  -> staged diff (pre-commit)
#                                              #   B     -> `git diff --name-only <B>` range
#   scripts/sync-all.sh --check --only <id>... # run only these ritual ids (preflight delegation)
#   scripts/sync-all.sh --list                 # list ritual ids and exit
#
# Options:
#   --manifest <path>   override manifest (tests). Default scripts/sync-manifest.json
#   --json              emit ONLY the machine summary on stdout (progress still on stderr)
#
# Output: a JSON summary object on stdout; human progress on stderr.
# Exit:   0 = all ran clean; 1 = a ritual failed (summary names id + fix) OR unknown --only id;
#         2 = CLI usage / missing-manifest-file error; 3 = manifest content invalid
#         (parse fail / empty or absent rituals[] / bad field) — fail-closed, nothing run.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=scripts/lib/json-emit.sh
. "$REPO_ROOT/scripts/lib/json-emit.sh"

MANIFEST="$REPO_ROOT/scripts/sync-manifest.json"
MODE="generate"        # generate | check
CHANGED=0
BASE=""
LIST=0
JSON_ONLY=0
declare -a ONLY=()

usage() { sed -n '2,30p' "$0"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --check)    MODE="check"; shift ;;
    --changed)  CHANGED=1; shift
                if [ $# -gt 0 ] && [ "${1#-}" = "$1" ]; then BASE="$1"; shift; fi ;;
    --only)     shift; [ $# -gt 0 ] || { echo "sync-all: --only needs an id" >&2; exit 2; }
                ONLY+=("$1"); shift ;;
    --manifest) shift; [ $# -gt 0 ] || { echo "sync-all: --manifest needs a path" >&2; exit 2; }
                MANIFEST="$1"; shift ;;
    --list)     LIST=1; shift ;;
    --json)     JSON_ONLY=1; shift ;;
    --help|-h)  usage; exit 0 ;;
    *)          echo "sync-all: unknown arg: $1" >&2; exit 2 ;;
  esac
done

[ -f "$MANIFEST" ] || { echo "sync-all: manifest not found: $MANIFEST" >&2; exit 2; }

# Emit one row per ritual, columns joined by US (0x1f, non-whitespace so empty
# fields — e.g. a null generator — are NOT collapsed by `read`'s IFS-whitespace rule):
#   id US generator US check US fix US tier US (space-joined triggers)
US=$'\x1f'
manifest_rows() {
  node -e '
    const fs = require("fs");
    const SEP = String.fromCharCode(31);
    let m;
    try { m = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
    catch (e) { process.stderr.write("manifest parse error: " + e.message + "\n"); process.exit(3); }
    if (!m || !Array.isArray(m.rituals)) { process.stderr.write("manifest missing rituals[]\n"); process.exit(3); }
    if (m.rituals.length === 0) { process.stderr.write("manifest has empty rituals[] (nothing to run — refusing, fail-closed)\n"); process.exit(3); }
    for (const r of m.rituals) {
      const trig = r.trigger || [];
      // Triggers are space-joined in the row and word-split by the shell, so a
      // trigger path containing whitespace would silently break matching — reject it loudly.
      if (trig.some(t => /\s/.test(String(t)))) {
        process.stderr.write("manifest trigger contains whitespace (unsupported): " + r.id + "\n"); process.exit(3);
      }
      const cols = [r.id || "", r.generator || "", r.check || "", r.fix || "", r.tier || "both", trig.join(" ")];
      if (cols.some(c => String(c).includes(SEP) || String(c).includes("\n"))) {
        process.stderr.write("manifest field contains a control char: " + r.id + "\n"); process.exit(3);
      }
      process.stdout.write(cols.join(SEP) + "\n");
    }
  ' "$MANIFEST"
}

# Propagate manifest-content errors (parse fail / no rituals[] / empty rituals[] /
# bad field) as the manifest_rows exit code (3), distinct from CLI-usage errors (2)
# and missing-manifest-file (2). Fail-closed: never run with an unreadable manifest.
ROWS="$(manifest_rows)"; MANIFEST_RC=$?
if [ "$MANIFEST_RC" -ne 0 ]; then
  echo "sync-all: manifest invalid (rc=$MANIFEST_RC) — refusing to run (fail-closed)" >&2
  exit "$MANIFEST_RC"
fi

if [ "$LIST" = 1 ]; then
  printf '%s\n' "$ROWS" | cut -d"$US" -f1
  exit 0
fi

# ── changed-file set (for --changed trigger filtering) ──
# On a git error in --changed mode we must NOT proceed with an empty changed-set: that
# would silently skip every trigger-scoped ritual (fail-open). Instead fall back to the
# FULL check set (fail-closed) so a broken git never suppresses a gate.
CHANGED_FILES=""
CHANGED_FAIL_FULL=0
if [ "$CHANGED" = 1 ]; then
  if [ -n "$BASE" ]; then
    CHANGED_FILES="$(git diff --name-only "$BASE" 2>/dev/null)"; GIT_RC=$?
  else
    CHANGED_FILES="$(git diff --cached --name-only 2>/dev/null)"; GIT_RC=$?
  fi
  if [ "$GIT_RC" -ne 0 ]; then
    echo "sync-all: git diff failed (rc=$GIT_RC) in --changed mode — running the FULL check set (fail-closed)" >&2
    CHANGED_FAIL_FULL=1
  fi
fi

match_one() {
  # match_one <changed-file> <trigger-entry>
  local f="$1" entry="$2"
  case "$entry" in
    */)   case "$f" in "$entry"*) return 0 ;; esac ;;   # directory prefix
    \**)  case "$f" in *"${entry#\*}") return 0 ;; esac ;;  # suffix
    *)    [ "$f" = "$entry" ] && return 0 ;;            # exact
  esac
  return 1
}

trigger_matches() {
  # trigger_matches <space-joined-triggers>; uses $CHANGED_FILES
  local trig="$1" entry f
  [ -z "$trig" ] && return 0   # empty trigger = always
  # Split the space-joined triggers WITH pathname globbing DISABLED (set -f): an
  # unquoted `for entry in $trig` would glob-expand a pattern like `*plugin.json`
  # against cwd, silently converting a suffix trigger into whatever files exist
  # there (proven: a root plugin.json collapses `*plugin.json` to an exact match,
  # so a nested plugin.json change no longer fires the rule). noglob keeps tokens literal.
  local -a entries=()
  set -f
  # shellcheck disable=SC2206
  entries=($trig)
  set +f
  for entry in "${entries[@]}"; do
    while IFS= read -r f; do
      [ -z "$f" ] && continue
      match_one "$f" "$entry" && return 0
    done <<< "$CHANGED_FILES"
  done
  return 1
}

# ── run selected rituals ──
declare -a RAN=() SKIPPED=() FAIL_IDS=() FAIL_FIXES=()
declare -a WANT_ONLY=()
if [ "${#ONLY[@]}" -gt 0 ]; then WANT_ONLY=("${ONLY[@]}"); fi
declare -a SEEN_ONLY=()

in_list() { local x="$1"; shift; local e; for e in "$@"; do [ "$e" = "$x" ] && return 0; done; return 1; }

while IFS="$US" read -r id gen check fix tier trig; do
  [ -z "$id" ] && continue

  if [ "${#WANT_ONLY[@]}" -gt 0 ]; then
    in_list "$id" "${WANT_ONLY[@]}" || { continue; }
    SEEN_ONLY+=("$id")
  elif [ "$CHANGED" = 1 ] && [ "$CHANGED_FAIL_FULL" = 0 ]; then
    # (CHANGED_FAIL_FULL=1 ⇒ git-diff failed ⇒ skip filtering, run the FULL set)
    case "$tier" in
      pre-commit|both) : ;;
      *) SKIPPED+=("$id (tier=$tier)"); continue ;;
    esac
    if ! trigger_matches "$trig"; then
      SKIPPED+=("$id (no trigger match)"); continue
    fi
  fi

  local_cmd=""
  if [ "$MODE" = "check" ]; then local_cmd="$check"; else local_cmd="$gen"; fi
  if [ -z "$local_cmd" ]; then
    SKIPPED+=("$id (no $MODE cmd)"); continue
  fi

  [ "$JSON_ONLY" = 1 ] || echo "── $id: $local_cmd" >&2
  RAN+=("$id")
  out=""
  if ! out="$(cd "$REPO_ROOT" && bash -c "$local_cmd" 2>&1)"; then
    echo "$out" >&2
    echo "✗ $id FAILED — fix: $fix" >&2
    FAIL_IDS+=("$id"); FAIL_FIXES+=("$fix")
  fi
done <<< "$ROWS"

# unknown --only ids are a hard error (typo protection)
declare -a UNKNOWN_ONLY=()
if [ "${#WANT_ONLY[@]}" -gt 0 ]; then
  for want in "${WANT_ONLY[@]}"; do
    in_list "$want" "${SEEN_ONLY[@]:-}" || UNKNOWN_ONLY+=("$want")
  done
fi

# ── JSON summary ──
OK=true
[ "${#FAIL_IDS[@]}" -gt 0 ] && OK=false
[ "${#UNKNOWN_ONLY[@]}" -gt 0 ] && OK=false

build_summary() {
  local first x i
  printf '{'
  printf '"mode":"%s",' "$MODE"
  printf '"changed":%s,' "$([ "$CHANGED" = 1 ] && echo true || echo false)"
  printf '"ran":['
  first=1; for x in "${RAN[@]:-}"; do [ -z "$x" ] && continue; [ "$first" = 1 ] && first=0 || printf ','; printf '"%s"' "$(json_escape "$x")"; done
  printf '],'
  printf '"skipped":['
  first=1; for x in "${SKIPPED[@]:-}"; do [ -z "$x" ] && continue; [ "$first" = 1 ] && first=0 || printf ','; printf '"%s"' "$(json_escape "$x")"; done
  printf '],'
  printf '"unknown_only":['
  first=1; for x in "${UNKNOWN_ONLY[@]:-}"; do [ -z "$x" ] && continue; [ "$first" = 1 ] && first=0 || printf ','; printf '"%s"' "$(json_escape "$x")"; done
  printf '],'
  printf '"failures":['
  first=1
  if [ "${#FAIL_IDS[@]}" -gt 0 ]; then
    for i in "${!FAIL_IDS[@]}"; do
      [ "$first" = 1 ] && first=0 || printf ','
      printf '{"id":"%s","fix":"%s"}' "$(json_escape "${FAIL_IDS[$i]}")" "$(json_escape "${FAIL_FIXES[$i]}")"
    done
  fi
  printf '],'
  printf '"ok":%s}' "$OK"
  printf '\n'
}

if [ "${#UNKNOWN_ONLY[@]}" -gt 0 ]; then
  printf 'sync-all: unknown --only id(s):' >&2
  for want in "${UNKNOWN_ONLY[@]}"; do printf ' %s' "$want" >&2; done
  printf '\n' >&2
fi

build_summary

$OK && exit 0 || exit 1
