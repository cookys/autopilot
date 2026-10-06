#!/usr/bin/env bash
# hooks/tests/skill-onoff-generic.test.sh — mods P1W EVALX: skill-onoff harness extensions E1-E5
# (spend-free; stub runner only, NEVER a live model).
#
# RED-first record: this file was run against the unmodified harness (git archive of 4641b5d7,
# before any EVALX edit) and failed at the first generic-arm assertion (rc=2 "arm must be
# full|card|off": no --skill support) — see the REPORT for the captured output.
#
#   T1 legacy regression: dev-flow full|card|off arms are byte-identical to the pre-EVALX harness
#      (golden plugin-tree + repo-tree digests, normalised result.json row)
#   T2 E1 generic arms: --skill/--arm base|change assemble ONLY skills/<skill>/ from digest-verified
#      packs; everything else byte-identical; tamper / unlisted file / missing pack / bad flag combos
#      are exit 2; --with-pack; freeze-pack refuses to mutate an existing id
#   T3 E2 live packs: ceo-agent-base / finish-flow-base / dev-flow-base equal git show of the freeze
#      ref; historical dev-flow-full untouched
#   T4 E3 fixture scripts: pack root copied into the base commit of BOTH arms; a pack-provided stub
#      helper (the rows' helpers do not exist on develop yet) is runnable from the fixture
#   T5 E4 isolation: per-cell AUTOPILOT_LIVE_DIR / TASK_STATUS_DIR on tmpfs (no tmpfs base = exit 2, fail closed); the ledger default stays inside the fixture repo; the real
#      /run/user/<uid>/autopilot and ~/.autopilot are untouched (inode+mtime diff); mutation: with the
#      export removed the stub DOES reach the (fake) store, so the check can fail
#   T6 E5: skill_invoked for the target skill (--skill / --check-skill); legacy row unchanged
#   T7 matrix passes the generic flags through and resumes by cell

set -euo pipefail
. "$(dirname "$0")/lib.sh"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="$REPO_ROOT/evals/skill-onoff"
fail() { echo "FAIL: $*" >&2; exit 1; }

# ── real-store snapshot BEFORE anything runs. The host's own sessions rewrite files DEEP inside the
# live store continuously (statusline/context feeds), so a recursive mtime diff is noise; what a leaking
# cell would do is create/replace entries at the store root. Snapshot = root dir inode+mtime plus the
# inode of every root-level entry; plus a recursive scan for this run's unique probe token.
PROBE_TAG="evalx-$$-$RANDOM"; export ONOFF_PROBE_TAG="$PROBE_TAG"
REAL_ROOTS=("/run/user/$(id -u)/autopilot" "$HOME/.autopilot")
real_snap() {
  { for r in "${REAL_ROOTS[@]}"; do
      find "$r" -maxdepth 0 -printf '%p %i %T@\n' 2>/dev/null || true
      find "$r" -maxdepth 1 -mindepth 1 -printf '%p %i\n' 2>/dev/null || true
    done; } | LC_ALL=C sort | sha256sum | cut -d' ' -f1
}
real_token_hits() { find "${REAL_ROOTS[@]}" -name "*$PROBE_TAG*" 2>/dev/null | wc -l; }
REAL_BEFORE=$(real_snap)

# fake XDG runtime dir on tmpfs: every stub cell resolves "the real live dir" HERE, never the host's
FAKE_XDG=""
if [ -d /dev/shm ] && [ -w /dev/shm ]; then FAKE_XDG=$(mktemp -d -p /dev/shm "onoff-fake-xdg-XXXXXX"); chmod 700 "$FAKE_XDG"; trap 'rm -rf "${FAKE_XDG:-}"; cleanup_test_tmp' EXIT; fi
[ -z "$FAKE_XDG" ] || export XDG_RUNTIME_DIR="$FAKE_XDG"

# ── stub runner: dumps what the cell assembled as key=value lines ──
STUB="$TEST_TMP/stub.sh"
cat > "$STUB" <<'STUBEOF'
#!/usr/bin/env bash
set -eu
td() { # tree digest of dir $1 (path + content), excluding .git and optional prune path $2
  (cd "$1" && find . -path ./.git -prune -o ${2:+-path "$2" -prune -o} -type f -print | LC_ALL=C sort \
     | while read -r f; do printf '%s %s\n' "$f" "$(sha256sum "$f" | cut -d' ' -f1)"; done | sha256sum | cut -d' ' -f1); }
