#!/usr/bin/env bash
# dispatch-hetero --sandbox bwrap: the worker may write only its worktree and its own scratch dir.
#   green  : a worker that writes inside the worktree commits.
#   red    : a worker that writes into the main checkout (the parent of its worktree's repo)
#            - sandbox OFF: the file lands and the fingerprint rejects the round (proves the
#              parent really is writable, so the next case is not an empty test)
#            - sandbox ON : the write fails (EROFS), the file does not exist, the result JSON
#              records the denied write, the fingerprint is untouched (status committed).
#   nested : a worktree under <repo>/.claude/worktrees with the sandbox on is refused.
#   gitfile: a worker that repoints $WT/.git at a clone whose config sets core.fsmonitor must not get
#            that command run by the rail outside the sandbox.
#            - sandbox ON : the gitfile is read-only, the rewrite fails, the command never runs.
#            - sandbox OFF: the rewrite lands, the rail's own check refuses to run git (boundary_rejected,
#              worktree_gitfile_tampered), the command never runs.
#   nested : a worker that builds a nested git repo inside the worktree (its config names filter.x.clean and
#            core.fsmonitor commands) must not get them run by the rail's add -A / status.
#            Both sandbox ON and OFF: boundary_rejected, worktree_nested_repo, the command never runs.
#            Positive control: the same tree under a plain unguarded `git status` does run it.
#   hooksPath: a relative core.hooksPath resolves inside the writable worktree; the rail's git runs with
#            core.hooksPath=/dev/null, so a worker-planted post-commit never runs (control: plain git does).
#   reuse  : --reuse-worktree takes its expected gitfile from the main repo's registry; a retained worktree whose
#            gitfile was repointed is refused before any git runs (control: an untouched one is reused).
#   gitlink: a gitlink added outside the output paths is not hidden from the rail's BASE..HEAD diff (every boundary diff carries --ignore-submodules=none, so
#            a .gitmodules `ignore = all` cannot hide it; status keeps =dirty; files_changed counts a committed or staged gitlink).
#   no bwrap / bwrap cannot start: fail closed (precondition_failed, no worker, no worktree).
# Seam: a stub `claude` on PATH, no real model, no GPU. Own temp dirs.
. "$(dirname "$0")/lib.sh"
eq() { assert_eq "$2" "$1" "$3"; }  # eq <expected> <actual> <msg>

export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude-config"; mkdir -p "$CLAUDE_CONFIG_DIR"
export AUTOPILOT_LIVE_DIR="$(mktemp -d -p /dev/shm autopilot-test-dhsbx-XXXXXX)"
trap 'rm -rf "$AUTOPILOT_LIVE_DIR"; cleanup_test_tmp' EXIT
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export ENGINE_CAPABILITY_DIR="$TEST_TMP/engine-capability"; mkdir -p "$ENGINE_CAPABILITY_DIR"
export DISPATCH_QUIET=1
export TMPDIR="$TEST_TMP/tmp"; mkdir -p "$TMPDIR"
export AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs"; mkdir -p "$AUTOPILOT_DISPATCH_RUNS_DIR"
export ANTHROPIC_BASE_URL="http://127.0.0.1:9/v1" ANTHROPIC_AUTH_TOKEN="t"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID \
  AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH \
  CLAUDE_CODE_SESSION_ID AUTOPILOT_SESSION_ID AUTOPILOT_PARENT_SESSION_ID 2>/dev/null || true

if ! command -v bwrap >/dev/null 2>&1 || ! bwrap --ro-bind / / --dev /dev --proc /proc true >/dev/null 2>&1; then
  echo "SKIP: bwrap is not usable on this host; the sandbox cases cannot run"
  finalize_test
  exit 0
fi

GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
SBX="$TEST_TMP/repo"; mkdir -p "$SBX"; $GIT -C "$SBX" init -q; $GIT -C "$SBX" commit -q --allow-empty -m base
WTPARENT="$TEST_TMP/wts"; mkdir -p "$WTPARENT"        # outside every repo
PROMPT="$TEST_TMP/prompt.txt"; echo "say ok" > "$PROMPT"
PARENT_TARGET="$SBX/parent-write.txt"                 # a file in the main checkout

BINDIR="$TEST_TMP/bin"; mkdir -p "$BINDIR"
# stub claude: one edit inside the worktree (cwd), and, when asked, an attempt to write into
# the main checkout. The stub reports the attempt on stderr like a shell would (it lands in the
# worker log, where the rail looks for EROFS lines).
cat > "$BINDIR/claude" <<'EOS'
#!/usr/bin/env bash
cat >/dev/null
echo edited >> sandbox-edit.txt
if [ -n "${STUB_PARENT_TARGET:-}" ]; then
  echo leaked > "$STUB_PARENT_TARGET"
fi
if [ -n "${STUB_GITFILE_ATTACK:-}" ]; then
  # repoint the worktree gitfile at a copy of the main git dir inside the worktree whose config names a command (core.fsmonitor)
  common="$(git rev-parse --git-common-dir)"
  { cp -r "$common" evil \
    && git -C evil config core.bare false \
    && git -C evil config core.fsmonitor "$STUB_PWN_HOOK" \
    && printf 'gitdir: %s/evil\n' "$PWD" > .git; } || echo "gitfile attack failed: $?" >&2
