#!/usr/bin/env bash
# resolve-knowledge-routing.sh — resolve WHERE durable content lands in the consuming
# project → JSON. Sibling of resolve-qc-gate.sh / resolve-doa.sh; same 4-tier ladder.
#
# Why this exists: references/knowledge-routing.md names autopilot's OWN layout
# (`references/`, `docs/BACKLOG.md`, `.claude/knowledge/` + its `git add -f` promotion).
# Two of those do not exist in a consuming project and the third's write contract is a
# fact about THIS repo's .gitignore. A skill that hands a foreign project those literals
# gets a path invented or nothing written. The policy (what is durable, which class goes
# where) stays in the reference doc; this script answers only "where, here".
#
# Usage:
#   scripts/resolve-knowledge-routing.sh              # emit resolved config JSON
#   scripts/resolve-knowledge-routing.sh --field discipline_target
#   scripts/resolve-knowledge-routing.sh --target <dir>   # resolve for another repo
#
# Order of precedence (first existing file wins):
#   1. $KNOWLEDGE_ROUTING_CONFIG_OVERRIDE
#   2. $PWD/.claude/knowledge-routing-config.md
#   3. $REPO_ROOT/.claude/knowledge-routing-config.md  — ONLY when the target IS this repo.
#      The installed plugin ships its own .claude/, so inheriting it across repos would hand
#      a consuming project autopilot's layout. That is the defect, not the fallback.
#   4. project-config-template/knowledge-routing-config.md   (shipped default)
#   5. Built-in defaults below
#
# Two fields are NOT read from the config by default. `backlog_path` and `plans_dir`
# default to `auto`, which delegates to scripts/project-detect.js — that script already
# owns the doc/ vs docs/ question and the project_paths block, and re-deriving it here
# would be a second answer to a settled question. `none` is a real value for both: a
# project that tracks deferred work outside the repo should say so rather than have a
# skill invent docs/BACKLOG.md.
#
# knowledge_gitignored is MEASURED (`git check-ignore`), never assumed. It decides whether
# a knowledge write needs the `git add -f` promotion (routing doc §4) or the ordinary
# commit path; assuming the autopilot answer is wrong in both directions.
#
# Output: JSON {memory_dir, knowledge_dir, knowledge_gitignored, discipline_target,
#               backlog_path, plans_dir, source, target}
#   source ∈ {override, project-cwd, project-repo, template, built-in-default}
#   backlog_path / plans_dir are a path, or "none" when the project declares it absent.
#
# Exit codes:
#   0  success (JSON or --field value on stdout)
#   2  usage / bad argument

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DEF_MEMORY='~/.claude/projects/<slug>/memory/'
DEF_KNOWLEDGE='.claude/knowledge/'
DEF_DISCIPLINE='CLAUDE.md'
DEF_BACKLOG='auto'
DEF_PLANS='auto'

FIELD=""
TARGET="$PWD"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --field) FIELD="${2:-}"; shift 2 ;;
    --target) TARGET="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,45p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ ! -d "$TARGET" ]]; then
  echo "--target is not a directory: $TARGET" >&2
  exit 2
fi
TARGET="$(cd "$TARGET" && pwd)"

# shellcheck source=lib/json-emit.sh
. "$SCRIPT_DIR/lib/json-emit.sh"
# shellcheck source=lib/resolve-config.sh
. "$SCRIPT_DIR/lib/resolve-config.sh"

# The ladder is spelled out here rather than sourced from resolve_config_ladder, for one
# reason: that helper's tier 3 is `$REPO_ROOT/.claude/<basename>` where REPO_ROOT is the
# PLUGIN's root — and the installed plugin ships its own `.claude/`. For a policy that is
# about the CONSUMING project's layout, inheriting autopilot's dogfood config is not a
# fallback, it is the exact defect this script exists to remove: a foreign project would
# be told its discipline sink is `references/`, a directory it does not have. So tier 3
# applies only when the target IS this repo. `read_field` is shared unchanged.
CONFIG=""
SOURCE="built-in-default"
_override="${KNOWLEDGE_ROUTING_CONFIG_OVERRIDE-}"
if [[ -n "$_override" && -r "$_override" ]]; then
  CONFIG="$_override"; SOURCE="override"
elif [[ -r "$TARGET/.claude/knowledge-routing-config.md" ]]; then
  CONFIG="$TARGET/.claude/knowledge-routing-config.md"; SOURCE="project-cwd"
