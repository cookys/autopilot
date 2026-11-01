#!/usr/bin/env bash
# resolve-project-paths.test.sh — the project-document locations must come from the
# TARGET project, and a location that does not exist must come back `none`.
#
# Context: scaffold-config.js has generated a `## Project Paths` block since onboarding
# existed, and nothing read it (measured 2026-09-12). These assertions pin the
# consumption path so the block cannot go write-only again.

set -uo pipefail
. "$(dirname "$0")/lib.sh"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
R="$REPO_ROOT/scripts/resolve-project-paths.sh"

PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); printf 'ok — %s\n' "$1"; }
no() { FAIL=$((FAIL+1)); printf 'FAIL — %s\n     want: %s\n     got:  %s\n' "$1" "$2" "$3"; }
eq() { [ "$2" = "$3" ] && ok "$1" || no "$1" "$2" "$3"; }
ne() { [ "$2" != "$3" ] && ok "$1" || no "$1" "anything but $2" "$3"; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"; cleanup_test_tmp' EXIT
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

# 8. backlog_config is the target's .claude/backlog-config.md or none.
eq "bare repo: backlog_config is none" "none" "$(bash "$R" --target "$BARE" --field backlog_config)"
mkdir -p "$P/.claude"
printf '# x\n' > "$P/.claude/backlog-config.md"
eq "declared backlog_config when the file exists" ".claude/backlog-config.md" "$(f backlog_config)"
rm -f "$P/.claude/backlog-config.md"
eq "absent backlog_config is none" "none" "$(f backlog_config)"

# 8b. *_exists: a resolved path that is not on disk must say so (fleet repo 2026-11-01:
#     detected backlog=docs/BACKLOG.md, file never created, finish-flow silently had nowhere to write).
cat > "$P/.claude/project-lifecycle-config.md" <<'CFG'
## Project Paths
- Backlog: `doc/DEBT.md`
CFG
eq "backlog_exists false when the resolved file is absent" "false" "$(f backlog_exists)"
mkdir -p "$P/doc"; printf '# debt\n' > "$P/doc/DEBT.md"
eq "backlog_exists true when the resolved file exists" "true" "$(f backlog_exists)"
eq "backlog value itself is unchanged by the exists check" "doc/DEBT.md" "$(f backlog)"
printf '## Project Paths\n- Backlog: `none`\n' > "$P/.claude/project-lifecycle-config.md"
eq "backlog: none stays none" "none" "$(f backlog)"
eq "backlog: none is never existing" "false" "$(f backlog_exists)"
eq "exists is a JSON boolean in the envelope" "boolean" "$(node -e 'console.log(typeof JSON.parse(process.argv[1]).backlog_exists)' "$(bash "$R" --target "$P")")"
eq "plans_dir_exists tracks the directory" "$([ -d "$P/$(f plans_dir)" ] && echo true || echo false)" "$(f plans_dir_exists)"
eq "bare repo: every *_exists is false" "false" "$(bash "$R" --target "$BARE" --field backlog_exists)"
rm -f "$P/.claude/project-lifecycle-config.md"

# 8c. finish-flow's Deferred-items row must treat backlog_exists=false like `none` (report, do not write).
FF="$REPO_ROOT/skills/finish-flow/SKILL.md"
if grep -F 'backlog: none`, or `backlog_exists` false' "$FF" >/dev/null && grep -F -- '--field backlog_exists' "$FF" >/dev/null
then ok "finish-flow Deferred items: backlog_exists=false triggers the no-backlog report"
else no "finish-flow Deferred items: backlog_exists=false triggers the no-backlog report" "SKILL.md names backlog_exists" "absent"; fi

# 8d. The layout registry answers before detection (relayout: stage bootstrap -> docs/, stage P1 ->
#     project/), but ONLY for a target in the same git repo as this script (equal git-common-dir):
#     a consumer's repo-layout.js is never executed, whatever its header says.
mk_wt() {  # mk_wt <dir> <docs|project> — a worktree of THIS repo; P1 rewrites its registry paths
  git -C "$REPO_ROOT" worktree add -q --detach "$1" HEAD >/dev/null 2>&1 || return 1
  if [ "$2" = project ]; then
    sed -i -E "s#'docs/(plans|plans/_archive|projects|projects/INDEX.md|projects/_archive|BACKLOG.md)'#'project/\\1'#" "$1/scripts/lib/repo-layout.js"
  fi
}
RB="$TMP/reg-boot"; mk_wt "$RB" docs
RP="$TMP/reg-p1";   mk_wt "$RP" project
RW="$TMP/reg-symlink"; mk_wt "$RW" docs
trap 'git -C "$REPO_ROOT" worktree remove --force "$RB" 2>/dev/null; git -C "$REPO_ROOT" worktree remove --force "$RP" 2>/dev/null; git -C "$REPO_ROOT" worktree remove --force "$RW" 2>/dev/null; git -C "$REPO_ROOT" worktree prune; rm -rf "$TMP"; cleanup_test_tmp' EXIT
eq "bootstrap registry: backlog -> docs/" "docs/BACKLOG.md" "$(bash "$R" --target "$RB" --field backlog)"
eq "bootstrap registry: index -> docs/"   "docs/projects/INDEX.md" "$(bash "$R" --target "$RB" --field index)"
eq "bootstrap registry: source is registry" "registry" "$(bash "$R" --target "$RB" --field source)"
eq "P1 registry (worktree of this repo): backlog -> project/" "project/BACKLOG.md" "$(bash "$R" --target "$RP" --field backlog)"
eq "P1 registry: index -> project/"       "project/projects/INDEX.md" "$(bash "$R" --target "$RP" --field index)"
eq "P1 registry: plans_dir -> project/"   "project/plans/" "$(bash "$R" --target "$RP" --field plans_dir)"
eq "P1 registry: projects_dir -> project/" "project/projects/" "$(bash "$R" --target "$RP" --field projects_dir)"
eq "P1 registry: archive_dir -> project/" "project/projects/_archive/" "$(bash "$R" --target "$RP" --field archive_dir)"
eq "P1 registry: source is registry"      "registry" "$(bash "$R" --target "$RP" --field source)"
# a config block still outranks the registry
mkdir -p "$RP/.claude"; printf '## Project Paths\n- Backlog: `doc/DEBT.md`\n' > "$RP/.claude/project-lifecycle-config.md"
eq "config block outranks the registry" "doc/DEBT.md" "$(bash "$R" --target "$RP" --field backlog)"
# NEGATIVE CONTROL: another git repo carrying a repo-layout.js with the real header, which writes a
# marker file the moment it runs. It must neither run nor answer.
FR="$TMP/reg-foreign"; mkdir -p "$FR/scripts/lib"; git -C "$FR" init -q
MARK="$TMP/foreign-ran.marker"
{ sed -n '1,12p' "$REPO_ROOT/scripts/lib/repo-layout.js"
  printf ' */\nrequire("fs").writeFileSync(%s, "ran");\nconsole.log("project/EVIL.md");\n' "\"$MARK\""; } > "$FR/scripts/lib/repo-layout.js"
eq "foreign repo with the registry header: not answered by registry" "none" "$(bash "$R" --target "$FR" --field backlog)"
eq "foreign repo: source is not registry" "none" "$(bash "$R" --target "$FR" --field source)"
[ ! -e "$MARK" ] && ok "foreign repo-layout.js was never executed (no marker)" || no "foreign repo-layout.js was never executed" "no marker" "marker written"
# Bypass controls: each foreign file would write $MARK if executed; each case must stay out of the registry.
rm -f "$MARK"
GD="$(git -C "$REPO_ROOT" rev-parse --absolute-git-dir)"; GC="$(cd "$GD" && cd "$(git rev-parse --git-common-dir)" && pwd -P)"
# (1) GIT_DIR pointing at this repo, foreign target
ne "bypass 1: GIT_DIR=<this repo> + foreign target: not registry" "registry" "$(GIT_DIR="$GD" bash "$R" --target "$FR" --field source)"
[ ! -e "$MARK" ] && ok "bypass 1: foreign file not executed" || no "bypass 1: foreign file not executed" "no marker" "marker written"
rm -f "$MARK"
# (2) GIT_COMMON_DIR + GIT_WORK_TREE
ne "bypass 2: GIT_COMMON_DIR+GIT_WORK_TREE: not registry" "registry" "$(GIT_COMMON_DIR="$GC" GIT_WORK_TREE="$FR" bash "$R" --target "$FR" --field source)"
[ ! -e "$MARK" ] && ok "bypass 2: foreign file not executed" || no "bypass 2: foreign file not executed" "no marker" "marker written"
rm -f "$MARK"
# (3) a worktree of this repo whose scripts/lib/repo-layout.js is a symlink to a foreign file
rm -f "$RW/scripts/lib/repo-layout.js"; ln -s "$FR/scripts/lib/repo-layout.js" "$RW/scripts/lib/repo-layout.js"
ne "bypass 3: symlinked repo-layout.js in our worktree: not registry" "registry" "$(bash "$R" --target "$RW" --field source)"
[ ! -e "$MARK" ] && ok "bypass 3: foreign file not executed" || no "bypass 3: foreign file not executed" "no marker" "marker written"
rm -f "$MARK"
# (4) a foreign dir whose .git is a gitfile pointing at this repo's git dir
GF="$TMP/reg-gitfile"; mkdir -p "$GF/scripts/lib"; cp "$FR/scripts/lib/repo-layout.js" "$GF/scripts/lib/"
printf 'gitdir: %s\n' "$GD" > "$GF/.git"
ne "bypass 4: foreign gitfile -> this repo: not registry" "registry" "$(bash "$R" --target "$GF" --field source)"
[ ! -e "$MARK" ] && ok "bypass 4: foreign file not executed" || no "bypass 4: foreign file not executed" "no marker" "marker written"
rm -f "$MARK"
# a non-git directory is skipped too
NG="$TMP/reg-nogit"; mkdir -p "$NG/scripts/lib"; cp "$FR/scripts/lib/repo-layout.js" "$NG/scripts/lib/"
eq "non-git target with the header: skipped" "none" "$(bash "$R" --target "$NG" --field backlog)"
[ ! -e "$MARK" ] && ok "non-git repo-layout.js was never executed" || no "non-git repo-layout.js never executed" "no marker" "marker written"
# a consumer repo without a registry keeps the pre-registry behaviour
eq "no registry: bare repo still none" "none" "$(bash "$R" --target "$BARE" --field backlog)"
eq "no registry: source is not registry" "none" "$(bash "$R" --target "$BARE" --field source)"

# 8e. A consumer whose config writes a directory WITHOUT the trailing slash: the exact glob dev-flow
#     step 5 tells the model to run (extracted from SKILL.md, not retyped) must still list the plan files.
NS="$TMP/noslash"; mkdir -p "$NS/.claude" "$NS/doc/rfc"; git -C "$NS" init -q
printf '## Project Paths\n- Plans directory: `doc/rfc`\n' > "$NS/.claude/project-lifecycle-config.md"
: > "$NS/doc/rfc/2026-01-01-a.md"; ln -s "$REPO_ROOT/scripts" "$NS/scripts"
eq "fixture: plans_dir really has no trailing slash" "doc/rfc" "$(bash "$R" --target "$NS" --field plans_dir)"
DF_CMD="$(grep -m1 -o 'Draft plan overlap: `[^`]*`' "$REPO_ROOT/skills/dev-flow/SKILL.md" | sed -E 's/^[^`]*`//; s/`$//')"
[ -n "$DF_CMD" ] && ok "extracted dev-flow draft-plan glob: $DF_CMD" || no "extracted dev-flow draft-plan glob" "a command" "empty"
DF_OUT="$(cd "$NS" && bash -c "$DF_CMD" 2>&1)"; DF_RC=$?
eq "dev-flow draft-plan glob exits 0 on a slash-less plans_dir" "0" "$DF_RC"
eq "dev-flow draft-plan glob lists the plan file" "doc/rfc/2026-01-01-a.md" "$DF_OUT"

# 8f. The same command with a resolver that fails / prints nothing must fail loudly, never fall through to
#     the filesystem root (d empty -> "/"*.md).
EM="$TMP/emptyres"; mkdir -p "$EM/scripts"; printf '#!/usr/bin/env bash\nexit 1\n' > "$EM/scripts/resolve-project-paths.sh"
DE_OUT="$(cd "$EM" && bash -c "$DF_CMD" 2>&1)"; DE_RC=$?
[ "$DE_RC" -ne 0 ] && ok "dev-flow draft-plan glob fails when the resolver yields nothing (rc=$DE_RC)" || no "dev-flow draft-plan glob fails on empty resolver" "rc != 0" "rc=0"
case "$DE_OUT" in *"parameter null or not set"*) ok "empty resolver: explicit unset-parameter error";; *) no "empty resolver: explicit unset-parameter error" "parameter null or not set" "$DE_OUT";; esac
case "$DE_OUT" in */\*.md*) no "empty resolver: nothing is listed from the filesystem root" "no /*.md" "$DE_OUT";; *) ok "empty resolver: nothing is listed from the filesystem root";; esac

# 7. Envelope.
node -e 'JSON.parse(process.argv[1])' "$(bash "$R" --target "$REPO_ROOT")" \
  && ok "emitted JSON parses" || no "emitted JSON parses" "valid JSON" "unparseable"
(bash "$R" --field nope >/dev/null 2>&1); eq "unknown --field exits 2" "2" "$?"
(timeout 5 bash "$R" --field >/dev/null 2>&1); eq "--field with no operand exits 2, does not spin" "2" "$?"
(timeout 5 bash "$R" --target >/dev/null 2>&1); eq "--target with no operand exits 2, does not spin" "2" "$?"
(bash "$R" --target /nonexistent-xyz >/dev/null 2>&1); eq "missing --target exits 2" "2" "$?"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
