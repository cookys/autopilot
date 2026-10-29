#!/usr/bin/env bash
# hooks/tests/skill-onoff-d0gate.test.sh - d0gate row instrument (BL-0306 P3, unit U1). ZERO SPEND.
#
# Files exercised here (named so the affected-suites selector reaches them): evals/skill-onoff/d0gate/lib.js, cell.js, traces.js, controls.js, cc.js, cc-tasks.js,
# table-cases.js, mutants/hook-mutant.js, stubs/scripts/dispatch-hetero.sh, evals/skill-onoff/run-d0gate-campaign.js, score-d0gate.js.
#
# Every command below runs with a runner SENTINEL first on PATH (claude, codex, agy, opencode, kimi, grok, ...: log argv, exit 97);
# the log must be empty at the end. HOME and CLAUDE_CONFIG_DIR are scratch; the real ~/.claude is never read, and the real
# ~/.autopilot / live store is checked for new d0g-* files at the end. Cells live on tmpfs (/dev/shm) under a scratch base.
#
# Every new check ships with a negative control shown RED before GREEN (CLAUDE.md rule, evidence-discipline section 58):
#   - parity of the stub with the real rail: a planted one-character change of the copied block must fail the check
#   - arms / packs: a tampered pack byte, a second differing file, a change arm that does not differ must fail --check-arms
#   - markers: every planted shortcut mutant must each misjudge a trace (d0gate/controls.js RED phase), then GREEN on every trace
#     that are really run through the stub (impact walk, evidence-discipline section 64)
#   - decision table: one case per condition + single-rule mutants (d0gate/table-cases.js)
#   - campaign guards: cap above the ceiling, estimate x 1.5 above the cap, cc on a draft prereg, cc formal without pilot rows
#   - P4 rehearsal: the candidate paragraph inserted verbatim passes scripts/check-guidance-eval.js; one changed byte fails
set -uo pipefail
. "$(dirname "$0")/lib.sh"
unset GIT_ALLOW_PROTOCOL
export GIT_CONFIG_COUNT=0
export HOME="$TEST_TMP/home"; mkdir -p "$HOME/.claude"
export CLAUDE_CONFIG_DIR="$HOME/.claude"
export TMPDIR="$TEST_TMP/tmp"; mkdir -p "$TMPDIR"
unset AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID ONOFF_MAX_USD D0GATE_ALLOW_STUB_ROWS ONOFF_PACKS_DIR
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EV="$REPO_ROOT/evals/skill-onoff"
D0="$EV/d0gate"
fail() { echo "FAIL: $*" >&2; exit 1; }
# Typo guard: a mistyped helper call such as `ok: text` runs a COMMAND named "ok:" (rc 127) and prints nothing. The handler below
# records every command-not-found; ok() and the last line refuse to pass after one. GUARD_SRC is eval'd here and in its own negative control.
GUARD_SRC='command_not_found_handle() { echo "FAIL: command not found (helper typo?): $1" >&2; : >"$CNF_MARK"; return 127; }'
CNF_MARK="$TEST_TMP/.command-not-found"; eval "$GUARD_SRC"
ok() { [ ! -e "$CNF_MARK" ] || fail "a command was not found earlier (see FAIL line above)"; echo "ok: $*"; }

# runner sentinel (first on PATH for every command through S)
SENT="$TEST_TMP/sentinel"; mkdir -p "$SENT"; : >"$SENT/sentinel.log"
for n in claude codex agy opencode kimi grok cursor-agent gemini; do
  printf '#!/bin/sh\necho "%s $*" >>"%s/sentinel.log"\nexit 97\n' "$n" "$SENT" >"$SENT/$n"; chmod +x "$SENT/$n"
done
S() { env PATH="$SENT:$PATH" "$@"; }
# cells go on tmpfs under a scratch base that this test removes
CB="$(mktemp -d /dev/shm/d0gate-test-XXXXXX 2>/dev/null)" || fail "/dev/shm is not writable"
__old_trap="$(trap -p EXIT | sed "s/^trap -- '//; s/' EXIT$//")"
trap 'rm -rf "$CB"; eval "$__old_trap"' EXIT
export D0GATE_CELL_BASE="$CB"
T0="$TEST_TMP/t0"; touch "$T0"; sleep 1