echo "plugin=$(td "$ONOFF_PLUGIN_DIR")"
echo "repo=$(td .)"
if [ -n "${STUB_SKILL:-}" ]; then
  echo "plugin_ex=$(td "$ONOFF_PLUGIN_DIR" "./skills/$STUB_SKILL")"
  echo "skill=$(td "$ONOFF_PLUGIN_DIR/skills/$STUB_SKILL")"
fi
echo "arm=$ONOFF_ARM"
echo "skills=$(ls "$ONOFF_PLUGIN_DIR/skills" | paste -sd, -)"
echo "tracked_scripts=$(git ls-files scripts | wc -l)"
echo "dirty=$(git status --porcelain | wc -l)"
echo "live=${AUTOPILOT_LIVE_DIR:-unset}"
echo "taskstatus=${AUTOPILOT_TASK_STATUS_DIR:-unset}"
echo "ledger_env=${AUTOPILOT_LEDGER_DIR:-unset}"
echo "ledger_default=$(cd "$(git rev-parse --git-common-dir)" && pwd -P)/autopilot/ledger"
echo "cwd=$(pwd -P)"
if [ -n "${STUB_RESOLVE:-}" ]; then
  r=$(node -e 'const l=require(process.argv[1]);const r=l.resolveLiveDir();const d=r.base;require("fs").mkdirSync(d,{recursive:true,mode:0o700});require("fs").writeFileSync(d+"/probe-"+process.env.ONOFF_PROBE_TAG+".txt","x");process.stdout.write(d+" source="+r.source)' "$STUB_RESOLVE/scripts/lib/live-state-dir.js")
  echo "resolved=$r"
fi
if [ -n "${STUB_RUN_HELPER:-}" ]; then
  echo "helper=$(node scripts/session-mode.js set --size S)"
fi
if [ -n "${STUB_SKILL_EVENT:-}" ]; then
  printf '{"message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"%s"}}]}}\n' "$STUB_SKILL_EVENT"
fi
STUBEOF
chmod +x "$STUB"
export ONOFF_STUB_BIN="$STUB"

run() { # out-name, then runner args
  local out="$TEST_TMP/$1"; shift
  bash "$BASE/run-skill-onoff-eval.sh" --model stub-model --runner stub --out "$out" "$@" >/dev/null
  echo "$out"
}
kv() { grep -m1 "^$2=" "$1/transcript.jsonl" | cut -d= -f2-; }

echo "=== T1: legacy dev-flow arms byte-identical to the pre-EVALX harness ==="
declare -A GOLD_PLUGIN=( [full]=8f9225b6998e0c7c57ab815207c9c35595e43ba9217490003b91e049350f7620
                         [card]=59eb46f5a907ee0d4025f42c4acd903992ab63e88b4c9113871cec8cd7346759
                         [off]=75a52e6aa823c9867748a74f43d1f6a2733c1d71c6c00a7e09767de6dd01c6cc )
GOLD_REPO_D4=a17b24c491c189da79bcf4a25c2d50ce551a15ac58c95aa96df870b3bbb98e44
GOLD_REPO_D1=a2e459ad3566fa687185ed1cf47d57947e77a9e1c238c735d5f7978950a25e72
for arm in full card off; do
  o=$(run "leg-d4-$arm" --task d4-hotfix --arm $arm)
  [ "$(kv "$o" plugin)" = "${GOLD_PLUGIN[$arm]}" ] || fail "legacy $arm plugin tree drifted from golden"
  [ "$(kv "$o" repo)" = "$GOLD_REPO_D4" ] || fail "legacy d4 repo tree drifted from golden"
  norm=$(sed -E 's/"frozen_base_sha":"[0-9a-f]*"/"frozen_base_sha":"X"/;s/"duration_s":[0-9]+/"duration_s":0/' "$o/result.json")
  want='{"task_id":"d4-hotfix","arm":"'$arm'","model":"stub-model","runner":"stub","runner_version":"null","rep":1,"duration_s":0,"frozen_base_sha":"X","markers":{"f3_hotfix_compound":false},"skill_invoked_devflow":false,"failure_class":null,"failure_cause":null}'
  [ "$norm" = "$want" ] || fail "legacy $arm result row changed: $norm"
