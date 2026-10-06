#!/usr/bin/env bash
# hooks/tests/skill-onoff-arm-builder.test.sh — spend-free proof of the P5 arm builder (plan
# docs/plans/2026-10-06-dev-flow-stage-graph.md §4 P5 item 7). NO live model cell: every "agent" is a stub.
#
#   1. multi-pack arm manifests: --arm-manifest installs ALL manifest skills + the non-skill files + the fixture
#      scripts; overlays beat companions; tamper / unlisted file / bad combos are exit 2; the committed base.json
#      installs from the REAL frozen packs; --fixture-scripts a,b overlays in order
#   2. change freezer: packs hold exactly the working-tree bytes of the prereg list (digests re-derived), siblings
#      stay base bytes, a listed-but-missing file is a deletion, extras get a base pack from guidance.base_ref,
#      an existing id is never mutated (suffix = new ids), unlisted guidance changes are refused
#   3. red builder: graph rotated (re-queried via the pack's own stage-graph.js), size table/list prose rotated,
#      M kept, fixture-scripts pack copy carries the rotated graph
#   4. instrument: a stub agent that FOLLOWS the installed graph passes 12/12 briefs under the change arm and
#      <= 3/12 under the red arm through the real markers + scorer; mutation control: a "red" arm that is really
#      the change arm is NOT-SHIP (the instrument can fail)
#   5. campaign --dry-run: cell counts, resume, cost estimate with its basis; spends nothing

set -euo pipefail
. "$(dirname "$0")/lib.sh"
set -eE
trap 'echo "FAIL: unexpected error at line $LINENO" >&2' ERR

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="$REPO_ROOT/evals/skill-onoff"
fail() { echo "FAIL: $*" >&2; exit 1; }
EXPECTED="$REPO_ROOT/hooks/tests/fixtures/stage-graph/expected.json"
TMP="$TEST_TMP"

# ── fixture: a tiny "guidance repo" + frozen base packs + a minimal packs dir ─────────────────────
FX="$TMP/fx"; PK="$TMP/pk"; ARMS="$TMP/arms"
mkdir -p "$FX/skills/alpha/references" "$FX/skills/beta" "$FX/references" "$FX/project-config-template"
cat > "$FX/skills/alpha/SKILL.md" <<'EOF'
# alpha
| Size | Stages | Files |
|---|---|---|
| XS | implement → qc-gate → finish | ≤2 |
| S | implement → verify → qc-gate → finish | ≤6 |
| M | plan → implement → verify → code-review → qc-gate → finish | ≤20 |
| L | intent → proposal → plan → plan-review → implement → verify → code-review → qc-gate → finish | any |
| XL | as L, units are deliverables | any |

- `XS`: implement → qc-gate → finish
- `L`: intent → plan → implement → finish
EOF
echo "alpha ref x" > "$FX/skills/alpha/references/x.md"
echo "alpha ref gone" > "$FX/skills/alpha/references/gone.md"
echo "alpha sibling (not in prereg list)" > "$FX/skills/alpha/references/sibling.md"
echo "beta v0" > "$FX/skills/beta/SKILL.md"
echo "plan v0" > "$FX/references/plan.md"
echo "extra v0" > "$FX/references/extra.md"
echo "tmpl v0" > "$FX/project-config-template/c.md"
( cd "$FX" && git init -q && git config user.name T && git config user.email t@t && git config commit.gpgsign false \
  && git add -A && git commit -qm base ) >/dev/null
C0=$(git -C "$FX" rev-parse HEAD)

mkdir -p "$PK"
cp -r "$BASE/packs/companions" "$PK/companions"
cp -r "$BASE/packs/fixture-scripts-sg" "$PK/fixture-scripts-sg"
cp -r "$BASE/packs/fixture-scripts-w2a" "$PK/fixture-scripts-w2a"
node - "$BASE/packs/manifest.json" "$PK/manifest.json" <<'NODE'
const fs = require('fs');
const [src, dst] = process.argv.slice(2);
const m = JSON.parse(fs.readFileSync(src, 'utf8'));
const keep = ['companions', 'fixture-scripts-sg', 'fixture-scripts-w2a'];
fs.writeFileSync(dst, JSON.stringify({ schema_version: 1, artifact_type: 'skill_onoff_packs', frozen_at: 't', note: 'test', packs: Object.fromEntries(keep.map((k) => [k, m.packs[k]])), pack_meta: {} }, null, 2));
NODE
export ONOFF_PACKS_DIR="$PK"
for s in alpha beta; do
  mkdir -p "$TMP/b-$s"; git -C "$FX" archive "$C0" "skills/$s" | tar -x -C "$TMP/b-$s"
  node "$BASE/freeze-pack.js" --id "$s-sg-base" --from-dir "$TMP/b-$s/skills/$s" --ref "$C0" >/dev/null