fi
if [ -n "${STUB_NESTED_ATTACK:-}" ]; then
  # a nested repo with a committed file; config naming commands is set AFTER the worker's own git calls
  # (so the worker never runs them itself), then the tracked file is modified
  mkdir nested && { cd nested && git init -q && echo x > f.txt && echo '* filter=x' > .gitattributes \
    && git add -A && git -c user.email=t@t -c user.name=t -c commit.gpgsign=false commit -q -m n \
    && git config filter.x.clean "$STUB_PWN_HOOK" && git config core.fsmonitor "$STUB_PWN_HOOK" \
    && echo y >> f.txt && cd ..; } || echo "nested attack failed: $?" >&2
fi
if [ -n "${STUB_GITLINK_ADD:-}" ]; then
  # a gitlink (mode 160000) outside any output path; STUB_GITLINK_ADD=commit also commits it from inside the worker
  mkdir -p forbidden/gl; git add sandbox-edit.txt   # an empty directory, like an uninitialised submodule
  git update-index --add --cacheinfo "160000,$(git rev-parse HEAD),forbidden/gl"
  [ "$STUB_GITLINK_ADD" != commit ] || git -c user.email=t@t -c user.name=t -c commit.gpgsign=false commit -q -m gl
fi
if [ -n "${STUB_HOOKSPATH_ATTACK:-}" ]; then
  mkdir -p hk && printf '#!/bin/sh\necho pwned > "%s"\n' "$STUB_PWN_FILE" > hk/post-commit && chmod +x hk/post-commit
fi
if [ -n "${STUB_TRANSCRIPT_EROFS:-}" ]; then
  # a claude-style session transcript in the throwaway config dir: the raw tool error, never repeated on stderr or in the result text
  mkdir -p "$CLAUDE_CONFIG_DIR/projects/p"
  printf '%s\n' "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"tool_result\",\"tool_use_id\":\"t1\",\"is_error\":true,\"content\":\"EROFS: read-only file system, open '$STUB_TRANSCRIPT_EROFS'\"}]}}" \
    "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"tool_result\",\"tool_use_id\":\"t2\",\"content\":\"fine\"}]}}" > "$CLAUDE_CONFIG_DIR/projects/p/s.jsonl"
fi
if [ -n "${STUB_TRANSCRIPT_SYMLINK:-}" ]; then
  # a worker-planted symlink named like a transcript, pointing at a file outside the projects dir (another run's transcript)
  mkdir -p "$CLAUDE_CONFIG_DIR/projects/p"
  ln -s "$STUB_TRANSCRIPT_SYMLINK" "$CLAUDE_CONFIG_DIR/projects/p/evil.jsonl"
fi
printf '%s' '{"type":"result","is_error":false,"result":"ok"}'
EOS
chmod +x "$BINDIR/claude"

# run_case <sandbox: off|bwrap|none> <write-parent: 1|0> [extra args...] -> OUT (stdout JSON) + RC
run_case() {
  local sandbox="$1" write_parent="$2"; shift 2
  local branch="feat/sbx-$RANDOM$RANDOM" sbx_args=() tgt=""
  [ "$sandbox" = none ] || sbx_args=(--sandbox "$sandbox")
  [ "$write_parent" = 1 ] && tgt="$PARENT_TARGET"
  rm -f "$PARENT_TARGET"
  RC=0
  OUT="$(cd "${RUN_REPO:-$SBX}" && timeout 90 env -u REPO_ROOT -u CONSUMING_REPO_ROOT \
      STUB_PARENT_TARGET="$tgt" PATH="$BINDIR:$PATH" \
      "$REPO_ROOT/scripts/dispatch-hetero.sh" --runner cc-shim --model MiniMax-M3 \
      --prompt-file "$PROMPT" --context-window off --branch "$branch" \
      ${sbx_args[@]+"${sbx_args[@]}"} "$@" 2>"$TEST_TMP/stderr")" || RC=$?
}
result_json() {
  node -e '
const s = require("fs").readFileSync(0, "utf8");
let best = "";
for (const line of s.split("\n")) {
  const t = line.trim();
  if (!t.startsWith("{")) continue;
  try { const o = JSON.parse(t); if (o && typeof o === "object" && !Array.isArray(o) && "status" in o) best = t; } catch {}
}
if (best === "") process.exit(3);
process.stdout.write(best);
'
}
# jfield <dotted.path>: stdin result JSON -> value (JSON-encoded), or <absent>
jfield() {
  node -e '
const o = JSON.parse(require("fs").readFileSync(0, "utf8"));
let v = o;
for (const k of process.argv[1].split(".")) { v = v === null || v === undefined ? undefined : v[k]; }
process.stdout.write(v === undefined ? "<absent>" : JSON.stringify(v));
' "$1"
}
status_of() { printf '%s' "$OUT" | result_json | jfield status; }