done
o=$(run leg-d1-off --task d1-s-tiny-feature --arm off)
[ "$(kv "$o" repo)" = "$GOLD_REPO_D1" ] || fail "legacy d1 repo tree drifted from golden"

echo "=== T2: E1 generic arms ==="
PK="$TEST_TMP/packs"; cp -r "$BASE/packs" "$PK"
export ONOFF_PACKS_DIR="$PK"
# a CHANGE pack = base + one edited line, frozen through the real freeze tool (--from-dir)
mkdir -p "$TEST_TMP/chg"; cp -r "$PK/ceo-agent-base"/. "$TEST_TMP/chg/"
printf '\n<!-- EVAL CHANGE ARM MARKER -->\n' >> "$TEST_TMP/chg/SKILL.md"
node "$BASE/freeze-pack.js" --force --id ceo-agent-change --from-dir "$TEST_TMP/chg" >/dev/null
export STUB_SKILL=ceo-agent
b=$(run gen-base --task d1-s-tiny-feature --skill ceo-agent --arm base)
c=$(run gen-change --task d1-s-tiny-feature --skill ceo-agent --arm change)
[ "$(kv "$b" skill)" != "$(kv "$c" skill)" ] || fail "base and change skill trees identical (variable not applied)"
[ "$(kv "$b" plugin_ex)" = "$(kv "$c" plugin_ex)" ] || fail "arms differ outside skills/ceo-agent (companions/roster must be byte-identical)"
[ "$(kv "$b" repo)" = "$(kv "$c" repo)" ] || fail "fixture repo differs across arms"
cmp -s "$b/prompt.md" "$c/prompt.md" || fail "prompt differs across arms"
grep -q 'EVAL CHANGE ARM MARKER' "$PK/ceo-agent-change/SKILL.md" || fail "test setup: change pack lacks edit"
[ "$(kv "$b" skills)" = "ceo-agent,finish-flow,learn,quality-pipeline" ] || fail "generic arm roster wrong (companions must all be present, no dev-flow): $(kv "$b" skills)"
[ "$(kv "$c" skills)" = "$(kv "$b" skills)" ] || fail "skill roster differs across arms"
[ "$(kv "$b" arm)" = base ] && [ "$(kv "$c" arm)" = change ] || fail "arm env wrong"
# the target skill tree equals the pack exactly (digest of pack dir == digest of plugin skill dir)
want=$(cd "$PK/ceo-agent-base" && find . -type f | LC_ALL=C sort | while read -r f; do printf '%s %s\n' "$f" "$(sha256sum "$f" | cut -d' ' -f1)"; done | sha256sum | cut -d' ' -f1)
[ "$(kv "$b" skill)" = "$want" ] || fail "plugin skills/ceo-agent != frozen pack content"
# dev-flow is NOT silently added; --with-pack adds it identically to both arms
ob=$(run gen-with-b --task d1-s-tiny-feature --skill ceo-agent --arm base --with-pack dev-flow=dev-flow-base)
oc=$(run gen-with-c --task d1-s-tiny-feature --skill ceo-agent --arm change --with-pack dev-flow=dev-flow-base)
[ "$(kv "$ob" plugin_ex)" = "$(kv "$oc" plugin_ex)" ] || fail "--with-pack not identical across arms"
[ "$(kv "$ob" plugin_ex)" != "$(kv "$b" plugin_ex)" ] || fail "--with-pack added nothing"
[ "$(kv "$ob" skills)" = "ceo-agent,dev-flow,finish-flow,learn,quality-pipeline" ] || fail "--with-pack roster wrong: $(kv "$ob" skills)"
# finish-flow as the TARGET replaces the frozen companion copy
export STUB_SKILL=finish-flow
ff=$(run gen-ff --task d1-s-tiny-feature --skill finish-flow --arm base)
ffwant=$(node -e 'const m=require(process.argv[1]);process.stdout.write(m.packs["finish-flow-base"]["finish-flow-base/SKILL.md"])' "$PK/manifest.json")
unset STUB_SKILL
[ -n "$ffwant" ] || fail "finish-flow-base not in manifest"
ffpack=$(cd "$PK/finish-flow-base" && find . -type f | LC_ALL=C sort | while read -r f; do printf '%s %s\n' "$f" "$(sha256sum "$f" | cut -d' ' -f1)"; done | sha256sum | cut -d' ' -f1)
[ "$(kv "$ff" skill)" = "$ffpack" ] || fail "finish-flow target did not replace the frozen companion copy"
[ "$(kv "$ff" skills)" = "finish-flow,learn,quality-pipeline" ] || fail "finish-flow target roster wrong: $(kv "$ff" skills)"
[ "$(kv "$ff" plugin_ex)" != "$(kv "$b" plugin_ex)" ] || fail "finish-flow target arm still carries the companion finish-flow"
# negative paths
expect_rc() { # want-rc label cmd...
  local want="$1" label="$2"; shift 2; set +e; "$@" >/dev/null 2>&1; local rc=$?; set -e
  [ "$rc" -eq "$want" ] || fail "$label: expected rc=$want got $rc"
}
RUNNER=(bash "$BASE/run-skill-onoff-eval.sh" --model m --runner stub --task d1-s-tiny-feature)
expect_rc 2 "base arm without --skill" "${RUNNER[@]}" --arm base --out "$TEST_TMP/x1"
expect_rc 2 "full arm with --skill" "${RUNNER[@]}" --skill ceo-agent --arm full --out "$TEST_TMP/x2"
expect_rc 2 "pack flag without --skill" "${RUNNER[@]}" --arm full --pack-base ceo-agent-base --out "$TEST_TMP/x3"
expect_rc 2 "missing change pack" "${RUNNER[@]}" --skill quality-pipeline --arm change --out "$TEST_TMP/x4"
expect_rc 2 "path-y pack name" "${RUNNER[@]}" --skill ceo-agent --arm base --pack-base ../packs/ceo-agent-base --out "$TEST_TMP/x5"
echo tamper >> "$PK/ceo-agent-base/SKILL.md"
expect_rc 2 "tampered generic pack" "${RUNNER[@]}" --skill ceo-agent --arm base --out "$TEST_TMP/x6"
cp "$BASE/packs/ceo-agent-base/SKILL.md" "$PK/ceo-agent-base/SKILL.md"
printf 'stray' > "$PK/ceo-agent-base/UNLISTED.md"
expect_rc 2 "unlisted file in pack" "${RUNNER[@]}" --skill ceo-agent --arm base --out "$TEST_TMP/x7"
rm "$PK/ceo-agent-base/UNLISTED.md"
expect_rc 0 "restored pack runs" "${RUNNER[@]}" --skill ceo-agent --arm base --out "$TEST_TMP/x8"
expect_rc 2 "freeze-pack refuses existing id" node "$BASE/freeze-pack.js" --id ceo-agent-base --from-dir "$TEST_TMP/chg"
echo "=== T3: E2 live packs equal their freeze ref; historical pack untouched ==="
node -e '
  const m=require(process.argv[1]);
  for (const id of ["ceo-agent-base","finish-flow-base","dev-flow-base","fixture-scripts-base"])
    if (!m.packs[id] || !m.pack_meta[id] || !/^[0-9a-f]{40}$/.test(m.pack_meta[id].ref)) { console.error("missing/unrefd pack: "+id); process.exit(1); }
  if (m.packs["dev-flow-full"]["dev-flow-full/SKILL.md"] !== "782d234c6f7b142f77249fdc1e38cb6c980b39beb4546232f92c9d8f3bd11cf5") { console.error("historical dev-flow-full digest changed"); process.exit(1); }
  if (m.packs["dev-flow-base"]["dev-flow-base/SKILL.md"] === m.packs["dev-flow-full"]["dev-flow-full/SKILL.md"]) { console.error("dev-flow-base == historical freeze (not refreshed)"); process.exit(1); }