done
mkdir -p "$TMP/b-files"; git -C "$FX" archive "$C0" references/plan.md project-config-template | tar -x -C "$TMP/b-files"
node "$BASE/freeze-pack.js" --id guidance-files-sg-base --from-dir "$TMP/b-files" --ref "$C0" >/dev/null

# fixture prereg = the real prereg with a toy guidance block (tasks / answer keys / thresholds stay real; reps 2, no generic)
PREREG="$TMP/prereg.json"
node - "$BASE/prereg/stage-graph.json" "$PREREG" "$C0" <<'NODE'
const fs = require('fs');
const [src, dst, c0] = process.argv.slice(2);
const p = JSON.parse(fs.readFileSync(src, 'utf8'));
p.reps = 2;
p.generic = { tasks: [], rule: 'none in this toy prereg' };
p.guidance = { base_ref: c0, skills: ['alpha', 'beta'], pack_ids: p.guidance.pack_ids,
  non_skill_files: ['references/plan.md', 'project-config-template/c.md'],
  files: ['project-config-template/c.md', 'references/plan.md', 'skills/alpha/SKILL.md', 'skills/alpha/references/gone.md', 'skills/alpha/references/x.md', 'skills/beta/SKILL.md'] };
fs.writeFileSync(dst, JSON.stringify(p, null, 2));
NODE
FGA() { node "$BASE/freeze-guidance-arm.js" "$@" --prereg "$PREREG" --repo "$FX" --arms-dir "$ARMS"; }

# working-tree edits the change arm must capture
echo "beta v1 (changed)" > "$FX/skills/beta/SKILL.md"
echo "plan v1 (changed)" > "$FX/references/plan.md"
echo "alpha ref x v1" > "$FX/skills/alpha/references/x.md"
rm "$FX/skills/alpha/references/gone.md"
echo "extra v1 (changed)" > "$FX/references/extra.md"
sha() { sha256sum "$1" | cut -d' ' -f1; }
pj() { node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));const v=process.argv[1].split(".").reduce((o,k)=>o==null?o:o[k],j);process.stdout.write(typeof v==="object"?JSON.stringify(v):String(v))' "$1"; }

echo "=== 2. change freezer ==="
# an unlisted guidance change inside a frozen skill tree is refused (the cut gate would reject it)
echo "alpha sibling EDITED" > "$FX/skills/alpha/references/sibling.md"
if FGA change --extra references/extra.md >/dev/null 2>"$TMP/e1"; then fail "unlisted working-tree change must be refused"; fi
grep -q "outside the prereg file list" "$TMP/e1" || fail "refusal reason: $(cat "$TMP/e1")"
[ ! -d "$PK/alpha-sg-change" ] || fail "a refused freeze must write nothing"
echo "alpha sibling (not in prereg list)" > "$FX/skills/alpha/references/sibling.md"
# extras under skills/ cannot join a frozen skill base
if FGA change --extra skills/alpha/references/new.md >/dev/null 2>&1; then fail "skills/ extra must be refused"; fi

