#!/usr/bin/env bash
# check-disjointness — result-validating allowlist enforcer for /l4 /l5 width
# fan-out (Phase S1). The DETERMINISTIC file-disjointness gate that authorizes
# batch independent-unit parallelism.
#
# Why a script (not LLM judgment): the disjointness clamp must be impossible to
# fake. The LLM is NEVER the clamp — the authoritative check reads GIT ARTIFACTS
# (`git diff --name-only <range>`), not the agent's self-report of what it
# touched. Same artifact-rail as scripts/dispatch-hetero.sh: verify by git,
# never by stream/self-report.
#
# ── SCOPE: FILES ONLY (read this before trusting a green verdict) ─────────────
# This gate certifies that a unit's actual commit touched ONLY files inside its
# declared allowlist, and that declared allowlists don't overlap. It certifies
# FILES, NOT BEHAVIOR. Semantic coupling — shared types, import edges, call-order
# invariants — is invisible to a file-path check and remains the depth-0
# reviewer's to catch. A green verdict here is NOT a behavior clearance.
#
# ── DENYLIST LIMIT (Ops review finding — do not relax) ────────────────────────
# The "never-widen shared files" denylist is scoped to WHAT REGEX CAN ACTUALLY
# OWN: lockfiles + NAMED build/config globs only (e.g. *.lock, *-lock.json,
# package.json, named CI/build files). "Generated code" / "shared-type module"
# detection is DELIBERATELY ABSENT: regex cannot reliably own those, and claiming
# it can is a footgun. Those classes are the reviewer's job, not this script's.
#
# ── MODES ─────────────────────────────────────────────────────────────────────
#   validate  (AUTHORITATIVE, post-commit): read git artifacts for <range>,
#             compute actual_touched_files, fail-closed (exit non-zero) if ANY
#             actual-touched file is outside the declared allowlist, or if any
#             touched file matches the denylist.
#   propose   (ADVISORY ONLY, pre-dispatch): given declared per-unit allowlists,
#             report pairwise overlaps + denylist hits. NEVER load-bearing for a
#             fail-closed dispatch decision — the LLM is never the clamp; this is
#             a courtesy check on a *proposal*, before any real artifact exists.
#
# ── USAGE ─────────────────────────────────────────────────────────────────────
#   scripts/check-disjointness.sh validate \
#       --allow "src/foo.ts" --allow "src/bar/**" \
#       --range <base>..<head>          # or a single commit SHA (its own diff)
#       [--allow-file <f>]              # one glob per line; '#' comments ok
#       [--repo <dir>]                  # default: cwd
#       [--deny-file <f>]               # extra denylist globs (one per line)
#       [--no-default-deny]             # drop the built-in lockfile/build denylist
#
#   scripts/check-disjointness.sh propose \
#       --unit "ui=src/ui/**" --unit "api=src/api/**,src/shared/types.ts" ...
#       [--deny-file <f>] [--no-default-deny]
#
# ── OUTPUT ────────────────────────────────────────────────────────────────────
# validate: one JSON object on stdout:
#   { "mode": "validate", "range": "...", "disjoint": bool,
#     "declared": [...], "actual_touched_files": [...],
#     "undeclared_touches": [...], "denylist_hits": [...] }
#   exit 0 = clean (touches ⊆ allowlist AND no denylist hit)
#   exit 1 = undeclared touch and/or denylist hit (fail-closed)
#
# propose: one JSON object on stdout:
#   { "mode": "propose", "disjoint": bool, "units": [...],
#     "overlaps": [ {"a":"u1","b":"u2","files":[...]} ], "denylist_hits": [...] }
#   exit 0 = no overlap + no denylist hit (advisory clean)
#   exit 1 = overlap and/or denylist hit (advisory — NOT a clamp)
#
#   exit 2 = usage / precondition error (nothing checked)
#
# ── HARD-WON NOTES (do not regress) ──────────────────────────────────────────
#   * set -euo pipefail. The SIGPIPE-under-pipefail trap (a `cmd | head` /
#     `cmd | grep -q` makes the upstream get SIGPIPE → exit 141 → script aborts;
#     this bug already bit two other scripts here) is AVOIDED: no `| head` /
#     `| grep -q` over git output — we read full output into vars / arrays.
#   * Root commits (no parent), binary files (numstat '-'), and renames are all
#     handled via `git diff --name-only` (renames already collapse to the new
#     path; --name-only is binary-safe).
#   * Run under bash explicitly (login shell is zsh; associative arrays differ).

