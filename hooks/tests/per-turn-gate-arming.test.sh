#!/usr/bin/env bash
# Test for the worker-bound arming of hooks/per-turn-gate.js (BL-0306 P2, plan
# docs/plans/2026-10-26-depth0-per-turn-gate.md section 5 P2 and section 3.1): T-N1..T-N5, T-G1..T-G3 of the
# P2 work order. hooks/tests/per-turn-gate.test.sh stays untouched; this file adds the gate-file cases.
# Every check is a function over a hook path: it must hold for the real hook and fail for a deliberately
# broken copy (negative control, evidence-discipline section 58). Fixtures use a real git repo, the real
# scripts/gate-verify.js and the real scripts/per-turn-gate-arm.js (no stub verifier on the armed path).
. "$(dirname "$0")/lib.sh"

REAL_HOOK="$HOOKS_DIR/per-turn-gate.js"
ARM="$REPO_ROOT/scripts/per-turn-gate-arm.js"
GV="$REPO_ROOT/scripts/gate-verify.js"
STUB="$TEST_TMP/verifier.js"
cat >"$STUB" <<'JS'
'use strict';
// Global (config) verifier stand-in: counts calls, mode from PTG_V_MODE.
require('fs').appendFileSync(process.env.PTG_V_CALLS, `${process.argv.slice(2).join(' ')}\n`);
if ((process.env.PTG_V_MODE || 'clean') === 'violate') {
  console.log(JSON.stringify({ violations: [{ constraint: 9, rule: 'global rule', evidence: 'global seen' }], feature_gaps: [] }));
  process.exit(1);
}
console.log(JSON.stringify({ violations: [], feature_gaps: [] }));
JS

