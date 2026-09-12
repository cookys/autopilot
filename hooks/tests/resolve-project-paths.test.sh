#!/usr/bin/env bash
# resolve-project-paths.test.sh — the project-document locations must come from the
# TARGET project, and a location that does not exist must come back `none`.
#
# Context: scaffold-config.js has generated a `## Project Paths` block since onboarding
# existed, and nothing read it (measured 2026-09-12). These assertions pin the
# consumption path so the block cannot go write-only again.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
R="$REPO_ROOT/scripts/resolve-project-paths.sh"

PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); printf 'ok — %s\n' "$1"; }
no() { FAIL=$((FAIL+1)); printf 'FAIL — %s\n     want: %s\n     got:  %s\n' "$1" "$2" "$3"; }
eq() { [ "$2" = "$3" ] && ok "$1" || no "$1" "$2" "$3"; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
P="$TMP/proj"; mkdir -p "$P"; git -C "$P" init -q
f() { bash "$R" --target "$P" --field "$1"; }

# 1. A project with the scaffolded block: the block is what answers, not detection.
mkdir -p "$P/.claude"
cat > "$P/.claude/project-lifecycle-config.md" <<'CFG'
# Project Lifecycle
## Project Paths
- Projects directory: `doc/proj/`
- Plans directory: `doc/rfc/`
- Archive: `doc/proj/done/`
- Backlog: `doc/DEBT.md`
- Index: `doc/proj/INDEX.md`
CFG
eq "scaffolded block answers projects_dir" "doc/proj/" "$(f projects_dir)"
eq "scaffolded block answers plans_dir"    "doc/rfc/"  "$(f plans_dir)"
eq "scaffolded block answers archive_dir"  "doc/proj/done/" "$(f archive_dir)"
eq "scaffolded block answers backlog"      "doc/DEBT.md" "$(f backlog)"
eq "scaffolded block answers index"        "doc/proj/INDEX.md" "$(f index)"
eq "source names the config that answered" "project-lifecycle-config" "$(f source)"

# 2. Backticks are stripped — scaffold-config.js writes the value inside them, and a
#    path carrying a literal backtick is a path that will never be found.
case "$(f backlog)" in *'`'*) no "backticks stripped" "no backtick" "$(f backlog)" ;; *) ok "backticks stripped" ;; esac

# 3. Per-field fallback: a config that answers SOME fields must not suppress detection
#    for the rest. A half-filled config is the common shape. The layout is a SENTINEL the
#    detector can find (a docs/ tree), so the fallback value is exact, not "none or a path".
mkdir -p "$P/docs/projects" "$P/docs/plans"
WANT_PROJECTS="$(node "$REPO_ROOT/scripts/project-detect.js" --target "$P" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(JSON.parse(d).project_paths.projects_dir))')"
[ -n "$WANT_PROJECTS" ] || { echo "fixture error: detector found no docs tree"; exit 1; }
cat > "$P/.claude/project-lifecycle-config.md" <<'CFG'
## Project Paths
- Backlog: `doc/DEBT.md`
CFG
eq "partial config: the declared field wins" "doc/DEBT.md" "$(f backlog)"
eq "partial config: undeclared field is the DETECTED value, exactly" "$WANT_PROJECTS" "$(f projects_dir)"
eq "partial config: source is the config, since it answered first" "project-lifecycle-config" "$(f source)"

# 3b. Explicit `none` in config beats an available detected path — the whole point of
#     `none` being a real answer. Same sentinel layout, so detection WOULD answer.
cat > "$P/.claude/project-lifecycle-config.md" <<'CFG'
## Project Paths
- Projects directory: `none`
CFG
eq "explicit none is honoured even though detection would answer $WANT_PROJECTS" "none" "$(f projects_dir)"

# 3c. Decoy outside the block: an identically labelled bullet in another section must
#     not redirect a write. next-config's `## Scan Sources` carries `- Backlog:` for real.
cat > "$P/.claude/project-lifecycle-config.md" <<'CFG'
## Scan Sources
- Backlog: `WRONG/decoy.md`
## Project Paths
- Backlog: `doc/DEBT.md`
## Other
- Backlog: `WRONG/other.md`
CFG
eq "label outside ## Project Paths is ignored" "doc/DEBT.md" "$(f backlog)"

# 3d. Near-match headings are not the block. `## Legacy Project Paths` appears FIRST so a
#     substring match would take it.
cat > "$P/.claude/project-lifecycle-config.md" <<'CFG'
## Legacy Project Paths
- Backlog: `WRONG/legacy.md`
## Not Project Paths
- Backlog: `WRONG/not.md`
## Project Paths
- Backlog: `doc/DEBT.md`
CFG
eq "near-match heading (Legacy/Not …) does not answer" "doc/DEBT.md" "$(f backlog)"
rm -rf "$P/docs"

# 4. THE portability case: no config at all, and no doc tree — every field is `none`,
#    and nothing invents docs/ because a reference doc once named it.
rm -rf "$P/.claude"
BARE="$TMP/bare"; mkdir -p "$BARE"; git -C "$BARE" init -q
for k in projects_dir plans_dir archive_dir backlog index; do
  eq "bare repo: $k is exactly none" "none" "$(bash "$R" --target "$BARE" --field "$k")"
done
eq "bare repo: source is none — a detector that answered nothing is not a source" \
   "none" "$(bash "$R" --target "$BARE" --field source)"

# 5. autopilot's own repo still resolves its real layout.
eq "autopilot: backlog" "docs/BACKLOG.md" "$(bash "$R" --target "$REPO_ROOT" --field backlog)"
eq "autopilot: archive" "docs/projects/_archive/" "$(bash "$R" --target "$REPO_ROOT" --field archive_dir)"

# 6. No leak across repos: resolving a foreign target must not return this plugin's
#    own .claude/, which the installed plugin does ship.
#    Leaked values would be RELATIVE (docs/BACKLOG.md), so a substring search for the plugin
#    root proves nothing. Assert the field values: a bare foreign repo must not resolve to
#    autopilot's real layout, which we know exactly.
AP_BACKLOG="$(bash "$R" --target "$REPO_ROOT" --field backlog)"
[ "$AP_BACKLOG" = "docs/BACKLOG.md" ] || { echo "fixture error: autopilot layout changed"; exit 1; }
eq "foreign target: does not inherit autopilot's backlog ($AP_BACKLOG)" "none" "$(bash "$R" --target "$BARE" --field backlog)"
eq "foreign target: does not inherit autopilot's projects_dir" "none" "$(bash "$R" --target "$BARE" --field projects_dir)"

# 7. Envelope.
node -e 'JSON.parse(process.argv[1])' "$(bash "$R" --target "$REPO_ROOT")" \
  && ok "emitted JSON parses" || no "emitted JSON parses" "valid JSON" "unparseable"
(bash "$R" --field nope >/dev/null 2>&1); eq "unknown --field exits 2" "2" "$?"
(timeout 5 bash "$R" --field >/dev/null 2>&1); eq "--field with no operand exits 2, does not spin" "2" "$?"
(timeout 5 bash "$R" --target >/dev/null 2>&1); eq "--target with no operand exits 2, does not spin" "2" "$?"
(bash "$R" --target /nonexistent-xyz >/dev/null 2>&1); eq "missing --target exits 2" "2" "$?"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