# ---- green: worker writes inside the worktree only; sandbox on -> committed
run_case bwrap 0 --worktree-parent "$WTPARENT"
eq '"committed"' "$(status_of)" "green: in-worktree write under the sandbox commits (rc=$RC, stderr: $(tail -c 300 "$TEST_TMP/stderr" 2>/dev/null))"
eq '"bwrap"' "$(printf '%s' "$OUT" | result_json | jfield sandbox.mode)" "green: result JSON carries sandbox.mode"
eq '"unknown"' "$(printf '%s' "$OUT" | result_json | jfield sandbox.denied_writes)" "green: no denied write seen is reported unknown, not 0"
eq '0' "$(printf '%s' "$OUT" | result_json | jfield sandbox_blocked_writes)" "green: a worker that writes only inside the worktree has sandbox_blocked_writes 0"
eq '[]' "$(printf '%s' "$OUT" | result_json | jfield sandbox_blocked_samples)" "green: no blocked-write sample paths"
WT_G="$(printf '%s' "$OUT" | result_json | jfield sandbox.writable.0 | tr -d '"')"
eq "$WTPARENT" "$(dirname "$WT_G")" "green: sandbox.writable[0] is the worktree, created under --worktree-parent (got: $WT_G)"

# ---- negative control: sandbox OFF, the same worker writes the main checkout -> the write lands and the fingerprint rejects the round
run_case off 1 --worktree-parent "$WTPARENT"
eq "yes" "$([ -e "$PARENT_TARGET" ] && echo yes || echo no)" "control(off): the unsandboxed worker really wrote the parent file"
eq '"boundary_rejected"' "$(status_of)" "control(off): the fingerprint rejects the round as boundary_rejected (rc=$RC)"
case "$(printf '%s' "$OUT" | result_json | jfield error)" in
  *main_checkout_mutated*|*main*checkout*) eq 0 0 "control(off): the error names the main checkout mutation" ;;
  *) fail "control(off): error does not name the main checkout mutation: $(printf '%s' "$OUT" | result_json | jfield error)" ;;
esac
rm -f "$PARENT_TARGET"

# ---- red: sandbox ON, the same worker -> the write fails before it lands
run_case bwrap 1 --worktree-parent "$WTPARENT"
eq "no" "$([ -e "$PARENT_TARGET" ] && echo yes || echo no)" "red(on): the parent file does NOT exist"
eq '"committed"' "$(status_of)" "red(on): the fingerprint is untouched, the in-worktree edit commits (rc=$RC)"
DEN="$(printf '%s' "$OUT" | result_json | jfield sandbox.denied_writes)"
case "$DEN" in
  ''|'"unknown"'|'<absent>') fail "red(on): the result JSON must record the denied write, got denied_writes=$DEN" ;;
  *) eq 0 0 "red(on): result JSON records the denied write (denied_writes=$DEN)" ;;
esac
BLK="$(printf '%s' "$OUT" | result_json | jfield sandbox_blocked_writes)"
case "$BLK" in
  ''|0|'<absent>') fail "red(on): sandbox_blocked_writes must be >= 1, got $BLK" ;;
  *) eq 0 0 "red(on): sandbox_blocked_writes=$BLK (>= 1), exit code unchanged (rc=$RC, status committed)" ;;
esac
case "$(printf '%s' "$OUT" | result_json | jfield sandbox_blocked_samples)" in
  *"$PARENT_TARGET"*) eq 0 0 "red(on): the sample path names the refused file" ;;
  *) fail "red(on): samples do not name $PARENT_TARGET: $(printf '%s' "$OUT" | result_json | jfield sandbox_blocked_samples)" ;;
esac
LEDGER_ROW="$(cat "$AUTOPILOT_LIVE_DIR"/dispatch-usage-*.jsonl 2>/dev/null | grep '"sandbox_blocked_writes":[1-9]' | head -1)"
if [ -n "$LEDGER_ROW" ]; then eq 0 0 "red(on): the dispatch usage ledger row carries sandbox_blocked_writes"; else fail "red(on): no usage ledger row with sandbox_blocked_writes >= 1 under $AUTOPILOT_LIVE_DIR"; fi
MF="$(grep -l '"sandbox"' "$AUTOPILOT_DISPATCH_RUNS_DIR"/*.manifest.json 2>/dev/null | head -1)"
if [ -n "$MF" ] && grep -q '"mode":"bwrap"' "$MF"; then eq 0 0 "red(on): the run manifest carries the sandbox object"; else fail "red(on): no manifest with a sandbox object under $AUTOPILOT_DISPATCH_RUNS_DIR"; fi
WLIST="$(printf '%s' "$OUT" | result_json | jfield sandbox.writable)"
case "$WLIST" in
  \[\"/*\",\"/*\"\]) eq 0 0 "red(on): writable lists exactly two non-empty absolute paths ($WLIST)" ;;
  *) fail "red(on): writable is not the two-entry list: $WLIST" ;;
esac
eq "0" "$(/bin/ls -A "$TMPDIR" | grep -c 'dispatch-hetero-sandbox-')" "red(on): the per-dispatch scratch dir is removed after the run"