# mutant <name> <sed-expr>: as in per-turn-gate.test.sh, plus the gate-verify path made absolute.
mutant() {
  local out="$TEST_TMP/mut-$1.js" cur="$TEST_TMP/mut-$1.cur" nxt="$TEST_TMP/mut-$1.nxt" cmd
  local abs="s#require('\./_shared#require('$HOOKS_DIR/_shared#; s#require('\.\./#require('$REPO_ROOT/#; s#path.resolve(__dirname, '\.\.', 'scripts', 'gate-verify.js')#'$GV'#"
  sed -e "$abs" "$REAL_HOOK" >"$cur"
  while IFS= read -r -d '' cmd; do
    sed -e "$cmd" "$cur" >"$nxt"
    if cmp -s "$cur" "$nxt"; then echo "mutant $1: sed command matched nothing: $cmd" >&2; return 1; fi
    mv "$nxt" "$cur"
  done < <(node -e '
    const s = process.argv[1]; let i = 0; const out = [];
    const field = () => { let r = ""; while (i < s.length && s[i] !== "#") { if (s[i] === "\\") { r += s[i++]; } r += s[i++]; } i++; return r; };
    while (i < s.length) {
      while (s[i] === " " || s[i] === ";") i++;
      if (i >= s.length) break;
      if (s[i] !== "s" || s[i + 1] !== "#") { process.stderr.write("bad sed script near: " + s.slice(i, i + 30) + "\n"); process.exit(2); }
      const start = i; i += 2; field(); field();
      while (i < s.length && s[i] !== ";" && s[i] !== " ") i++;
      out.push(s.slice(start, i));
    }
    process.stdout.write(out.map((c) => c + "\0").join(""));' "$2")
  mv "$cur" "$out"
  echo "$out"
}

GIT() { git -c user.name=t -c user.email=t@t "$@"; }
RULES_JSON='{"v":1,"forbid_paths":[{"id":"fp","glob":"src/legacy/**"}],"forbid_text":[{"id":"ft","glob":"src/**","text":"ZZZ-FORBIDDEN"}],"features":[{"id":"f1","check":"js-syntax"}]}'

# fresh <label> [config-json] : new live dir, config, git repo with a base commit; sets CASE_*.
fresh() {
  CASE_DIR="$TEST_TMP/case-$1"; rm -rf "$CASE_DIR"; mkdir -p "$CASE_DIR/repo/src/legacy"
  export AUTOPILOT_LIVE_DIR="$CASE_DIR/live"; mkdir -p "$AUTOPILOT_LIVE_DIR"; chmod 700 "$AUTOPILOT_LIVE_DIR"
  export AUTOPILOT_CONFIG_FILE="$CASE_DIR/config.json"
  export PTG_V_CALLS="$CASE_DIR/calls.txt"; : >"$PTG_V_CALLS"; export PTG_V_MODE=clean
  local cfg="${2:-}"; [ -n "$cfg" ] || cfg='{}'
  printf '%s' "$cfg" >"$AUTOPILOT_CONFIG_FILE"
  CASE_REPO="$CASE_DIR/repo"; CASE_GD="$AUTOPILOT_LIVE_DIR/per-turn-gate"
  ( cd "$CASE_REPO" && git init -q && echo ok >src/keep.js && echo ok >src/legacy/old.js && GIT add -A && GIT commit -qm base ) >/dev/null 2>&1
  CASE_BASE="$(git -C "$CASE_REPO" rev-parse HEAD)"
  printf '%s' "$RULES_JSON" >"$CASE_DIR/rules.json"
}
# arm_case [extra arm args...] : arm session s1 for the case repo.
arm_case() { node "$ARM" arm --session s1 --repo "$CASE_REPO" --rules "$CASE_DIR/rules.json" --ttl-seconds 600 "$@" >"$CASE_DIR/arm.out" 2>/dev/null; }
# stop <hook> <active> [extra-json-members-with-leading-comma] : one invocation; stdout in STOP_OUT.
stop() {
  STOP_OUT="$(printf '{"session_id":"s1","cwd":"%s","stop_hook_active":%s,"prompt_id":"p"%s}' "$CASE_REPO" "$2" "${3:-}" \
    | env HOME="$HOOK_HOME" node "$1" 2>/dev/null)"
}
sub_stop() { stop "$1" "$2" ',"hook_event_name":"SubagentStop","agent_id":"'"${3:-a1}"'"'; }
blocks() { printf '%s' "$STOP_OUT" | grep -c '"decision":"block"' || true; }
LOGF() { echo "$CASE_GD/${1:-s1}.jsonl"; }
log_count() { [ -f "$(LOGF "${1:-}")" ] && wc -l <"$(LOGF "${1:-}")" | tr -d ' ' || echo 0; }
log_has() { local f; f="$(LOGF "${2:-}")"; if [ -f "$f" ]; then grep -c -F -- "$1" "$f" || true; else echo 0; fi; }
calls() { wc -l <"$PTG_V_CALLS" | tr -d ' '; }
listing() { find "$AUTOPILOT_LIVE_DIR" -mindepth 1 | LC_ALL=C sort; }
violate() { echo x >"$CASE_REPO/src/legacy/new.js"; }

# ---- T-N1: a valid gate file blocks a worker violation while the global knob is off.
tn1() {
  fresh tn1; arm_case; violate
  stop "$1" false
  [ "$(blocks)" = 1 ] && [ "$(log_has '"decision":"block","reason":"block","counter":1,"source":"session"')" = 1 ] || return 1
  case "$STOP_OUT" in *"forbid_paths fp"*) ;; *) return 1 ;; esac
  stop "$1" true; [ "$(blocks)" = 1 ] || return 1
  stop "$1" true
  [ "$(blocks)" = 0 ] && [ "$(log_has '"decision":"allow","reason":"cap","counter":2,"source":"session"')" = 1 ] && [ "$(log_count)" = 3 ]
}
# global on + config verifier + valid file: the file wins, the config verifier is never called.
tn1_file_wins() {
  fresh tn1w '{"hooks":{"per-turn-gate":true},"per_turn_gate":{"verifier":"node '"$STUB"'"}}'; export PTG_V_MODE=violate
  arm_case; violate
  stop "$1" false
  [ "$(blocks)" = 1 ] && [ "$(calls)" = 0 ] && [ "$(log_has '"source":"session"')" = 1 ] || return 1
  case "$STOP_OUT" in *"global rule"*) return 1 ;; esac
}
# max_blocks 0 in the file: never blocks, still leaves an armed record.
tn1_zero() {
  fresh tn1z; arm_case --max-blocks 0; violate
  stop "$1" false
  [ "$(blocks)" = 0 ] && [ "$(log_has '"decision":"allow","reason":"cap","counter":0,"source":"session"')" = 1 ]
}
# mode: a feature gap alone blocks only in violations+features.
tn1_mode() {
  fresh tn1m; arm_case --mode violations; echo 'syntax error (((' >"$CASE_REPO/src/bad.js"
  stop "$1" false; [ "$(blocks)" = 0 ] && [ "$(log_has '"reason":"clean","counter":0,"source":"session"')" = 1 ] || return 1
  fresh tn1m2; arm_case --mode violations+features; echo 'syntax error (((' >"$CASE_REPO/src/bad.js"
  stop "$1" false; [ "$(blocks)" = 1 ]
}
# a record with no gate file never has a source key (global-on, no file).
tn1_nosource() {
  fresh tn1n '{"hooks":{"per-turn-gate":true},"per_turn_gate":{"verifier":"node '"$STUB"'"}}'
  stop "$1" false
  [ "$(log_count)" = 1 ] && [ "$(log_has '"source"')" = 0 ] && [ "$(calls)" = 1 ]
}