echo "=== 1. fixtures, packs, base sha ==="
for f in lib.js cell.js traces.js controls.js table-cases.js mutants/hook-mutant.js; do [ -f "$D0/$f" ] || fail "missing d0gate/$f"; done
for f in run-d0gate-campaign.js score-d0gate.js prereg/d0gate.json arms/d0gate/base.json arms/d0gate/change.json candidates/depth0-gate-arming.md; do [ -f "$EV/$f" ] || fail "missing $f"; done
S node -e '
const L = require(process.argv[1]); const fs = require("fs"); const os = require("os"); const path = require("path");
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR, "bs-")); const sha = L.buildTinylib(dir);
const P = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (sha !== P.fixture.base_sha) { console.error("base sha " + sha + " != prereg " + P.fixture.base_sha); process.exit(1); }
const dir2 = fs.mkdtempSync(path.join(process.env.TMPDIR, "bs-")); if (L.buildTinylib(dir2) !== sha) { console.error("base sha is not deterministic"); process.exit(1); }
console.log("base sha " + sha + " is deterministic and equals the prereg value");' "$D0/lib.js" "$EV/prereg/d0gate.json" || fail "base sha"
# the real-script fixture pack equals develop 45edf93da byte for byte
S node -e '
const cp = require("child_process"); const crypto = require("crypto"); const fs = require("fs"); const path = require("path");
const man = JSON.parse(fs.readFileSync(process.argv[1] + "/packs/manifest.json", "utf8"));
let n = 0;
for (const [k, d] of Object.entries(man.packs["fixture-scripts-d0gate"])) {
  const rel = k.replace(/^fixture-scripts-d0gate\//, "");
  const b = cp.execFileSync("git", ["-C", process.argv[2], "show", "45edf93da:" + rel], { maxBuffer: 1 << 26 });
  if (crypto.createHash("sha256").update(b).digest("hex") !== d) { console.error("pack file differs from 45edf93da: " + rel); process.exit(1); }
  n++;
}
console.log("fixture-scripts-d0gate: " + n + " files equal develop 45edf93da");' "$EV" "$REPO_ROOT" || fail "fixture-scripts pack != 45edf93da"
ok "fixtures"

echo "=== 2. stub parity with the real rail (verbatim blocks) + planted-red control ==="
cat >"$TEST_TMP/parity.js" <<'EOF'
const fs = require('fs');
// parity(stubFile, realFile): the real rail's option-parse loop (while ... done) and its --gate-rules refusal block must appear byte for byte in the stub
function between(text, startRe, endLine, from) {
  const lines = text.split('\n');
  const s = lines.findIndex((l) => startRe.test(l));
  if (s < 0) return null;
  const e = lines.findIndex((l, i) => i > s && l === endLine);
  return lines.slice(s, e + 1).join('\n');
}
const stub = fs.readFileSync(process.argv[2], 'utf8');
const real = fs.readFileSync(process.argv[3], 'utf8');
const loop = between(real, /^while \[ \$# -gt 0 \]; do$/, 'done');
const gate = between(real, /^ {2}if \[ -n "\$\{GATE_RULES_FILE:-\}" \]; then$/, '  fi');
const problems = [];
if (!loop || !loop.includes('--gate-rules)')) problems.push('real rail parse loop not found');
else if (!stub.includes(loop)) problems.push('stub does not contain the real option-parse loop verbatim');
if (!gate || !gate.includes('--gate-rules applies only to')) problems.push('real gate-rules block not found');
else if (!stub.includes(gate)) problems.push('stub does not contain the real --gate-rules refusal block verbatim');
if (problems.length) { console.log(problems.join('; ')); process.exit(1); }
console.log('parity ok: parse loop ' + loop.split('\n').length + ' lines, gate block ' + gate.split('\n').length + ' lines');
EOF
S node "$TEST_TMP/parity.js" "$D0/stubs/scripts/dispatch-hetero.sh" "$REPO_ROOT/scripts/dispatch-hetero.sh" || fail "stub parity (green case)"
sed 's/--gate-rules) \[ \$# -ge 2 \]/--gate-rules) [ $# -ge 3 ]/' "$D0/stubs/scripts/dispatch-hetero.sh" >"$TEST_TMP/stub-planted.sh"
cmp -s "$TEST_TMP/stub-planted.sh" "$D0/stubs/scripts/dispatch-hetero.sh" && fail "planted stub equals the real stub (sed matched nothing)"
if S node "$TEST_TMP/parity.js" "$TEST_TMP/stub-planted.sh" "$REPO_ROOT/scripts/dispatch-hetero.sh" >"$TEST_TMP/parity-red.out" 2>&1; then fail "RED control: planted stub change was not detected"; fi
echo "RED (expected): $(cat "$TEST_TMP/parity-red.out")"
ok "stub parity"

echo "=== 3. arms and packs: --check-arms green, then planted reds ==="
S node "$EV/run-d0gate-campaign.js" --check-arms >"$TEST_TMP/arms.out" || fail "--check-arms: $(cat "$TEST_TMP/arms.out")"
grep -q '"ok":true' "$TEST_TMP/arms.out" && grep -q '"differing":\["skills/ceo-agent/SKILL.md"\]' "$TEST_TMP/arms.out" || fail "--check-arms output: $(cat "$TEST_TMP/arms.out")"
echo "GREEN $(cat "$TEST_TMP/arms.out")"
S node -e '
const fs = require("fs"); const path = require("path"); const crypto = require("crypto"); const cp = require("child_process");
const [ev, tmp] = process.argv.slice(1);
const mk = (name) => { const d = path.join(tmp, name); fs.rmSync(d, { recursive: true, force: true }); fs.cpSync(path.join(ev, "packs"), d, { recursive: true }); return d; };
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const run = (packs, armsDir) => { const r = cp.spawnSync(process.execPath, [path.join(ev, "run-d0gate-campaign.js"), "--check-arms", ...(armsDir ? ["--arms-dir", armsDir] : [])], { env: { ...process.env, ONOFF_PACKS_DIR: packs }, encoding: "utf8" }); return { rc: r.status, out: r.stdout.trim() }; };
let bad = 0;
const expectRed = (label, r, re) => { if (r.rc === 0 || !re.test(r.out)) { bad++; console.log("NOT-CAUGHT " + label + " rc=" + r.rc + " " + r.out); } else console.log("RED (expected) " + label + ": " + r.out.slice(0, 220)); };
// (a) a tampered byte in a frozen pack file
let p = mk("packs-a"); fs.appendFileSync(path.join(p, "ceo-agent-d0gate-change", "SKILL.md"), "x");
expectRed("tampered pack byte", run(p), /digest mismatch/);
// (b) a second differing file that is not registered
p = mk("packs-b"); const f = path.join(p, "d0gate-files-change", "references", "hetero-dispatch.md"); fs.appendFileSync(f, "\nextra\n");
const m = JSON.parse(fs.readFileSync(path.join(p, "manifest.json"), "utf8")); m.packs["d0gate-files-change"]["d0gate-files-change/references/hetero-dispatch.md"] = sha(fs.readFileSync(f)); fs.writeFileSync(path.join(p, "manifest.json"), JSON.stringify(m));
expectRed("unregistered second difference", run(p), /not a registered change/);
// (c) a change arm that points at the base skill pack: the registered change does not differ
const arms = path.join(tmp, "arms-c"); fs.rmSync(arms, { recursive: true, force: true }); fs.cpSync(path.join(ev, "arms", "d0gate"), arms, { recursive: true });
const ch = JSON.parse(fs.readFileSync(path.join(arms, "change.json"), "utf8")); ch.skills["ceo-agent"] = "ceo-agent-d0gate-base"; fs.writeFileSync(path.join(arms, "change.json"), JSON.stringify(ch));
expectRed("change arm equals base", run(path.join(ev, "packs"), arms), /registered as changed but does not differ/);
// (d) fixture packs differ between arms
const arms2 = path.join(tmp, "arms-d"); fs.rmSync(arms2, { recursive: true, force: true }); fs.cpSync(path.join(ev, "arms", "d0gate"), arms2, { recursive: true });
const ch2 = JSON.parse(fs.readFileSync(path.join(arms2, "change.json"), "utf8")); ch2.fixture_scripts = ["fixture-scripts-d0gate"]; fs.writeFileSync(path.join(arms2, "change.json"), JSON.stringify(ch2));
expectRed("fixture packs differ", run(path.join(ev, "packs"), arms2), /fixture_scripts differ/);
process.exit(bad ? 1 : 0);' "$EV" "$TEST_TMP" || fail "arms planted reds"
S node -e '
const fs = require("fs"); const [ev] = process.argv.slice(1);
const cand = fs.readFileSync(ev + "/candidates/depth0-gate-arming.md", "utf8");
const base = fs.readFileSync(ev + "/packs/ceo-agent-d0gate-base/SKILL.md", "utf8");
const chg = fs.readFileSync(ev + "/packs/ceo-agent-d0gate-change/SKILL.md", "utf8");
if (chg !== base.replace("\n## Startup\n", "\n" + cand + "\n## Startup\n")) throw new Error("change pack is not base + candidate verbatim");
console.log("candidate paragraph (" + Buffer.byteLength(cand) + " bytes) equals the inserted block of the change pack byte for byte");' "$EV" || fail "candidate vs change pack"
ok "arms and packs"

echo "=== 4. markers: RED (planted mutants) then GREEN (44 traces really run through the stub) + impact walk ==="
S node "$D0/controls.js" >"$TEST_TMP/controls.out" 2>&1; rc=$?
cat "$TEST_TMP/controls.out"
[ "$rc" = 0 ] || fail "d0gate/controls.js rc=$rc"
grep -q '^NOT-CAUGHT' "$TEST_TMP/controls.out" && fail "a mutant was not caught"
[ "$(grep -c '^RED ' "$TEST_TMP/controls.out")" -ge 12 ] || fail "expected at least 12 RED mutant lines"
[ "$(grep -c '^GREEN ' "$TEST_TMP/controls.out")" = 44 ] || fail "expected 44 GREEN trace lines"
ok "markers"

echo "=== 5. decision table: one case per condition + single-rule mutants ==="
S node "$D0/table-cases.js" >"$TEST_TMP/table.out" 2>&1 || { cat "$TEST_TMP/table.out"; fail "table-cases"; }
tail -14 "$TEST_TMP/table.out"
grep -q '^NOT-CAUGHT\|^WRONG' "$TEST_TMP/table.out" && fail "table case wrong or mutant not caught"
ok "decision table"

echo "=== 6. campaign: dry-run, pilot, cap guards, cc guards ==="
DRY="$TEST_TMP/dry.out"
S node "$EV/run-d0gate-campaign.js" --results "$TEST_TMP/dry.jsonl" --dry-run >"$DRY" || fail "dry-run rc=$?"
S node -e '
const lines = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n"); const j = JSON.parse(lines[lines.length - 1]);
const cells = lines.filter((l) => l.startsWith("todo")).map((l) => l.split(/\s+/)[1]);
if (j.cells_total !== 40 || cells.length !== 40) throw new Error("cells " + j.cells_total + "/" + cells.length);
if (!(j.cost_estimate_usd * 1.5 <= j.max_usd)) throw new Error("estimate x 1.5 > cap");
if (j.max_usd !== 20) throw new Error("cap is not 20");
const g = (t) => cells.filter((c) => c.startsWith(t + "|")).length;
if (g("g1-constrained") !== 10 || g("g2-unconstrained") !== 10 || g("g3-wrong-list") !== 10 || g("g4-hand-effect") !== 10) throw new Error("grid shape");
console.log("dry-run: 40 cells, estimate " + j.cost_estimate_usd + " USD, x1.5 = " + j.cost_estimate_x1_5_usd + " <= cap " + j.max_usd);' "$DRY" || fail "dry-run shape"
S node "$EV/run-d0gate-campaign.js" --results "$TEST_TMP/dry.jsonl" --dry-run --pilot | tail -1 | S node -e 'const j = JSON.parse(require("fs").readFileSync(0, "utf8")); if (j.cells_total !== 9 || !(j.cost_estimate_usd * 1.5 <= j.max_usd) || j.max_usd !== 2.2) throw new Error(JSON.stringify(j)); console.log("pilot dry-run: 9 cells, estimate " + j.cost_estimate_usd + " x1.5 <= " + j.max_usd)' || fail "pilot dry-run"
# negative controls
ONOFF_MAX_USD=4 S node "$EV/run-d0gate-campaign.js" --results "$TEST_TMP/dry.jsonl" --dry-run >/dev/null 2>"$TEST_TMP/e1"; rc=$?
[ "$rc" = 1 ] && grep -q 'exceeds ONOFF_MAX_USD' "$TEST_TMP/e1" || fail "RED control: cap 4 must refuse (rc=$rc: $(cat "$TEST_TMP/e1"))"; echo "RED (expected) cap 4: $(cat "$TEST_TMP/e1")"
ONOFF_MAX_USD=25 S node "$EV/run-d0gate-campaign.js" --results "$TEST_TMP/dry.jsonl" --dry-run >/dev/null 2>"$TEST_TMP/e2"; rc=$?
[ "$rc" = 2 ] && grep -q 'never raised' "$TEST_TMP/e2" || fail "RED control: cap 25 must be refused (rc=$rc: $(cat "$TEST_TMP/e2"))"; echo "RED (expected) cap 25: $(cat "$TEST_TMP/e2")"
S node "$EV/run-d0gate-campaign.js" --results "$TEST_TMP/cc.jsonl" --runner cc >/dev/null 2>"$TEST_TMP/e3"; rc=$?
[ "$rc" = 2 ] && grep -q 'not stamped' "$TEST_TMP/e3" || fail "RED control: cc formal on a draft prereg must be refused (rc=$rc: $(cat "$TEST_TMP/e3"))"; echo "RED (expected) cc formal, draft: $(cat "$TEST_TMP/e3")"
# U2 wired the cc runner (hooks/tests/skill-onoff-d0gate-cc.test.sh drives it with a fake claude). Here: with NO claude on PATH it must stop
# before dispatching anything (the sentinel claude must not be reached either: PATH is an empty directory, node is called by absolute path).
mkdir -p "$TEST_TMP/emptypath"
env PATH="$TEST_TMP/emptypath" "$(command -v node)" "$EV/run-d0gate-campaign.js" --results "$TEST_TMP/cc.jsonl" --runner cc --pilot >/dev/null 2>"$TEST_TMP/e4"; rc=$?
[ "$rc" = 2 ] && grep -q 'claude is not on PATH' "$TEST_TMP/e4" || fail "cc pilot without claude on PATH must stop (rc=$rc: $(cat "$TEST_TMP/e4"))"; echo "RED (expected) cc pilot, no claude: $(cat "$TEST_TMP/e4")"
[ ! -s "$TEST_TMP/cc.jsonl" ] || fail "cc run wrote results"
S node "$EV/run-d0gate-campaign.js" --results "$TEST_TMP/x.jsonl" --reps 2 --dry-run --runner cc >/dev/null 2>"$TEST_TMP/e5"; [ $? = 2 ] || fail "--reps must be refused outside a stub run"
S node "$EV/score-d0gate.js" --prereg "$EV/prereg/d0gate.json" --results "$TEST_TMP/none.jsonl" >/dev/null 2>"$TEST_TMP/e6"; [ $? = 2 ] || fail "scorer must refuse a missing results file"
ok "campaign guards"

echo "=== 7. stub campaign end to end (40 cells), scorer re-derives controls ==="
RES="$TEST_TMP/stub-good.jsonl"
S node "$EV/run-d0gate-campaign.js" --results "$RES" --runner stub --scenario good >"$TEST_TMP/stub-good.out" 2>&1; rc=$?
tail -4 "$TEST_TMP/stub-good.out"
[ "$rc" = 0 ] || fail "stub good campaign rc=$rc (expected PASS = 0)"
grep -q '^d0gate: PASS' "$TEST_TMP/stub-good.out" || fail "stub good campaign did not print PASS"
grep -q 'runner sentinel log lines: 0' "$TEST_TMP/stub-good.out" || fail "sentinel line missing"
[ "$(wc -l <"$RES")" = 40 ] || fail "results rows != 40"
# the scorer refuses stub rows by default (no env): zero counted rows
S node "$EV/score-d0gate.js" --prereg "$EV/prereg/d0gate.json" --results "$RES" >"$TEST_TMP/stub-refused.out" 2>&1; rc=$?
tail -1 "$TEST_TMP/stub-refused.out" | grep -q '"cells":0' || fail "RED control: stub rows must not count without D0GATE_ALLOW_STUB_ROWS (rc=$rc)"
echo "RED (expected) scorer without the stub-rows env counts 0 cells: $(head -1 "$TEST_TMP/stub-refused.out")"
ok "stub campaign"

echo "=== 8. dead gate, costly ON, no-effect from REAL stub cells (G4 / G1 columns re-run, rest from the good run) ==="
S node -e '
const fs = require("fs"); const cp = require("child_process"); const path = require("path"); const L = require(process.argv[1] + "/d0gate/lib.js");
const [ev, good, tmp] = process.argv.slice(1);
const goodRows = fs.readFileSync(good, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const T = L.TASKS;
const P = JSON.parse(fs.readFileSync(path.join(ev, "prereg", "d0gate.json"), "utf8"));
const TR = require(ev + "/d0gate/traces.js");
const { Cell, makeSentinel } = require(ev + "/d0gate/cell.js");
const sentinel = makeSentinel(fs.mkdtempSync(path.join(tmp, "sent-")));
const rerun = (scenario, task, arms) => {
  const rows = [];
  for (const arm of arms) for (let rep = 1; rep <= 5; rep++) {
    const spec = { task, arm, rep }; const c = new Cell({ sentinel }).init();
    try { TR.stubAgent(c, spec, scenario); const r = TR.scoreCell(c, spec); const d0 = task !== T.G4;
      rows.push({ row: "d0gate", ...r, model: d0 ? P.model : P.g4_model, pilot: false, runner: "stub", failure_class: null, ...(d0 ? { skill_invoked: true } : {}), cost_usd: task === T.G4 ? (arm === "gate-on" && scenario === "costly-on" ? 0.24 : 0.15) : 0 }); } finally { c.destroy(); }
  }
  return rows;
};
const controls = { ok: true, failed: [] };
const verdictOf = (rows) => L.verdict(rows, controls, 5, P);
const replace = (task, newRows) => goodRows.filter((r) => r.task_id !== task).concat(newRows);
const good2 = verdictOf(goodRows);
const dead = verdictOf(replace(T.G4, rerun("dead-gate", T.G4, ["gate-off", "gate-on"])));
const costly = verdictOf(replace(T.G4, rerun("costly-on", T.G4, ["gate-off", "gate-on"])));
const noeff = verdictOf(replace(T.G1, rerun("no-effect", T.G1, ["base", "change"])));
const show = (n, v) => console.log(n + ": " + v.verdict + " " + JSON.stringify(v.reasons) + " g4=" + JSON.stringify({ off: v.g4.off_rate, on: v.g4.on_rate, off_usd: v.g4.off_mean_usd, on_usd: v.g4.on_mean_usd }) + " fisher=" + JSON.stringify(v.fisher));
show("working gate", good2); show("dead gate (hook always allows)", dead); show("ON spends 1.6x", costly); show("paragraph has no effect (change arm never arms)", noeff);
const bad = [];
if (good2.verdict !== "PASS") bad.push("working gate must PASS");
if (dead.verdict !== "NOT-SHIP" || dead.g4.on_rate !== dead.g4.off_rate) bad.push("dead gate: ON rate must equal OFF and the verdict must not be PASS");
if (costly.verdict !== "NOT-SHIP" || !/spend/.test(costly.reasons.join(" "))) bad.push("costly ON must be NOT-SHIP on spend");
if (noeff.verdict === "PASS" || !/V3 G1/.test(noeff.reasons.join(" "))) bad.push("no-effect must not PASS (V3 G1)");
TR.dropCells();
if (bad.length) { console.error(bad.join("; ")); process.exit(1); }' "$EV" "$RES" "$TEST_TMP" || fail "scenario verdicts"
ok "dead gate / spend / no-effect"

echo "=== 9. isolation: tmpfs placement, per-cell state, nothing in the real stores ==="
S node -e '
const fs = require("fs"); const cp = require("child_process"); const path = require("path");
const { Cell } = require(process.argv[1] + "/d0gate/cell.js"); const L = require(process.argv[1] + "/d0gate/lib.js");
const c = new Cell().init();
const r = c.std(["--gate-rules", c.putRules("g1-good.json")], { worker: "clean-g1", noDisarm: "1" });
if (r.rc !== 0) throw new Error("dispatch rc " + r.rc + r.err);
const fstype = cp.spawnSync("findmnt", ["-T", c.root, "-o", "FSTYPE", "-n"], { encoding: "utf8" }).stdout.trim();
if (!/^(tmpfs|ramfs)$/.test(fstype)) throw new Error("cell root is on " + fstype);
const g = path.join(c.live, "per-turn-gate"); const files = fs.readdirSync(g);
if (!files.some((f) => f.endsWith(".gate.json")) || !files.some((f) => /^d0g-.*\.jsonl$/.test(f))) throw new Error("switch file or hook jsonl missing under the cell live dir: " + files);
console.log("cell root on " + fstype + "; switch file + hook jsonl under " + g + ": " + files.join(", "));
c.destroy();' "$D0/.." || fail "isolation"
[ -z "$(find "$HOME/.claude" -newer "$T0" -type f 2>/dev/null)" ] || echo "(scratch CLAUDE_CONFIG_DIR is empty or untouched by design)"
ok "isolation"

NONTMP=""
for cand in "$TEST_TMP" /var/tmp "$HOME" "$REPO_ROOT"; do
  [ -d "$cand" ] && [ -w "$cand" ] || continue
  fst="$(stat -f -c %T "$cand" 2>/dev/null)"
  case "$fst" in tmpfs|ramfs|"") continue;; esac
  NONTMP="$cand"; echo "non-tmpfs candidate for the refusal control: $cand ($fst)"; break
done
[ -n "$NONTMP" ] || echo "SKIP reason: every candidate (TEST_TMP, /var/tmp, HOME, repo) is tmpfs or unreadable; the non-tmpfs refusal control cannot run here"
echo "=== 9b. cell base must be tmpfs; --ledger does not break N; disarm runs on any exit ==="
S node -e '
const { Cell } = require(process.argv[1] + "/d0gate/cell.js"); const fs = require("fs"); const path = require("path");
// 3: a disk directory is refused, with a clear error, and no cell is built (the directory is chosen by the shell from a
// stat -f check, never assumed from the type of /tmp on the host; with none found this part prints SKIP and says why)
if (process.argv[2]) {
  let refused = false;
  try { new Cell({ base: process.argv[2] }); } catch (e) { refused = /not tmpfs/.test(e.message); console.log("RED (expected) " + e.message); }
  if (!refused) throw new Error("a non-tmpfs base was accepted");
  process.env.D0GATE_CELL_BASE = process.argv[2];
  const { cellBase } = require(process.argv[1] + "/d0gate/cell.js");
  try { cellBase(); throw new Error("D0GATE_CELL_BASE on disk was accepted"); } catch (e) { if (!/not tmpfs/.test(e.message)) throw e; }
} else console.log("SKIP: no non-tmpfs writable directory found among the candidates (non-tmpfs refusal not exercised on this host)");
delete process.env.D0GATE_CELL_BASE;
// 4: a --ledger option in the call must not redirect the stub ledger; the second call still counts N=2
const c = new Cell().init();
c.std([], { worker: "clean-g2" });
const lg = path.join(c.root, "other-ledger.jsonl");
const r2 = c.std(["--ledger", lg], { worker: "clean-g2" });
const calls = c.facts().calls.filter((x) => x.accepted);
if (r2.rc !== 0 || calls.length !== 2 || calls[1].n !== 2 || fs.existsSync(lg)) throw new Error("ledger/N broken by --ledger: " + JSON.stringify(calls.map((x) => x.n)) + r2.err);
console.log("GREEN --ledger call: N=" + calls[1].n + ", stub ledger kept, option file not written");
// 6: disarm on early exit (bad worker mode after arm) and on TERM during the worker
const gdir = path.join(c.live, "per-turn-gate");
const sw = () => (fs.existsSync(gdir) ? fs.readdirSync(gdir).filter((f) => f.endsWith(".gate.json")) : []);
const rules = c.putRules("g1-good.json");
const r3 = c.std(["--gate-rules", rules], { worker: "no-such-mode" });
if (r3.rc === 0) throw new Error("bad worker mode did not exit non-zero");
if (sw().length) throw new Error("switch file left after an early exit: " + sw());
const k = c.sh("timeout -s TERM 3 bash scripts/dispatch-hetero.sh --runner claude-native --model m --prompt-file " + c.prompt + " --gate-rules " + rules, { worker: "clean-g1", hookCmd: "sleep 6" });
for (let i = 0; i < 40 && sw().length; i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
if (sw().length) throw new Error("switch file left after TERM: " + sw());
console.log("GREEN disarm on early exit and on TERM (rc " + k.rc + ")");
// red control: with the disarm switched off the same early exit DOES leave the switch file
c.std(["--gate-rules", rules], { worker: "no-such-mode", noDisarm: "1" });
if (!sw().length) throw new Error("control cannot see a left-behind switch file");
console.log("RED (expected) with D0GATE_NO_DISARM=1 the switch file stays: " + sw().join(","));
c.destroy();' "$D0/.." "$NONTMP" || fail "section 9b"
ok "tmpfs base, --ledger, disarm trap"

echo "=== 9c. stub cell root comes from the stub's own position, never from D0GATE_CELL; fixture rules match the rule list; gate_blocks ==="
git -C "$REPO_ROOT" show 50e840543:evals/skill-onoff/d0gate/stubs/scripts/dispatch-hetero.sh >"$TEST_TMP/stub-old.sh" || fail "cannot read the stub at the base commit"
git -C "$REPO_ROOT" show 37f631a9c:evals/skill-onoff/d0gate/stubs/scripts/dispatch-hetero.sh >"$TEST_TMP/stub-prefix.sh" || fail "cannot read the previous stub"
git -C "$REPO_ROOT" show 278052bad:evals/skill-onoff/d0gate/stubs/scripts/dispatch-hetero.sh >"$TEST_TMP/stub-locderived.sh" || fail "cannot read the position-deriving stub"
if grep -nE 'Needs D0GATE_CELL|D0GATE_CELL is not' "$D0/stubs/scripts/dispatch-hetero.sh" "$EV/packs/fixture-stubs-d0gate/scripts/dispatch-hetero.sh"; then fail "the stub still tells the model to set D0GATE_CELL"; fi
cmp -s "$D0/stubs/scripts/dispatch-hetero.sh" "$EV/packs/fixture-stubs-d0gate/scripts/dispatch-hetero.sh" || fail "frozen stub pack differs from d0gate/stubs"
S node -e '
const { Cell } = require(process.argv[1] + "/d0gate/cell.js"); const fs = require("fs"); const path = require("path");
const c = new Cell().init();
// a copy or a symlink of the stub in a directory that LOOKS like a cell (<dir>/repo/scripts/ and <dir>/.d0gate/base_sha) while D0GATE_CELL names the real cell
const lookalike = (name, how, src) => {
  const d = fs.mkdtempSync(path.join(path.dirname(c.root), "d0gate-ext-" + name + "-"));
  fs.mkdirSync(path.join(d, "repo", "scripts"), { recursive: true }); fs.mkdirSync(path.join(d, ".d0gate"));
  fs.writeFileSync(path.join(d, ".d0gate", "base_sha"), "x\n");
  const f = path.join(d, "repo", "scripts", "dispatch-hetero.sh");
  if (how === "copy") fs.copyFileSync(src, f); else fs.symlinkSync(src, f);
  return { d, f };
};
const callThrough = (f) => c.dispatch(["--runner", "claude-native", "--model", "m", "--prompt-file", c.prompt], { script: f, rawEnv: { D0GATE_CELL: c.root } });
const realStub = path.join(c.repo, "scripts", "dispatch-hetero.sh");
for (const how of ["copy", "symlink"]) {
  // RED: the stub that derives the cell from its position builds the ledger outside the real cell
  const bad = lookalike("red-" + how, how, how === "copy" ? process.argv[3] : (fs.copyFileSync(process.argv[3], path.join(c.repo, "scripts", "stub-locderived.sh")), path.join(c.repo, "scripts", "stub-locderived.sh")));
  callThrough(bad.f);
  if (!fs.existsSync(path.join(bad.d, ".d0gate", "ledger.jsonl"))) throw new Error("RED control cannot see the position-deriving stub (" + how + ") write outside");
  console.log("RED (expected) position-derived stub, " + how + ": the ledger was created outside the real cell");
  // GREEN: the pinned stub writes into the real cell wherever it is copied or linked
  const before = c.facts().calls.filter((x) => x.accepted).length;
  const good = lookalike("green-" + how, how, realStub);
  callThrough(good.f);
  if (fs.existsSync(path.join(good.d, ".d0gate", "ledger.jsonl"))) throw new Error("GREEN failed: ledger created outside the cell (" + how + ")");
  const cl = c.facts().calls.filter((x) => x.accepted);
  if (cl.length !== before + 1 || cl[cl.length - 1].cell_env_override !== true) throw new Error("GREEN failed: no flagged call in the real cell (" + how + ")");
  console.log("GREEN pinned stub, " + how + ": ledger in the real cell, cell_env_override=true, nothing outside");
  fs.rmSync(good.d, { recursive: true, force: true }); fs.rmSync(bad.d, { recursive: true, force: true });
}
const other = fs.mkdtempSync(path.join(path.dirname(c.root), "d0gate-other-"));
fs.mkdirSync(path.join(other, ".d0gate"));
// RED: the stub as it was at the base commit trusts the caller value, so the ledger lands in the wrong directory
fs.copyFileSync(process.argv[2], path.join(c.repo, "scripts", "dispatch-hetero-old.sh"));
const n0 = c.facts().calls.length;
const r0 = c.std([], { worker: "clean-g1", script: path.join(c.repo, "scripts", "dispatch-hetero-old.sh"), rawEnv: { D0GATE_CELL: other } });
const wrong = fs.existsSync(path.join(other, ".d0gate", "ledger.jsonl")) && c.facts().calls.length === n0;
if (!wrong) throw new Error("RED control cannot see the old stub misplace the ledger: rc=" + r0.rc + " " + r0.err);
console.log("RED (expected) old stub with a caller D0GATE_CELL writes the ledger into the other directory, the cell sees no new call");
fs.rmSync(path.join(other, ".d0gate"), { recursive: true });
// GREEN: the stub in the tree puts the ledger in its own cell and flags the override
const nA = c.facts().calls.filter((x) => x.accepted).length;
const r1 = c.std([], { worker: "clean-g1", rawEnv: { D0GATE_CELL: other } });
const calls = c.facts().calls.filter((x) => x.accepted);
if (r1.rc !== 0 || calls.length !== nA + 1 || calls[nA].cell_env_override !== true) throw new Error("override not flagged or call missing: " + JSON.stringify(calls) + r1.err);
if (fs.existsSync(path.join(other, ".d0gate"))) throw new Error("the stub wrote into the overriding directory");
// the same value as the real cell root (spelled differently) is not an override
const r2 = c.std([], { worker: "clean-g1", rawEnv: { D0GATE_CELL: c.root + "/." } });
const calls2 = c.facts().calls.filter((x) => x.accepted);
if (r2.rc !== 0 || calls2.length !== nA + 2 || calls2[nA + 1].cell_env_override !== false) throw new Error("same-root value flagged: " + JSON.stringify(calls2[1]));
const r3 = c.std([], { worker: "clean-g1", rawEnv: { D0GATE_CELL: "" } });
if (r3.rc !== 0 || c.facts().calls.filter((x) => x.accepted)[nA + 2].cell_env_override !== false) throw new Error("empty value flagged");
console.log("GREEN stub under an overriding D0GATE_CELL: ledger in its own cell, cell_env_override=true; same root and empty value: false");
// the worker mode / hook command / no-disarm knobs are pinned too: a caller putting D0GATE_WORKER in front of the call changes nothing
const prefix = path.join(c.repo, "scripts", "stub-prefix.sh");
fs.writeFileSync(prefix, fs.readFileSync(process.argv[4], "utf8").replace(/^D0G_PINNED_CELL=""$/m, () => "D0G_PINNED_CELL=\x27" + fs.realpathSync(c.root) + "\x27"), { mode: 0o755 });
const nB = c.facts().calls.filter((x) => x.accepted).length;
c.dispatch(["--runner", "claude-native", "--model", "m", "--prompt-file", c.prompt], { script: prefix, rawEnv: { D0GATE_WORKER: "g4-console" } });
const pre = c.facts().calls.filter((x) => x.accepted)[nB];
if (!pre || pre.worker !== "g4-console") throw new Error("RED control cannot see the environment-driven worker of the previous stub: " + JSON.stringify(pre));
console.log("RED (expected) previous stub with D0GATE_WORKER=g4-console in front of the call ran the worker " + pre.worker + " (pinned mode was clean-g1)");
c.std([], { worker: "clean-g1", rawEnv: { D0GATE_WORKER: "g4-console" } });
const cur = c.facts().calls.filter((x) => x.accepted)[nB + 1];
if (!cur || cur.worker !== "clean-g1" || cur.knob_env_override !== true) throw new Error("GREEN failed: worker " + (cur && cur.worker) + " knob_env_override " + (cur && cur.knob_env_override));
c.std([], { worker: "g4-console", rawEnv: { D0GATE_WORKER: "g4-console" } });
const same = c.facts().calls.filter((x) => x.accepted)[nB + 2];
if (!same || same.worker !== "g4-console" || same.knob_env_override !== false) throw new Error("an env value equal to the pinned mode was flagged: " + JSON.stringify(same));
const hk = c.facts().calls.filter((x) => x.accepted)[nB + 1];
console.log("GREEN pinned stub with D0GATE_WORKER=g4-console in front: ran " + cur.worker + ", knob_env_override=true; equal value: false");
fs.rmSync(other, { recursive: true, force: true }); c.destroy();' "$D0/.." "$TEST_TMP/stub-old.sh" "$TEST_TMP/stub-locderived.sh" "$TEST_TMP/stub-prefix.sh" || fail "section 9c stub cell root"
# the rules live where the hand reads them (CONTRIBUTING.md) and agree with the rule list that scores the cell; the brief carries none of them
S node -e '
const fs = require("fs"); const path = require("path");
const d0 = process.argv[1] + "/d0gate";
const T = require(d0 + "/cc-tasks.js"); const rules = JSON.parse(fs.readFileSync(d0 + "/fixtures/rules/g1-good.json", "utf8"));
const contrib = fs.readFileSync(d0 + "/fixtures/tinylib/CONTRIBUTING.md", "utf8");
const brief = T.handPrompt();
const items = [rules.forbid_paths[0].glob.replace(/\*+$/, ""), rules.require_files[0].path, rules.forbid_text[0].text];
if (items.length !== 3 || rules.forbid_paths.length !== 1 || rules.require_files.length !== 1 || rules.forbid_text.length !== 1) throw new Error("g1-good.json is no longer the three-rule list");
for (const it of items) {
  if (!contrib.includes(it)) throw new Error("CONTRIBUTING.md does not state the rule for " + it);
}
if (!contrib.includes(rules.forbid_text[0].glob.split("/")[0] + "/")) throw new Error("CONTRIBUTING.md names a different scope for the text rule");
if (/rejected|Hard rules|docs\/CHANGES\.md|no console\.log/i.test(brief)) throw new Error("the hand brief still spells the rules out");
if (!/contributing rules/.test(brief)) throw new Error("the hand brief does not point at the repo rules");
if (/must|required|necessary/i.test(brief.split("Notes:")[1] || "")) throw new Error("a bait is written as a requirement");
// a planted brief that lists the rules again (the old text) must be caught by the same check
const old = T.RULES; if (!/rejected|Hard rules|docs\/CHANGES\.md|no console\.log/i.test("Hard rules from the owner, the work is rejected if one is broken:\n" + old)) throw new Error("RED control cannot see the old brief");
console.log("GREEN fixture rules agree with g1-good.json, the brief only points at them; RED the old brief text is detected");' "$D0/.." || fail "section 9c rules agreement"
# the gate_blocks field: counted in the ON arm from the real hook records, 0 in the OFF arm, and a row without it is INVALID (table-cases)
S node -e '
const { Cell } = require(process.argv[1] + "/d0gate/cell.js"); const TR = require(process.argv[1] + "/d0gate/traces.js"); const L = require(process.argv[1] + "/d0gate/lib.js");
const on = new Cell().init(); on.std(["--gate-rules", on.putRules("g1-good.json")], { worker: "g4-console" });
const off = new Cell().init(); off.std([], { worker: "g4-console" });
const a = TR.scoreCell(on, { task: L.TASKS.G4, arm: "gate-on", rep: 1 }).g4, b = TR.scoreCell(off, { task: L.TASKS.G4, arm: "gate-off", rep: 1 }).g4;
if (!(Number.isInteger(a.gate_blocks) && a.gate_blocks >= 1) || b.gate_blocks !== 0) throw new Error("gate_blocks " + JSON.stringify([a, b]));
console.log("GREEN gate_blocks ON=" + a.gate_blocks + " OFF=" + b.gate_blocks); on.destroy(); off.destroy();' "$D0/.." || fail "section 9c gate_blocks"
ok "stub cell root, rules agreement, gate_blocks"

echo "=== 10. P4 rehearsal: the candidate paragraph byte for byte passes check-guidance-eval; one changed byte fails ==="
MINI="$TEST_TMP/p4repo"; mkdir -p "$MINI/skills/ceo-agent"
cp "$EV/packs/ceo-agent-d0gate-base/SKILL.md" "$MINI/skills/ceo-agent/SKILL.md"
git -C "$MINI" init -q -b develop
G() { git -C "$MINI" -c user.email=t@t -c user.name=t -c core.hooksPath=/dev/null "$@"; }
G add -A; G commit -q -m base; BASE_C="$(G rev-parse HEAD)"
S node -e '
const fs = require("fs"); const [mini, cand] = process.argv.slice(1);
const f = mini + "/skills/ceo-agent/SKILL.md"; const t = fs.readFileSync(f, "utf8"); const c = fs.readFileSync(cand, "utf8");
fs.writeFileSync(f, t.replace("\n## Startup\n", "\n" + c + "\n## Startup\n"));' "$MINI" "$EV/candidates/depth0-gate-arming.md"
G add -A; G commit -q -m "p4: insert candidate"; HEAD_C="$(G rev-parse HEAD)"
D0GATE_ALLOW_STUB_ROWS=1 S node "$REPO_ROOT/scripts/check-guidance-eval.js" --base "$BASE_C" --head "$HEAD_C" --repo "$MINI" --prereg "$EV/prereg/d0gate.json" \
  --packs-dir "$EV/packs" --arm "$EV/arms/d0gate/change.json" --results "$RES" --scorer "$EV/score-d0gate.js" >"$TEST_TMP/p4-green.out" 2>"$TEST_TMP/p4-green.err"; rc=$?
echo "GREEN p4 verbatim: rc=$rc $(cut -c1-260 "$TEST_TMP/p4-green.out")"
[ "$rc" = 0 ] && grep -q '"ok":true' "$TEST_TMP/p4-green.out" || fail "P4 rehearsal (verbatim) did not pass: $(cat "$TEST_TMP/p4-green.err")"
# one changed byte in the paragraph
G reset -q --hard "$BASE_C"
S node -e '
const fs = require("fs"); const [mini, cand] = process.argv.slice(1);
const f = mini + "/skills/ceo-agent/SKILL.md"; const t = fs.readFileSync(f, "utf8"); const c = fs.readFileSync(cand, "utf8").replace("at most two blocks", "at most 2 blocks");
fs.writeFileSync(f, t.replace("\n## Startup\n", "\n" + c + "\n## Startup\n"));' "$MINI" "$EV/candidates/depth0-gate-arming.md"
G add -A; G commit -q -m "p4: one byte changed"; BAD_C="$(G rev-parse HEAD)"
D0GATE_ALLOW_STUB_ROWS=1 S node "$REPO_ROOT/scripts/check-guidance-eval.js" --base "$BASE_C" --head "$BAD_C" --repo "$MINI" --prereg "$EV/prereg/d0gate.json" \
  --packs-dir "$EV/packs" --arm "$EV/arms/d0gate/change.json" --results "$RES" --scorer "$EV/score-d0gate.js" >"$TEST_TMP/p4-red.out" 2>"$TEST_TMP/p4-red.err"; rc=$?
echo "RED (expected) p4 one byte changed: rc=$rc $(cut -c1-300 "$TEST_TMP/p4-red.out")"
[ "$rc" = 1 ] && grep -q 'shipped file digest != pack manifest digest' "$TEST_TMP/p4-red.out" || fail "RED control: one changed byte must fail the gate"
# a results file that does not reproduce a pass must fail the gate too (the scorer says NOT-SHIP: change arm never arms)
S node -e '
const fs = require("fs"); const rows = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
const out = rows.map((r) => (r.task_id === "g1-constrained" && r.arm === "change" ? { ...r, markers: { m_armed: false } } : r));
fs.writeFileSync(process.argv[2], out.map((r) => JSON.stringify(r)).join("\n") + "\n");' "$RES" "$TEST_TMP/stub-noeffect.jsonl"
D0GATE_ALLOW_STUB_ROWS=1 S node "$REPO_ROOT/scripts/check-guidance-eval.js" --base "$BASE_C" --head "$HEAD_C" --repo "$MINI" --prereg "$EV/prereg/d0gate.json" \
  --packs-dir "$EV/packs" --arm "$EV/arms/d0gate/change.json" --results "$TEST_TMP/stub-noeffect.jsonl" --scorer "$EV/score-d0gate.js" >"$TEST_TMP/p4-red2.out" 2>/dev/null; rc=$?
[ "$rc" = 1 ] && grep -q 'scorer did not reproduce SHIP' "$TEST_TMP/p4-red2.out" || fail "RED control: a NOT-SHIP results file must fail the gate (rc=$rc)"
echo "RED (expected) p4 with non-passing results: scorer did not reproduce SHIP"
ok "P4 rehearsal"

echo "=== 11. stamp rehearsal in a throwaway copy (the real row is NOT stamped) ==="
mkdir -p "$TEST_TMP/rh/evals"; cp -R "$EV" "$TEST_TMP/rh/evals/skill-onoff"; RH="$TEST_TMP/rh/evals/skill-onoff"
S node "$EV/stamp-prereg.js" --row d0gate --root "$RH" >"$TEST_TMP/stamp.out" 2>&1 || { cat "$TEST_TMP/stamp.out"; fail "stamp rehearsal"; }
cat "$TEST_TMP/stamp.out"
S node "$EV/stamp-prereg.js" --row d0gate --root "$RH" --check >/dev/null 2>&1 || fail "stamp --check after stamping"
echo "x" >>"$RH/d0gate/lib.js"
S node "$EV/stamp-prereg.js" --row d0gate --root "$RH" --check >"$TEST_TMP/stamp-red.out" 2>&1 && fail "RED control: a changed frozen file must break --check"
echo "RED (expected) $(cat "$TEST_TMP/stamp-red.out")"
grep -q '"d0gate"' "$EV/prereg/FROZEN.json" && fail "the real FROZEN.json already holds d0gate (U1 must not stamp)"
case "$(S node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).status)' "$EV/prereg/d0gate.json")" in draft*) ;; *) fail "prereg status is not draft";; esac
cat >"$TEST_TMP/localinfo.js" <<'EOF'
// every string (keys and values) of the d0gate pack entries / pack_meta in the manifest, and of the whole prereg, must hold no machine-local text
const fs = require('fs');
let BAD_USER = null;
const BAD = /\/tmp\/|\/home\/|\/run\/user|tmp\.[A-Za-z0-9]{8}/;
const USER = process.argv[4]; // the local user name, passed in by the test (never written into the repo)
// the user name is matched only as a PATH SEGMENT (/home/<user>/, /Users/<user>/, or an absolute /<user>/ path start such as /root/),
// never as a bare word: with user "root" the strings "closure_roots" and "repo root" must stay clean
if (USER) { const e = USER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); BAD_USER = new RegExp(`(?:^|[^A-Za-z0-9._-])(?:/(?:home|Users)/${e}(?:/|$)|/${e}(?:/|$))`); }
const ALLOW = []; // explicit, named exceptions: [{where: '<json path>', re: /.../}] (none are needed)
const hits = [];
const walk = (v, where) => {
  if (typeof v === 'string') { if ((BAD.test(v) || (BAD_USER && BAD_USER.test(v))) && !ALLOW.some((a) => a.where === where && a.re.test(v))) hits.push(`${where}: ${v.slice(0, 120)}`); return; }
  if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${where}[${i}]`));
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { walk(k, `${where}{key ${k}}`); walk(x, `${where}.${k}`); }
};
const man = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const id of Object.keys({ ...man.packs, ...man.pack_meta }).filter((k) => /d0gate/.test(k))) {
  walk(man.packs[id], `packs.${id}`);
  walk(man.pack_meta && man.pack_meta[id], `pack_meta.${id}`);
}
walk(JSON.parse(fs.readFileSync(process.argv[3], 'utf8')), 'prereg');
if (hits.length) { console.log(hits.join('\n')); process.exit(1); }
console.log('no machine-local text in the d0gate manifest entries or the prereg');
EOF
S node "$TEST_TMP/localinfo.js" "$EV/packs/manifest.json" "$EV/prereg/d0gate.json" "$(id -un)" || fail "local info in d0gate metadata"
S node -e '
const fs = require("fs"); const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
m.pack_meta["fixture-stubs-d0gate"].source = "/tmp/tmp.AbCd1234/stubs"; fs.writeFileSync(process.argv[2], JSON.stringify(m));' "$EV/packs/manifest.json" "$TEST_TMP/manifest-planted.json" || fail "could not plant the local-path control"
if S node "$TEST_TMP/localinfo.js" "$TEST_TMP/manifest-planted.json" "$EV/prereg/d0gate.json" "$(id -un)" >"$TEST_TMP/li-red.out" 2>&1; then fail "RED control: a planted /tmp/tmp.XXXX in a d0gate manifest field was not caught"; fi
grep -q 'pack_meta.fixture-stubs-d0gate.source: /tmp/tmp.AbCd1234/stubs' "$TEST_TMP/li-red.out" || fail "RED control failed for the wrong reason: $(cat "$TEST_TMP/li-red.out")"
# user name "root": the real files must stay green (no bare-word match), planted /root/x and /home/root/x must be red
S node "$TEST_TMP/localinfo.js" "$EV/packs/manifest.json" "$EV/prereg/d0gate.json" root >/dev/null 2>&1 || fail "user name root: the real manifest/prereg must be clean"
for planted in /root/x /home/root/x; do
  S node -e '
const fs = require("fs"); const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
m.pack_meta["fixture-stubs-d0gate"].source = process.argv[3]; fs.writeFileSync(process.argv[2], JSON.stringify(m));' "$EV/packs/manifest.json" "$TEST_TMP/manifest-root.json" "$planted" || fail "could not plant $planted"
  if S node "$TEST_TMP/localinfo.js" "$TEST_TMP/manifest-root.json" "$EV/prereg/d0gate.json" root >"$TEST_TMP/li-root.out" 2>&1; then fail "RED control: planted $planted was not caught for user root"; fi
  grep -q "source: $planted" "$TEST_TMP/li-root.out" || fail "planted $planted caught for the wrong reason: $(cat "$TEST_TMP/li-root.out")"
  echo "RED (expected) user root, planted $planted: $(cat "$TEST_TMP/li-root.out")"
done
echo "RED (expected) $(cat "$TEST_TMP/li-red.out")"
ok "stamp rehearsal (real row untouched: draft, not in FROZEN.json)"

echo "=== 12. nothing written to the real stores (checked after every section that runs traces) ==="
REAL_XDG="${XDG_RUNTIME_DIR:-/nonexistent}/autopilot"
if [ -d "$REAL_XDG" ] && find "$REAL_XDG" -newer "$T0" -name 'd0g-*' 2>/dev/null | grep -q .; then fail "d0g-* files in the real live store $REAL_XDG"; fi
REAL_HOME_AP="$(getent passwd "$(id -un)" | cut -d: -f6)/.autopilot"
if [ -d "$REAL_HOME_AP" ] && find "$REAL_HOME_AP" -newer "$T0" -name 'd0g-*' 2>/dev/null | grep -q .; then fail "d0g-* files under the real ~/.autopilot"; fi
ok "real live store and ~/.autopilot untouched"

echo "=== 12b. typo guard negative control: a planted helper typo must turn the run red ==="
{ echo "CNF_MARK='$TEST_TMP/.cnf-control'"; echo "$GUARD_SRC"; echo 'ok() { [ ! -e "$CNF_MARK" ] || { echo "RED (expected): ok() refused after a typo"; exit 1; }; echo "ok: $*"; }'; echo 'ok: planted typo'; echo 'ok fine'; echo 'echo REACHED-END'; } >"$TEST_TMP/typo.sh"
S bash "$TEST_TMP/typo.sh" >"$TEST_TMP/typo.out" 2>&1; rc=$?
[ "$rc" = 1 ] && grep -q 'command not found' "$TEST_TMP/typo.out" && grep -q 'RED (expected)' "$TEST_TMP/typo.out" && ! grep -q REACHED-END "$TEST_TMP/typo.out" || fail "typo guard control did not turn red (rc=$rc: $(cat "$TEST_TMP/typo.out"))"
echo "RED (expected) $(tr '\n' ' ' <"$TEST_TMP/typo.out")"
ok "typo guard"

echo "=== 13. runner sentinel and spend ==="
if [ -s "$SENT/sentinel.log" ]; then echo "sentinel log:"; cat "$SENT/sentinel.log"; fail "a runner binary was called"; fi
echo "sentinel log is empty: no runner binary was started"
ok "zero spend"
[ ! -e "$CNF_MARK" ] || fail "a command was not found during the run"
echo "PASS: skill-onoff-d0gate"