# ---- transcript signal: the refused write appears only as a tool_result in the worker's session transcript
export STUB_TRANSCRIPT_EROFS="/srv/never-writable/x.txt"
run_case bwrap 0 --worktree-parent "$WTPARENT"
eq '1' "$(printf '%s' "$OUT" | result_json | jfield sandbox_blocked_writes)" "transcript: one EROFS tool_result counts as one blocked write (rc=$RC)"
eq '["/srv/never-writable/x.txt"]' "$(printf '%s' "$OUT" | result_json | jfield sandbox_blocked_samples)" "transcript: the sample is the path, nothing else"
eq '"committed"' "$(status_of)" "transcript: the count does not change the status"
unset STUB_TRANSCRIPT_EROFS

# ---- transcript symlink: a planted evil.jsonl symlink to another run's transcript is neither counted nor sampled
OTHER_RUN="$TEST_TMP/other-run-transcript.jsonl"
printf '%s\n' "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"tool_result\",\"tool_use_id\":\"t9\",\"is_error\":true,\"content\":\"EROFS: read-only file system, open '/srv/other-run/secret.txt'\"}]}}" > "$OTHER_RUN"
export STUB_TRANSCRIPT_SYMLINK="$OTHER_RUN"
run_case bwrap 0 --worktree-parent "$WTPARENT"
eq '0' "$(printf '%s' "$OUT" | result_json | jfield sandbox_blocked_writes)" "transcript-symlink: a symlinked transcript is not counted (rc=$RC)"
eq '[]' "$(printf '%s' "$OUT" | result_json | jfield sandbox_blocked_samples)" "transcript-symlink: its path is not sampled"
unset STUB_TRANSCRIPT_SYMLINK

# ---- nested worktree + sandbox -> refused (the default placement is <repo>/.claude/worktrees)
run_case bwrap 0
eq '"precondition_failed"' "$(status_of)" "nested: sandbox with the default (in-repo) worktree is refused (rc=$RC)"
case "$(printf '%s' "$OUT" | result_json | jfield error)" in
  *"sits inside the working tree"*) eq 0 0 "nested: the error explains the rule" ;;
  *) fail "nested: error text: $(printf '%s' "$OUT" | result_json | jfield error)" ;;
esac
eq "0" "$({ /bin/ls -A "$SBX/.claude/worktrees" 2>/dev/null || true; } | wc -l | tr -d ' ')" "nested: no worktree was created"
# the same default placement without the sandbox still works (the rule is sandbox-only)
run_case none 0
eq '"committed"' "$(status_of)" "nested control: without the sandbox the in-repo worktree still commits (rc=$RC)"

# ---- gitfile attack: repoint $WT/.git at a clone with core.fsmonitor = <command that writes outside the worktree and scratch>
PWN_FILE="$TEST_TMP/pwned-by-fsmonitor.txt"
PWN_HOOK="$TEST_TMP/pwn-hook.sh"
printf '#!/bin/sh\necho pwned > "%s"\n' "$PWN_FILE" > "$PWN_HOOK"; chmod +x "$PWN_HOOK"
export STUB_GITFILE_ATTACK=1 STUB_PWN_HOOK="$PWN_HOOK"
rm -f "$PWN_FILE"
run_case bwrap 0 --worktree-parent "$WTPARENT"
eq "no" "$([ -e "$PWN_FILE" ] && echo yes || echo no)" "gitfile(on): the hostile core.fsmonitor command never ran (file written outside: $([ -e "$PWN_FILE" ] && echo YES || echo no))"
eq '"committed"' "$(status_of)" "gitfile(on): the gitfile stayed intact so the round commits normally (rc=$RC)"
DEN="$(printf '%s' "$OUT" | result_json | jfield sandbox.denied_writes)"
case "$DEN" in
  ''|'"unknown"'|'<absent>') fail "gitfile(on): the result JSON must record the denied gitfile rewrite, got denied_writes=$DEN" ;;
  *) eq 0 0 "gitfile(on): result JSON records the denied rewrite (denied_writes=$DEN)" ;;
esac
rm -f "$PWN_FILE"
run_case off 0 --worktree-parent "$WTPARENT"
eq "no" "$([ -e "$PWN_FILE" ] && echo yes || echo no)" "gitfile(off): the rail ran no git against the repointed worktree (file written outside: $([ -e "$PWN_FILE" ] && echo YES || echo no))"
eq '"boundary_rejected"' "$(status_of)" "gitfile(off): the round is not committed, status boundary_rejected (rc=$RC)"
case "$(printf '%s' "$OUT" | result_json | jfield error)" in
  *worktree_gitfile_tampered*) eq 0 0 "gitfile(off): the result JSON error names worktree_gitfile_tampered" ;;
  *) fail "gitfile(off): error text: $(printf '%s' "$OUT" | result_json | jfield error)" ;;
esac
unset STUB_GITFILE_ATTACK STUB_PWN_HOOK

# ---- gitfile positive control: with no guard, a plain `git -C <dir> status` DOES run the hostile core.fsmonitor
CTL="$TEST_TMP/ctl-repo"; cp -r "$SBX" "$CTL"
rm -f "$PWN_FILE"
git -C "$CTL" config core.fsmonitor "$PWN_HOOK"
git -C "$CTL" status --porcelain >/dev/null 2>&1 || true
eq "yes" "$([ -e "$PWN_FILE" ] && echo yes || echo no)" "gitfile control: an unguarded git status runs the hostile core.fsmonitor (so the cases above are not vacuous)"
rm -f "$PWN_FILE"

