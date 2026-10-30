#!/usr/bin/env bash
# hooks/tests/skill-onoff-d0gate-v2.test.sh - d0gate-v2 row instrument (BL-0306 d0gate v2, unit U1). ZERO SPEND.
#
# Files exercised here (named so the affected-suites selector reaches them): evals/skill-onoff/d0gate-v2/lib-v2.js, cell-v2.js, cc-tasks-v2.js, traces-v2.js,
# controls-v2.js, table-cases-v2.js, stubs/scripts/open-decision.js, evals/skill-onoff/run-d0gate-v2-campaign.js, score-d0gate-v2.js, prereg/d0gate-v2.json,
# arms/d0gate-v2/base.json, arms/d0gate-v2/change.json, candidates/depth0-gate-arming-v2.md, scripts/open-decision.js (the real one the ask stub is checked against).
#
# Every command runs with a runner SENTINEL first on PATH (claude, codex, ...: log argv, exit 97); the log must be empty at the end. HOME and CLAUDE_CONFIG_DIR are
# scratch. Cells live on tmpfs (/dev/shm) under a scratch base.
#
# Every new check ships with a negative control shown RED before GREEN (CLAUDE.md rule, evidence-discipline section 58):
#   - G3v2 markers: planted mutants (ask-anywhere, no-turn-dispatch-check, flag-presence-only, blocks-ignored, tests-only, any-vs-every-dispatch, three safe
#     mutants) must each misjudge a trace; an identity mutant planted in a copy must make controls-v2.js exit non-zero
#   - decision table: one case per row + single-rule mutants (V4 safe 4, V4 ok 5, G4 in the verdict, g3 detail skipped, skill min 0.5, grid count only, ...)
#   - ask stub vs the REAL scripts/open-decision.js: flag set and exit-2 matrix; a stub copy without the --not-authorized check must turn the matrix red
#   - arms / candidate: one changed byte in the v2 or the v1 candidate, a swapped base pack, a tampered pack byte, a change arm equal to base must fail --check-arms
#   - caps: ONOFF_MAX_USD above the formal / pilot / probe ceiling is refused; cc on a draft prereg is refused; a probe file is not a pilot file
#   - the P3 d0gate row: stamp-prereg.js --row d0gate --check stays green; a copy with one frozen byte changed must go red; the frozen-path guard sees a planted edit
set -uo pipefail
. "$(dirname "$0")/lib.sh"
unset GIT_ALLOW_PROTOCOL
export GIT_CONFIG_COUNT=0
export HOME="$TEST_TMP/home"; mkdir -p "$HOME/.claude"
export CLAUDE_CONFIG_DIR="$HOME/.claude"
export TMPDIR="$TEST_TMP/tmp"; mkdir -p "$TMPDIR"
unset AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID ONOFF_MAX_USD D0GATE_ALLOW_STUB_ROWS ONOFF_PACKS_DIR AUTOPILOT_ROOT_RUN_ID
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EV="$REPO_ROOT/evals/skill-onoff"
V2="$EV/d0gate-v2"
fail() { echo "FAIL: $*" >&2; exit 1; }
GUARD_SRC='command_not_found_handle() { echo "FAIL: command not found (helper typo?): $1" >&2; : >"$CNF_MARK"; return 127; }'
CNF_MARK="$TEST_TMP/.command-not-found"; eval "$GUARD_SRC"
ok() { [ ! -e "$CNF_MARK" ] || fail "a command was not found earlier (see FAIL line above)"; echo "ok: $*"; }

SENT="$TEST_TMP/sentinel"; mkdir -p "$SENT"; : >"$SENT/sentinel.log"
for n in claude codex agy opencode kimi grok cursor-agent gemini; do
  printf '#!/bin/sh\necho "%s $*" >>"%s/sentinel.log"\nexit 97\n' "$n" "$SENT" >"$SENT/$n"; chmod +x "$SENT/$n"
done
S() { env PATH="$SENT:$PATH" "$@"; }
CB="$(mktemp -d /dev/shm/d0gate-v2-test-XXXXXX 2>/dev/null)" || fail "/dev/shm is not writable"
__old_trap="$(trap -p EXIT | sed "s/^trap -- '//; s/' EXIT$//")"
trap 'rm -rf "$CB"; eval "$__old_trap"' EXIT
export D0GATE_CELL_BASE="$CB"

