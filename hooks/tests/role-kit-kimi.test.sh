#!/usr/bin/env bash
# --role-kit <dir> on the kimi arm of dispatch-author. No model call: `kimi` is a stub (FAKE only) that records its argv, env,
# cwd and a copy of the --agent-file it was handed (the rail deletes its own copy after the run).
#  (a) no kit      -> kimi argv is exactly --model/--prompt/--output-format; argv, env and cwd are byte-identical to the
#                     pre-change tree (BASE_REV via git archive, random temp suffixes normalised); no role_kit in the result JSON
#  (b) kit         -> same argv + `--agent-file <rail-owned path>`; the agent file is frontmatter + the exact role.md bytes and
#                     equals evals/rolekit/compile-kit.js's kimi agent_file; env and cwd unchanged; the rail removes the file;
#                     result JSON gets role_kit (path, role/tools sha256, agent_file_sha256 = sha of the file kimi saw)
#  (c) tools none  -> `tools: []`
#  (d) plugin/ kit, over-cap kit, every validator refusal -> exit 2, one role-kit line, kimi never spawned
#  (e) the kimi CLI lacks --agent-file -> fail closed before spawn; without a kit that flag is not required
#  (f) dispatch-review and dispatch-hetero still refuse --role-kit for kimi
#  (g) negative controls (PM red case): a rail copy that drops --agent-file, one whose agent file lacks the card, one that drops the
#      plugin refusal, one whose adapter ignores agentFile -> the same checks that pass on the real tree go red
. "$(dirname "$0")/lib.sh"
. "$(dirname "$0")/lib/dispatch-review-fixtures.sh"
AUTHOR="$REPO_ROOT/scripts/dispatch-author.sh"
BASE_REV="${ROLE_KIT_KIMI_BASE_REV:-a271be9c9288a6584cdcfe526f059075af8753cf}"

export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
export TMPDIR="$TEST_TMP/tmp"; mkdir -p "$TMPDIR"
export AUTOPILOT_ACCOUNTS_DIR="$TEST_TMP/no-accounts"
export AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs"; mkdir -p "$AUTOPILOT_DISPATCH_RUNS_DIR"
export AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1 DISPATCH_DETACH=0
unset AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID AUTOPILOT_CONFIG_FILE

BIN="$TEST_TMP/bin"; mkdir -p "$BIN"
CAP="$TEST_TMP/cap"; mkdir -p "$CAP"
cat > "$BIN/kimi" <<'EOF2'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then printf '0.0.0-fake\n'; exit 0; fi
if [ "${1:-}" = "--help" ]; then
  if [ "${KIT_FAKE_SURFACE:-agent}" = "noagent" ]; then printf '%s\n' 'Usage: kimi --model=<m>, --prompt <p>; --output-format=text'
  else printf '%s\n' 'Usage: kimi --model=<m>, --prompt <p>; --output-format=text; --agent-file <f>'; fi
  exit 0
fi
echo call >> "$KIT_CAP/calls.log"
node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)))' "$KIT_CAP/argv.json" "$@"
{ env | sort; pwd; } > "$KIT_CAP/env.txt"
prev=""; for a in "$@"; do [ "$prev" = "--agent-file" ] && { cp "$a" "$KIT_CAP/agent.seen"; printf '%s' "$a" > "$KIT_CAP/agent.path"; }; prev="$a"; done
printf 'authored by the fake\n'
EOF2
chmod +x "$BIN/kimi"
export KIT_CAP="$CAP"
export PATH="$BIN:$PATH"

PROMPT="$TEST_TMP/p.txt"; printf 'say hi\n' > "$PROMPT"
mkkit() { rm -rf "$1"; mkdir -p "$1"; printf -- '# Role card\n- keep "quotes" and $(not run) and `ticks`\n--not-a-flag\nlast line\n\n' > "$1/role.md"; printf 'Read,Grep\n' > "$1/tools"; }
KIT="$TEST_TMP/kit"; mkkit "$KIT"
KIT_REAL="$(cd "$KIT" && pwd -P)"