' "$BASE/packs/manifest.json" || fail "manifest pack set"
for pair in "ceo-agent-base:ceo-agent" "finish-flow-base:finish-flow" "dev-flow-base:dev-flow"; do
  id=${pair%%:*}; sk=${pair##*:}
  ref=$(node -e 'process.stdout.write(require(process.argv[1]).pack_meta[process.argv[2]].ref)' "$BASE/packs/manifest.json" "$id")
  if git -C "$REPO_ROOT" cat-file -e "$ref^{commit}" 2>/dev/null; then
    while IFS= read -r f; do
      rel=${f#skills/$sk/}
      git -C "$REPO_ROOT" show "$ref:$f" | cmp -s - "$BASE/packs/$id/$rel" || fail "$id/$rel != git show $ref:$f"
    done < <(git -C "$REPO_ROOT" ls-tree -r --name-only "$ref" "skills/$sk/")
  else
    echo "SKIP: freeze ref $ref not present in this clone (digest check below still applies)"
  fi
  bash "$BASE/run-skill-onoff-eval.sh" --model m --runner stub --task d1-s-tiny-feature --skill "$sk" --arm base --pack-base "$id" --out "$TEST_TMP/live-$id" >/dev/null \
    || fail "live pack $id fails digest verification"
done

echo "=== T4: E3 fixture scripts (frozen subset, both arms, in the base commit) ==="
unset STUB_SKILL
fb=$(run fs-b --task d1-s-tiny-feature --skill ceo-agent --arm base --fixture-scripts fixture-scripts-base)
fc=$(run fs-c --task d1-s-tiny-feature --skill ceo-agent --arm change --fixture-scripts fixture-scripts-base)
n=$(find "$BASE/packs/fixture-scripts-base" -type f | wc -l)
[ "$(kv "$fb" tracked_scripts)" = "$n" ] && [ "$(kv "$fc" tracked_scripts)" = "$n" ] || fail "fixture scripts not committed into the base commit of both arms"
[ "$(kv "$fb" dirty)" = 0 ] || fail "fixture repo dirty after scripts copy"
[ "$(kv "$fb" repo)" = "$(kv "$fc" repo)" ] || fail "fixture repo differs across arms with scripts"
plain=$(run fs-none --task d1-s-tiny-feature --skill ceo-agent --arm base)
[ "$(kv "$plain" repo)" != "$(kv "$fb" repo)" ] || fail "--fixture-scripts changed nothing"
for f in validate-json-schema.js decision-ledger.js run-ledger.sh lib/jsonl-store.js; do
  node -e 'const m=require(process.argv[1]).packs["fixture-scripts-base"];if(!m["fixture-scripts-base/scripts/"+process.argv[2]])process.exit(1)' "$BASE/packs/manifest.json" "$f" || fail "manifest lacks fixture script $f"
done
# pluggable helper pack: a stub session-mode.js stands in for a pack-provided helper
mkdir -p "$TEST_TMP/helperpack/scripts"
printf '#!/usr/bin/env node\nconsole.log("stub-helper:" + process.argv.slice(2).join(" "));\n' > "$TEST_TMP/helperpack/scripts/session-mode.js"
node "$BASE/freeze-pack.js" --id fixture-scripts-stubhelper --from-dir "$TEST_TMP/helperpack" >/dev/null
export STUB_RUN_HELPER=1
hb=$(run helper-b --task d1-s-tiny-feature --skill ceo-agent --arm base --fixture-scripts fixture-scripts-stubhelper)
hc=$(run helper-c --task d1-s-tiny-feature --skill ceo-agent --arm change --fixture-scripts fixture-scripts-stubhelper)
unset STUB_RUN_HELPER
[ "$(kv "$hb" helper)" = "stub-helper:set --size S" ] && [ "$(kv "$hc" helper)" = "stub-helper:set --size S" ] \
  || fail "pack-provided helper not runnable in the fixture of both arms"
echo tamper >> "$PK/fixture-scripts-stubhelper/scripts/session-mode.js"
expect_rc 2 "tampered fixture-scripts pack" "${RUNNER[@]}" --skill ceo-agent --arm base --fixture-scripts fixture-scripts-stubhelper --out "$TEST_TMP/x9"

echo "=== T5: E4 per-cell isolation ==="
if [ -z "$FAKE_XDG" ]; then
  echo "SKIP T5 resolver legs: no writable /dev/shm (tmpfs) on this host"
else
  export STUB_RESOLVE="$REPO_ROOT"
  i1=$(run iso-1 --task d1-s-tiny-feature --skill ceo-agent --arm base)
  i2=$(run iso-2 --task d1-s-tiny-feature --skill ceo-agent --arm change)
  unset STUB_RESOLVE
  for k in live taskstatus; do
    [ "$(kv "$i1" $k)" != unset ] || fail "AUTOPILOT env for $k not exported to the cell"
  done
  [ "$(kv "$i1" ledger_env)" = unset ] || fail "AUTOPILOT_LEDGER_DIR must not be exported (no consumer; default ledger is repo-local)"
  case "$(kv "$i1" ledger_default)" in "$(kv "$i1" cwd)"/*) ;; *) fail "default ledger path is not inside the cell's fixture repo: $(kv "$i1" ledger_default)" ;; esac
  [ "$(kv "$i1" live)" != "$(kv "$i2" live)" ] || fail "two cells share a live dir"
  [ "$(kv "$i1" resolved)" = "$(kv "$i1" live) source=override" ] || fail "resolveLiveDir() did not land on the per-cell dir (override rejected -> would hit the real store)"
  case "$(kv "$i1" live)" in "$FAKE_XDG"/autopilot*|"$HOME"/.autopilot*|/run/user/*/autopilot*) fail "cell live dir is a real-store path" ;; esac
  [ -f "$i1/state/live/probe-$PROBE_TAG.txt" ] || fail "cell state not copied to \$OUT/state (evidence)"
  [ ! -e "$FAKE_XDG/autopilot" ] || fail "cell wrote into the (fake) shared live dir"
  # mutation: drop the live-dir export from a runner copy -> the stub reaches the fake shared store
  mkdir -p "$TEST_TMP/mutant/evals"; cp -r "$BASE" "$TEST_TMP/mutant/evals/skill-onoff"; MUT="$TEST_TMP/mutant/evals/skill-onoff/run-skill-onoff-eval.sh"; sed -i 's/^export AUTOPILOT_LIVE_DIR=.*$/export AUTOPILOT_TASK_STATUS_DIR="$CELL_STATE\/task-status"/' "$MUT"
  grep -q 'AUTOPILOT_LIVE_DIR' <(sed -n '/^export AUTOPILOT/,/^cleanup/p' "$MUT") && fail "mutation did not apply"
  env -u AUTOPILOT_LIVE_DIR STUB_RESOLVE="$REPO_ROOT" ONOFF_PACKS_DIR="$BASE/packs" bash "$MUT" --task d1-s-tiny-feature --arm off --model m --runner stub --out "$TEST_TMP/iso-mut" >/dev/null
  [ -f "$FAKE_XDG/autopilot/probe-$PROBE_TAG.txt" ] || fail "mutation control: removing the export did not reach the shared store (isolation check cannot fail)"
  rm -rf "$FAKE_XDG/autopilot"
fi

# fail closed: no usable tmpfs base (no /dev/shm dependency: every candidate unset or unwritable)
( unset XDG_RUNTIME_DIR ONOFF_STATE_BASE; export ONOFF_SHM_DIR=/nonexistent-onoff-shm
  expect_rc 2 "no tmpfs base fails closed" "${RUNNER[@]}" --skill ceo-agent --arm base --out "$TEST_TMP/failclosed" )
case "$(stat -f -c %T "$TEST_TMP")" in
  tmpfs|ramfs) echo "SKIP: TEST_TMP is tmpfs here; the non-tmpfs ONOFF_STATE_BASE probe needs a non-tmpfs dir" ;;
  *) ( unset XDG_RUNTIME_DIR; export ONOFF_STATE_BASE="$TEST_TMP" ONOFF_SHM_DIR=/nonexistent-onoff-shm
       expect_rc 2 "non-tmpfs ONOFF_STATE_BASE fails closed" "${RUNNER[@]}" --skill ceo-agent --arm base --out "$TEST_TMP/failclosed2" ) ;;