out=$(FGA change --extra references/extra.md) || fail "change freeze failed"
[ "$(pj prereg_amendment.add_to_guidance_files_and_non_skill_files <<<"$out")" = '["references/extra.md"]' ] || fail "extra not reported for prereg amendment: $out"
dig() { node -e 'const m=require(process.argv[1]).packs[process.argv[2]];process.stdout.write(m[process.argv[2]+"/"+process.argv[3]]||"")' "$PK/manifest.json" "$1" "$2"; }
[ "$(dig beta-sg-change SKILL.md)" = "$(sha "$FX/skills/beta/SKILL.md")" ] || fail "beta-sg-change digest != working-tree bytes"
[ "$(dig alpha-sg-change references/x.md)" = "$(sha "$FX/skills/alpha/references/x.md")" ] || fail "alpha x.md digest"
[ "$(dig alpha-sg-change references/sibling.md)" = "$(dig alpha-sg-base references/sibling.md)" ] || fail "unlisted sibling must stay the base bytes"
[ -z "$(dig alpha-sg-change references/gone.md)" ] && [ ! -e "$PK/alpha-sg-change/references/gone.md" ] || fail "a listed file missing from the tree must be a deletion"
[ "$(dig guidance-files-sg-change references/plan.md)" = "$(sha "$FX/references/plan.md")" ] || fail "files pack plan.md"
[ "$(dig guidance-files-sg-change references/extra.md)" = "$(sha "$FX/references/extra.md")" ] || fail "files pack must carry the extra from the working tree"
[ "$(dig guidance-files-sg-extra-base references/extra.md)" = "$(git -C "$FX" show "$C0:references/extra.md" | sha256sum | cut -d' ' -f1)" ] || fail "extra base must come from base_ref"
[ "$(sha "$PK/guidance-files-sg-change/references/plan.md")" = "$(dig guidance-files-sg-change references/plan.md)" ] || fail "pack bytes != recorded digest"
node -e 'const m=require(process.argv[1]);for(const id of ["alpha-sg-change","guidance-files-sg-change","guidance-files-sg-extra-base"]){const x=m.pack_meta[id];if(!x||!x.ref||!x.files)process.exit(1)}' "$PK/manifest.json" || fail "pack_meta missing"
[ "$(pj skills.alpha < "$ARMS/change.json")" = "alpha-sg-change" ] && [ "$(pj files < "$ARMS/change.json")" = "guidance-files-sg-change" ] || fail "change.json shape"
[ "$(pj files < "$ARMS/base.json")" = '["guidance-files-sg-base","guidance-files-sg-extra-base"]' ] || fail "base.json must carry the extras' base pack: $(cat "$ARMS/base.json")"
# never mutate: same ids again is an error; a suffix makes NEW ids and leaves the old ones byte-identical
before=$(sha "$PK/manifest.json")
if FGA change --extra references/extra.md >/dev/null 2>&1; then fail "re-freeze of existing ids must be refused"; fi
[ "$(sha "$PK/manifest.json")" = "$before" ] || fail "refused re-freeze mutated the manifest"
FGA change --extra references/extra.md --suffix v2 >/dev/null || fail "suffix freeze"
[ -d "$PK/beta-sg-change-v2" ] && [ "$(sha "$PK/beta-sg-change/SKILL.md")" = "$(dig beta-sg-change SKILL.md)" ] || fail "suffix must add new ids and keep old"
if FGA change --extra references/extra.md --suffix v2 >/dev/null 2>&1; then fail "dup suffix"; fi
# restore the canonical (unsuffixed) change arm manifest for the next sections
FGA base >/dev/null
node - "$ARMS/change.json" <<'NODE'
const fs = require('fs'); const f = process.argv[2];
const j = JSON.parse(fs.readFileSync(f, 'utf8'));
j.skills = { alpha: 'alpha-sg-change', beta: 'beta-sg-change' }; j.files = 'guidance-files-sg-change'; j.fixture_scripts = ['fixture-scripts-sg'];
fs.writeFileSync(f, JSON.stringify(j, null, 2));
NODE