# run_author <scripts-dir> [args...] -> RC OUT NCALLS (capture dir reset)
run_author() {
  local sd="$1"; shift
  rm -rf "$CAP"; mkdir -p "$CAP"; touch "$CAP/calls.log"
  OUT="$("$sd/dispatch-author.sh" --runner kimi --model kimi-code/k3 --prompt-file "$PROMPT" --timeout 30s --context-window off "$@" 2>&1 < /dev/null)"; RC=$?
  NCALLS="$(grep -c call "$CAP/calls.log" 2>/dev/null || true)"; NCALLS="${NCALLS:-0}"
}
sha_of() { sha256sum "$1" | cut -d' ' -f1; }
EXPECT_HEAD() { printf -- '---\nname: rk-kit\ndescription: "role kit agent (no behaviour of its own)"\ntools: [%s]\n---\n' "$1"; }
norm() { sed -E 's/autopilot-kimi-cwd-[A-Za-z0-9]+/autopilot-kimi-cwd-X/g; s/tmp\.[A-Za-z0-9]+/tmp.X/g; /^(OLDPWD|SHLVL|_|RANDOM|EPOCHREALTIME|SECONDS|INVOCATION_ID)=/d' "$1"; }

# argv_norm <argv.json> : the dispatcher wraps the prompt with a random nonce; normalise it (hex runs) and keep the rest verbatim
argv_norm() { node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8");process.stdout.write(s.replace(/NONCE=[0-9a-f]+/g,"NONCE=H").replace(/[0-9a-f]{32}/g,"H"))' "$1"; }
argv_shape() { node -e 'const a=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));a[3]=a[3].includes("say hi")?"<prompt>":"<WRONG PROMPT>";process.stdout.write(JSON.stringify(a))' "$1"; }

# kit_problems <scripts-dir> -> "" when a run with the Read,Grep kit holds every (b) property, else the reasons
kit_problems() {
  local bad=""
  run_author "$1" --role-kit "$KIT"
  [ "$NCALLS" = 1 ] || { printf 'kimi calls=%s rc=%s' "$NCALLS" "$RC"; return; }
  grep -q -- '"--agent-file"' "$CAP/argv.json" || bad="$bad no --agent-file;"
  if [ ! -f "$CAP/agent.seen" ]; then bad="$bad kimi saw no agent file;"
  else
    { EXPECT_HEAD 'Read, Grep'; cat "$KIT/role.md"; } > "$TEST_TMP/expected.agent"
    cmp -s "$CAP/agent.seen" "$TEST_TMP/expected.agent" || bad="$bad agent file is not frontmatter + exact role.md;"
    node -e 'const f=require("fs");process.exit(f.readFileSync(process.argv[1]).includes(f.readFileSync(process.argv[2]))?0:1)' "$CAP/agent.seen" "$KIT/role.md" || bad="$bad agent file lacks the card;"
  fi
  printf '%s' "$bad"
}

mut_tree() { rm -rf "$TEST_TMP/$1"; mkdir -p "$TEST_TMP/$1"; cp -r "$REPO_ROOT/scripts" "$REPO_ROOT/src" "$TEST_TMP/$1/"; }
# ---- (a) no kit
run_author "$REPO_ROOT/scripts"
assert_eq "1" "$NCALLS" "(a) no kit: one kimi call (rc=$RC)"
assert_eq '["--model","kimi-code/k3","--prompt","<prompt>","--output-format","text"]' "$(argv_shape "$CAP/argv.json")" "(a) no kit: argv is exactly what it was"
assert_not_contains "$OUT" '"role_kit"' "(a) no kit: result JSON has no role_kit"
norm "$CAP/env.txt" > "$TEST_TMP/nokit.env"
argv_norm "$CAP/argv.json" > "$TEST_TMP/nokit.argv"

# baseline: the pre-change tree (scripts + src) from git; argv, env and cwd of the kimi child must be byte-identical to a
# copy of the working tree placed beside it (both outside the repo: the session lookup of the child env depends on where the
# scripts live, so the two trees are compared from the same kind of location)
BASE="$TEST_TMP/base-tree"; mkdir -p "$BASE"
if git -C "$REPO_ROOT" cat-file -e "$BASE_REV^{commit}" 2>/dev/null; then
  git -C "$REPO_ROOT" archive "$BASE_REV" scripts src | tar -x -C "$BASE"
  mut_tree newcopy
  run_author "$TEST_TMP/newcopy/scripts"
  assert_eq "1" "$NCALLS" "(a) working-tree copy: one kimi call"
  norm "$CAP/env.txt" > "$TEST_TMP/newcopy.env"; argv_norm "$CAP/argv.json" > "$TEST_TMP/newcopy.argv"
  run_author "$BASE/scripts"
  assert_eq "1" "$NCALLS" "(a) baseline tree: one kimi call"
  norm "$CAP/env.txt" > "$TEST_TMP/base.env"
  argv_norm "$CAP/argv.json" > "$TEST_TMP/base.argv"
  cmp -s "$TEST_TMP/base.argv" "$TEST_TMP/newcopy.argv"; assert_eq "0" "$?" "(a) no kit: argv byte-identical to the baseline tree"
  [ -z "${KIT_DEBUG:-}" ] || diff "$TEST_TMP/base.env" "$TEST_TMP/newcopy.env" >&2
  cmp -s "$TEST_TMP/base.env" "$TEST_TMP/newcopy.env"; assert_eq "0" "$?" "(a) no kit: child env + cwd byte-identical to the baseline tree"
  [ -s "$TEST_TMP/newcopy.env" ]; assert_eq "0" "$?" "(a) the compared env is not empty"
else
  assert_eq "present" "missing" "(a) baseline revision $BASE_REV must be in this repo (or set ROLE_KIT_KIMI_BASE_REV)"
fi

# ---- (b) kit
run_author "$REPO_ROOT/scripts" --role-kit "$KIT"
assert_eq "1" "$NCALLS" "(b) kit: one kimi call (rc=$RC)"
AP="$(cat "$CAP/agent.path")"
assert_eq "[\"--model\",\"kimi-code/k3\",\"--prompt\",\"<prompt>\",\"--output-format\",\"text\",\"--agent-file\",\"$AP\"]" "$(argv_shape "$CAP/argv.json")" "(b) kit: argv is the plain argv plus --agent-file <path>"
case "$AP" in "$TMPDIR"/dispatch-author-kimikit-*/agent.md) RC2=0 ;; *) RC2=1 ;; esac
assert_eq "0" "$RC2" "(b) kit: agent file sits in the rail's own temp dir ($AP)"
[ ! -e "$AP" ] && [ ! -e "$(dirname "$AP")" ]; assert_eq "0" "$?" "(b) kit: the rail removes its agent-file dir after the run"
norm "$CAP/env.txt" > "$TEST_TMP/kit.env"
cmp -s "$TEST_TMP/kit.env" "$TEST_TMP/nokit.env"; assert_eq "0" "$?" "(b) kit: child env + cwd identical to the no-kit run"
JSON_PROBLEMS="$(node -e '
  const line = process.argv[1].split("\n").filter((l) => l.startsWith("{")).pop();
  const o = JSON.parse(line); const k = o.role_kit; const bad = [];
  const sha = (f) => require("crypto").createHash("sha256").update(require("fs").readFileSync(f)).digest("hex");
  if (!k) bad.push("no role_kit"); else {
    if (k.path !== process.argv[2]) bad.push("path " + k.path);
    if (k.role_md_sha256 !== sha(process.argv[3])) bad.push("role sha");
    if (k.tools_sha256 !== sha(process.argv[4])) bad.push("tools sha");
    if (k.tools !== "Read,Grep") bad.push("tools " + k.tools);
    if (k.agent_file_sha256 !== sha(process.argv[5])) bad.push("agent_file_sha256 is not the sha of the file kimi saw");
    if (k.plugin !== false) bad.push("plugin flag");
  }
  process.stdout.write(bad.join("; "));' "$OUT" "$KIT_REAL" "$KIT/role.md" "$KIT/tools" "$CAP/agent.seen")"