# ---- T-N2: a worker who makes gate-verify exit 2 gets a block (option B), not a free pass.
tn2_symlink() {
  fresh tn2a; arm_case; rm -rf "$CASE_REPO/src/legacy"; ln -s /tmp "$CASE_REPO/src/legacy"
  stop "$1" false; [ "$(blocks)" = 1 ] && [ "$(log_has '"decision":"block","reason":"error","counter":1,"source":"session"')" = 1 ] || return 1
  case "$STOP_OUT" in *"could not run"*) ;; *) return 1 ;; esac
  stop "$1" true; [ "$(blocks)" = 1 ] || return 1
  stop "$1" true; [ "$(blocks)" = 0 ] && [ "$(log_has '"decision":"allow","reason":"cap"')" = 1 ]
}
tn2_chmod() {
  [ "$(id -u)" != 0 ] || return 0
  fresh tn2b; arm_case; chmod 000 "$CASE_REPO/src/legacy"
  stop "$1" false; local r=$?; chmod 755 "$CASE_REPO/src/legacy"
  [ "$(blocks)" = 1 ] && [ "$(log_has '"decision":"block","reason":"error"')" = 1 ]
}
tn2_file() {
  [ "$(id -u)" != 0 ] || return 0
  fresh tn2c; arm_case; echo ok >"$CASE_REPO/src/unreadable.js"; chmod 000 "$CASE_REPO/src/unreadable.js"
  stop "$1" false; chmod 644 "$CASE_REPO/src/unreadable.js"
  [ "$(blocks)" = 1 ] && [ "$(log_has '"decision":"block","reason":"error"')" = 1 ]
}
# after the block the worker restores what it changed: the next check is clean and allows.
tn2_restore() {
  fresh tn2r; arm_case; rm -rf "$CASE_REPO/src/legacy"; ln -s /tmp "$CASE_REPO/src/legacy"
  stop "$1" false; [ "$(blocks)" = 1 ] || return 1
  rm "$CASE_REPO/src/legacy"; mkdir -p "$CASE_REPO/src/legacy"; echo ok >"$CASE_REPO/src/legacy/old.js"
  stop "$1" true
  [ "$(blocks)" = 0 ] && [ "$(log_has '"decision":"allow","reason":"clean","counter":1,"source":"session"')" = 1 ]
}
# a global (config) verifier that exits 2 stays allow/error: option B is for the armed gate only.
tn2_global_unchanged() {
  fresh tn2g '{"hooks":{"per-turn-gate":true},"per_turn_gate":{"verifier":"node -e process.exit(2) --"}}'
  stop "$1" false
  [ "$(blocks)" = 0 ] && [ "$(log_has '"decision":"allow","reason":"error"')" = 1 ]
}