# ---- nested repo attack: the worker builds a nested repo inside the worktree; its config names commands
export STUB_NESTED_ATTACK=1 STUB_PWN_HOOK="$PWN_HOOK"
for sbxmode in bwrap off; do
  rm -f "$PWN_FILE"
  run_case "$sbxmode" 0 --worktree-parent "$WTPARENT"
  eq "no" "$([ -e "$PWN_FILE" ] && echo yes || echo no)" "nested($sbxmode): the nested repo's filter/fsmonitor command never ran (file written outside: $([ -e "$PWN_FILE" ] && echo YES || echo no))"
  eq '"boundary_rejected"' "$(status_of)" "nested($sbxmode): the round is not committed, status boundary_rejected (rc=$RC)"
  case "$(printf '%s' "$OUT" | result_json | jfield error)" in
    *worktree_nested_repo*) eq 0 0 "nested($sbxmode): the result JSON error names worktree_nested_repo" ;;
    *) fail "nested($sbxmode): error text: $(printf '%s' "$OUT" | result_json | jfield error)" ;;
  esac
done
unset STUB_NESTED_ATTACK
# positive control: the same nested tree under plain git (add -A, then status) does run the nested config
NCTL="$TEST_TMP/nested-ctl"; mkdir -p "$NCTL"; $GIT -C "$NCTL" init -q; $GIT -C "$NCTL" commit -q --allow-empty -m b
mkdir "$NCTL/nested"
( cd "$NCTL/nested" && $GIT init -q && echo x > f.txt && echo '* filter=x' > .gitattributes && $GIT add -A && $GIT commit -q -m n \
  && git config filter.x.clean "$PWN_HOOK" && git config core.fsmonitor "$PWN_HOOK" && echo y >> f.txt )
rm -f "$PWN_FILE"
git -C "$NCTL" add -A >/dev/null 2>&1 || true
git -C "$NCTL" status --porcelain >/dev/null 2>&1 || true
eq "yes" "$([ -e "$PWN_FILE" ] && echo yes || echo no)" "nested control: unguarded add -A + status really runs the nested repo's command"
rm -f "$PWN_FILE"

# ---- hooksPath: a relative core.hooksPath resolves inside the worktree; a worker-planted post-commit must not run
export STUB_HOOKSPATH_ATTACK=1 STUB_PWN_FILE="$PWN_FILE"
git -C "$SBX" config core.hooksPath hk
run_case bwrap 0 --worktree-parent "$WTPARENT"
eq "no" "$([ -e "$PWN_FILE" ] && echo yes || echo no)" "hooksPath(on): the worker-planted post-commit never ran (file written outside: $([ -e "$PWN_FILE" ] && echo YES || echo no))"
eq '"committed"' "$(status_of)" "hooksPath(on): the wrapper commit still lands (rc=$RC)"
# positive control: plain git commit with the same relative core.hooksPath does run it
HCTL="$TEST_TMP/hooks-ctl"; mkdir -p "$HCTL/hk"; $GIT -C "$HCTL" init -q; git -C "$HCTL" config core.hooksPath hk
printf '#!/bin/sh\necho pwned > "%s"\n' "$PWN_FILE" > "$HCTL/hk/post-commit"; chmod +x "$HCTL/hk/post-commit"
rm -f "$PWN_FILE"
echo a > "$HCTL/a"; git -C "$HCTL" add a; $GIT -C "$HCTL" commit -q -m a >/dev/null 2>&1 || true
eq "yes" "$([ -e "$PWN_FILE" ] && echo yes || echo no)" "hooksPath control: a plain commit really runs a post-commit found through a relative core.hooksPath"
git -C "$SBX" config --unset core.hooksPath
unset STUB_HOOKSPATH_ATTACK STUB_PWN_FILE STUB_PWN_HOOK
rm -f "$PWN_FILE"