assert_eq "" "$JSON_PROBLEMS" "(b) kit: result JSON role_kit has path, role/tools sha256, agent_file_sha256"
assert_eq "" "$(kit_problems "$REPO_ROOT/scripts")" "(b) kit: agent file = frontmatter + exact role.md bytes (tools: [Read, Grep])"

# the layout is the one compile-kit.js documents (frozen file; used read-only through its exported compile())
node -e 'const r=require(process.argv[1]).compile(process.argv[2],"kimi");if(!r.ok)process.exit(3);process.stdout.write(r.agent_file)' "$REPO_ROOT/evals/rolekit/compile-kit.js" "$KIT" > "$TEST_TMP/ck.agent"
cmp -s "$TEST_TMP/ck.agent" "$CAP/agent.seen"; assert_eq "0" "$?" "(b) kit: agent file equals compile-kit.js --runner kimi agent_file byte for byte"
assert_eq "4096" "$(node -e 'process.stdout.write(String(require(process.argv[1]).MAX_ROLE_BYTES_KIMI))' "$REPO_ROOT/evals/rolekit/compile-kit.js")" "(b) the kimi role.md cap equals compile-kit.js's"
assert_eq "4096" "$(node -e 'process.stdout.write(String(require(process.argv[1]).ROLE_MD_MAX_BYTES_KIMI))' "$REPO_ROOT/scripts/lib/role-kit-kimi.js")" "(b) rail kimi role.md cap is 4096"