set -euo pipefail

# ── built-in denylist: ONLY what a regex/glob can reliably own ────────────────
# lockfiles + named build/config files. NO generated-code / shared-type globs.
DEFAULT_DENY=(
  "*.lock"
  "*-lock.json"
  "*-lock.yaml"
  "*.lockb"
  "package-lock.json"
  "yarn.lock"
  "pnpm-lock.yaml"
  "Cargo.lock"
  "poetry.lock"
  "Gemfile.lock"
  "composer.lock"
  "go.sum"
  "package.json"
  ".github/workflows/*"
)

MODE=""
RANGE=""
STAGED=0
REPO="."
NO_DEFAULT_DENY=0
declare -a ALLOW=()
declare -a DENY_EXTRA=()
declare -a UNITS=()   # propose mode: "name=glob,glob,..."

usage() { sed -n '2,75p' "$0" | sed 's/^# \{0,1\}//'; }

# shellcheck source=lib/json-emit.sh
. "$(dirname "$0")/lib/json-emit.sh"
# Class A: flatten newlines before shared RFC escape (flatten stays VISIBLE here).
_flat_json_escape() { json_escape "$(printf '%s' "$1" | tr '\n' ' ')"; }

err_usage() { # message
  printf '{ "mode": "%s", "error": "%s", "exit": 2 }\n' "${MODE:-none}" "$(_flat_json_escape "$1")"
  exit 2
}

# glob_match <path> <glob> → exit 0 if path matches the glob.
# ALWAYS routed through a glob→ERE translation (NOT shell `case`): shell `case`
# treats '*' as crossing '/', which would make `src/*` wrongly match
# `src/sub/x.ts`. Here single '*' = [^/]* (one path segment) and '**' = any
# depth (incl. zero segments). A bare directory glob (`dir` or `dir/`) also
# matches everything below it (an allowlist of a dir owns its subtree).
glob_match() {
  local path="$1" glob="$2"
  # Brace `{a,b}` and char-class `[a-z]` are NOT supported: the translator escapes
  # them to literals, so such a glob would SILENTLY match only the literal text
  # (under-match) instead of the intended set. Reject loudly so the caller splits
  # the scope into explicit globs rather than getting a confusing false "undeclared
  # touch". (Fail-closed direction either way, but a clear error beats a silent miss.)
  case "$glob" in
    *'{'*|*'}'*|*'['*|*']'*)
      err_usage "unsupported glob syntax in '$glob': brace {a,b} / char-class [a-z] are not supported (they match literally, not as a set) — split the scope into separate explicit globs" ;;
  esac
  # A trailing-slash or bare-dir form: normalise `dir/` → `dir` so the subtree
  # rule below applies uniformly.
  glob="${glob%/}"
  local re
  re="$(printf '%s' "$glob" \
    | sed -e 's/[.[\^$()+{}|]/\\&/g' \
          -e 's#\*\*/#§DBLSLASH§#g' \
          -e 's#/\*\*#§SLASHDBL§#g' \
          -e 's#\*\*#§DBL§#g' \
          -e 's#\*#[^/]*#g' \
          -e 's#?#[^/]#g' \
          -e 's#§DBLSLASH§#(.*/)?#g' \
          -e 's#§SLASHDBL§#(/.*)?#g' \
          -e 's#§DBL§#.*#g')"
  if [[ "$path" =~ ^${re}$ ]]; then return 0; fi
  # Subtree rule: a WILDCARD-FREE glob naming a bare directory (e.g. `src/api`)
  # owns its whole subtree. Globs that contain a wildcard ('*'/'?') are NOT
  # extended this way — `src/*` must stay one segment and reject `src/sub/x.ts`.
  case "$glob" in
    *'*'*|*'?'*) return 1 ;;
    *) [[ "$path" =~ ^${re}/.*$ ]] ;;
  esac
}