elif [[ "$TARGET" == "$REPO_ROOT" && -r "$REPO_ROOT/.claude/knowledge-routing-config.md" ]]; then
  CONFIG="$REPO_ROOT/.claude/knowledge-routing-config.md"; SOURCE="project-repo"
elif [[ -r "$REPO_ROOT/project-config-template/knowledge-routing-config.md" ]]; then
  CONFIG="$REPO_ROOT/project-config-template/knowledge-routing-config.md"; SOURCE="template"
fi

MEMORY_DIR="$(read_field "$CONFIG" memory_dir "$DEF_MEMORY")"
KNOWLEDGE_DIR="$(read_field "$CONFIG" knowledge_dir "$DEF_KNOWLEDGE")"
DISCIPLINE="$(read_field "$CONFIG" discipline_target "$DEF_DISCIPLINE")"
BACKLOG="$(read_field "$CONFIG" backlog_path "$DEF_BACKLOG")"
PLANS="$(read_field "$CONFIG" plans_dir "$DEF_PLANS")"

# --- `auto` delegates to project-detect.js, which already owns project_paths ---
if [[ "$BACKLOG" == "auto" || "$PLANS" == "auto" ]]; then
  DETECTED="$(node "$SCRIPT_DIR/project-detect.js" --target "$TARGET" 2>/dev/null)" || DETECTED=""
  if [[ -n "$DETECTED" ]]; then
    [[ "$BACKLOG" == "auto" ]] && BACKLOG="$(printf '%s' "$DETECTED" \
      | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);process.stdout.write((j.project_paths&&j.project_paths.backlog)||"")}catch(e){}})')"
    [[ "$PLANS" == "auto" ]] && PLANS="$(printf '%s' "$DETECTED" \
      | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);process.stdout.write((j.project_paths&&j.project_paths.plans_dir)||"")}catch(e){}})')"
  fi
  # Detection failed or returned nothing: say `none` rather than name a path that may not
  # exist. An invented path is the failure this script exists to prevent.
  [[ "$BACKLOG" == "auto" || -z "$BACKLOG" ]] && BACKLOG="none"
  [[ "$PLANS" == "auto" || -z "$PLANS" ]] && PLANS="none"
fi

# --- knowledge_gitignored is measured, never assumed ---
KNOWLEDGE_IGNORED="unknown"
if git -C "$TARGET" rev-parse --git-dir >/dev/null 2>&1; then
  # --no-index is required, not cosmetic: without it `check-ignore` reports a path as
  # NOT ignored once anything under it is tracked — and a force-added knowledge file is
  # exactly that. The measurement would then deny the very promotion that created it.
  if git -C "$TARGET" check-ignore --no-index -q "$KNOWLEDGE_DIR" 2>/dev/null; then
    KNOWLEDGE_IGNORED="true"
  else
    KNOWLEDGE_IGNORED="false"
  fi
fi

if [[ -n "$FIELD" ]]; then
  case "$FIELD" in
    memory_dir) printf '%s\n' "$MEMORY_DIR" ;;
    knowledge_dir) printf '%s\n' "$KNOWLEDGE_DIR" ;;
    knowledge_gitignored) printf '%s\n' "$KNOWLEDGE_IGNORED" ;;
    discipline_target) printf '%s\n' "$DISCIPLINE" ;;
    backlog_path) printf '%s\n' "$BACKLOG" ;;
    plans_dir) printf '%s\n' "$PLANS" ;;
    source) printf '%s\n' "$SOURCE" ;;
    target) printf '%s\n' "$TARGET" ;;
    *) echo "unknown field: $FIELD" >&2; exit 2 ;;
  esac
  exit 0
fi

printf '{ "memory_dir": "%s", "knowledge_dir": "%s", "knowledge_gitignored": %s, "discipline_target": "%s", "backlog_path": "%s", "plans_dir": "%s", "source": "%s", "target": "%s" }\n' \
  "$(json_escape "$MEMORY_DIR")" "$(json_escape "$KNOWLEDGE_DIR")" \
  "$([[ "$KNOWLEDGE_IGNORED" == "unknown" ]] && printf '"unknown"' || printf '%s' "$KNOWLEDGE_IGNORED")" \
  "$(json_escape "$DISCIPLINE")" "$(json_escape "$BACKLOG")" "$(json_escape "$PLANS")" \
  "$SOURCE" "$(json_escape "$TARGET")"