# ---- (c) tools none
KIT_NONE="$TEST_TMP/kit-none"; mkkit "$KIT_NONE"; printf 'none\n' > "$KIT_NONE/tools"
run_author "$REPO_ROOT/scripts" --role-kit "$KIT_NONE"
assert_eq "1" "$NCALLS" "(c) tools none: one kimi call (rc=$RC)"
printf -- '---\nname: rk-kit-none\ndescription: "role kit agent (no behaviour of its own)"\ntools: []\n---\n' > "$TEST_TMP/exp-none"; cat "$KIT_NONE/role.md" >> "$TEST_TMP/exp-none"
cmp -s "$CAP/agent.seen" "$TEST_TMP/exp-none"; assert_eq "0" "$?" "(c) tools none: agent file carries tools: []"

# ---- (d) refusals: exit 2, one role-kit line, kimi never spawned
OUTSIDE="$TEST_TMP/outside.txt"; printf 'not part of the kit\n' > "$OUTSIDE"
refuse_case() { # <name> <why>
  local K="$TEST_TMP/bad-$1"; mkkit "$K"
  case "$1" in
    missing-dir) K="$TEST_TMP/does-not-exist" ;;
    plugin) mkdir -p "$K/plugin/skills/only-skill"; printf 'skill\n' > "$K/plugin/skills/only-skill/SKILL.md" ;;
    empty-role) : > "$K/role.md" ;;
    kimi-cap) head -c 4097 /dev/zero | tr '\0' 'a' > "$K/role.md" ;;
    big-role) head -c 8193 /dev/zero | tr '\0' 'a' > "$K/role.md" ;;
    bad-tools) printf 'Read;rm -rf\n' > "$K/tools" ;;
    empty-tools) printf '\n' > "$K/tools" ;;
    link-escape) rm "$K/role.md"; ln -s "$OUTSIDE" "$K/role.md" ;;
  esac
  run_author "$REPO_ROOT/scripts" --role-kit "$K"
  assert_eq "2" "$RC" "(d) $1: exits 2"
  assert_eq "0" "$NCALLS" "(d) $1: kimi not spawned"
  assert_contains "$OUT" "role-kit refused" "(d) $1: a role-kit refusal"
  assert_contains "$OUT" "$2" "(d) $1: names the cause [$2]"
  assert_eq "0" "$(command ls "$TMPDIR" | grep -c 'dispatch-author-kimikit')" "(d) $1: no agent-file dir left behind"
}
refuse_case missing-dir "kit dir missing"
refuse_case plugin "cannot read plugin skills"
refuse_case empty-role "role.md is empty"
refuse_case kimi-cap "over the 4096 byte kimi cap"
refuse_case big-role "over the 8192 byte cap"
refuse_case bad-tools "unknown tool name shape"
refuse_case empty-tools "tools line is empty"
refuse_case link-escape "escapes the kit dir"
run_author "$REPO_ROOT/scripts" --role-kit ""
assert_eq "2" "$RC" "(d) empty --role-kit value exits 2"