# path_in_globs <path> <glob1> <glob2> ... → exit 0 if path matches ANY glob
path_in_globs() {
  local path="$1"; shift
  local g
  for g in "$@"; do
    [ -z "$g" ] && continue
    if glob_match "$path" "$g"; then return 0; fi
  done
  return 1
}

# ── arg parse ─────────────────────────────────────────────────────────────────
[ $# -ge 1 ] || { usage; exit 2; }
case "$1" in
  --help|-h) usage; exit 0 ;;
  validate|propose) MODE="$1"; shift ;;
  *) err_usage "first argument must be 'validate', 'propose', or --help (got: $1)" ;;
esac

while [ $# -gt 0 ]; do
  case "$1" in
    --range) RANGE="${2:-}"; shift 2 ;;
    --staged) STAGED=1; shift ;;
    --allow) ALLOW+=("${2:-}"); shift 2 ;;
    --allow-file)
      [ -r "${2:-}" ] || err_usage "allow-file not readable: ${2:-}"
      while IFS= read -r __l; do
        __l="${__l%%#*}"; __l="${__l#"${__l%%[![:space:]]*}"}"; __l="${__l%"${__l##*[![:space:]]}"}"
        [ -n "$__l" ] && ALLOW+=("$__l")
      done < "$2"
      shift 2 ;;
    --deny-file)
      [ -r "${2:-}" ] || err_usage "deny-file not readable: ${2:-}"
      while IFS= read -r __l; do
        __l="${__l%%#*}"; __l="${__l#"${__l%%[![:space:]]*}"}"; __l="${__l%"${__l##*[![:space:]]}"}"
        [ -n "$__l" ] && DENY_EXTRA+=("$__l")
      done < "$2"
      shift 2 ;;
    --unit) UNITS+=("${2:-}"); shift 2 ;;
    --repo) REPO="${2:-}"; shift 2 ;;
    --no-default-deny) NO_DEFAULT_DENY=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) err_usage "unknown argument: $1" ;;
  esac
done

# assemble the effective denylist
declare -a DENY=()
[ "$NO_DEFAULT_DENY" = 0 ] && DENY+=("${DEFAULT_DENY[@]}")
[ "${#DENY_EXTRA[@]}" -gt 0 ] && DENY+=("${DENY_EXTRA[@]}")

