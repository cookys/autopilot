#!/usr/bin/env bash
# record-files.test.sh — scripts/lib/record-files.js (Files-mode writers of project-record, plan A3.1).
#
# One golden case per matrix row, run against a temp repo built from hooks/tests/fixtures/record-files/base
# (its dot-claude/ becomes .claude/). A case is inputs/<name>.json = {fn, input, opts?, pre?}; the result and the
# files it wrote are compared with golden/<name>/. Validation cases (v-*) must throw the rule and leave the tree
# untouched. RECORD_FILES_REGEN=1 rewrites the goldens (inspect them by hand before committing).
#
# Temp repos follow C6: the sandbox HOME and scrubbed git env come from lib.sh; every repo is preflighted
# (show-toplevel is the temp path, core.hooksPath empty or inside it) before anything runs in it, and the
# preflight has a negative control.

. "$(dirname "$0")/lib.sh"

FIX="$REPO_ROOT/hooks/tests/fixtures/record-files"
DRIVER="$REPO_ROOT/hooks/tests/lib/record-files-driver.js"
GATE="$REPO_ROOT/scripts/check-backlog-entries.js"
REGEN="${RECORD_FILES_REGEN:-}"

jq_() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const v=eval(process.argv[2]);process.stdout.write(typeof v==="string"?v:JSON.stringify(v))' "$1" "$2"; }