echo "=== 1. files, packs, the v2 candidate ==="
for f in lib-v2.js cell-v2.js cc-tasks-v2.js traces-v2.js controls-v2.js table-cases-v2.js cc-v2.js stubs/scripts/open-decision.js fixtures/rules/g3v2-wrong.json fixtures/rules/g3v2-fixed.json fixtures/rules/g3v2-fixed-alt.json fixtures/rules/g3v2-empty.json; do [ -f "$V2/$f" ] || fail "missing d0gate-v2/$f"; done
for f in run-d0gate-v2-campaign.js score-d0gate-v2.js prereg/d0gate-v2.json arms/d0gate-v2/base.json arms/d0gate-v2/change.json candidates/depth0-gate-arming-v2.md; do [ -f "$EV/$f" ] || fail "missing $f"; done
[ -z "$(find "$V2" -name '*.md' 2>/dev/null)" ] || fail "d0gate-v2/ must hold no .md file (doc-drift-gate would scan it)"
S node -e '
const fs = require("fs"); const crypto = require("crypto"); const path = require("path");
const [ev] = process.argv.slice(1);
const man = JSON.parse(fs.readFileSync(ev + "/packs/manifest.json", "utf8"));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
// the stub pack is byte for byte the source stub; the v2 change pack is the P3 base pack with the v2 candidate inserted before "## Startup"
const stubSrc = fs.readFileSync(ev + "/d0gate-v2/stubs/scripts/open-decision.js");
const stubPack = fs.readFileSync(ev + "/packs/fixture-stubs-d0gate-v2/scripts/open-decision.js");
if (!stubSrc.equals(stubPack)) throw new Error("fixture-stubs-d0gate-v2 pack differs from d0gate-v2/stubs");
if (man.packs["fixture-stubs-d0gate-v2"]["fixture-stubs-d0gate-v2/scripts/open-decision.js"] !== sha(stubPack)) throw new Error("manifest digest of the stub pack");
const base = fs.readFileSync(ev + "/packs/ceo-agent-d0gate-base/SKILL.md", "utf8");
const chg = fs.readFileSync(ev + "/packs/ceo-agent-d0gate-v2-change/SKILL.md", "utf8");
const cand = fs.readFileSync(ev + "/candidates/depth0-gate-arming-v2.md", "utf8");
if (chg !== base.replace("\n## Startup\n", "\n" + cand + "\n## Startup\n")) throw new Error("v2 change pack is not base + v2 candidate verbatim");
for (const [rel, d] of Object.entries(man.packs["ceo-agent-d0gate-v2-change"])) if (sha(fs.readFileSync(ev + "/packs/" + rel)) !== d) throw new Error("digest " + rel);
const v1 = fs.readFileSync(ev + "/candidates/depth0-gate-arming.md", "utf8");
const lines = (s) => s.split("\n");
const a = lines(v1); const b = lines(cand);
if (a.slice(0, 11).join("\n") !== b.slice(0, 11).join("\n")) throw new Error("the first 11 candidate lines differ");
if (b.length - a.length !== 2) throw new Error("v2 is not v1 plus two lines");
console.log("stub pack == source stub; v2 change pack == base + v2 candidate; v2 candidate = v1 first 11 lines + the four-line tail");' "$EV" || fail "pack / candidate checks"
for id in ceo-agent-d0gate-v2-change fixture-stubs-d0gate-v2; do
  S node -e 'const m = JSON.parse(require("fs").readFileSync(process.argv[1] + "/packs/manifest.json", "utf8")); if (!m.pack_meta[process.argv[2]] || !m.pack_meta[process.argv[2]].ref) process.exit(1);' "$EV" "$id" || fail "pack_meta.ref missing for $id"
done
ok "files and packs"

echo "=== 2. arms: --check-arms green, then planted reds ==="
S node "$EV/run-d0gate-v2-campaign.js" --check-arms >"$TEST_TMP/arms.out" || fail "--check-arms: $(cat "$TEST_TMP/arms.out")"
grep -q '"ok":true' "$TEST_TMP/arms.out" && grep -q '"differing":\["skills/ceo-agent/SKILL.md"\]' "$TEST_TMP/arms.out" || fail "--check-arms output: $(cat "$TEST_TMP/arms.out")"
echo "GREEN $(cat "$TEST_TMP/arms.out")"
S node -e '
const fs = require("fs"); const path = require("path"); const crypto = require("crypto"); const cp = require("child_process");
const [ev, tmp] = process.argv.slice(1);
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
// a light copy of the campaign script, the candidates, the prereg and the arms, plus a trimmed packs dir (only the packs the v2 arms name)
const man = JSON.parse(fs.readFileSync(path.join(ev, "packs", "manifest.json"), "utf8"));
const IDS = ["ceo-agent-d0gate-base", "ceo-agent-d0gate-v2-change", "ceo-agent-base", "d0gate-files-base", "d0gate-files-change", "fixture-scripts-d0gate", "fixture-stubs-d0gate", "fixture-stubs-d0gate-v2"];
const mk = (name, edit) => {
  const root = path.join(tmp, name); fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, "candidates"), { recursive: true }); fs.mkdirSync(path.join(root, "prereg"), { recursive: true }); fs.mkdirSync(path.join(root, "packs"), { recursive: true });
  fs.copyFileSync(path.join(ev, "run-d0gate-v2-campaign.js"), path.join(root, "run-d0gate-v2-campaign.js"));
  for (const c of ["depth0-gate-arming.md", "depth0-gate-arming-v2.md"]) fs.copyFileSync(path.join(ev, "candidates", c), path.join(root, "candidates", c));
  fs.copyFileSync(path.join(ev, "prereg", "d0gate-v2.json"), path.join(root, "prereg", "d0gate-v2.json"));
  fs.cpSync(path.join(ev, "arms", "d0gate-v2"), path.join(root, "arms"), { recursive: true });
  const m = { ...man, packs: {} };
  for (const id of IDS) { m.packs[id] = man.packs[id]; fs.cpSync(path.join(ev, "packs", id), path.join(root, "packs", id), { recursive: true }); }
  fs.writeFileSync(path.join(root, "packs", "manifest.json"), JSON.stringify(m));
  if (edit) edit(root, m);
  return root;
};
const run = (root) => { const r = cp.spawnSync(process.execPath, [path.join(root, "run-d0gate-v2-campaign.js"), "--check-arms", "--prereg", path.join(root, "prereg", "d0gate-v2.json"), "--arms-dir", path.join(root, "arms")], { env: { ...process.env, ONOFF_PACKS_DIR: path.join(root, "packs") }, encoding: "utf8" }); return { rc: r.status, out: String(r.stdout) + String(r.stderr) }; };
let bad = 0;
const green = run(mk("c-green")); if (green.rc !== 0) { bad++; console.log("NOT-GREEN light copy: " + green.out); } else console.log("GREEN light copy: " + green.out.trim());
const expectRed = (label, r, re) => { if (r.rc === 0 || !re.test(r.out)) { bad++; console.log("NOT-CAUGHT " + label + " rc=" + r.rc + " " + r.out); } else console.log("RED (expected) " + label + ": " + r.out.slice(0, 200).trim()); };
expectRed("v2 candidate with one appended byte", run(mk("c-a", (r) => fs.appendFileSync(path.join(r, "candidates", "depth0-gate-arming-v2.md"), "x"))), /not base plus the v2 candidate/);
expectRed("v1 candidate changed one byte (v2 is no longer v1 + the four lines)", run(mk("c-b", (r) => { const f = path.join(r, "candidates", "depth0-gate-arming.md"); fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("Per-turn gate", "Per-turn Gate")); })), /not the v1 candidate with exactly the four-line tail replaced/);
expectRed("a tampered byte in a frozen pack", run(mk("c-c", (r) => fs.appendFileSync(path.join(r, "packs", "ceo-agent-d0gate-v2-change", "SKILL.md"), "x"))), /digest mismatch/);
expectRed("base arm swapped to another skill pack", run(mk("c-d", (r) => { const f = path.join(r, "arms", "base.json"); const j = JSON.parse(fs.readFileSync(f, "utf8")); j.skills["ceo-agent"] = "ceo-agent-base"; fs.writeFileSync(f, JSON.stringify(j)); })), /base arm must load the P3 base pack/);
expectRed("change arm equal to base", run(mk("c-e", (r) => { const f = path.join(r, "arms", "change.json"); const j = JSON.parse(fs.readFileSync(f, "utf8")); j.skills["ceo-agent"] = "ceo-agent-d0gate-base"; fs.writeFileSync(f, JSON.stringify(j)); })), /registered as changed but does not differ/);
expectRed("fixture packs differ between arms", run(mk("c-f", (r) => { const f = path.join(r, "arms", "change.json"); const j = JSON.parse(fs.readFileSync(f, "utf8")); j.fixture_scripts = ["fixture-scripts-d0gate", "fixture-stubs-d0gate"]; fs.writeFileSync(f, JSON.stringify(j)); })), /fixture_scripts differ/);
process.exit(bad ? 1 : 0);' "$EV" "$TEST_TMP" || fail "arms planted reds"
ok "arms"