# ---- --reuse-worktree: the expected gitfile comes from the main repo's registry, not from the retained tree
instance_of() {
  node - "$1" <<'NODE'
const crypto = require('crypto'); const fs = require('fs'); const path = require('path');
const worktree = path.resolve(process.argv[2]);
const stat = fs.statSync(worktree, { bigint: true });
process.stdout.write(crypto.createHash('sha256').update(JSON.stringify({
  birthtime_ns: stat.birthtimeNs.toString(), device: stat.dev.toString(), inode: stat.ino.toString(), schema: 1, worktree,
})).digest('hex'));
NODE
}
RB="feat/sbx-reuse-$RANDOM"; export AUTOPILOT_WORKTREE_ROOT_RUN_ID="sbx-reuse-root"
RETAIN="$(( $(date +%s) + 3600 ))"
run_case none 0 --branch "$RB" --worktree-parent "$WTPARENT" --keep-worktree --retain-owner sbx-reuse-root --retain-reason reuse-test --retain-until "$RETAIN"
eq '"committed"' "$(status_of)" "reuse: the first round commits and retains the worktree (rc=$RC, stderr: $(tail -c 300 "$TEST_TMP/stderr"))"
RWT="$(printf '%s' "$OUT" | result_json | jfield worktree | tr -d '"')"
RCOMMIT="$(printf '%s' "$OUT" | result_json | jfield commit | tr -d '"')"
reuse_run() {
  run_case none 0 --branch "$RB" --base "$(git -C "$RWT" rev-parse HEAD 2>/dev/null || echo "$RCOMMIT")" --keep-worktree --reuse-worktree "$RWT" \
    --expected-worktree-instance "$(instance_of "$RWT")" --retain-owner sbx-reuse-root --retain-reason reuse-test --retain-until "$RETAIN"
}
# control: an untouched retained worktree is reused (the registry-derived gitfile matches)
reuse_run
eq '"committed"' "$(status_of)" "reuse control: an untouched retained worktree is reused and commits (rc=$RC, stderr: $(tail -c 300 "$TEST_TMP/stderr"))"
RCOMMIT="$(printf '%s' "$OUT" | result_json | jfield commit | tr -d '"')"
# attack: the retained gitfile now points at a copy of the main git dir whose config names a command
rm -f "$PWN_FILE"
EVIL="$TEST_TMP/evil-reuse"; cp -r "$SBX/.git" "$EVIL"
git -C "$EVIL" config core.bare false; git -C "$EVIL" config core.fsmonitor "$PWN_HOOK"
git -C "$EVIL" symbolic-ref HEAD "refs/heads/$RB"
cp "$RWT/.git" "$TEST_TMP/gitfile.orig"; printf 'gitdir: %s\n' "$EVIL" > "$RWT/.git"
reuse_run
eq "no" "$([ -e "$PWN_FILE" ] && echo yes || echo no)" "reuse(tampered): the hostile core.fsmonitor never ran (file written outside: $([ -e "$PWN_FILE" ] && echo YES || echo no))"
eq '"precondition_failed"' "$(status_of)" "reuse(tampered): the reuse is refused (rc=$RC)"
case "$(printf '%s' "$OUT" | result_json | jfield error)" in
  *worktree_gitfile_tampered*) eq 0 0 "reuse(tampered): the error names worktree_gitfile_tampered" ;;
  *) fail "reuse(tampered): error text: $(printf '%s' "$OUT" | result_json | jfield error)" ;;
esac
cp "$TEST_TMP/gitfile.orig" "$RWT/.git"
unset AUTOPILOT_WORKTREE_ROOT_RUN_ID
rm -f "$PWN_FILE"

# ---- gitlink: a mode-160000 entry added at a path outside the output paths must show in the BASE..HEAD diff the
# rail reads (changed_paths / SHORTSTAT). `--ignore-submodules=all` hides it, so no rail diff may carry that flag.
GL="$TEST_TMP/gitlink-ctl"; mkdir -p "$GL"; $GIT -C "$GL" init -q; $GIT -C "$GL" commit -q --allow-empty -m b
GL_BASE="$(git -C "$GL" rev-parse HEAD)"
git -C "$GL" update-index --add --cacheinfo "160000,$GL_BASE,forbidden/gl"; $GIT -C "$GL" commit -q -m gl
eq "forbidden/gl" "$(git -C "$GL" diff --name-only "$GL_BASE..HEAD")" "gitlink control: a plain tree-to-tree diff lists the gitlink path"
eq "" "$(git -C "$GL" diff --ignore-submodules=all --name-only "$GL_BASE..HEAD")" "gitlink control: --ignore-submodules=all really hides it (so the scan below is not vacuous)"
eq "forbidden/gl" "$(git -C "$GL" diff --ignore-submodules=dirty --name-only "$GL_BASE..HEAD")" "gitlink control: dirty keeps a committed gitlink visible"
# behavioural: the rail's own diff/status see a gitlink the worker added (committed by the worker, or only staged)
for glmode in commit stage; do
  export STUB_GITLINK_ADD="$glmode"
  run_case none 0 --worktree-parent "$WTPARENT"
  eq '"boundary_rejected"' "$(status_of)" "gitlink($glmode): the content gate rejects the gitlink (rc=$RC)"
  case "$(printf '%s' "$OUT" | result_json | jfield error)" in
    *forbidden/gl*) eq 0 0 "gitlink($glmode): the error names forbidden/gl" ;;
    *) fail "gitlink($glmode): error text: $(printf '%s' "$OUT" | result_json | jfield error)" ;;
  esac
  eq "2" "$(printf '%s' "$OUT" | result_json | jfield files_changed)" "gitlink($glmode): the rail's own diff counts the gitlink (sandbox-edit.txt + forbidden/gl)"