# ---- T-N3: with no gate file nothing changes, and the lookup costs at most one findmnt and no git.
SHIM="$TEST_TMP/shim"; mkdir -p "$SHIM"
for tool in git findmnt; do
  real="$(command -v "$tool")"
  printf '#!/bin/sh\necho x >>"$PTG_SHIM_LOG.%s"\nexec %s "$@"\n' "$tool" "$real" >"$SHIM/$tool"; chmod +x "$SHIM/$tool"
done
shim_count() { [ -f "$PTG_SHIM_LOG.$1" ] && wc -l <"$PTG_SHIM_LOG.$1" | tr -d ' ' || echo 0; }
tn3_cost() {
  fresh tn3; export PTG_SHIM_LOG="$CASE_DIR/shim"; rm -f "$PTG_SHIM_LOG".*
  local before after; before="$(listing)"
  STOP_OUT="$(printf '{"session_id":"s1","cwd":"%s","stop_hook_active":false}' "$CASE_REPO" | env PATH="$SHIM:$PATH" HOME="$HOOK_HOME" node "$1" 2>/dev/null)"
  after="$(listing)"
  [ -z "$STOP_OUT" ] && [ "$before" = "$after" ] && [ "$(shim_count git)" = 0 ] && [ "$(shim_count findmnt)" -le 1 ] || return 1
  # the veto: session_arming false does no lookup at all
  fresh tn3v '{"per_turn_gate":{"session_arming":false}}'; export PTG_SHIM_LOG="$CASE_DIR/shim"; rm -f "$PTG_SHIM_LOG".*
  STOP_OUT="$(printf '{"session_id":"s1","cwd":"%s","stop_hook_active":false}' "$CASE_REPO" | env PATH="$SHIM:$PATH" HOME="$HOOK_HOME" node "$1" 2>/dev/null)"
  [ -z "$STOP_OUT" ] && [ "$(shim_count findmnt)" = 0 ] && [ "$(shim_count git)" = 0 ]
}
tn3_veto_ignores_file() {
  fresh tn3f '{"per_turn_gate":{"session_arming":false}}'; arm_case; violate
  local before; before="$(listing)"
  stop "$1" false
  [ -z "$STOP_OUT" ] && [ "$before" = "$(listing)" ]
}

# ---- T-N4: every invalid gate file behaves exactly like no file (global on: same record, no source;
# global off: empty output and no new live-state entry).
tamper() { # <kind> : edit the armed gate file of the current case
  local f="$CASE_GD/s1.gate.json"
  case "$1" in
    absent) rm -f "$f" ;;
    unreadable) chmod 000 "$f" ;;
    malformed) printf '{not json' >"$f" ;;
    array) printf '[1]' >"$f" ;;
    *) node -e '
      const fs = require("fs"); const [f, kind] = process.argv.slice(1); const g = JSON.parse(fs.readFileSync(f, "utf8"));
      if (kind === "expired") g.expires_at = "2020-01-01T00:00:00Z";
      if (kind === "badv") g.v = 2;
      if (kind === "unknown") g.extra = 1;
      if (kind === "repo") g.repo = "/tmp";
      if (kind === "nobase") delete g.base;
      if (kind === "norules") delete g.rules;
      if (kind === "rulesarray") g.rules = [];
      if (kind === "mode") g.mode = "everything";
      if (kind === "maxblocks") g.max_blocks = 3;
      if (kind === "notcommit") g.base = "0".repeat(40);
      if (kind === "shortbase") g.base = "abc";
      fs.writeFileSync(f, JSON.stringify(g));' "$f" "$1" ;;
  esac
}
INVALID_KINDS="absent unreadable malformed array expired badv unknown repo nobase norules rulesarray mode maxblocks notcommit shortbase"
inv() { # <kind> <hook>
  [ "$1" != unreadable ] || [ "$(id -u)" != 0 ] || return 0
  fresh "inv-$1" '{"hooks":{"per-turn-gate":true},"per_turn_gate":{"verifier":"node '"$STUB"'"}}'
  arm_case; violate; tamper "$1"
  stop "$2" false; chmod 644 "$CASE_GD/s1.gate.json" 2>/dev/null
  [ "$(blocks)" = 0 ] && [ "$(log_count)" = 1 ] && [ "$(log_has '"source"')" = 0 ] && [ "$(calls)" = 1 ] || return 1
  [ "$(cat "$(LOGF)")" = '{"session":"s1","turn":1,"prompt_id":"p","decision":"allow","reason":"clean","counter":0}' ] || return 1
  fresh "inv-off-$1"; arm_case; violate; tamper "$1"
  local before; before="$(listing)"
  stop "$2" false; chmod 644 "$CASE_GD/s1.gate.json" 2>/dev/null
  [ -z "$STOP_OUT" ] && [ "$before" = "$(listing)" ]
}
tn4_expired() { inv expired "$1"; }
tn4_unknown() { inv unknown "$1"; }
tn4_notcommit() { inv notcommit "$1"; }
tn4_rest() { local k; for k in $INVALID_KINDS; do inv "$k" "$1" || { echo "invalid-file kind failed: $k" >&2; return 1; }; done; }

