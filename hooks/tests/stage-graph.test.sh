#!/usr/bin/env bash
# hooks/tests/stage-graph.test.sh — scripts/stage-graph.js vs the P0 frozen fixture (plan §2.7, P1).
# Every one of the 84 cells of expected.json must be reproduced exactly (nodes/walk/entry/terminal/unit_kind),
# plus the named acceptance stdouts, limits, and `validate` exit codes (planted unreachable node -> exit 1).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SG="$REPO_ROOT/scripts/stage-graph.js"
FIXTURE="$REPO_ROOT/hooks/tests/fixtures/stage-graph/expected.json"
TEST_TMP=$(mktemp -d -t "stage-graph-test-XXXXXX")
trap 'rm -rf "$TEST_TMP"' EXIT
PASS=0; FAILS=0
ok() { PASS=$((PASS+1)); echo "ok: $*"; }
bad() { FAILS=$((FAILS+1)); echo "FAIL: $*" >&2; }
eq() { # name expected actual
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1: expected [$2] got [$3]"; fi
}

# --- every fixture cell ---------------------------------------------------------
CELLS=$(FIXTURE="$FIXTURE" SG="$SG" node -e '
const { spawnSync } = require("child_process");
const d = require(process.env.FIXTURE);
let n = 0, fails = [];
for (const c of d.cells) {
  const a = [process.env.SG, "nodes", "--size", c.size, "--units", String(c.units)];
  if (c.bug) a.push("--bug");
  if (c.urgent) a.push("--urgent");
  if (c.urgency === "urgent-high") a.push("--high-risk");
  if (c.research === "research") a.push("--research");
  const r = spawnSync("node", a, { encoding: "utf8" });
  let got = {};
  try { got = JSON.parse(r.stdout); } catch (e) {}
  for (const k of ["nodes", "walk", "entry", "terminal", "unit_kind"]) {
    if (JSON.stringify(got[k]) !== JSON.stringify(c[k])) fails.push(c.id + ":" + k);
  }
  n++;
}
console.log(n + " " + fails.length + " " + fails.slice(0, 5).join(","));
')
set -- $CELLS
eq "fixture cell count" "84" "$1"
eq "fixture cells mismatching" "0" "$2"

# --- named acceptance cases -----------------------------------------------------
eq "XS walk" '["implement","qc-gate","finish"]' "$(node "$SG" nodes --size XS | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s).walk)))')"
eq "next verify L" '["code-review","implement"]' "$(node "$SG" next --from verify --size L)"
eq "next finish M urgent" '["code-review"]' "$(node "$SG" next --from finish --size M --urgent)"
eq "next code-review M urgent" '[]' "$(node "$SG" next --from code-review --size M --urgent)"
eq "next code-review M normal" '["implement","qc-gate"]' "$(node "$SG" next --from code-review --size M)"
eq "next intent L (research optional)" '["proposal","research"]' "$(node "$SG" next --from intent --size L)"
eq "next verify S (unit repeat vs qc-gate)" '["implement","qc-gate"]' "$(node "$SG" next --from verify --size S)"

# --- limits (equal fits; L/XL unlimited) -----------------------------------------
eq "limits XS" '{"size":"XS","files":2,"lines":20}' "$(node "$SG" limits --size XS)"
eq "limits S" '{"size":"S","files":6,"lines":200}' "$(node "$SG" limits --size S)"
eq "limits M" '{"size":"M","files":20,"lines":800}' "$(node "$SG" limits --size M)"
eq "limits L" '{"size":"L","files":null,"lines":null}' "$(node "$SG" limits --size L)"
eq "limits XL" '{"size":"XL","files":null,"lines":null}' "$(node "$SG" limits --size XL)"

# --- validate ---------------------------------------------------------------------
node "$SG" validate >/dev/null 2>&1 && ok "validate shipped graph exit 0" || bad "validate shipped graph"
node -e '
const g = require(process.argv[1]);
g.node_ids.push("ghost");
require("fs").writeFileSync(process.argv[2], JSON.stringify(g));
' "$REPO_ROOT/references/stage-graph.json" "$TEST_TMP/unreachable.json"
rc=0; node "$SG" validate --graph "$TEST_TMP/unreachable.json" >"$TEST_TMP/o1" 2>/dev/null || rc=$?
eq "validate unreachable exits 1" "1" "$rc"
grep -q 'unreachable node: ghost' "$TEST_TMP/o1" && ok "unreachable node named" || bad "unreachable node not named"
node -e '
const g = require(process.argv[1]);
delete g.loop_backs;
require("fs").writeFileSync(process.argv[2], JSON.stringify(g));
' "$REPO_ROOT/references/stage-graph.json" "$TEST_TMP/badschema.json"
rc=0; node "$SG" validate --graph "$TEST_TMP/badschema.json" >/dev/null 2>&1 || rc=$?
eq "validate schema error exits 1" "1" "$rc"
rc=0; node "$SG" nodes --size ZZ >/dev/null 2>&1 || rc=$?
eq "unknown size exits 2" "2" "$rc"

echo "stage-graph.test: pass=$PASS fail=$FAILS"
[ "$FAILS" -eq 0 ]