esac
echo "=== T6: E5 manipulation check ==="
export STUB_SKILL_EVENT=ceo-agent
s1=$(run e5-on --task d1-s-tiny-feature --skill ceo-agent --arm base)
unset STUB_SKILL_EVENT
s2=$(run e5-off --task d1-s-tiny-feature --skill ceo-agent --arm change)
grep -q '"skill_invoked":true,"check_skill":"ceo-agent"' "$s1/result.json" || fail "skill_invoked not true when Skill(ceo-agent) event present"
grep -q '"skill_invoked":false,"check_skill":"ceo-agent"' "$s2/result.json" || fail "skill_invoked not false without the event"
grep -q 'skill_invoked_devflow' "$s1/result.json" && fail "generic row still carries the dev-flow-only field"
export STUB_SKILL_EVENT=dev-flow
s3=$(run e5-legacy --task d1-s-tiny-feature --arm full)
unset STUB_SKILL_EVENT
grep -q '"skill_invoked_devflow":true' "$s3/result.json" || fail "legacy arm lost skill_invoked_devflow"
export STUB_SKILL_EVENT=finish-flow
s4=$(run e5-flag --task d1-s-tiny-feature --arm full --check-skill finish-flow)
unset STUB_SKILL_EVENT
grep -q '"skill_invoked":true,"check_skill":"finish-flow"' "$s4/result.json" || fail "--check-skill flag on a legacy arm"