# ---- T-N4b: hostile ids, env-only gate path, odd plugin path, vanished file.
tn4b_ids() {
  local id n=0
  for id in "a b" "a'b" "a;b" "a..b" "$(printf 'a%.0s' $(seq 1 129))"; do
    n=$((n + 1)); fresh "tn4b$n"; arm_case; violate
    cp "$CASE_GD/s1.gate.json" "$CASE_GD/$id.gate.json"; rm "$CASE_GD/s1.gate.json"
    STOP_OUT="$(printf '{"session_id":"%s","cwd":"%s","stop_hook_active":false}' "$id" "$CASE_REPO" | env HOME="$HOOK_HOME" node "$1" 2>/dev/null)"
    [ -z "$STOP_OUT" ] && [ ! -e "$CASE_DIR/SENT" ] || return 1
  done
}
tn4b_shell_path() { # live dir with a quote and a semicolon: the gate path must only travel in the environment
  local live="$TEST_TMP/li ve'x;touch $TEST_TMP/SENT"
  fresh tn4bs; rm -rf "$AUTOPILOT_LIVE_DIR" "$live"; export AUTOPILOT_LIVE_DIR="$live"; mkdir -p "$live"; chmod 700 "$live"; CASE_GD="$live/per-turn-gate"
  rm -f "$TEST_TMP/SENT"; arm_case; violate
  stop "$1" false
  # a real violation block (reason "block"), not a could-not-run block: the verifier really ran
  [ "$(blocks)" = 1 ] && [ "$(log_has '"decision":"block","reason":"block"')" = 1 ] && [ ! -e "$TEST_TMP/SENT" ] && [ ! -e "$CASE_REPO/SENT" ]
}
tn4b_plugin_path() { # the hook copy lives in a directory with a space and a single quote
  local pl="$TEST_TMP/pl ug'x"; rm -rf "$pl"; mkdir -p "$pl/hooks" "$pl/scripts"
  cp -r "$HOOKS_DIR/_shared" "$pl/hooks/_shared"; cp -r "$REPO_ROOT/scripts/lib" "$pl/scripts/lib"; cp "$GV" "$pl/scripts/gate-verify.js"
  cp "$1" "$pl/hooks/per-turn-gate.js"
  fresh tn4bp; arm_case; violate
  stop "$pl/hooks/per-turn-gate.js" false
  [ "$(blocks)" = 1 ]
}
tn4b_vanish() {
  fresh tn4bv; arm_case; violate
  stop "$1" false; [ "$(blocks)" = 1 ] || return 1
  node "$ARM" disarm --session s1 >/dev/null 2>&1
  stop "$1" true
  [ -z "$STOP_OUT" ] && [ "$(log_count)" = 1 ]
}

