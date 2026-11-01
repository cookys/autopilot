#!/usr/bin/env bash
# resolve-project-paths.sh — where THIS project keeps its project documents → JSON.
# Sibling of resolve-knowledge-routing.sh; same ladder discipline, same `none` rule.
#
# Why it exists: scripts/scaffold-config.js already generates a `## Project Paths`
# block (projects_dir / plans_dir / archive_dir / backlog / index) into
# .claude/{project-lifecycle,next,dev-flow}-config.md at onboarding, derived from
# project-detect.js. Nothing read it. Three skills inject their config into context so an
# LLM may read the paths by eye; the skills that actually CREATE or SCAN project documents
# (ceo-agent, finish-flow, research-to-ship, quality-pipeline, handoff, retro) inject a
# config with no paths in it and name `docs/…` literally. This script is the missing
# consumption path.
#
# Usage:
#   scripts/resolve-project-paths.sh                 # JSON for $PWD
#   scripts/resolve-project-paths.sh --target <dir>  # …for another repo
#   scripts/resolve-project-paths.sh --field backlog
#   scripts/resolve-project-paths.sh --field backlog_config
#
# Precedence per field (first that answers wins):
#   1. $PROJECT_PATHS_CONFIG_OVERRIDE
#   2. <target>/.claude/project-lifecycle-config.md   ← what scaffold-config.js writes
#   3. <target>/.claude/next-config.md
#   4. <target>/.claude/dev-flow-config.md
#   5. <target>/scripts/lib/repo-layout.js registry — executed ONLY when the target and this
#      script's own repo are the same git repo (equal realpath of `git rev-parse --git-common-dir`,
#      GIT_* location variables cleared), the target is one of that repo's worktrees, the file is a
#      non-symlink physically under <target>/scripts/lib/, and its header names it the layout
#      registry. Anything else skips the tier: never run a consumer's code.
#   6. project-detect.js --target <target>
#   7. "none"
#
# Tier 2-4 are read from the TARGET, never from this plugin's own .claude/. The installed
# plugin ships a .claude/ directory, so inheriting it across repos would hand a consuming
# project autopilot's layout — measured 2026-09-12, see docs/BACKLOG.md.
#
# `none` is a real answer and MUST be reported, not replaced. A skill that receives `none`
# says the project has no such location; it does not create one because a reference doc
# once named `docs/`. An invented path fails silently: the file is written, nobody reads it.
#
# Output: JSON {projects_dir, plans_dir, archive_dir, backlog, backlog_config, index, source, target,
#               projects_dir_exists, plans_dir_exists, archive_dir_exists, backlog_exists, index_exists}
#   <field>_exists is true only when the resolved path is not `none` and exists under <target>
#   (a directory for *_dir, a file for backlog/index). A detected default can name a path that was
#   never created (fleet repo, 2026-11-01: backlog=docs/BACKLOG.md, no such file); a skill must treat
#   backlog_exists=false like `none`: report, do not write.
#   source ∈ {override, project-lifecycle-config, next-config, dev-flow-config, registry, detected, none}
#     — the source of the FIRST field that answered; individual fields may differ, so a
#       field's own value is authoritative, not the aggregate label.
#
# Exit codes: 0 success · 2 usage

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