echo "=== T7: matrix passthrough + resume ==="
RES="$TEST_TMP/matrix.jsonl"
bash "$BASE/run-skill-onoff-matrix.sh" --model m --reps 2 --results "$RES" --tasks d1-s-tiny-feature --runner stub \
  --skill ceo-agent --fixture-scripts fixture-scripts-base >/dev/null
[ "$(wc -l < "$RES")" = 4 ] || fail "matrix did not run base,change x 2 reps (got $(wc -l < "$RES"))"
grep -q '"arm":"base"' "$RES" && grep -q '"arm":"change"' "$RES" && ! grep -q '"arm":"full"' "$RES" || fail "matrix default arms for --skill must be base,change"
out=$(bash "$BASE/run-skill-onoff-matrix.sh" --model m --reps 2 --results "$RES" --tasks d1-s-tiny-feature --runner stub --skill ceo-agent --fixture-scripts fixture-scripts-base)
grep -q 'ran=0 skipped(done)=4' <<<"$out" || fail "matrix did not resume by cell: $out"
RES2="$TEST_TMP/matrix-legacy.jsonl"
bash "$BASE/run-skill-onoff-matrix.sh" --model m --reps 1 --results "$RES2" --tasks d1-s-tiny-feature --runner stub >/dev/null
[ "$(wc -l < "$RES2")" = 3 ] || fail "legacy matrix default arms changed (want full,card,off)"