# ---- T-N5: Stop and SubagentStop never share a gate file.
tn5_subagent_blocks() {
  fresh tn5a; arm_case --agent a1; violate
  stop "$1" false; [ -z "$STOP_OUT" ] && [ "$(log_count)" = 0 ] || return 1   # depth-0 Stop ignores the subagent file
  sub_stop "$1" false a1
  [ "$(blocks)" = 1 ] && [ "$(log_has '"source":"subagent"' s1.a1)" = 1 ] || return 1
  sub_stop "$1" false a2; [ -z "$STOP_OUT" ]   # other agent id: no file
}
tn5_silent() { # global on + SubagentStop + no file: silent, nothing counted, config verifier not run
  fresh tn5s '{"hooks":{"per-turn-gate":true},"per_turn_gate":{"verifier":"node '"$STUB"'"}}'; export PTG_V_MODE=violate
  local before; before="$(listing)"
  sub_stop "$1" false a1
  [ -z "$STOP_OUT" ] && [ "$(calls)" = 0 ] && [ "$before" = "$(listing)" ]
}

# ---- T-N6: no depth-0 text calls the arm flag or script (this unit writes none).
scan_text() { grep -rIl -e '--gate-rules' -e 'per-turn-gate-arm' "$@" 2>/dev/null | head -1 | grep -q .; }
tn6() { [ -d "$1/skills" ] && ! scan_text "$1/skills" "$1/agents"; }