preflight() { # <dir> -> 0 when git here is the temp repo itself and no hook path reaches outside it
  local d top hp
  d="$(cd "$1" && pwd -P)"
  top="$(git -C "$d" rev-parse --show-toplevel 2>/dev/null)" || return 1
  [ "$top" = "$d" ] || return 1
  hp="$(git -C "$d" config --get core.hooksPath 2>/dev/null || true)"
  if [ -n "$hp" ]; then case "$hp" in "$d"/*) : ;; *) return 1 ;; esac; fi
  return 0
}

mk_repo() { # <name> -> prints the repo path
  local d="$TEST_TMP/repos/$1-$RANDOM$RANDOM"
  mkdir -p "$TEST_TMP/repos"
  cp -r "$FIX/base" "$d"
  mv "$d/dot-claude" "$d/.claude"
  git -C "$d" init -q
  git -C "$d" add -A -f
  git -C "$d" commit -q -m base
  preflight "$d" || { fail "C6 preflight failed for $d"; return 1; }
  echo "$d"
}

# -- C6 preflight: positive and negative controls
P="$(mk_repo preflight)"
assert_eq "$(preflight "$P" && echo ok)" "ok" "preflight accepts a temp repo"
mkdir -p "$TEST_TMP/not-a-repo/sub"
assert_eq "$(preflight "$TEST_TMP/not-a-repo/sub" && echo ok || echo refused)" "refused" "preflight refuses a directory that is not a repo root"
git -C "$P" config core.hooksPath /somewhere/else
assert_eq "$(preflight "$P" && echo ok || echo refused)" "refused" "preflight refuses a hooksPath outside the temp tree"
git -C "$P" config core.hooksPath "$P/hooks-inside"
assert_eq "$(preflight "$P" && echo ok || echo refused)" "ok" "preflight accepts a hooksPath inside the temp tree"
assert_contains "$HOME" "$TEST_TMP" "HOME is the sandbox"

drive() { # <repo> <fn> <input-json> <opts-json> -> the driver's one-line JSON
  node "$DRIVER" "$1" "$2" "$3" "$4"
}

# case_json <name> <repo> <tmp> -> runs the optional pre-step, then the case; writes $TEST_TMP/<name>.out
run_case() {
  local name="$1" f="$FIX/inputs/$1.json" repo tmp fn input opts prefn preinput
  repo="$(mk_repo "$name")" || return 1
  tmp="$TEST_TMP/tmp-$name"; mkdir -p "$tmp"
  fn="$(jq_ "$f" 'j.fn')"
  input="$(jq_ "$f" 'j.input')"
  opts="$(jq_ "$f" 'JSON.stringify(j.opts||{})' | sed "s#@TMP@#$tmp#g")"
  if [ "$(jq_ "$f" '!!j.pre')" = "true" ]; then
    prefn="$(jq_ "$f" 'j.pre.fn')"; preinput="$(jq_ "$f" 'j.pre.input')"
    drive "$repo" "$prefn" "$preinput" "{}" > /dev/null
    git -C "$repo" add -A -f && git -C "$repo" commit -q -m pre
  fi
  drive "$repo" "$fn" "$input" "$opts" > "$TEST_TMP/$name.out"
  CASE_REPO="$repo"; CASE_TMP="$tmp"
}

golden_case() { # <name>
  local name="$1" out g="$FIX/golden/$1" paths changed p
  run_case "$name" || return 1
  out="$TEST_TMP/$name.out"
  assert_eq "$(jq_ "$out" 'j.ok')" "true" "$name: call succeeded"
  jq_ "$out" 'Object.assign({}, j.result, {ledger: undefined})' > "$TEST_TMP/$name.result"
  node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));fs.writeFileSync(process.argv[1],JSON.stringify(j,null,1)+"\n")' "$TEST_TMP/$name.result"
  paths="$(jq_ "$out" 'j.result.paths_written.join("\n")')"
  if [ -n "$REGEN" ]; then
    rm -rf "$g"; mkdir -p "$g/files"
    cp "$TEST_TMP/$name.result" "$g/result.json"
    while IFS= read -r p; do
      [ -n "$p" ] && [ -f "$CASE_REPO/$p" ] && { mkdir -p "$g/files/$(dirname "$p")"; cp "$CASE_REPO/$p" "$g/files/$p"; }
    done <<< "$paths"
    if [ -f "$CASE_TMP/ledger.jsonl" ]; then
      node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).map(({decision_id,title,rationale,source,area,supersedes})=>({decision_id,title,rationale,source,area,supersedes}));console.log(JSON.stringify(l,null,1))' "$CASE_TMP/ledger.jsonl" > "$g/ledger.json"
    fi
    return 0
  fi
  cmp -s "$TEST_TMP/$name.result" "$g/result.json" && ok=1 || ok=0
  assert_eq "$ok" "1" "$name: result matches golden"
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    if [ -f "$g/files/$p" ]; then
      cmp -s "$CASE_REPO/$p" "$g/files/$p" && ok=1 || ok=0
      assert_eq "$ok" "1" "$name: $p matches golden"
    else
      assert_eq "$([ -e "$CASE_REPO/$p" ] && echo present || echo absent)" "absent" "$name: $p was deleted"
    fi
  done <<< "$paths"
  # nothing outside paths_written changed
  changed="$(git -C "$CASE_REPO" status --porcelain -uall | sed -E 's/^.{3}//' | sort)"
  assert_eq "$changed" "$(printf '%s\n' "$paths" | sort | sed '/^$/d')" "$name: only paths_written changed"
  if [ -f "$g/ledger.json" ]; then
    node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).map(({decision_id,title,rationale,source,area,supersedes})=>({decision_id,title,rationale,source,area,supersedes}));console.log(JSON.stringify(l,null,1))' "$CASE_TMP/ledger.jsonl" > "$TEST_TMP/$name.ledger"
    cmp -s "$TEST_TMP/$name.ledger" "$g/ledger.json" && ok=1 || ok=0
    assert_eq "$ok" "1" "$name: ledger rows match golden"
  fi
}

# -- golden cases, one per matrix row
for c in backlog-new backlog-new-peer-sidecar backlog-reply backlog-close-done backlog-close-done-sidecar \
         backlog-close-cancelled backlog-close-superseded decision-new-ledger-row decision-new-ledger-only \
         decision-supersede adr-new adr-supersede lesson-new handoff-new handoff-replace handoff-close; do
  golden_case "$c"
done

# a decision with a ledger row writes nothing and says so
assert_contains "$(cat "$FIX/golden/decision-new-ledger-row/result.json")" "ledger row dec-abc123def456 is the decision" "ledger-row decision is a no-op with its info line"

# -- backlog new output passes the gate (also with a peer row and its sidecar)
for c in backlog-new backlog-new-peer-sidecar; do
  run_case "$c" || continue
  rc=0; out="$(cd "$CASE_REPO" && node "$GATE" --backlog docs/BACKLOG.md --json)" || rc=$?
  assert_eq "$rc" "0" "$c: check-backlog-entries.js exits 0 on the written backlog"
  printf '%s' "$out" > "$TEST_TMP/$c.gate"
  assert_eq "$(jq_ "$TEST_TMP/$c.gate" 'j.violations.length')" "0" "$c: gate reports no violation"
done
run_case backlog-new
assert_contains "$(cat "$CASE_REPO/docs/BACKLOG.md")" "<!-- next-id: BL-0007 -->" "backlog new bumps the next-id mark"

# -- backlog reply leaves every other line byte-equal
run_case backlog-reply
node -e '
const fs=require("fs");
const base=fs.readFileSync(process.argv[1],"utf8");
const want=base.replace("- **Reply**: none\n","- **Reply**: 2026-11-09 msg_01ABC\n");
if(want===base)process.exit(2);
fs.writeFileSync(process.argv[3],want);
' "$FIX/base/docs/BACKLOG.md" /dev/null "$TEST_TMP/reply-expected.md"
cmp -s "$CASE_REPO/docs/BACKLOG.md" "$TEST_TMP/reply-expected.md" && ok=1 || ok=0
assert_eq "$ok" "1" "backlog reply: the file is the base byte for byte except the Reply line"
assert_eq "$(diff "$FIX/base/docs/BACKLOG.md" "$CASE_REPO/docs/BACKLOG.md" | grep -c '^[<>]')" "2" "backlog reply: exactly one line replaced"

# -- validation: the rule is thrown (exit 3) and nothing is written
vcase() { # <name> <rule>
  run_case "$1" || return 1
  local out="$TEST_TMP/$1.out"
  assert_eq "$(jq_ "$out" 'j.ok')" "false" "$1: refused"
  assert_eq "$(jq_ "$out" 'j.name')" "RuleViolationError" "$1: typed rule error"
  assert_eq "$(jq_ "$out" 'j.rule')" "$2" "$1: carries the rule"
  assert_eq "$(jq_ "$out" 'j.exitCode')" "3" "$1: exit code 3"
  assert_eq "$(git -C "$CASE_REPO" status --porcelain -uall)" "" "$1: nothing written"
}
vcase v-missing-problem missing_field
vcase v-bad-trigger-type bad_trigger_type
vcase v-peer-no-reporter peer_field_missing
vcase v-reply-bad bad_reply
vcase v-peer-close-unanswered peer_closed_unanswered
vcase v-duplicate-title duplicate_title

# -- a gate failure after the write restores the files (an orphan sidecar makes the block-mode gate refuse any state)
G="$(mk_repo gate-failed)"
printf 'nobody points here\n' > "$G/docs/backlog/orphan.md"
git -C "$G" add -A -f && git -C "$G" commit -q -m orphan
out="$(drive "$G" backlogNew "$(jq_ "$FIX/inputs/backlog-new.json" 'j.input')" '{}')"
printf '%s' "$out" > "$TEST_TMP/gate-failed.out"
assert_eq "$(jq_ "$TEST_TMP/gate-failed.out" 'j.rule')" "gate_failed" "gate failure after the write is reported as gate_failed"
assert_eq "$(git -C "$G" status --porcelain -uall)" "" "gate failure restores the backlog"

finalize_test