echo "=== amend-2: ONOFF_PROMPT_PREFIX is prepended identically in both arms; unset = task.md verbatim ==="
export STUB_SKILL=ceo-agent
pb=$(ONOFF_PROMPT_PREFIX="CEO mode — 全權處理:" run pfx-base --task d1-s-tiny-feature --skill ceo-agent --arm base)
pc=$(ONOFF_PROMPT_PREFIX="CEO mode — 全權處理:" run pfx-change --task d1-s-tiny-feature --skill ceo-agent --arm change)
pn=$(run pfx-none --task d1-s-tiny-feature --skill ceo-agent --arm base)
cmp -s "$pb/prompt.md" "$pc/prompt.md" || fail "prefixed prompt differs across arms"
[ "$(head -1 "$pb/prompt.md")" = "CEO mode — 全權處理:" ] || fail "prefix not first line"
cmp -s "$pn/prompt.md" "$BASE/tasks/d1-s-tiny-feature/task.md" || fail "unset prefix changed the prompt"
tail -n +3 "$pb/prompt.md" | cmp -s - "$BASE/tasks/d1-s-tiny-feature/task.md" || fail "prefixed prompt body != task.md"

echo "=== the real stores were never touched ==="
[ "$(real_token_hits)" = 0 ] || fail "a cell wrote its probe into the REAL live store"
[ "$(real_snap)" = "$REAL_BEFORE" ] || fail "real /run/user/<uid>/autopilot or ~/.autopilot root changed during the test (inode/mtime diff)"

echo "PASS: skill-onoff generic harness (E1-E5)"