# ---- T-G1/T-G2: the worker's .git/config cannot run code or redirect git.
tg1_key() { # <hook> <key>: with the sentinel configured in the worker's repo, the hook run creates no marker
  local hook="$1" key="$2" S="$TEST_TMP/sent-$2"
  fresh "tg1-$key"; arm_case; violate; rm -rf "$S" "$S.ctl"; mkdir -p "$S" "$S.ctl"
  local sc="$CASE_DIR/sentinel.sh"; printf '#!/bin/sh\ntouch "$PTG_SENT/%s"\nexit 0\n' "$key" >"$sc"; chmod +x "$sc"
  local c="$CASE_REPO/.git/config"
  case "$key" in
    fsmonitor) printf '[core]\n\tfsmonitor = %s\n' "$sc" >>"$c" ;;
    hooksPath) mkdir -p "$CASE_DIR/hk"; cp "$sc" "$CASE_DIR/hk/pre-commit"; cp "$sc" "$CASE_DIR/hk/post-checkout"; printf '[core]\n\thooksPath = %s\n' "$CASE_DIR/hk" >>"$c" ;;
    editor) printf '[core]\n\teditor = %s\n' "$sc" >>"$c" ;;
    sshCommand) printf '[core]\n\tsshCommand = %s\n' "$sc" >>"$c" ;;
    diffexternal) printf '[diff]\n\texternal = %s\n' "$sc" >>"$c" ;;
    credential) printf '[credential]\n\thelper = !%s\n' "$sc" >>"$c" ;;
    gpg) printf '[gpg]\n\tprogram = %s\n' "$sc" >>"$c" ;;
    includefsmonitor) printf '[core]\n\tfsmonitor = false\n' >"$CASE_DIR/inc.cfg"; printf '[core]\n\tfsmonitor = %s\n' "$sc" >"$CASE_DIR/inc.cfg"; printf '[include]\n\tpath = %s\n' "$CASE_DIR/inc.cfg" >>"$c" ;;
    smudge) printf '[filter "ptg"]\n\tsmudge = %s\n\tprocess = %s\n' "$sc" "$sc" >>"$c"; echo '*.js filter=ptg' >"$CASE_REPO/.gitattributes" ;;
  esac
  # capability control: an unisolated git operation does fire this key in this very repo
  ( cd "$CASE_REPO" && export PTG_SENT="$S.ctl" GIT_TERMINAL_PROMPT=0
    case "$key" in
      fsmonitor|includefsmonitor) git status >/dev/null 2>&1 ;;
      hooksPath) GIT commit --allow-empty -qm c >/dev/null 2>&1 ;;
      editor) env -u GIT_EDITOR git -c user.name=t -c user.email=t@t commit --allow-empty >/dev/null 2>&1 </dev/null ;;
      sshCommand) git ls-remote ssh://example.invalid/x.git >/dev/null 2>&1 ;;
      diffexternal) echo y >src/keep.js; git diff >/dev/null 2>&1; git checkout -q -- src/keep.js 2>/dev/null ;;
      credential) printf 'protocol=https\nhost=example.invalid\n\n' | git credential fill >/dev/null 2>&1 ;;
      gpg) GIT commit --allow-empty -S -qm c >/dev/null 2>&1 ;;
      smudge) rm -f src/keep.js; git checkout -q -- src/keep.js >/dev/null 2>&1 ;;
    esac )
  [ -e "$S.ctl/$key" ] || { echo "tg1 $key: capability control did not fire (key unusable in this fixture)" >&2; return 2; }
  rm -rf "$S.ctl"
  export PTG_SENT="$S"
  stop "$hook" false
  local rc=0; [ ! -e "$S/$key" ] || rc=1
  unset PTG_SENT
  return $rc
}
# core.pager was dropped: git only starts a pager on a tty, so no unisolated control can fire it here.
TG1_KEYS="fsmonitor hooksPath editor sshCommand diffexternal credential gpg includefsmonitor smudge"
tg1_all() { local k rc; for k in $TG1_KEYS; do tg1_key "$1" "$k"; rc=$?; [ "$rc" = 0 ] || { echo "tg1 key failed ($rc): $k" >&2; return 1; }; done; }
tg2() { # GIT_DIR/GIT_WORK_TREE point at a decoy repo that has the base; the real repo does not
  fresh tg2; arm_case; violate
  local D="$CASE_DIR/decoy"; mkdir -p "$D"; ( cd "$D" && git init -q && echo d >d.txt && GIT add -A && GIT commit -qm decoy ) >/dev/null 2>&1
  local dbase; dbase="$(git -C "$D" rev-parse HEAD)"
  node -e 'const fs=require("fs");const f=process.argv[1];const g=JSON.parse(fs.readFileSync(f,"utf8"));g.base=process.argv[2];fs.writeFileSync(f,JSON.stringify(g))' "$CASE_GD/s1.gate.json" "$dbase"
  STOP_OUT="$(printf '{"session_id":"s1","cwd":"%s","stop_hook_active":false}' "$CASE_REPO" | env GIT_DIR="$D/.git" GIT_WORK_TREE="$D" HOME="$HOOK_HOME" node "$1" 2>/dev/null)"
  [ -z "$STOP_OUT" ] && [ "$(log_count)" = 0 ]
}
# T-G3: the isolation literals are identical in gate-verify.js, the hook and the arm script.
tg3() {
  node -e '
    const fs = require("fs"); const srcs = process.argv.slice(1).map((f) => fs.readFileSync(f, "utf8"));
    const lits = ["\x27-c\x27, \x27core.fsmonitor=false\x27, \x27-c\x27, \x27core.hooksPath=/dev/null\x27, \x27-c\x27, \x27core.excludesFile=/dev/null\x27",
      "!k.startsWith(\x27GIT_\x27)", "env.GIT_OPTIONAL_LOCKS = \x270\x27", "env.GIT_NO_REPLACE_OBJECTS = \x271\x27"];
    process.exit(srcs.every((s) => lits.every((l) => s.includes(l))) ? 0 : 1);' "$GV" "$1" "$ARM"
}

run_nc() { # <label> <fn> <mutant-name> <sed-expr>
  if "$2" "$REAL_HOOK"; then assert_eq 0 0 "$1 holds on the real hook"; else fail "$1 broken on the real hook"; fi
  local m; m="$(mutant "$3" "$4")" || { fail "$1 mutant not built"; return; }
  if "$2" "$m"; then fail "$1 negative control: the mutant passed (check cannot go red)"; else assert_eq 0 0 "$1 red on the mutant"; fi
}
holds() { if "$2" "$REAL_HOOK"; then assert_eq 0 0 "$1 holds"; else fail "$1 broken on the real hook"; fi; }

