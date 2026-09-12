#!/usr/bin/env bash
# resolve-knowledge-routing.test.sh — the sinks must resolve to the CONSUMING project's
# layout, never to autopilot's.
#
# The defect under test is not hypothetical: ladder tier 3 reads
# $REPO_ROOT/.claude/<basename>, and REPO_ROOT is the PLUGIN's root. autopilot ships its
# own .claude/knowledge-routing-config.md (discipline_target: references/), so a naive
# resolve from a foreign cwd would hand that project a directory it does not have.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RESOLVER="$REPO_ROOT/scripts/resolve-knowledge-routing.sh"

PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); printf 'ok — %s\n' "$1"; }
no() { FAIL=$((FAIL+1)); printf 'FAIL — %s\n     want: %s\n     got:  %s\n' "$1" "$2" "$3"; }
eq() { [ "$2" = "$3" ] && ok "$1" || no "$1" "$2" "$3"; }

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

# --- a consuming project: a real git repo, no autopilot layout at all ---
FOREIGN="$TMP/foreign"
mkdir -p "$FOREIGN/doc"
git -C "$FOREIGN" init -q 2>/dev/null || { mkdir -p "$FOREIGN"; git -C "$FOREIGN" init -q; }
printf '# foreign\n' > "$FOREIGN/README.md"

R="$(cd "$FOREIGN" && bash "$RESOLVER" --target "$FOREIGN")"
field() { cd "$FOREIGN" && bash "$RESOLVER" --target "$FOREIGN" --field "$1"; }

# 1. THE case: a foreign project must not be handed autopilot's reference directory.
eq "foreign project: discipline_target is CLAUDE.md, not references/" \
   "CLAUDE.md" "$(field discipline_target)"
eq "foreign project: resolves from the shipped template, not autopilot's own .claude/" \
   "template" "$(field source)"
case "$R" in
  *references/*) no "foreign project: no autopilot path leaks into the JSON" "no 'references/'" "$R" ;;
  *) ok "foreign project: no autopilot path leaks into the JSON" ;;
esac

# 2. A project with no docs/ and no plans must be told `none`, not given an invented path.
B="$(field backlog_path)"
case "$B" in
  none|doc/*|docs/*) ok "foreign project: backlog_path is none or a real project-detect answer ($B)" ;;
  *) no "foreign project: backlog_path is none or project-detect's answer" "none|doc*/…" "$B" ;;
esac

# 3. knowledge_gitignored is MEASURED. A repo that does not ignore .claude/knowledge/
#    must report false, or the skill would demand a `git add -f` that is wrong there.
eq "foreign project: knowledge_gitignored measured false when nothing ignores it" \
   "false" "$(field knowledge_gitignored)"

printf '.claude/knowledge/\n' > "$FOREIGN/.gitignore"
eq "foreign project: adding the ignore rule flips the measurement to true" \
   "true" "$(cd "$FOREIGN" && bash "$RESOLVER" --target "$FOREIGN" --field knowledge_gitignored)"

# 3b. --no-index regression: a TRACKED file under an ignored dir must not mask the rule.
#     Without --no-index git reports NOT ignored here, which would deny the promotion
#     that created the file in the first place.
mkdir -p "$FOREIGN/.claude/knowledge"
printf 'x\n' > "$FOREIGN/.claude/knowledge/a.md"
git -C "$FOREIGN" add -f .claude/knowledge/a.md >/dev/null 2>&1
eq "ignored dir with a force-added tracked file still reports gitignored true" \
   "true" "$(cd "$FOREIGN" && bash "$RESOLVER" --target "$FOREIGN" --field knowledge_gitignored)"

# 4. The project's own config wins over the template.
cat > "$FOREIGN/.claude/knowledge-routing-config.md" <<'CFG'
- discipline_target: docs/conventions/
- backlog_path: none
CFG
eq "project config overrides the template default" \
   "docs/conventions/" "$(cd "$FOREIGN" && bash "$RESOLVER" --target "$FOREIGN" --field discipline_target)"
eq "project config source is project-cwd" \
   "project-cwd" "$(cd "$FOREIGN" && bash "$RESOLVER" --target "$FOREIGN" --field source)"
eq "backlog_path: none is honoured, not replaced by a detected path" \
   "none" "$(cd "$FOREIGN" && bash "$RESOLVER" --target "$FOREIGN" --field backlog_path)"

# 5. autopilot itself still gets references/ — the dogfood config must keep working.
eq "autopilot's own repo: discipline_target is references/" \
   "references/" "$(cd "$REPO_ROOT" && bash "$RESOLVER" --target "$REPO_ROOT" --field discipline_target)"
eq "autopilot's own repo: knowledge dir is gitignored (force-added files do not mask it)" \
   "true" "$(cd "$REPO_ROOT" && bash "$RESOLVER" --target "$REPO_ROOT" --field knowledge_gitignored)"

# 6. Emitted JSON parses.
node -e 'JSON.parse(process.argv[1])' "$(cd "$REPO_ROOT" && bash "$RESOLVER")" \
  && ok "emitted JSON parses" || no "emitted JSON parses" "valid JSON" "unparseable"

# 7. Bad args are a usage error, not a silent default.
(cd "$REPO_ROOT" && bash "$RESOLVER" --field nope >/dev/null 2>&1); eq "unknown --field exits 2" "2" "$?"
(cd "$REPO_ROOT" && bash "$RESOLVER" --target /nonexistent-xyz >/dev/null 2>&1); eq "missing --target dir exits 2" "2" "$?"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