done
unset STUB_GITLINK_ADD
# g4: `submodule.<name>.ignore` in .gitmodules (the worktree copy is worker-writable) and in config is honoured by a
# diff that carries no --ignore-submodules flag. With ignore=all on the path, a committed or staged gitlink change is
# invisible to a plain diff; `--ignore-submodules=none` shows it. The control proves the scan below is not vacuous.
GM="$TEST_TMP/gitmodules-ctl"; mkdir -p "$GM"; $GIT -C "$GM" init -q
printf '[submodule "gl"]\n\tpath = forbidden/gl\n\turl = ./nowhere\n\tignore = all\n' > "$GM/.gitmodules"
$GIT -C "$GM" add .gitmodules; $GIT -C "$GM" commit -q -m base
GM_BASE="$(git -C "$GM" rev-parse HEAD)"
git -C "$GM" update-index --add --cacheinfo "160000,$GM_BASE,forbidden/gl"
eq "" "$(git -C "$GM" diff --cached --name-only)" "g4 control: .gitmodules ignore=all hides a staged gitlink from a plain diff --cached"
eq "forbidden/gl" "$(git -C "$GM" diff --cached --ignore-submodules=none --name-only)" "g4 control: --ignore-submodules=none shows the staged gitlink"
eq "forbidden/gl" "$(git -C "$GM" status --porcelain --ignore-submodules=dirty | awk '{print $2}')" "g4 control: status --ignore-submodules=dirty (the rail's DIRTY / reuse form) still lists the staged gitlink under ignore=all"
$GIT -C "$GM" commit -q -m gl
eq "" "$(git -C "$GM" diff --name-only "$GM_BASE..HEAD")" "g4 control: .gitmodules ignore=all hides a committed gitlink from a plain BASE..HEAD diff"
eq "forbidden/gl" "$(git -C "$GM" diff --ignore-submodules=none --name-only "$GM_BASE..HEAD")" "g4 control: --ignore-submodules=none shows the committed gitlink"
# static: every boundary diff the rail makes (its own, and the staged/range diffs of check-disjointness.sh) carries =none
for f in dispatch-hetero.sh check-disjointness.sh; do
  nodiff="$(grep -E '(git|_wt_git)\b.*\bdiff\b' "$REPO_ROOT/scripts/$f" | grep -vE '^\s*#' | grep -v -e '--ignore-submodules=none' | grep -c 'name-only\|shortstat\|--cached' || true)"
  eq "0" "$nodiff" "g4 static: every name-only/shortstat/--cached diff in scripts/$f carries --ignore-submodules=none"
  eq "0" "$(grep -c -e '--ignore-submodules=all' "$REPO_ROOT/scripts/$f" || true)" "g4 static: scripts/$f has no --ignore-submodules=all"
done
eq "2" "$(grep -c -e '_wt_git diff --ignore-submodules=none' "$REPO_ROOT/scripts/dispatch-hetero.sh" || true)" "g4 static: dispatch-hetero.sh makes exactly two diffs (shortstat, name-only), both with =none"
eq "4" "$(grep -c -e 'diff --cached --ignore-submodules=none\|diff --ignore-submodules=none --name-only' "$REPO_ROOT/scripts/check-disjointness.sh" || true)" "g4 static: check-disjointness.sh makes four diffs (staged, range, parent, empty-tree), all with =none"
eq "0" "$(grep -E "'diff-tree'" "$REPO_ROOT/scripts/check-hands-commit.js" | grep -vc -e '--ignore-submodules=none' || true)" "g4 static: check-hands-commit.js's diff-tree carries --ignore-submodules=none (diff-tree honours ignore=all too)"
eq "0" "$(grep -E 'status .*--ignore-submodules' "$REPO_ROOT/scripts/dispatch-hetero.sh" | grep -vc -e '--ignore-submodules=dirty' || true)" "g4 static: every rail status carries --ignore-submodules=dirty"
# behavioural: .gitmodules (committed in the base) says ignore=all for forbidden/gl; the worker adds the gitlink
GMR="$TEST_TMP/gm-repo"; mkdir -p "$GMR"; $GIT -C "$GMR" init -q
printf '[submodule "gl"]\n\tpath = forbidden/gl\n\turl = ./nowhere\n\tignore = all\n' > "$GMR/.gitmodules"
$GIT -C "$GMR" add .gitmodules; $GIT -C "$GMR" commit -q -m base
export RUN_REPO="$GMR"
for glmode in commit stage; do
  export STUB_GITLINK_ADD="$glmode"
  run_case none 0 --worktree-parent "$WTPARENT"
  eq '"boundary_rejected"' "$(status_of)" "g4 ignore=all($glmode): the content gate still rejects the gitlink (rc=$RC)"
  case "$(printf '%s' "$OUT" | result_json | jfield error)" in
    *forbidden/gl*) eq 0 0 "g4 ignore=all($glmode): the error names forbidden/gl" ;;
    *) fail "g4 ignore=all($glmode): error text: $(printf '%s' "$OUT" | result_json | jfield error)" ;;
  esac
  eq "2" "$(printf '%s' "$OUT" | result_json | jfield files_changed)" "g4 ignore=all($glmode): files_changed counts the gitlink (sandbox-edit.txt + forbidden/gl)"
done
unset STUB_GITLINK_ADD RUN_REPO