FIELD=""; TARGET="$PWD"
while [[ $# -gt 0 ]]; do
  case "$1" in
    # `shift 2` with only one argument left FAILS and shifts nothing; without set -e the
    # loop then spins on the same argv forever. Require the operand before shifting.
    --field) [[ $# -ge 2 ]] || { echo "--field requires a value" >&2; exit 2; }; FIELD="$2"; shift 2 ;;
    --target) [[ $# -ge 2 ]] || { echo "--target requires a value" >&2; exit 2; }; TARGET="$2"; shift 2 ;;
    -h|--help) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[[ -d "$TARGET" ]] || { echo "--target is not a directory: $TARGET" >&2; exit 2; }
TARGET="$(cd "$TARGET" && pwd)"

# shellcheck source=lib/json-emit.sh
. "$SCRIPT_DIR/lib/json-emit.sh"
# shellcheck source=lib/resolve-config.sh
. "$SCRIPT_DIR/lib/resolve-config.sh"

CANDIDATES=()
[[ -n "${PROJECT_PATHS_CONFIG_OVERRIDE-}" && -r "${PROJECT_PATHS_CONFIG_OVERRIDE-}" ]] \
  && CANDIDATES+=("override:$PROJECT_PATHS_CONFIG_OVERRIDE")
for c in project-lifecycle-config next-config dev-flow-config; do
  [[ -r "$TARGET/.claude/$c.md" ]] && CANDIDATES+=("$c:$TARGET/.claude/$c.md")
done

# scaffold-config.js writes these as `- Projects directory: \`docs/projects/\`` — a label,
# not a key. Read the label and strip the surrounding backticks.
# Parse ONLY inside the `## Project Paths` section. An identically labelled bullet
# elsewhere in the same file — next-config's `## Scan Sources` carries `- Backlog:` too —
# would otherwise redirect where documents get written, silently and plausibly.
read_labelled() {
  local file="$1" label="$2" val=""
  val="$(awk '
      # Exact generated heading only (case-insensitive, trailing space tolerated). A
      # substring match would let `## Legacy Project Paths` answer for the real block.
      /^##[[:space:]]/ { inblock = (tolower($0) ~ /^##[[:space:]]+project[[:space:]]+paths[[:space:]]*$/) ? 1 : 0; next }
      inblock { print }
    ' "$file" 2>/dev/null \
    | grep -iE "^[[:space:]]*-[[:space:]]*${label}:" | head -1 \
    | sed -E "s/^[^:]*:[[:space:]]*//; s/^\`//; s/\`[[:space:]]*\$//; s/[[:space:]]+\$//")"
  printf '%s' "$val"
}

SOURCE="none"
RESOLVED=""
# Assigns RESOLVED and may advance SOURCE. NOT command substitution: a $( ) subshell
# would discard the SOURCE update, which is how the first version silently reported
# `none` while returning correct paths — the values looked right, the provenance lied.
resolve_one() {  # resolve_one <label>
  local label="$1" entry name file val
  RESOLVED=""
  for entry in "${CANDIDATES[@]+"${CANDIDATES[@]}"}"; do
    name="${entry%%:*}"; file="${entry#*:}"
    val="$(read_labelled "$file" "$label")"
    if [[ -n "$val" ]]; then
      [[ "$SOURCE" == "none" ]] && SOURCE="$name"
      RESOLVED="$val"; return 0
    fi
  done
}

resolve_one 'Projects directory'; PROJECTS="$RESOLVED"
resolve_one 'Plans directory';    PLANS="$RESOLVED"
resolve_one 'Archive';            ARCHIVE="$RESOLVED"
resolve_one 'Backlog';            BACKLOG="$RESOLVED"
resolve_one 'Index';              INDEX="$RESOLVED"

# Tier 5: the TARGET's own layout registry (autopilot repo only; relayout moves the work-record
# paths and the registry is the one place that knows the current stage). Read from TARGET, never
# from this plugin. The file is run only when it is this plugin's own repo (same_repo) and its
# header names it the layout registry, with the test-override env cleared.
REG_FILE="$TARGET/scripts/lib/repo-layout.js"
# Every git call below runs with the GIT_* location variables cleared: a caller (or an attacker
# who controls the environment) could otherwise point git at THIS repo while TARGET is foreign.
git_clean() { env -u GIT_DIR -u GIT_COMMON_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES git "$@"; }
common_dir() {  # common_dir <dir> → realpath of its git common dir, or fail
  local c; c="$(git_clean -C "$1" rev-parse --git-common-dir 2>/dev/null)" || return 1
  [[ -n "$c" ]] || return 1
  (cd "$1" && cd "$c" 2>/dev/null && pwd -P)
}
# True only when TARGET is this plugin's own repo: same git common dir, TARGET is itself one of
# this repo's worktrees (a gitfile or .git symlink pointing here does not make a foreign dir ours),
# and the registry file is a real file (no symlink) physically under TARGET/scripts/lib/.
same_repo() {
  local a b w t lib
  a="$(common_dir "$TARGET")" || return 1
  b="$(common_dir "$SCRIPT_DIR")" || return 1
  [[ -n "$a" && "$a" == "$b" ]] || return 1
  t="$(cd "$TARGET" && pwd -P)" || return 1
  local found=1
  while IFS= read -r w; do
    [[ "$w" == "worktree "* ]] || continue
    w="${w#worktree }"
    [[ "$(cd "$w" 2>/dev/null && pwd -P)" == "$t" ]] && { found=0; break; }
  done < <(git_clean -C "$SCRIPT_DIR" worktree list --porcelain 2>/dev/null)
  [[ "$found" -eq 0 ]] || return 1
  [[ ! -L "$REG_FILE" ]] || return 1
  lib="$(cd "$t/scripts/lib" 2>/dev/null && pwd -P)" || return 1
  [[ "$lib" == "$t/scripts/lib" ]]
}
if [[ -z "$PROJECTS" || -z "$PLANS" || -z "$ARCHIVE" || -z "$BACKLOG" || -z "$INDEX" ]] \
   && [[ -f "$REG_FILE" ]] && same_repo && [[ "$(head -c 800 "$REG_FILE")" == *'the one registry of where things live'* ]]; then
  reg_get() { env -u REPO_LAYOUT_REGISTRY node "$REG_FILE" path "$1" 2>/dev/null; }
  _answered=0
  for _f in projects_dir:projects_dir:PROJECTS:/ plans_dir:plans_dir:PLANS:/ projects_archive_dir:archive_dir:ARCHIVE:/ backlog_file:backlog:BACKLOG: projects_index:index:INDEX:; do
    IFS=: read -r _rk _ _var _suf <<< "$_f"
    [[ -n "${!_var}" ]] && continue
    _v="$(reg_get "$_rk")"
    [[ -n "$_v" ]] || continue
    printf -v "$_var" '%s' "${_v%/}$_suf"; _answered=1
  done
  [[ "$SOURCE" == "none" && "$_answered" -eq 1 ]] && SOURCE="registry"
fi

# Anything the config did not answer falls to detection, which owns doc/ vs docs/.
if [[ -z "$PROJECTS$PLANS$ARCHIVE$BACKLOG$INDEX" ]] \
   || [[ -z "$PROJECTS" || -z "$PLANS" || -z "$ARCHIVE" || -z "$BACKLOG" || -z "$INDEX" ]]; then
  DETECTED="$(node "$SCRIPT_DIR/project-detect.js" --target "$TARGET" 2>/dev/null)" || DETECTED=""
  pick() { printf '%s' "$DETECTED" | node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      try{const j=JSON.parse(d);const p=j.project_paths||{};process.stdout.write(p[process.argv[1]]||"")}catch(e){}
    })' "$1"; }
  if [[ -n "$DETECTED" ]]; then
    _answered=0
    for _f in projects_dir:PROJECTS plans_dir:PLANS archive_dir:ARCHIVE backlog:BACKLOG index:INDEX; do
      _key="${_f%%:*}"; _var="${_f##*:}"
      [[ -n "${!_var}" ]] && continue
      _v="$(pick "$_key")"
      [[ -n "$_v" ]] || continue
      printf -v "$_var" '%s' "$_v"; _answered=1
    done
    # Provenance follows an accepted VALUE, not a non-empty detector stdout. A detector
    # that runs and answers nothing must not be credited as the source of five `none`s.
    [[ "$SOURCE" == "none" && "$_answered" -eq 1 ]] && SOURCE="detected"
  fi
fi

for v in PROJECTS PLANS ARCHIVE BACKLOG INDEX; do
  [[ -z "${!v}" ]] && printf -v "$v" '%s' 'none'
done

BACKLOG_CONFIG="none"
if [[ -f "$TARGET/.claude/backlog-config.md" ]]; then
  BACKLOG_CONFIG=".claude/backlog-config.md"
fi

# <value> exists under TARGET as a <d|f>? `none` and empty are never existing.
path_exists() {  # path_exists <value> <d|f> → "true"|"false"
  local v="$1" kind="$2" p
  if [[ -z "$v" || "$v" == "none" ]]; then printf 'false'; return; fi
  [[ "$v" == /* ]] && p="$v" || p="$TARGET/$v"
  if [[ "$kind" == d ]]; then [[ -d "$p" ]] && printf 'true' || printf 'false'
  else [[ -f "$p" ]] && printf 'true' || printf 'false'; fi
}
PROJECTS_EXISTS="$(path_exists "$PROJECTS" d)"
PLANS_EXISTS="$(path_exists "$PLANS" d)"
ARCHIVE_EXISTS="$(path_exists "$ARCHIVE" d)"
BACKLOG_EXISTS="$(path_exists "$BACKLOG" f)"
INDEX_EXISTS="$(path_exists "$INDEX" f)"

if [[ -n "$FIELD" ]]; then
  case "$FIELD" in
    projects_dir) printf '%s\n' "$PROJECTS" ;;
    plans_dir) printf '%s\n' "$PLANS" ;;
    archive_dir) printf '%s\n' "$ARCHIVE" ;;
    backlog) printf '%s\n' "$BACKLOG" ;;
    backlog_config) printf '%s\n' "$BACKLOG_CONFIG" ;;
    index) printf '%s\n' "$INDEX" ;;
    projects_dir_exists) printf '%s\n' "$PROJECTS_EXISTS" ;;
    plans_dir_exists) printf '%s\n' "$PLANS_EXISTS" ;;
    archive_dir_exists) printf '%s\n' "$ARCHIVE_EXISTS" ;;
    backlog_exists) printf '%s\n' "$BACKLOG_EXISTS" ;;
    index_exists) printf '%s\n' "$INDEX_EXISTS" ;;
    source) printf '%s\n' "$SOURCE" ;;
    target) printf '%s\n' "$TARGET" ;;
    *) echo "unknown field: $FIELD" >&2; exit 2 ;;
  esac
  exit 0
fi

printf '{ "projects_dir": "%s", "plans_dir": "%s", "archive_dir": "%s", "backlog": "%s", "backlog_config": "%s", "index": "%s", "source": "%s", "target": "%s", "projects_dir_exists": %s, "plans_dir_exists": %s, "archive_dir_exists": %s, "backlog_exists": %s, "index_exists": %s }\n' \
  "$(json_escape "$PROJECTS")" "$(json_escape "$PLANS")" "$(json_escape "$ARCHIVE")" \
  "$(json_escape "$BACKLOG")" "$(json_escape "$BACKLOG_CONFIG")" "$(json_escape "$INDEX")" "$SOURCE" "$(json_escape "$TARGET")" \
  "$PROJECTS_EXISTS" "$PLANS_EXISTS" "$ARCHIVE_EXISTS" "$BACKLOG_EXISTS" "$INDEX_EXISTS"