echo "=== 3. red builder ==="
out=$(FGA red --require-text) || fail "red build failed: $out"
[ "$(pj graph_self_check <<<"$out")" = ok ] || fail "graph self check: $out"
RT="$PK/alpha-sg-red/SKILL.md"
grep -q '^| XS | intent → proposal → plan → plan-review → implement → verify → code-review → qc-gate → finish | ≤2 |$' "$RT" || fail "red XS table row not rotated to L's sequence: $(grep '^| XS' "$RT")"
grep -q '^| L | implement → qc-gate → finish | any |$' "$RT" || fail "red L table row not rotated: $(grep '^| L ' "$RT")"
grep -q '^| S | as L, units are deliverables | ≤6 |$' "$RT" || fail "red S row must take XL's 'as L' cell: $(grep '^| S ' "$RT")"
grep -q '^| XL | implement → verify → qc-gate → finish | any |$' "$RT" || fail "red XL row"
grep -q '^| M | plan → implement → verify → code-review → qc-gate → finish | ≤20 |$' "$RT" || fail "M must be unchanged"
grep -q '^- `XS`: intent → plan → implement → finish$' "$RT" && grep -q '^- `L`: implement → qc-gate → finish$' "$RT" || fail "list lines not rotated"
[ "$(sha "$PK/beta-sg-red/SKILL.md")" = "$(sha "$PK/beta-sg-change/SKILL.md")" ] || fail "a pack with no size prose must be copied unchanged"
RG="$PK/fixture-scripts-sg-red"
q() { node "$1/scripts/stage-graph.js" nodes "${@:2}"; }
for sz in XS S M L XL; do
  want=$(node -e 'process.stdout.write(JSON.stringify({XS:"L",L:"XS",S:"XL",XL:"S",M:"M"}[process.argv[1]]))' "$sz" | tr -d '"')
  [ "$(q "$RG" --size "$sz" | pj walk)" = "$(q "$PK/fixture-scripts-sg" --size "$want" | pj walk)" ] || fail "red graph: $sz must walk $want's base sequence"
done
[ "$(q "$RG" --size M | pj walk)" = "$(q "$PK/fixture-scripts-sg" --size M | pj walk)" ] || fail "M must keep its sequence"
[ "$(q "$RG" --size XS | pj walk)" != "$(q "$PK/fixture-scripts-sg" --size XS | pj walk)" ] || fail "red XS must differ from base XS"
[ "$(node "$RG/scripts/stage-graph.js" limits --size XS | pj lines)" = 20 ] || fail "bump limits must not be rotated (the size recorded is not rotated)"
[ "$(pj fixture_scripts < "$ARMS/red.json")" = '["fixture-scripts-sg-red"]' ] && [ "$(pj skills.beta < "$ARMS/red.json")" = "beta-sg-red" ] && [ "$(pj arm < "$ARMS/red.json")" = red ] || fail "red.json shape"
# pack identity: only the graph differs between the fixture-scripts packs
n=$( (diff -rq "$PK/fixture-scripts-sg" "$RG" || true) | wc -l); [ "$n" -eq 1 ] || fail "fixture-scripts-sg-red may differ from the base pack only in references/stage-graph.json ($n files differ)"
# a change arm without a graph-bearing fixture pack is refused (the red agent would see nothing rotated)
node - "$ARMS/change.json" "$TMP/nograph-arms" <<'NODE'
const fs = require('fs'); const [f, d] = process.argv.slice(2);
const j = JSON.parse(fs.readFileSync(f, 'utf8')); j.fixture_scripts = ['fixture-scripts-w2a'];
fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(`${d}/change.json`, JSON.stringify(j));
NODE
if node "$BASE/freeze-guidance-arm.js" red --prereg "$PREREG" --arms-dir "$TMP/nograph-arms" --suffix ng >/dev/null 2>&1; then fail "red without a graph-bearing fixture pack must be refused"; fi

echo "=== 1. multi-pack arm install ==="
STUB="$TMP/stub.sh"
cat > "$STUB" <<'EOF'
#!/usr/bin/env bash
set -eu
rm -rf "$STUB_DUMP"; mkdir -p "$STUB_DUMP"
cp -r "$ONOFF_PLUGIN_DIR" "$STUB_DUMP/plugin"; cp -r . "$STUB_DUMP/repo"
echo "arm=$ONOFF_ARM"
EOF
chmod +x "$STUB"
export ONOFF_STUB_BIN="$STUB"
cell() { # $1 dump dir, rest = args
  local d=$1; shift
  STUB_DUMP="$d" bash "$BASE/run-skill-onoff-eval.sh" --runner stub --model m --task d1-s-tiny-feature --out "$TMP/out-$(basename "$d")" "$@"
}
row=$(cell "$TMP/dump-change" --arm-manifest "$ARMS/change.json") || fail "change cell"
[ "$(pj arm <<<"$row")" = change ] && [ "$(pj check_skill <<<"$row")" = dev-flow ] || fail "row arm/check_skill: $row"
P1="$TMP/dump-change/plugin"
[ "$(sha "$P1/skills/beta/SKILL.md")" = "$(sha "$PK/beta-sg-change/SKILL.md")" ] || fail "beta skill not installed from its change pack"
[ "$(sha "$P1/skills/alpha/references/x.md")" = "$(sha "$PK/alpha-sg-change/references/x.md")" ] && [ -f "$P1/skills/alpha/references/sibling.md" ] && [ ! -e "$P1/skills/alpha/references/gone.md" ] || fail "alpha pack tree wrong"
[ "$(sha "$P1/references/plan.md")" = "$(sha "$PK/guidance-files-sg-change/references/plan.md")" ] && [ -f "$P1/project-config-template/c.md" ] && [ -f "$P1/references/extra.md" ] || fail "non-skill guidance files not at the plugin root"
[ ! -e "$TMP/dump-change/repo/references/plan.md" ] || fail "guidance files must not land in the fixture repo"
R1="$TMP/dump-change/repo"
for f in scripts/session-mode.js scripts/stage-advance.js scripts/stage-graph.js scripts/probe-unknown.js references/stage-graph.json; do
  [ "$(sha "$R1/$f")" = "$(sha "$PK/fixture-scripts-sg/$f")" ] || fail "fixture script $f missing/different in the cell repo"