# ---- bwrap unavailable -> fail closed
NOBW="$TEST_TMP/nobwrap-bin"; mkdir -p "$NOBW"
# every executable on PATH except bwrap (a hand-picked tool list missed things the rail needs)
IFS=: read -ra _pdirs <<< "$PATH"
for d in "${_pdirs[@]}"; do
  [ -d "$d" ] || continue
  for f in "$d"/*; do
    b="$(basename "$f")"
    [ "$b" = bwrap ] && continue
    [ -x "$f" ] && [ ! -d "$f" ] && [ ! -e "$NOBW/$b" ] && ln -s "$f" "$NOBW/$b"
  done
done
RC=0
OUT="$(cd "$SBX" && PATH="$NOBW:$BINDIR" env -u REPO_ROOT -u CONSUMING_REPO_ROOT \
    "$REPO_ROOT/scripts/dispatch-hetero.sh" --runner cc-shim --model MiniMax-M3 --prompt-file "$PROMPT" \
    --context-window off --branch "feat/sbx-nobwrap" --sandbox bwrap --worktree-parent "$WTPARENT" 2>"$TEST_TMP/stderr")" || RC=$?
eq '"precondition_failed"' "$(status_of)" "no-bwrap: fails closed with precondition_failed (rc=$RC, stderr: $(tail -c 200 "$TEST_TMP/stderr"))"
case "$(printf '%s' "$OUT" | result_json | jfield error)" in
  *"bwrap is not on PATH"*) eq 0 0 "no-bwrap: the error says bwrap is missing and nothing downgraded" ;;
  *) fail "no-bwrap: error text: $(printf '%s' "$OUT" | result_json | jfield error)" ;;
esac
eq "null" "$(printf '%s' "$OUT" | result_json | jfield worktree)" "no-bwrap: no worktree was opened"
eq "0" "$({ git -C "$SBX" branch --list 'feat/sbx-nobwrap' 2>/dev/null || true; } | wc -l | tr -d ' ')" "no-bwrap: no branch was created"

# ---- bwrap present but cannot start (a stub that always fails) -> fail closed
BADBW="$TEST_TMP/badbwrap-bin"; mkdir -p "$BADBW"
printf '#!/bin/sh\necho "bwrap: No permissions to create new namespace" >&2\nexit 1\n' > "$BADBW/bwrap"; chmod +x "$BADBW/bwrap"
RC=0
OUT="$(cd "$SBX" && STUB_PARENT_TARGET="" PATH="$BADBW:$BINDIR:$PATH" env -u REPO_ROOT -u CONSUMING_REPO_ROOT \
    "$REPO_ROOT/scripts/dispatch-hetero.sh" --runner cc-shim --model MiniMax-M3 --prompt-file "$PROMPT" \
    --context-window off --branch "feat/sbx-badbwrap" --sandbox bwrap --worktree-parent "$WTPARENT" 2>"$TEST_TMP/stderr")" || RC=$?
eq '"precondition_failed"' "$(status_of)" "bad-bwrap: a bwrap that cannot start fails closed (rc=$RC)"
case "$(printf '%s' "$OUT" | result_json | jfield error)" in
  *"cannot start"*) eq 0 0 "bad-bwrap: the error says bwrap cannot start" ;;
  *) fail "bad-bwrap: error text: $(printf '%s' "$OUT" | result_json | jfield error)" ;;
esac

# ---- other runners and bad values are refused, never ignored
RC=0
OUT="$(cd "$SBX" && PATH="$BINDIR:$PATH" env -u REPO_ROOT -u CONSUMING_REPO_ROOT \
    "$REPO_ROOT/scripts/dispatch-hetero.sh" --runner codex --model gpt-x --prompt-file "$PROMPT" \
    --context-window off --branch "feat/sbx-codex" --sandbox bwrap 2>"$TEST_TMP/stderr")" || RC=$?
eq '"precondition_failed"' "$(status_of)" "runner: --sandbox bwrap with a non-cc-shim runner is refused (rc=$RC)"

# ---- brief with a ../ path: warn-only (stderr line, exit code and status unchanged)
BASE_PROMPT="$PROMPT"
RC=0; PROMPT="$TEST_TMP/prompt-dotdot.txt"; printf 'edit the file ../x/y please\n' > "$PROMPT"
run_case bwrap 0 --worktree-parent "$WTPARENT"; RC_WARN=$RC
eq '"committed"' "$(status_of)" "dotdot-warn: the dispatch still runs and commits (rc=$RC_WARN)"
eq 0 "$RC_WARN" "dotdot-warn: exit code unchanged"
case "$(cat "$TEST_TMP/stderr")" in
  *"dispatch-hetero: warn: brief has a ../ path outside the worktree: ../x/y"*) eq 0 0 "dotdot-warn: the warn line names the first token" ;;
  *) fail "dotdot-warn: stderr was: $(head -c 300 "$TEST_TMP/stderr")" ;;
esac
# absolute paths and a mid-path a/../b are not a ../ at a word start: no warn
PROMPT="$TEST_TMP/prompt-nodotdot.txt"; printf 'edit /abs/x/y and a/../b and https://h/p/../q\n' > "$PROMPT"
run_case bwrap 0 --worktree-parent "$WTPARENT"
eq '"committed"' "$(status_of)" "dotdot-quiet: the dispatch commits"
case "$(cat "$TEST_TMP/stderr")" in
  *"brief has a ../ path"*) fail "dotdot-quiet: unexpected warn: $(head -c 300 "$TEST_TMP/stderr")" ;;
  *) eq 0 0 "dotdot-quiet: no warn for absolute or mid-path ../" ;;
esac
PROMPT="$BASE_PROMPT"

finalize_test
