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
#
# Precedence per field (first that answers wins):
#   1. $PROJECT_PATHS_CONFIG_OVERRIDE
#   2. <target>/.claude/project-lifecycle-config.md   ← what scaffold-config.js writes
#   3. <target>/.claude/next-config.md
#   4. <target>/.claude/dev-flow-config.md
#   5. project-detect.js --target <target>
#   6. "none"
#
# Tier 2-4 are read from the TARGET, never from this plugin's own .claude/. The installed
# plugin ships a .claude/ directory, so inheriting it across repos would hand a consuming
# project autopilot's layout — measured 2026-09-12, see docs/BACKLOG.md.
#
# `none` is a real answer and MUST be reported, not replaced. A skill that receives `none`
# says the project has no such location; it does not create one because a reference doc
# once named `docs/`. An invented path fails silently: the file is written, nobody reads it.
#
# Output: JSON {projects_dir, plans_dir, archive_dir, backlog, index, source, target}
#   source ∈ {override, project-lifecycle-config, next-config, dev-flow-config, detected, none}
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

if [[ -n "$FIELD" ]]; then
  case "$FIELD" in
    projects_dir) printf '%s\n' "$PROJECTS" ;;
    plans_dir) printf '%s\n' "$PLANS" ;;
    archive_dir) printf '%s\n' "$ARCHIVE" ;;
    backlog) printf '%s\n' "$BACKLOG" ;;
    index) printf '%s\n' "$INDEX" ;;
    source) printf '%s\n' "$SOURCE" ;;
    target) printf '%s\n' "$TARGET" ;;
    *) echo "unknown field: $FIELD" >&2; exit 2 ;;
  esac
  exit 0
fi

printf '{ "projects_dir": "%s", "plans_dir": "%s", "archive_dir": "%s", "backlog": "%s", "index": "%s", "source": "%s", "target": "%s" }\n' \
  "$(json_escape "$PROJECTS")" "$(json_escape "$PLANS")" "$(json_escape "$ARCHIVE")" \
  "$(json_escape "$BACKLOG")" "$(json_escape "$INDEX")" "$SOURCE" "$(json_escape "$TARGET")"