# ── propose mode (advisory) ───────────────────────────────────────────────────
if [ "$MODE" = "propose" ]; then
  [ "${#UNITS[@]}" -ge 1 ] || err_usage "propose requires at least one --unit name=glob[,glob...]"

  # parse units → parallel arrays of name + space-separated globs
  declare -a U_NAME=() U_GLOBS=()
  for u in "${UNITS[@]}"; do
    case "$u" in
      *=*) : ;;
      *) err_usage "malformed --unit (expected name=glob[,glob...]): $u" ;;
    esac
    local_name="${u%%=*}"
    local_globs="${u#*=}"
    # comma → newline → trimmed, space-joined
    globs_joined=""
    while IFS= read -r g; do
      g="${g#"${g%%[![:space:]]*}"}"; g="${g%"${g##*[![:space:]]}"}"
      [ -n "$g" ] && globs_joined="$globs_joined $g"
    done <<< "$(printf '%s' "$local_globs" | tr ',' '\n')"
    U_NAME+=("$local_name")
    U_GLOBS+=("${globs_joined# }")
  done

  # denylist hits: any unit glob that is itself a denylisted name
  deny_hits=""
  for i in "${!U_NAME[@]}"; do
    # shellcheck disable=SC2206
    g_arr=(${U_GLOBS[$i]})
    for g in "${g_arr[@]}"; do
      if [ "${#DENY[@]}" -gt 0 ] && path_in_globs "$g" "${DENY[@]}"; then
        deny_hits="$deny_hits${deny_hits:+$'\n'}${U_NAME[$i]}: $g"
      fi
    done
  done

  # pairwise overlap: a glob from unit A whose literal text appears in unit B,
  # OR a glob from A that matches a *concrete-looking* path declared in B.
  # Advisory heuristic only: declared globs aren't real paths, so we detect
  # exact-glob-string collisions AND prefix-containment (a/** vs a/b.ts).
  overlaps_json=""
  any_overlap=0
  n="${#U_NAME[@]}"
  for ((a=0; a<n; a++)); do
    for ((b=a+1; b<n; b++)); do
      # shellcheck disable=SC2206
      ga=(${U_GLOBS[$a]}); gb=(${U_GLOBS[$b]})
      pair_files=""
      for x in "${ga[@]}"; do
        for y in "${gb[@]}"; do
          hit=0
          [ "$x" = "$y" ] && hit=1
          # x matches y as a path, or y matches x as a path (covers a/** vs a/b)
          if [ "$hit" = 0 ]; then
            if glob_match "$y" "$x" || glob_match "$x" "$y"; then hit=1; fi
          fi
          if [ "$hit" = 1 ]; then
            pair_files="$pair_files${pair_files:+$'\n'}$x ∩ $y"
          fi
        done
      done
      if [ -n "$pair_files" ]; then
        any_overlap=1
        files_arr="$(json_array_from_lines "$pair_files")"
        overlaps_json="$overlaps_json${overlaps_json:+, }{ \"a\": \"$(_flat_json_escape "${U_NAME[$a]}")\", \"b\": \"$(_flat_json_escape "${U_NAME[$b]}")\", \"files\": $files_arr }"
      fi
    done
  done

  # units json
  units_json=""
  for i in "${!U_NAME[@]}"; do
    # shellcheck disable=SC2206
    g_arr=(${U_GLOBS[$i]})
    g_lines=""
    for g in "${g_arr[@]}"; do g_lines="$g_lines${g_lines:+$'\n'}$g"; done
    units_json="$units_json${units_json:+, }{ \"name\": \"$(_flat_json_escape "${U_NAME[$i]}")\", \"globs\": $(json_array_from_lines "$g_lines") }"
  done

  deny_json="$(json_array_from_lines "$deny_hits")"
  disjoint="true"; exit_code=0
  if [ "$any_overlap" = 1 ] || [ -n "$deny_hits" ]; then disjoint="false"; exit_code=1; fi

  printf '{ "mode": "propose", "disjoint": %s, "units": [%s], "overlaps": [%s], "denylist_hits": %s }\n' \
    "$disjoint" "$units_json" "$overlaps_json" "$deny_json"
  exit "$exit_code"
fi

# ── validate mode (AUTHORITATIVE) ─────────────────────────────────────────────
[ "${#ALLOW[@]}" -ge 1 ] || err_usage "validate requires at least one --allow / --allow-file glob"
if [ "$STAGED" -eq 1 ] && [ -n "$RANGE" ]; then
  err_usage "--staged and --range are mutually exclusive"
fi
[ -n "$RANGE" ] || [ "$STAGED" -eq 1 ] || err_usage "validate requires --range <base>..<head>, a commit SHA, or --staged"
git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || err_usage "not a git repository: $REPO"

# Resolve the diff. Two accepted shapes:
#   * a range "A..B" (or "A...B") → diff that range
#   * a single commit SHA → diff against its parent; root commit (no parent) →
#     diff against the empty tree so the full initial set is reported.
# --staged (P6D KR2, plan R2\' 2026-08-21): the SAME matcher over the staged
# index instead of a committed range — equivalence with the post-commit gate is
# by construction (one comparator, two input sources), pinned by the corpus in
# hooks/tests/p6d-gates-manifest.test.sh. This is the pre-commit manifest gate
# input for wrapper-owned staging (dispatch-hetero edit-only capture).
NAME_ONLY=""
if [ "$STAGED" -eq 1 ]; then
  NAME_ONLY="$(git -C "$REPO" -c core.quotepath=false diff --cached --name-only)"
else
case "$RANGE" in
  *..*)
    git -C "$REPO" rev-parse --verify --quiet "${RANGE%%..*}" >/dev/null \
      || err_usage "base ref not found in range: ${RANGE%%..*}"
    git -C "$REPO" rev-parse --verify --quiet "${RANGE##*..}" >/dev/null \
      || err_usage "head ref not found in range: ${RANGE##*..}"
    # NOTE: a two-dot A..B range over a DIVERGED branch (a unit forked off the
    # base while the base advanced) reports base-side changes as PHANTOM
    # undeclared touches. For forked branches use a single SHA (the primary
    # per-unit own-commit path) or a three-dot A...B (merge-base) range — both
    # accepted here. core.quotepath=false so non-ASCII paths arrive as real bytes
    # (else an in-allowlist unicode file fails to match itself → false exit 1).
    NAME_ONLY="$(git -C "$REPO" -c core.quotepath=false diff --name-only "$RANGE")"
    ;;
  *)
    git -C "$REPO" rev-parse --verify --quiet "$RANGE^{commit}" >/dev/null \
      || err_usage "commit not found: $RANGE"
    if git -C "$REPO" rev-parse --verify --quiet "${RANGE}^" >/dev/null 2>&1; then
      # has a parent → its own diff
      NAME_ONLY="$(git -C "$REPO" -c core.quotepath=false diff --name-only "${RANGE}^" "$RANGE")"
    else
      # root commit (no parent) → diff vs the empty tree
      EMPTY_TREE="$(git -C "$REPO" hash-object -t tree /dev/null)"
      NAME_ONLY="$(git -C "$REPO" -c core.quotepath=false diff --name-only "$EMPTY_TREE" "$RANGE")"
    fi
    ;;