run_nc TN1 tn1 nofile "s#const armed = armingAllowed ? findArmed(payload, isSub) : null;#const armed = null;#"
run_nc TN1w tn1_file_wins nofilew "s#const armed = armingAllowed ? findArmed(payload, isSub) : null;#const armed = null;#"
run_nc TN1-source tn1_nosource alwayssource "s#if (armed) rec.source = armed.source;#rec.source = 'session';#"
holds TN1-zero tn1_zero
holds TN1-mode tn1_mode
run_nc TN2a tn2_symlink exit2allow "s#if (armed \&\& result.kind === 'error' \&\& result.status === 2) {#if (false) {#"
holds TN2b tn2_chmod
holds TN2c tn2_file
run_nc TN2r tn2_restore exit2allowr "s#if (armed \&\& result.kind === 'error' \&\& result.status === 2) {#if (false) {#"
holds TN2g tn2_global_unchanged
run_nc TN3 tn3_cost noveto "s#const armingAllowed = gate.session_arming !== false;#const armingAllowed = true;#"
run_nc TN3-git tn3_cost gitfirst "s#const sid = payload.session_id;#spawnSync('git', ['--version']); const sid = payload.session_id;#"
run_nc TN3-veto tn3_veto_ignores_file noveto2 "s#const armingAllowed = gate.session_arming !== false;#const armingAllowed = true;#"
run_nc TN4-expired tn4_expired noexpiry "s#exp <= Date.now()#false#"
run_nc TN4-unknown tn4_unknown nounknown "s#if (keys.length !== GATE_KEYS.length || !keys.every((k) => GATE_KEYS.includes(k))) return null;##"
run_nc TN4-notcommit tn4_notcommit nobasecheck "s#if (!baseIsCommit(repoReal, g.base)) return null;##"
holds TN4-all tn4_rest
run_nc TN4b-ids tn4b_ids noidcheck "s#if (typeof sid !== 'string' || !ID_RE.test(sid)) return null;##"
run_nc TN4b-shell tn4b_shell_path shellpath 's#shq(GATE_VERIFY)}` : gate.verifier;#shq(GATE_VERIFY)} --gate-file ${armed.file}` : gate.verifier;#'
holds TN4b-plugin-path tn4b_plugin_path
holds TN4b-vanish tn4b_vanish
run_nc TN5 tn5_subagent_blocks nosubkey "s#const file = path.join(liveBase(), HOOK_STEM, \`\${key}.gate.json\`);#const file = path.join(liveBase(), HOOK_STEM, \`\${sid}.gate.json\`);#"
run_nc TN5-silent tn5_silent noeventgate "s#if (isSub) return; // SubagentStop without its own gate file: not ours, leave no trace##"
run_nc TG2 tg2 keepgitenv "s#if (!k.startsWith('GIT_')) env\[k\]#env[k]#"
run_nc TG3 tg3 driftflag "s#core.hooksPath=/dev/null#core.hooksPath=/tmp#"
holds TG1 tg1_all

# T-N6 scans the real tree; its negative control is a fake tree that mentions the flag.
if tn6 "$REPO_ROOT"; then assert_eq 0 0 "TN6 no depth-0 text mentions the arm flag"; else fail "TN6 a skill or agent mentions --gate-rules or per-turn-gate-arm"; fi
mkdir -p "$TEST_TMP/faketree/skills" "$TEST_TMP/faketree/agents"; echo 'run dispatch-hetero --gate-rules f' >"$TEST_TMP/faketree/skills/x.md"
if tn6 "$TEST_TMP/faketree"; then fail "TN6 negative control: the scan did not see the mention"; else assert_eq 0 0 "TN6 red on a tree that mentions the flag"; fi

finalize_test