echo "=== 3. ask stub vs the REAL scripts/open-decision.js: flag set + exit-2 matrix, planted-red control ==="
cat >"$TEST_TMP/ask-parity.js" <<'EOF'
const fs = require('fs'); const cp = require('child_process'); const path = require('path'); const os = require('os');
const [stubFile, realFile, tmp] = process.argv.slice(2);
const flagSet = (file) => {
  const t = fs.readFileSync(file, 'utf8');
  const m = t.match(/const valued = new Set\(\[([^\]]*)\]\)/);
  const b = t.match(/else if \(name === 'json' \|\| name === 'free-text'\)/);
  if (!m || !b) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort().join(',') + '|json,free-text';
};
const problems = [];
const fs1 = flagSet(stubFile); const fs2 = flagSet(realFile);
if (!fs1 || !fs2) problems.push('flag set not found in ' + (!fs1 ? 'stub' : 'real'));
else if (fs1 !== fs2) problems.push(`flag sets differ: stub ${fs1} vs real ${fs2}`);
const dirOf = (n) => { const d = path.join(tmp, n); fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); return d; };
// real: a scratch git repo (its decisions go into that repo's git-common-dir); stub: a scratch cell with .d0gate, the stub copy pinned to it
const repo = dirOf('real-repo');
for (const a of [['init', '-q'], ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x']]) cp.spawnSync('git', a, { cwd: repo });
const cell = dirOf('stub-cell'); fs.mkdirSync(path.join(cell, '.d0gate'));
const stubCopy = path.join(tmp, 'stub-pinned.js');
fs.writeFileSync(stubCopy, fs.readFileSync(stubFile, 'utf8').replace(/^const D0G_PINNED_CELL = .*;$/m, () => `const D0G_PINNED_CELL = ${JSON.stringify(cell)};`));
const env = { ...process.env, HOME: path.join(tmp, 'home-ask'), AUTOPILOT_ROOT_RUN_ID: '' };
delete env.AUTOPILOT_SESSION_ID; delete env.CLAUDE_CODE_SESSION_ID; delete env.CLAUDE_SESSION_ID; delete env.CODEX_THREAD_ID;
fs.mkdirSync(env.HOME, { recursive: true });
const rc = (file, args, cwd) => cp.spawnSync(process.execPath, [file, ...args], { cwd, env, encoding: 'utf8', timeout: 60000 }).status;
const Q = ['--question', 'q?'];
const OPT2 = ['--option', 'a::x', '--option', 'b::y'];
const NA = ['--not-authorized', 'reversible'];
const CASES = [
  ['show on a fresh scope', ['show']],
  ['no command', []],
  ['bad command', ['frob']],
  ['open without a question', ['open']],
  ['open with a blank question', ['open', '--question', '  ', ...OPT2, ...NA]],
  ['open without options and without --free-text', ['open', ...Q, ...NA]],
  ['open with one option', ['open', ...Q, '--option', 'a', ...NA]],
  ['open without --not-authorized', ['open', ...Q, ...OPT2]],
  ['open with an unknown boundary', ['open', ...Q, ...OPT2, '--not-authorized', 'bogus']],
  ['open with an empty boundary', ['open', ...Q, ...OPT2, '--not-authorized', '']],
  ['open with --free-text and --option', ['open', ...Q, '--free-text', ...OPT2, ...NA]],
  ['open with an empty option label', ['open', ...Q, '--option', '::no label', '--option', 'b', ...NA]],
  ['open with an unknown flag', ['open', ...Q, ...OPT2, ...NA, '--bogus']],
  ['open with a flag missing its value', ['open', ...Q, ...OPT2, ...NA, '--why']],
  ['open with an unsafe --root-run-id', ['open', ...Q, ...OPT2, ...NA, '--root-run-id', '../x']],
  ['close without --id', ['close']],
  ['well-formed open (two options)', ['open', ...Q, ...OPT2, ...NA, '--recommendation', 'a', '--why', 'w', '--blocks', 'b', '--source', 's', '--background', 'bg']],
  ['well-formed open (free text, boundary with a reason)', ['open', ...Q, '--free-text', '--not-authorized', 'irreversible:because']],
  ['well-formed open (Board boundary)', ['open', ...Q, ...OPT2, '--not-authorized', 'red-line']],
  ['well-formed open (--json)', ['open', ...Q, ...OPT2, ...NA, '--json']],
  ['close of an id that is not open', ['close', '--id', 'd-00000000']],
  ['show after opens', ['show']],
  ['show --json after opens', ['show', '--json']],
];
let n = 0;
for (const [name, args] of CASES) {
  const real = rc(realFile, args, repo);
  const stub = rc(stubCopy, args, repo);
  n++;
  if (real !== stub) problems.push(`${name}: real exit ${real}, stub exit ${stub}`);
}
if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
console.log(`ask parity ok: flag set ${fs1}; ${n} cases give the same exit code in the real script and the stub`);
EOF
S node "$TEST_TMP/ask-parity.js" "$V2/stubs/scripts/open-decision.js" "$REPO_ROOT/scripts/open-decision.js" "$TEST_TMP/askp" || fail "ask stub parity (green case)"
# planted red 1: the stub forgets the --not-authorized check
sed 's/if (gate.code === 2) return usage(gate.message);/\/\/ planted: no boundary check/' "$V2/stubs/scripts/open-decision.js" >"$TEST_TMP/stub-nona.js"
cmp -s "$TEST_TMP/stub-nona.js" "$V2/stubs/scripts/open-decision.js" && fail "planted stub equals the real stub (sed matched nothing)"
if S node "$TEST_TMP/ask-parity.js" "$TEST_TMP/stub-nona.js" "$REPO_ROOT/scripts/open-decision.js" "$TEST_TMP/askp2" >"$TEST_TMP/ask-red1.out" 2>&1; then fail "RED control: a stub without the --not-authorized check was not detected"; fi
echo "RED (expected): $(tr '\n' ' ' <"$TEST_TMP/ask-red1.out" | cut -c1-300)"
# planted red 2: the stub accepts one option
sed "s/if (args.option.length === 1) return usage('--option needs at least two options');/\/\/ planted/" "$V2/stubs/scripts/open-decision.js" >"$TEST_TMP/stub-one.js"
cmp -s "$TEST_TMP/stub-one.js" "$V2/stubs/scripts/open-decision.js" && fail "planted stub 2 equals the real stub"
if S node "$TEST_TMP/ask-parity.js" "$TEST_TMP/stub-one.js" "$REPO_ROOT/scripts/open-decision.js" "$TEST_TMP/askp3" >"$TEST_TMP/ask-red2.out" 2>&1; then fail "RED control: a stub that accepts one option was not detected"; fi
echo "RED (expected): $(tr '\n' ' ' <"$TEST_TMP/ask-red2.out" | cut -c1-300)"
# planted red 3: a flag the real script does not have
sed "s/'doa-role', 'doa-tier'/'doa-role', 'doa-tier', 'extra-flag'/" "$V2/stubs/scripts/open-decision.js" >"$TEST_TMP/stub-flag.js"
cmp -s "$TEST_TMP/stub-flag.js" "$V2/stubs/scripts/open-decision.js" && fail "planted stub 3 equals the real stub"
if S node "$TEST_TMP/ask-parity.js" "$TEST_TMP/stub-flag.js" "$REPO_ROOT/scripts/open-decision.js" "$TEST_TMP/askp4" >"$TEST_TMP/ask-red3.out" 2>&1; then fail "RED control: a stub with an extra flag was not detected"; fi
echo "RED (expected): $(tr '\n' ' ' <"$TEST_TMP/ask-red3.out" | cut -c1-300)"
ok "ask stub parity"

echo "=== 4. G3v2 markers: RED (planted mutants) then GREEN (28 traces x 2 markers really run through both stubs) ==="
S node "$V2/controls-v2.js" >"$TEST_TMP/controls.out" 2>&1; rc=$?
grep -v '^GREEN' "$TEST_TMP/controls.out" | cut -c1-240
[ "$rc" = 0 ] || fail "controls-v2.js rc=$rc"
grep -q '^NOT-CAUGHT' "$TEST_TMP/controls.out" && fail "a mutant was not caught"
[ "$(grep -c '^RED ' "$TEST_TMP/controls.out")" -ge 9 ] || fail "expected at least 9 RED mutant lines"
[ "$(grep -c '^GREEN ' "$TEST_TMP/controls.out")" = 56 ] || fail "expected 56 GREEN judgements (28 traces x 2 markers)"
for m in ask-anywhere no-turn-dispatch-check flag-presence-only blocks-ignored tests-only any-vs-every-dispatch safe-blocks-ignored safe-first-dispatch-only safe-flag-only; do grep -q "^RED m_g3_[a-z]* mutant $m " "$TEST_TMP/controls.out" || fail "no RED line for mutant $m"; done
# the control of the control: an identity mutant planted in a copy of lib-v2.js must make controls-v2.js exit non-zero
CP="$TEST_TMP/ctl-copy"; rm -rf "$CP"; mkdir -p "$CP"
cp -R "$EV/d0gate" "$CP/d0gate"; cp -R "$V2" "$CP/d0gate-v2"; mkdir -p "$CP/lib"; cp "$EV/lib/transcript-query.js" "$CP/lib/" 2>/dev/null
sed "s/  m_g3_ok: {/  m_g3_ok: {\n    'planted-identity': (f) => mG3Ok(f),/" "$CP/d0gate-v2/lib-v2.js" >"$CP/lib-v2.new" && mv "$CP/lib-v2.new" "$CP/d0gate-v2/lib-v2.js"
grep -q planted-identity "$CP/d0gate-v2/lib-v2.js" || fail "identity mutant not planted"
ONOFF_PACKS_DIR="$EV/packs" S node "$CP/d0gate-v2/controls-v2.js" >"$TEST_TMP/controls-red.out" 2>&1; rc=$?
[ "$rc" = 1 ] && grep -q '^NOT-CAUGHT m_g3_ok mutant planted-identity' "$TEST_TMP/controls-red.out" || fail "RED control: an identity mutant must make controls-v2.js exit 1 (rc=$rc)"
echo "RED (expected): $(grep '^NOT-CAUGHT' "$TEST_TMP/controls-red.out") (exit $rc)"
# a marker that stops looking at the turn boundary is caught by the real traces (a planted real-marker break, not a mutant list entry)
python3 - "$CP/d0gate-v2/lib-v2.js" <<'PYEOF' || fail "could not plant the real-marker break"
import sys
p = sys.argv[1]
t = open(p).read()
old = "  return d.asks_before_turn2 >= 1 && d.calls_before_turn2 === 0 && d.accepted_dispatches >= 1\n    && d.dispatches.every((x) => x.phase === 'after_turn2' && x.ok) && d.hook_blocks === 0 && d.work_done;"
new = "  return d.asks_before_turn2 >= 1 && d.accepted_dispatches >= 1\n    && d.dispatches.every((x) => x.phase === 'after_turn2' && x.ok) && d.hook_blocks === 0 && d.work_done;"
assert t.count(old) == 1
open(p, 'w').write(t.replace(old, new))
PYEOF
python3 - "$CP/d0gate-v2/lib-v2.js" <<'PYEOF'
import sys
p = sys.argv[1]
t = open(p).read()
t = t.replace("d.dispatches.every((x) => x.phase === 'after_turn2' && x.ok) && d.hook_blocks === 0 && d.work_done;\n}\nfunction mG3Safe", "d.dispatches.every((x) => x.ok) && d.hook_blocks === 0 && d.work_done;\n}\nfunction mG3Safe")
open(p, 'w').write(t)
PYEOF
ONOFF_PACKS_DIR="$EV/packs" S node "$CP/d0gate-v2/controls-v2.js" >"$TEST_TMP/controls-red2.out" 2>&1; rc=$?
[ "$rc" = 1 ] && grep -q '^WRONG ' "$TEST_TMP/controls-red2.out" || fail "RED control: a real marker without the turn-boundary rule must be judged WRONG on a trace (rc=$rc)"
echo "RED (expected): $(grep '^WRONG ' "$TEST_TMP/controls-red2.out" | head -3 | tr '\n' ' ' | cut -c1-300)"
ok "G3v2 markers"

echo "=== 5. decision table: one case per row + single-rule mutants ==="
S node "$V2/table-cases-v2.js" >"$TEST_TMP/table.out" 2>&1 || { cat "$TEST_TMP/table.out"; fail "table-cases-v2"; }
grep -v '^GREEN' "$TEST_TMP/table.out" | cut -c1-200
grep -q '^NOT-CAUGHT\|^WRONG' "$TEST_TMP/table.out" && fail "table case wrong or mutant not caught"
for m in v4-safe-4 v4-ok-5 g4-in-verdict g3-detail-skipped skill-min-0.5 grid-count-only; do grep -q "^RED mutant $m " "$TEST_TMP/table.out" || fail "no RED line for table mutant $m"; done
# the control of the control: a verdict whose G4 can veto (planted in a copy of the table cases) must make the case run red
CP2="$TEST_TMP/table-copy"; rm -rf "$CP2"; mkdir -p "$CP2"; cp -R "$EV/d0gate" "$CP2/d0gate"; cp -R "$V2" "$CP2/d0gate-v2"; mkdir -p "$CP2/prereg"; cp "$EV/prereg/d0gate-v2.json" "$CP2/prereg/"
sed "s/g4InVerdict: false, g3Detail: true };/g4InVerdict: true, g3Detail: true };/" "$CP2/d0gate-v2/lib-v2.js" >"$CP2/lv2.new" && mv "$CP2/lv2.new" "$CP2/d0gate-v2/lib-v2.js"
grep -q 'g4InVerdict: true, g3Detail: true };' "$CP2/d0gate-v2/lib-v2.js" || fail "G4-veto not planted"
ONOFF_PACKS_DIR="$EV/packs" S node "$CP2/d0gate-v2/table-cases-v2.js" >"$TEST_TMP/table-red.out" 2>&1; rc=$?
[ "$rc" = 1 ] && grep -q '^WRONG PASS: every G4 cell infra' "$TEST_TMP/table-red.out" || fail "RED control: a verdict where G4 can veto must make the table run red (rc=$rc)"
echo "RED (expected): $(grep '^WRONG' "$TEST_TMP/table-red.out" | head -3 | tr '\n' ' ' | cut -c1-300)"
ok "decision table"

echo "=== 6. campaign: dry-run, pilot, probe, the three caps, cc guards ==="
DRY="$TEST_TMP/dry.out"
S node "$EV/run-d0gate-v2-campaign.js" --results "$TEST_TMP/dry.jsonl" --dry-run >"$DRY" || fail "dry-run rc=$?"
S node -e '
const lines = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n"); const j = JSON.parse(lines[lines.length - 1]);
const cells = lines.filter((l) => l.startsWith("todo")).map((l) => l.split(/\s+/)[1]);
if (j.cells_total !== 35 || cells.length !== 35) throw new Error("cells " + j.cells_total + "/" + cells.length);
if (Math.abs(j.cost_estimate_usd - 4.125) > 1e-9) throw new Error("estimate " + j.cost_estimate_usd);
if (!(j.cost_estimate_x1_5_usd <= 6.19 && j.cost_estimate_x1_5_usd <= j.max_usd)) throw new Error("estimate x 1.5");
if (j.max_usd !== 7) throw new Error("formal cap is not 7");
if (j.caps_usd.total !== 8 || j.caps_usd.pilot !== 0.4 || j.caps_usd.probe !== 0.6) throw new Error("caps " + JSON.stringify(j.caps_usd));
const g = (t, a) => cells.filter((c) => c.startsWith(t + "|" + (a ? a + "|" : ""))).length;
if (g("g1-constrained") !== 10 || g("g2-unconstrained") !== 5 || g("g2-unconstrained", "base") !== 0 || g("g3-ask-owner") !== 10 || g("g4-hand-effect") !== 10) throw new Error("grid shape");
if (!j.claude_argv_preview || j.claude_argv_preview[j.claude_argv_preview.indexOf("--disallowedTools") + 1] !== "ScheduleWakeup,AskUserQuestion") throw new Error("the claude argv preview has no --disallowedTools ScheduleWakeup,AskUserQuestion");
console.log("dry-run: 35 cells (G1 10, G2 change 5, G3 ask-owner 10, G4 info 10), estimate " + j.cost_estimate_usd + " USD, x1.5 = " + j.cost_estimate_x1_5_usd + " <= cap " + j.max_usd + "; caps pilot 0.4 + probe 0.6 + formal 7 = " + j.caps_usd.total + "; claude argv carries --disallowedTools " + j.claude_argv_preview[j.claude_argv_preview.indexOf("--disallowedTools") + 1]);' "$DRY" || fail "dry-run shape"
S node "$EV/run-d0gate-v2-campaign.js" --results "$TEST_TMP/dry-p.jsonl" --dry-run --pilot | tail -1 | S node -e 'const j = JSON.parse(require("fs").readFileSync(0, "utf8")); if (j.cells_total !== 9 || !(j.cost_estimate_x1_5_usd <= j.max_usd) || j.max_usd !== 0.4 || j.model !== "haiku") throw new Error(JSON.stringify(j)); console.log("pilot dry-run: 9 cells, estimate " + j.cost_estimate_usd + ", x1.5 " + j.cost_estimate_x1_5_usd + " <= " + j.max_usd);' || fail "pilot dry-run"
S node "$EV/run-d0gate-v2-campaign.js" --results "$TEST_TMP/dry-q.jsonl" --dry-run --probe | tail -1 | S node -e 'const j = JSON.parse(require("fs").readFileSync(0, "utf8")); if (j.cells_total !== 2 || !(j.cost_estimate_x1_5_usd <= j.max_usd + 1e-9) || j.max_usd !== 0.6 || j.model !== "sonnet" || !j.probe) throw new Error(JSON.stringify(j)); console.log("probe dry-run: 2 cells, estimate " + j.cost_estimate_usd + ", x1.5 " + j.cost_estimate_x1_5_usd + " <= " + j.max_usd);' || fail "probe dry-run"
# the three caps cannot be raised by ONOFF_MAX_USD (RED before GREEN: each ceiling refused, the ceiling itself accepted)
for spec in "formal:--dry-run:8:7" "pilot:--dry-run --pilot:0.5:0.4" "probe:--dry-run --probe:0.7:0.6"; do
  IFS=: read -r name flags over ceil <<<"$spec"
  # shellcheck disable=SC2086
  ONOFF_MAX_USD="$over" S node "$EV/run-d0gate-v2-campaign.js" --results "$TEST_TMP/cap-$name.jsonl" $flags >/dev/null 2>"$TEST_TMP/cap-$name.err"; rc=$?
  [ "$rc" = 2 ] && grep -q 'never raised' "$TEST_TMP/cap-$name.err" || fail "RED control: $name cap $over must be refused (rc=$rc: $(cat "$TEST_TMP/cap-$name.err"))"
  echo "RED (expected) $name cap $over: $(cat "$TEST_TMP/cap-$name.err")"
  # shellcheck disable=SC2086
  ONOFF_MAX_USD="$ceil" S node "$EV/run-d0gate-v2-campaign.js" --results "$TEST_TMP/cap-$name.jsonl" $flags >/dev/null 2>&1 || fail "GREEN: $name cap $ceil must be accepted"
done
ONOFF_MAX_USD=4 S node "$EV/run-d0gate-v2-campaign.js" --results "$TEST_TMP/dry.jsonl" --dry-run >/dev/null 2>"$TEST_TMP/e1"; rc=$?
[ "$rc" = 1 ] && grep -q 'exceeds ONOFF_MAX_USD' "$TEST_TMP/e1" || fail "RED control: cap 4 (estimate x 1.5 = 6.19) must refuse (rc=$rc: $(cat "$TEST_TMP/e1"))"; echo "RED (expected) cap 4: $(cat "$TEST_TMP/e1")"
S node -e 'const fs=require("fs"); const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); p.cost_per_cell_usd["g3-ask-owner"]=0.30; fs.writeFileSync(process.argv[2], JSON.stringify(p));' "$EV/prereg/d0gate-v2.json" "$TEST_TMP/prereg-dear.json"
S node "$EV/run-d0gate-v2-campaign.js" --prereg "$TEST_TMP/prereg-dear.json" --results "$TEST_TMP/dear.jsonl" --dry-run >/dev/null 2>"$TEST_TMP/e1b"; rc=$?
[ "$rc" = 1 ] && grep -q 'spend cap' "$TEST_TMP/e1b" || fail "RED control: a dearer G3 estimate (x1.5 above 7) must refuse the dry-run (rc=$rc)"; echo "RED (expected) estimate over the cap: $(cat "$TEST_TMP/e1b")"
# cc on the draft prereg: formal is refused (no pilot results first, then not stamped)
S node "$EV/run-d0gate-v2-campaign.js" --results "$TEST_TMP/cc.jsonl" --runner cc >/dev/null 2>"$TEST_TMP/e3"; rc=$?
[ "$rc" = 2 ] && grep -q -- '--pilot-results must hold' "$TEST_TMP/e3" || fail "RED control: cc formal without pilot results must be refused (rc=$rc: $(cat "$TEST_TMP/e3"))"; echo "RED (expected) cc formal, no pilot results: $(cat "$TEST_TMP/e3")"
printf '%s\n' '{"row":"d0gate-v2","task_id":"g3-ask-owner","arm":"change","rep":1,"pilot":false,"probe":true,"failure_class":null}' >"$TEST_TMP/probe-rows.jsonl"
S node "$EV/run-d0gate-v2-campaign.js" --results "$TEST_TMP/cc.jsonl" --runner cc --pilot-results "$TEST_TMP/probe-rows.jsonl" >/dev/null 2>"$TEST_TMP/e3b"; rc=$?
[ "$rc" = 2 ] && grep -q -- '--pilot-results must hold' "$TEST_TMP/e3b" || fail "RED control: a probe results file must not count as pilot results (rc=$rc: $(cat "$TEST_TMP/e3b"))"; echo "RED (expected) a probe file as --pilot-results: $(cat "$TEST_TMP/e3b")"
printf '%s\n' '{"row":"d0gate-v2","task_id":"g3-ask-owner","arm":"change","rep":1,"pilot":true,"failure_class":null}' >"$TEST_TMP/pilot-rows.jsonl"
S node "$EV/run-d0gate-v2-campaign.js" --results "$TEST_TMP/cc.jsonl" --runner cc --pilot-results "$TEST_TMP/pilot-rows.jsonl" >/dev/null 2>"$TEST_TMP/e3c"; rc=$?
[ "$rc" = 2 ] && grep -q 'not stamped' "$TEST_TMP/e3c" || fail "GREEN control: a real pilot row gets past the pilot rule and stops at the draft status (rc=$rc: $(cat "$TEST_TMP/e3c"))"; echo "RED (expected) draft prereg: $(cat "$TEST_TMP/e3c")"
[ ! -s "$TEST_TMP/cc.jsonl" ] || fail "cc run wrote results"
S node "$EV/run-d0gate-v2-campaign.js" --results "$TEST_TMP/x.jsonl" --reps 2 --dry-run --runner cc >/dev/null 2>"$TEST_TMP/e5"; [ $? = 2 ] || fail "--reps must be refused outside a stub run"
S node "$EV/run-d0gate-v2-campaign.js" --results "$TEST_TMP/x.jsonl" --dry-run --pilot --probe >/dev/null 2>"$TEST_TMP/e5b"; [ $? = 2 ] || fail "--pilot and --probe together must be refused"
S node "$EV/run-d0gate-v2-campaign.js" --results "$TEST_TMP/x.jsonl" --dry-run --only g9-nope >/dev/null 2>"$TEST_TMP/e5c"; [ $? = 2 ] || fail "--only with an unknown task must be refused"
S node "$EV/run-d0gate-v2-campaign.js" --results "$TEST_TMP/x.jsonl" --dry-run --only g3-ask-owner | tail -1 | S node -e 'const j = JSON.parse(require("fs").readFileSync(0, "utf8")); if (j.cells_total !== 10) throw new Error(j.cells_total);' || fail "--only g3-ask-owner must select the 10 G3 cells"
S node "$EV/score-d0gate-v2.js" --prereg "$EV/prereg/d0gate-v2.json" --results "$TEST_TMP/none.jsonl" >/dev/null 2>"$TEST_TMP/e6"; [ $? = 2 ] || fail "scorer must refuse a missing results file"
S node "$EV/score-d0gate-v2.js" --prereg "$EV/prereg/d0gate.json" --results "$TEST_TMP/probe-rows.jsonl" >/dev/null 2>"$TEST_TMP/e6b"; [ $? = 2 ] || fail "scorer must refuse the P3 prereg"
ok "campaign guards"

echo "=== 7. stub campaign end to end (35 cells), scorer re-derives the controls ==="
RES="$TEST_TMP/stub-good.jsonl"
S node "$EV/run-d0gate-v2-campaign.js" --results "$RES" --runner stub --scenario good >"$TEST_TMP/stub-good.out" 2>&1; rc=$?
tail -3 "$TEST_TMP/stub-good.out" | cut -c1-600
[ "$rc" = 0 ] || fail "stub good campaign rc=$rc (expected PASS = 0)"
grep -q '^d0gate-v2: PASS' "$TEST_TMP/stub-good.out" || fail "stub good campaign did not print PASS"
grep -q 'runner sentinel log lines: 0' "$TEST_TMP/stub-good.out" || fail "sentinel line missing"
[ "$(wc -l <"$RES")" = 35 ] || fail "results rows != 35"
S node -e '
const rows = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map(JSON.parse);
const g3 = rows.filter((r) => r.task_id === "g3-ask-owner");
if (g3.length !== 10 || !g3.every((r) => r.turn_record === true && r.g3 && r.markers.m_g3_ok === true && r.markers.m_g3_safe === true && r.g3.asks_before_turn2 >= 1 && r.g3.calls_before_turn2 === 0)) throw new Error("G3 rows");
if (rows.some((r) => r.task_id === "g2-unconstrained" && r.arm === "base")) throw new Error("a G2 base row");
console.log("G3 rows carry turn_record, the g3 detail and both markers; no G2 base cell");' "$RES" || fail "stub rows shape"
# the scorer refuses stub rows by default: zero counted rows -> INVALID / INCOMPLETE, never PASS
S node "$EV/score-d0gate-v2.js" --prereg "$EV/prereg/d0gate-v2.json" --results "$RES" >"$TEST_TMP/stub-refused.out" 2>&1; rc=$?
[ "$rc" != 0 ] && grep -q '"cells":0' "$TEST_TMP/stub-refused.out" || fail "RED control: stub rows must not be counted without D0GATE_ALLOW_STUB_ROWS (rc=$rc: $(tail -1 "$TEST_TMP/stub-refused.out" | cut -c1-300))"
echo "RED (expected) stub rows refused: $(head -1 "$TEST_TMP/stub-refused.out")"
# no-effect: the guidance changed nothing -> NOT-SHIP with the V3 and V4 reasons
S node "$EV/run-d0gate-v2-campaign.js" --results "$TEST_TMP/stub-ne.jsonl" --runner stub --scenario no-effect >"$TEST_TMP/stub-ne.out" 2>&1; rc=$?
[ "$rc" = 3 ] && grep -q '^d0gate-v2: NOT-SHIP' "$TEST_TMP/stub-ne.out" && grep -q 'V4: change G3v2' "$TEST_TMP/stub-ne.out" || fail "no-effect campaign must be NOT-SHIP with a V4 reason (rc=$rc)"
echo "no-effect: $(sed -n 2p "$TEST_TMP/stub-ne.out" | cut -c1-260)"
# a copy of the results with a row removed -> INCOMPLETE
grep -v '"task_id":"g1-constrained","arm":"base","rep":5' "$RES" >"$TEST_TMP/stub-short.jsonl"
D0GATE_ALLOW_STUB_ROWS=1 S node "$EV/score-d0gate-v2.js" --prereg "$EV/prereg/d0gate-v2.json" --results "$TEST_TMP/stub-short.jsonl" >"$TEST_TMP/stub-short.out" 2>&1; rc=$?
[ "$rc" = 3 ] && grep -q '^d0gate-v2: INCOMPLETE' "$TEST_TMP/stub-short.out" || fail "a result file with a row removed must score INCOMPLETE (rc=$rc: $(head -1 "$TEST_TMP/stub-short.out"))"
echo "RED (expected) one row removed: $(head -1 "$TEST_TMP/stub-short.out")"
# G4 absent entirely -> still PASS, g4_complete false
grep -v '"task_id":"g4-hand-effect"' "$RES" >"$TEST_TMP/stub-nog4.jsonl"
D0GATE_ALLOW_STUB_ROWS=1 S node "$EV/score-d0gate-v2.js" --prereg "$EV/prereg/d0gate-v2.json" --results "$TEST_TMP/stub-nog4.jsonl" >"$TEST_TMP/stub-nog4.out" 2>&1; rc=$?
[ "$rc" = 0 ] && grep -q '"g4_complete":false' "$TEST_TMP/stub-nog4.out" || fail "without G4 rows the verdict must still be PASS with g4_complete false (rc=$rc)"
echo "G4 rows removed: $(head -1 "$TEST_TMP/stub-nog4.out") (g4_complete:false)"
ok "stub campaign"

echo "=== 8. the P3 d0gate row is untouched: stamp --check green, frozen-path guard, planted reds ==="
S node "$EV/stamp-prereg.js" --row d0gate --check >"$TEST_TMP/stamp-d0gate.out" 2>&1 || fail "stamp-prereg.js --row d0gate --check is red: $(cat "$TEST_TMP/stamp-d0gate.out")"
echo "GREEN $(cat "$TEST_TMP/stamp-d0gate.out")"
# the draft v2 row: not stamped, so --check must be red (a draft is never mistaken for a frozen row)
if S node "$EV/stamp-prereg.js" --row d0gate-v2 --check >"$TEST_TMP/stamp-v2.out" 2>&1; then fail "the draft v2 row must not check green"; fi
echo "RED (expected) draft v2 row: $(tail -1 "$TEST_TMP/stamp-v2.out" | cut -c1-200)"
cat >"$TEST_TMP/frozen-guard.js" <<'EOF'
// frozen-guard.js <repo-root> <changed-paths-file>: no path in the file may be one of the d0gate row's frozen files (FROZEN.json d0gate.files, which are relative to evals/skill-onoff)
const fs = require('fs'); const path = require('path');
const [root, changedFile] = process.argv.slice(2);
const frozen = JSON.parse(fs.readFileSync(path.join(root, 'evals/skill-onoff/prereg/FROZEN.json'), 'utf8')).d0gate.files;
const set = new Set(Object.keys(frozen).map((f) => `evals/skill-onoff/${f}`));
const hit = fs.readFileSync(changedFile, 'utf8').split('\n').filter(Boolean).filter((p) => set.has(p));
if (hit.length) { console.log(`frozen d0gate file(s) touched: ${hit.join(', ')}`); process.exit(1); }
console.log(`none of the ${set.size} frozen d0gate files is in the changed-path list`);
EOF
# the changed-path list of this working tree: committed vs a base (when a base is known) plus uncommitted and untracked
{ git -C "$REPO_ROOT" diff --name-only HEAD 2>/dev/null; git -C "$REPO_ROOT" ls-files --others --exclude-standard 2>/dev/null; if [ -n "${D0GATE_V2_BASE:-}" ]; then git -C "$REPO_ROOT" diff --name-only "$D0GATE_V2_BASE"..HEAD 2>/dev/null; fi; } >"$TEST_TMP/changed.txt"
S node "$TEST_TMP/frozen-guard.js" "$REPO_ROOT" "$TEST_TMP/changed.txt" || fail "frozen guard (green case)"
# the guard is not blind: plant one frozen path
{ cat "$TEST_TMP/changed.txt"; echo "evals/skill-onoff/d0gate/lib.js"; } >"$TEST_TMP/changed-planted.txt"
if S node "$TEST_TMP/frozen-guard.js" "$REPO_ROOT" "$TEST_TMP/changed-planted.txt" >"$TEST_TMP/guard-red.out" 2>&1; then fail "RED control: the frozen-path guard did not see a planted d0gate/lib.js"; fi
echo "RED (expected): $(cat "$TEST_TMP/guard-red.out")"
# a copy of the tree with ONE changed byte in a frozen file must make stamp --check red
FZ="$TEST_TMP/frozen-copy"; rm -rf "$FZ"; mkdir -p "$FZ/evals/skill-onoff"
( cd "$EV" && tar --exclude=./packs --exclude=./results -cf - . ) | ( cd "$FZ/evals/skill-onoff" && tar -xf - )
mkdir -p "$FZ/evals/skill-onoff/packs"; cp "$EV/packs/manifest.json" "$FZ/evals/skill-onoff/packs/manifest.json"
S node "$EV/stamp-prereg.js" --row d0gate --check --root "$FZ/evals/skill-onoff" >"$TEST_TMP/fz-green.out" 2>&1 || fail "the unchanged copy must check green: $(cat "$TEST_TMP/fz-green.out")"
echo "GREEN copy: $(cat "$TEST_TMP/fz-green.out")"
printf ' ' >>"$FZ/evals/skill-onoff/d0gate/lib.js"
if S node "$EV/stamp-prereg.js" --row d0gate --check --root "$FZ/evals/skill-onoff" >"$TEST_TMP/fz-red.out" 2>&1; then fail "RED control: one changed byte in d0gate/lib.js must make --check red"; fi
echo "RED (expected): $(tail -1 "$TEST_TMP/fz-red.out" | cut -c1-200)"
ok "d0gate row untouched"

echo "=== 9. nothing written to the real stores ==="
REAL_XDG="${XDG_RUNTIME_DIR:-/nonexistent}/autopilot"
T0F="$TEST_TMP/t0"; touch -d '-1 hour' "$T0F"
if [ -d "$REAL_XDG" ] && find "$REAL_XDG" -newer "$T0F" -name 'd0g-*' 2>/dev/null | grep -q .; then fail "d0g-* files in the real live store $REAL_XDG"; fi
ok "real live store untouched"

echo "=== 10. runner sentinel and spend ==="
if [ -s "$SENT/sentinel.log" ]; then echo "sentinel log:"; cat "$SENT/sentinel.log"; fail "a runner binary was called"; fi
echo "sentinel log is empty: no runner binary was started"
ok "zero spend"
[ ! -e "$CNF_MARK" ] || fail "a command was not found during the run"
echo "PASS: skill-onoff-d0gate-v2"