done
[ "$(git -C "$R1" ls-files scripts/stage-advance.js)" = scripts/stage-advance.js ] || fail "fixture scripts must be in the frozen base commit"
# companions with a manifest skill's name are replaced, others stay
for c in $(ls "$PK/companions"); do
  case "$c" in alpha|beta) ;; *) [ -d "$P1/skills/$c" ] || fail "companion $c lost";; esac
done
# red arm: the SAME stub cell sees the rotated graph in the repo it runs in
cell "$TMP/dump-red" --arm-manifest "$ARMS/red.json" >/dev/null || fail "red cell"
[ "$(sha "$TMP/dump-red/repo/references/stage-graph.json")" = "$(sha "$RG/references/stage-graph.json")" ] || fail "red cell repo lacks the rotated graph"
[ "$(sha "$TMP/dump-red/repo/references/stage-graph.json")" != "$(sha "$R1/references/stage-graph.json")" ] || fail "red graph == change graph"
[ "$(sha "$TMP/dump-red/plugin/skills/alpha/SKILL.md")" = "$(sha "$RT")" ] || fail "red alpha text not installed"
# --fixture-scripts a,b overlays in order, later wins; the manifest's pack comes last
cell "$TMP/dump-ov" --arm-manifest "$ARMS/change.json" --fixture-scripts fixture-scripts-w2a >/dev/null || fail "overlay cell"
[ "$(sha "$TMP/dump-ov/repo/scripts/session-mode.js")" = "$(sha "$PK/fixture-scripts-sg/scripts/session-mode.js")" ] || fail "manifest fixture pack must overlay the row's pack"
[ -f "$TMP/dump-ov/repo/scripts/decision-ledger.js" ] || fail "row fixture pack missing from the overlay"
# error paths
expect_rc2() { local d="$1"; shift; if cell "$TMP/dump-$d" "$@" >/dev/null 2>"$TMP/e-$d"; then fail "expected exit 2: $d"; fi; }
expect_rc2 combo --arm-manifest "$ARMS/change.json" --skill alpha
expect_rc2 mism --arm-manifest "$ARMS/change.json" --arm red
echo tamper >> "$PK/beta-sg-change/SKILL.md"; expect_rc2 tamper --arm-manifest "$ARMS/change.json"; echo "beta v1 (changed)" > "$PK/beta-sg-change/SKILL.md"
[ "$(sha "$PK/beta-sg-change/SKILL.md")" = "$(dig beta-sg-change SKILL.md)" ] || fail "test restore of the tampered file"
echo stray > "$PK/beta-sg-change/stray.md"; expect_rc2 stray --arm-manifest "$ARMS/change.json"; rm "$PK/beta-sg-change/stray.md"
printf '{"schema_version":1,"arm":"x","skills":{"alpha":"../etc"}}' > "$TMP/bad.json"; expect_rc2 badname --arm-manifest "$TMP/bad.json"
printf '{"schema_version":1,"arm":"x","skills":{"alpha":"no-such-pack"}}' > "$TMP/bad2.json"; expect_rc2 nopack --arm-manifest "$TMP/bad2.json"
printf '{"schema_version":1,"arm":"x"}' > "$TMP/bad3.json"; expect_rc2 empty --arm-manifest "$TMP/bad3.json"
# the COMMITTED base arm installs from the REAL frozen packs (16 skills + files + fixture scripts, all digest-verified)
unset ONOFF_PACKS_DIR
row=$(cell "$TMP/dump-realbase" --arm-manifest "$BASE/arms/stage-graph/base.json" --fixture-scripts fixture-scripts-w2a) || fail "real base arm cell"
[ "$(pj arm <<<"$row")" = base ] || fail "real base row"
n=$(node -e 'process.stdout.write(String(Object.keys(require(process.argv[1]).skills).length))' "$BASE/arms/stage-graph/base.json"); [ "$n" -eq 16 ] || fail "base arm must list 16 skills, got $n"
for s in dev-flow finish-flow ceo-agent team debug think-tank l4 l5 l6 next quality-pipeline distill doc-sync learn project-lifecycle research-to-ship; do
  [ "$(sha "$TMP/dump-realbase/plugin/skills/$s/SKILL.md")" = "$(sha "$BASE/packs/$s-sg-base/SKILL.md")" ] || fail "real base: $s not installed from $s-sg-base"
