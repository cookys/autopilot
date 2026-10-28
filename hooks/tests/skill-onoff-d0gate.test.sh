#!/usr/bin/env bash
# hooks/tests/skill-onoff-d0gate.test.sh - d0gate row instrument (BL-0306 P3, unit U1). ZERO SPEND.
#
# Files exercised here (named so the affected-suites selector reaches them): evals/skill-onoff/d0gate/lib.js, cell.js, traces.js, controls.js,
# table-cases.js, mutants/hook-mutant.js, stubs/scripts/dispatch-hetero.sh, evals/skill-onoff/run-d0gate-campaign.js, score-d0gate.js.
#
# Every command below runs with a runner SENTINEL first on PATH (claude, codex, agy, opencode, kimi, grok, ...: log argv, exit 97);
# the log must be empty at the end. HOME and CLAUDE_CONFIG_DIR are scratch; the real ~/.claude is never read, and the real
# ~/.autopilot / live store is checked for new d0g-* files at the end. Cells live on tmpfs (/dev/shm) under a scratch base.
#
# Every new check ships with a negative control shown RED before GREEN (CLAUDE.md rule, evidence-discipline section 58):
#   - parity of the stub with the real rail: a planted one-character change of the copied block must fail the check
#   - arms / packs: a tampered pack byte, a second differing file, a change arm that does not differ must fail --check-arms
#   - markers: 12 planted shortcut mutants must each misjudge a trace (d0gate/controls.js RED phase), then GREEN on 42 traces
#     that are really run through the stub (impact walk, evidence-discipline section 64)
#   - decision table: 27 cases + 8 single-rule mutants (d0gate/table-cases.js)
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
ok() { echo "ok: $*"; }

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
ok "arms and packs"

echo "=== 4. markers: RED (planted mutants) then GREEN (42 traces really run through the stub) + impact walk ==="
S node "$D0/controls.js" >"$TEST_TMP/controls.out" 2>&1; rc=$?
cat "$TEST_TMP/controls.out"
[ "$rc" = 0 ] || fail "d0gate/controls.js rc=$rc"
grep -q '^NOT-CAUGHT' "$TEST_TMP/controls.out" && fail "a mutant was not caught"
[ "$(grep -c '^RED ' "$TEST_TMP/controls.out")" -ge 12 ] || fail "expected at least 12 RED mutant lines"
[ "$(grep -c '^GREEN ' "$TEST_TMP/controls.out")" = 42 ] || fail "expected 42 GREEN trace lines"
ok "markers"

echo "=== 5. decision table: 27 cases + 8 single-rule mutants ==="
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
ONOFF_MAX_USD=14 S node "$EV/run-d0gate-campaign.js" --results "$TEST_TMP/dry.jsonl" --dry-run >/dev/null 2>"$TEST_TMP/e1"; rc=$?
[ "$rc" = 1 ] && grep -q 'exceeds ONOFF_MAX_USD' "$TEST_TMP/e1" || fail "RED control: cap 14 must refuse (rc=$rc: $(cat "$TEST_TMP/e1"))"; echo "RED (expected) cap 14: $(cat "$TEST_TMP/e1")"
ONOFF_MAX_USD=25 S node "$EV/run-d0gate-campaign.js" --results "$TEST_TMP/dry.jsonl" --dry-run >/dev/null 2>"$TEST_TMP/e2"; rc=$?
[ "$rc" = 2 ] && grep -q 'never raised' "$TEST_TMP/e2" || fail "RED control: cap 25 must be refused (rc=$rc: $(cat "$TEST_TMP/e2"))"; echo "RED (expected) cap 25: $(cat "$TEST_TMP/e2")"
S node "$EV/run-d0gate-campaign.js" --results "$TEST_TMP/cc.jsonl" --runner cc >/dev/null 2>"$TEST_TMP/e3"; rc=$?
[ "$rc" = 2 ] && grep -q 'not stamped' "$TEST_TMP/e3" || fail "RED control: cc formal on a draft prereg must be refused (rc=$rc: $(cat "$TEST_TMP/e3"))"; echo "RED (expected) cc formal, draft: $(cat "$TEST_TMP/e3")"
S node "$EV/run-d0gate-campaign.js" --results "$TEST_TMP/cc.jsonl" --runner cc --pilot >/dev/null 2>"$TEST_TMP/e4"; rc=$?
[ "$rc" = 2 ] && grep -q 'not wired in U1' "$TEST_TMP/e4" || fail "cc pilot must stop at the U1 wall (rc=$rc: $(cat "$TEST_TMP/e4"))"; echo "RED (expected) cc pilot: $(cat "$TEST_TMP/e4")"
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
const r = c.std(["--gate-rules", c.putRules("g1-good.json")], { worker: "clean-g1", env: { D0GATE_NO_DISARM: "1" } });
if (r.rc !== 0) throw new Error("dispatch rc " + r.rc + r.err);
const fstype = cp.spawnSync("findmnt", ["-T", c.root, "-o", "FSTYPE", "-n"], { encoding: "utf8" }).stdout.trim();
if (!/^(tmpfs|ramfs)$/.test(fstype)) throw new Error("cell root is on " + fstype);
const g = path.join(c.live, "per-turn-gate"); const files = fs.readdirSync(g);
if (!files.some((f) => f.endsWith(".gate.json")) || !files.some((f) => /^d0g-.*\.jsonl$/.test(f))) throw new Error("switch file or hook jsonl missing under the cell live dir: " + files);
console.log("cell root on " + fstype + "; switch file + hook jsonl under " + g + ": " + files.join(", "));
c.destroy();' "$D0/.." || fail "isolation"
REAL_XDG="${XDG_RUNTIME_DIR:-/nonexistent}/autopilot"
if [ -d "$REAL_XDG" ] && find "$REAL_XDG" -newer "$T0" -name 'd0g-*' 2>/dev/null | grep -q .; then fail "d0g-* files in the real live store $REAL_XDG"; fi
REAL_HOME_AP="$(getent passwd "$(id -un)" | cut -d: -f6)/.autopilot"
if [ -d "$REAL_HOME_AP" ] && find "$REAL_HOME_AP" -newer "$T0" -name 'd0g-*' 2>/dev/null | grep -q .; then fail "d0g-* files under the real ~/.autopilot"; fi
[ -z "$(find "$HOME/.claude" -newer "$T0" -type f 2>/dev/null)" ] || echo "(scratch CLAUDE_CONFIG_DIR is empty or untouched by design)"
ok "isolation"

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
ok "stamp rehearsal (real row untouched: draft, not in FROZEN.json)"

echo "=== 12. runner sentinel and spend ==="
if [ -s "$SENT/sentinel.log" ]; then echo "sentinel log:"; cat "$SENT/sentinel.log"; fail "a runner binary was called"; fi
echo "sentinel log is empty: no runner binary was started"
ok "zero spend"
echo "PASS: skill-onoff-d0gate"