# ---- (e) kimi without --agent-file
export KIT_FAKE_SURFACE=noagent
run_author "$REPO_ROOT/scripts" --role-kit "$KIT"
assert_eq "0" "$NCALLS" "(e) kimi lacking --agent-file: not spawned with a kit"
assert_neq "0" "$RC" "(e) kimi lacking --agent-file: nonzero exit"
run_author "$REPO_ROOT/scripts"
assert_eq "1" "$NCALLS" "(e) kimi lacking --agent-file: still runs without a kit (flag not required then)"
export KIT_FAKE_SURFACE=agent

# ---- (f) other rails keep refusing kimi
DIFF2="$TEST_TMP/d2.diff"; printf '+x\n' > "$DIFF2"
R_OUT="$("$REPO_ROOT/scripts/dispatch-review.sh" --runner kimi --model kimi-code/k3 --diff-file "$DIFF2" --timeout 30s --context-window off --role-kit "$KIT" 2>&1 < /dev/null)"; R_RC=$?
assert_eq "2" "$R_RC" "(f) dispatch-review kimi + kit exits 2"
assert_contains "$R_OUT" "role-kit unsupported for runner kimi" "(f) dispatch-review still refuses kimi"
SBX="$TEST_TMP/repo"; mkdir -p "$SBX"; git -C "$SBX" init -q -b develop; git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
H_OUT="$(cd "$SBX" && "$REPO_ROOT/scripts/dispatch-hetero.sh" --runner kimi --model kimi-code/k3 --effort low --prompt-file "$PROMPT" --context-window off --branch feat/kk --role-kit "$KIT" 2>&1 < /dev/null)"; H_RC=$?
assert_eq "2" "$H_RC" "(f) dispatch-hetero kimi + kit exits 2"
assert_contains "$H_OUT" "role-kit unsupported for runner kimi" "(f) dispatch-hetero still refuses kimi"
assert_contains "$("$AUTHOR" -h 2>&1)" "kimi" "(f) author -h mentions the kimi kit arm"

# ---- (g) negative controls: mutated copies of scripts/ + src/ must turn the same checks red
mut_tree m1; sed_mutate "$TEST_TMP/m1/scripts/dispatch-author.sh" 's/ \${KIMI_AGENT_ARGS\[@\]+"\${KIMI_AGENT_ARGS\[@\]}"}//' >/dev/null
assert_contains "$(kit_problems "$TEST_TMP/m1/scripts")" "no --agent-file" "(g) red case: a rail that drops --agent-file is caught"
mut_tree m2; sed_mutate "$TEST_TMP/m2/scripts/lib/role-kit-kimi.js" 's/Buffer.concat(\[Buffer.from(head, .utf8.), role\])/Buffer.from(head, "utf8")/' >/dev/null
assert_contains "$(kit_problems "$TEST_TMP/m2/scripts")" "agent file lacks the card" "(g) red case: an agent file without the card is caught"
mut_tree m3; sed_mutate "$TEST_TMP/m3/scripts/lib/role-kit-kimi.js" "s/if (k.plugin) throw/if (false) throw/" >/dev/null
run_author "$TEST_TMP/m3/scripts" --role-kit "$TEST_TMP/bad-plugin"
assert_eq "1" "$NCALLS" "(g) red case: without the plugin refusal a plugin kit reaches a spawn"
mut_tree m4; sed_mutate "$TEST_TMP/m4/src/runners/kimi.js" "s/\.\.\.(agentFile === null ? \[\] : \['--agent-file', agentFile\]),//" >/dev/null
assert_contains "$(kit_problems "$TEST_TMP/m4/scripts")" "no --agent-file" "(g) red case: an adapter that ignores agentFile is caught"

finalize_test