done
[ -f "$TMP/dump-realbase/plugin/references/plan-template.md" ] && [ -f "$TMP/dump-realbase/plugin/project-config-template/review-loop-config.md" ] || fail "real base: guidance files absent"
[ "$(sha "$TMP/dump-realbase/repo/scripts/stage-graph.js")" = "$(sha "$BASE/packs/fixture-scripts-sg/scripts/stage-graph.js")" ] || fail "real base: fixture scripts"
export ONOFF_PACKS_DIR="$PK"

echo "=== 4. instrument: a stub agent following the INSTALLED graph, through real markers + scorer ==="
AGENT="$TMP/agent.js"
cat > "$AGENT" <<'NODE'
#!/usr/bin/env node
// stub depth-0: asks the INSTALLED graph (scripts/stage-graph.js in its cwd) for its walk, then emits the
// stream-json an agent that followed it would have produced. No model; no knowledge of the answer's walk.
const fs = require('fs');
const cp = require('child_process');
const path = require('path');
const base = process.env.SG_BASE;
const ans = JSON.parse(fs.readFileSync(path.join(base, 'tasks', process.env.ONOFF_TASK, 'answer.json'), 'utf8'));
const args = ['scripts/stage-graph.js', 'nodes', '--size', ans.size, '--units', String(ans.units)];
if (ans.bug) args.push('--bug');
if (ans.urgent) args.push('--urgent');
if (/urgent-high/.test(ans.cell)) args.push('--high-risk');
if (/\.research\./.test(ans.cell)) args.push('--research');
const graph = JSON.parse(cp.execFileSync('node', args, { encoding: 'utf8' }));
let n = 0;
const out = [];
const use = (cmd, result) => {
  const id = `tu${++n}`;
  out.push(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command: cmd } }] } }));
  out.push(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: false, content: result }] } }));
};
use(`node scripts/session-mode.js set --size ${ans.size}${ans.bug ? ' --bug' : ''}${ans.urgent ? ' --urgent' : ''}`, '{"ok":true}');
// amend-2-instrument: the U0 brief is scored on consistency with the probe, so that stub runs the REAL classify on a term the repo contains
if (ans.first_rung === 'U0') {
  const real = cp.execFileSync('node', ['scripts/probe-unknown.js', 'classify', '--ledger', path.join(require('os').tmpdir(), `sg-stub-${process.pid}.jsonl`), '--terms', 'scheduler,retry'], { encoding: 'utf8' });
  use('node scripts/probe-unknown.js classify --terms scheduler,retry', real);
} else if (ans.first_rung !== 'none') use('node scripts/probe-unknown.js classify --terms x', JSON.stringify({ eligible_max: ans.first_rung, recommend: ans.first_rung }));
for (const node of graph.walk.slice(0, ans.horizon_index + 1)) use(`node scripts/stage-advance.js --to ${node}`, JSON.stringify({ allowed: true, to: node })); // amend-3: the written node is read from the invocation's JSON
fs.writeFileSync('agent-work.txt', 'did work\n');
if (process.env.SG_PROMPT_LOG && process.argv[2]) fs.appendFileSync(process.env.SG_PROMPT_LOG, `${fs.readFileSync(process.argv[2], 'utf8').split('\n')[0]}\n`);
process.stdout.write(`${out.join('\n')}\n`);
NODE
cat > "$TMP/agent.sh" <<EOF
#!/usr/bin/env bash
exec node "$AGENT" "\$@"
EOF
chmod +x "$TMP/agent.sh"
export SG_BASE="$BASE" ONOFF_SG_EXPECTED="$EXPECTED"
export ONOFF_STUB_BIN="$TMP/agent.sh"
RES="$TMP/res.jsonl"; export SG_PROMPT_LOG="$TMP/prompts.log"
CAMP() { node "$BASE/run-stage-graph-campaign.js" --runner stub --model sonnet --reps 2 --prereg "$PREREG" --arms-dir "$ARMS" --skip-generic "$@"; }
set +e; CAMP --results "$RES" > "$TMP/camp.out" 2> "$TMP/camp.err"; rc=$?; set -e
[ "$rc" -eq 0 ] || fail "campaign (stub) rc=$rc: $(tail -3 "$TMP/camp.out") $(tail -3 "$TMP/camp.err")"
verdict=$(tail -1 "$TMP/camp.out")
[ "$(pj verdict <<<"$verdict")" = SHIP ] || fail "verdict: $verdict"
[ "$(pj counts.change.passed <<<"$verdict")" = 12 ] || fail "change arm must pass 12/12 for an agent following the real graph: $verdict"
red=$(pj counts.red.passed <<<"$verdict")
[ "$red" -le 3 ] || fail "red arm passed $red/12, planted red must pass <= 3"
for t in stage-graph-m-feature stage-graph-m-bug stage-graph-m-urgent-high; do [ "$(pj "counts.red.per_task.$t" <<<"$verdict")" -eq 2 ] || fail "red must keep $t"; done
for t in stage-graph-xs-feature stage-graph-s-feature stage-graph-l-feature stage-graph-xl-deliverable stage-graph-xs-bug stage-graph-s-urgent stage-graph-l-u0-known stage-graph-l-research-a stage-graph-l-research-b; do
  [ "$(pj "counts.red.per_task.$t" <<<"$verdict")" -eq 0 ] || fail "red must break $t"