esac
fi

# Compute undeclared touches + denylist hits over the ACTUAL touched files.
undeclared=""
deny_hits=""
if [ -n "$NAME_ONLY" ]; then
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if ! path_in_globs "$f" "${ALLOW[@]}"; then
      undeclared="$undeclared${undeclared:+$'\n'}$f"
    fi
    if [ "${#DENY[@]}" -gt 0 ] && path_in_globs "$f" "${DENY[@]}"; then
      deny_hits="$deny_hits${deny_hits:+$'\n'}$f"
    fi
  done <<< "$NAME_ONLY"
fi

declared_json="$(printf '%s\n' "${ALLOW[@]}" | { json_array_from_lines "$(cat)"; })"
actual_json="$(json_array_from_lines "$NAME_ONLY")"
undeclared_json="$(json_array_from_lines "$undeclared")"
deny_json="$(json_array_from_lines "$deny_hits")"

disjoint="true"; exit_code=0
if [ -n "$undeclared" ] || [ -n "$deny_hits" ]; then disjoint="false"; exit_code=1; fi

printf '{ "mode": "validate", "range": "%s", "disjoint": %s, "declared": %s, "actual_touched_files": %s, "undeclared_touches": %s, "denylist_hits": %s }\n' \
  "$(_flat_json_escape "$RANGE")" "$disjoint" "$declared_json" "$actual_json" "$undeclared_json" "$deny_json"
exit "$exit_code"