done
# invocation preface (prereg/stage-graph.amend-1-invocation.json): a bare task.md never loads the skill in headless -p
# (live 2026-10-06: 6-8 s cells, skill_invoked false). EVERY stage-graph cell, both arms, must carry the same skill-only preface.
[ "$(wc -l < "$SG_PROMPT_LOG")" -eq 48 ] && [ "$(sort -u "$SG_PROMPT_LOG")" = "Use dev-flow:" ] || fail "every stage-graph cell prompt must start with 'Use dev-flow:' (got: $(sort -u "$SG_PROMPT_LOG" | head -3))"
node -e 'const a=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(a.ONOFF_PROMPT_PREFIX!=="Use dev-flow:"||/size|bug|urgent|stage|\bXS\b|\bXL\b/i.test(a.ONOFF_PROMPT_PREFIX))process.exit(1)' "$BASE/prereg/stage-graph.amend-1-invocation.json" || fail "amendment prefix must equal the campaign's and name only the skill"
# cell retention (prereg/stage-graph.amend-2-instrument.json fix 1): the stub campaign leaves every cell's artifacts next to the results file
KEEP="$TMP/stage-graph-cells"
[ "$(find "$KEEP" -name transcript.jsonl | wc -l)" -eq 48 ] || fail "retention: expected 48 retained transcripts under $KEEP, got $(find "$KEEP" -name transcript.jsonl | wc -l)"
for f in prompt.md stage-graph-extracted.json result.json markers.env; do [ "$(find "$KEEP" -name "$f" | wc -l)" -eq 48 ] || fail "retention: $f missing from some cell"; done
K1="$KEEP/stage-graph-l-u0-known/change/1"
[ -s "$K1/transcript.jsonl" ] && [ "$(pj observed.rung_check.mode < "$K1/stage-graph-extracted.json")" = consistency ] && [ "$(pj judged.rung < "$K1/stage-graph-extracted.json")" = true ] || fail "retention: l-u0-known extraction must carry the consistency verdict: $(cat "$K1/stage-graph-extracted.json" | head -c 600)"
# resume: re-running the same command runs no cell
set +e; CAMP --results "$RES" > "$TMP/camp2.out" 2>/dev/null; set -e
grep -q "ran=0" "$TMP/camp2.out" || fail "resume must skip finished cells: $(grep matrix "$TMP/camp2.out")"
[ "$(wc -l < "$RES")" -eq 48 ] || fail "expected 48 rows (12 tasks x 2 arms x 2 reps), got $(wc -l < "$RES")"
# mutation control: a "red" arm that is really the change arm is NOT-SHIP (the planted red must be able to fail the ship rule)
mkdir -p "$TMP/ctl-arms"; cp "$ARMS/change.json" "$TMP/ctl-arms/change.json"
node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));j.arm="red";fs.writeFileSync(process.argv[2],JSON.stringify(j))' "$ARMS/change.json" "$TMP/ctl-arms/red.json"
grep '"arm":"change"' "$RES" > "$TMP/res-ctl.jsonl"
if node "$BASE/run-stage-graph-campaign.js" --runner stub --model sonnet --reps 2 --prereg "$PREREG" --arms-dir "$TMP/ctl-arms" --skip-generic --results "$TMP/res-ctl.jsonl" > "$TMP/ctl.out" 2>/dev/null; then rc=0; else rc=$?; fi
[ "$rc" -eq 3 ] || fail "un-rotated red must be NOT-SHIP (exit 3), got rc=$rc: $(tail -1 "$TMP/ctl.out")"
[ "$(pj counts.red.passed < <(tail -1 "$TMP/ctl.out"))" = 12 ] || fail "control: red arm == change arm must pass 12"

echo "=== 5. campaign --dry-run ==="
unset ONOFF_STUB_BIN
d=$(node "$BASE/run-stage-graph-campaign.js" --results "$TMP/dry.jsonl" --dry-run | tail -1)
[ "$(pj cells_total <<<"$d")" -eq 114 ] && [ "$(pj stage_graph_cells_todo <<<"$d")" -eq 72 ] && [ "$(pj generic_cells_todo <<<"$d")" -eq 42 ] || fail "default dry-run cell counts: $d"
[ "$(pj dry_run <<<"$d")" = true ] && [ "$(pj model <<<"$d")" = sonnet ] && [ "$(pj reps <<<"$d")" -eq 3 ] || fail "dry-run header: $d"
node -e 'const j=JSON.parse(process.argv[1]);const e=j.estimated_cost_usd;if(!(e.low>0&&e.low<e.typical&&e.typical<e.high)||!j.cost_basis.source||!j.cost_basis.measured_cells)process.exit(1)' "$d" || fail "cost estimate / basis: $d"
[ "$(node "$BASE/run-stage-graph-campaign.js" --results "$TMP/dry.jsonl" --dry-run | grep -c '^todo ')" -eq 114 ] || fail "dry-run must list every cell"
[ "$(node "$BASE/run-stage-graph-campaign.js" --results "$TMP/dry.jsonl" --dry-run --skip-generic | tail -1 | pj cells_total)" -eq 72 ] || fail "--skip-generic count"
[ "$(node "$BASE/run-stage-graph-campaign.js" --results "$TMP/dry.jsonl" --dry-run --with-base | tail -1 | pj cells_total)" -eq 150 ] || fail "--with-base count"
# resume accounting: one done row + one infra_fail row
printf '%s\n' '{"task_id":"stage-graph-xs-feature","arm":"change","rep":1,"failure_class":null}' '{"task_id":"stage-graph-xs-feature","arm":"red","rep":1,"failure_class":"infra_fail"}' > "$TMP/dry2.jsonl"
d2=$(node "$BASE/run-stage-graph-campaign.js" --results "$TMP/dry2.jsonl" --dry-run | tail -1)
[ "$(pj cells_done <<<"$d2")" -eq 1 ] && [ "$(pj cells_todo <<<"$d2")" -eq 113 ] || fail "resume accounting: $d2"
[ ! -s "$TMP/dry.jsonl" ] || fail "dry-run must not write results"
if node "$BASE/run-stage-graph-campaign.js" --results "$TMP/x.jsonl" --model opus --dry-run >/dev/null 2>&1; then fail "a live-model other than the prereg's must be refused"; fi

echo "PASS: skill-onoff-arm-builder"
