#!/usr/bin/env bash
# Harness for `mission-terminal-reconcile.js rollover` and its admission consumer.
#
# The defect: runtime.js fences a same-graph adoption only while the prior Mission is
# UNRESOLVED. After COMPLETE the fence lifts, so every retry mints another permanent
# "current ready" terminal and nothing retires them. Six attempts at one graph left
# five COMPLETE adoptions that all looked authoritative, and admission — correctly —
# refused to guess between them, which blocked every subsequent Mission in the repo.
#
# The load-bearing check is that the canonical adoption's observed_head is an ANCESTOR
# OF HEAD. That is what makes it safe for admission to skip the controller Work Order
# requirement: the WO exists to stop a missing one being read as "first run" and
# replaying an effectful node, and a node whose output is already in shipped history
# cannot be replayed. If that ancestry check ever softens, the exemption becomes
# unsound. Most of this harness exists to keep that one argument honest.
#
# Inputs: a Mission state must satisfy ~20 validator predicates and
# `repo_identity` is bound to the git common dir, so a hand-fabricated JSON
# fixture is not cheap. Instead the harness reads a FROZEN SNAPSHOT of the real
# Mission evidence for the two graphs it needs (c1c6f577: six same-graph adoptions;
# d904c9d1: legacy), committed at hooks/tests/fixtures/mission-terminal-rollover/
# (mission/ = registry + states + journals + evidence, repo identity replaced by a
# placeholder; the sealed graph + sources json beside it). It never reads the host's
# .git/autopilot/mission registry nor docs/mission-next-touch-debt-retirement-*.json,
# so archiving, moving or re-sealing those on the host cannot change this suite's
# result (BL-0129). mission-terminal-reconcile.js and mission-routing-admission.js
# derive their common dir purely from `git -C <repo-root>`, so --repo-root points at
# a SCRATCH CLONE (own independent .git, full history so observed_head ancestry is
# real) — the live .git/autopilot/mission is never touched. A live-store byte-identity
# check at the end is a belt-and-braces guard on top of that isolation.
#
# NOTE: hooks/tests/mission-routing-admission.test.sh is RED on develop independently
# of this work (scripts/verify-preexisting.sh: head=fail, base=fail), so it cannot
# serve as the oracle here.
set -uo pipefail
. "$(dirname "$0")/lib.sh"

LIVE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURE="$LIVE_ROOT/hooks/tests/fixtures/mission-terminal-rollover"
RECONCILE="$LIVE_ROOT/scripts/mission-terminal-reconcile.js"
ADMISSION="$LIVE_ROOT/scripts/mission-routing-admission.js"
PASS=0; FAIL=0

ok()  { PASS=$((PASS+1)); printf 'PASS: %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FAIL: %s\n' "$1"; }
skip() { printf 'SKIP: %s\n' "$1"; SKIP_REASON="$1"; }
# A precondition-less run asserts NOTHING. It must not look like "0 passed, 0 failed" (a green
# summary): print an explicit, greppable SKIP [suite] line on stdout and stderr, and exit 0 only
# because a clean CI checkout legitimately has no Mission registry (hermetic setup is not
# possible: a Mission state needs ~20 validator predicates bound to the real git common dir).
vacuous_exit() {
  printf '\nSKIP [mission-terminal-rollover] VACUOUS RUN - no assertion executed: %s\n' "${SKIP_REASON:-unknown}"
  printf 'SKIP [mission-terminal-rollover] VACUOUS RUN - no assertion executed: %s\n' "${SKIP_REASON:-unknown}" >&2
  exit 0
}
SKIP_REASON=""

LIVE_COMMON="$(git -C "$LIVE_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
LIVE_MROOT="$LIVE_COMMON/autopilot/mission"
LIVE_STORE="$LIVE_MROOT/terminal-rollovers.json"

if [ ! -f "$FIXTURE/mission/registry.json" ]; then
  bad "frozen Mission fixture missing: $FIXTURE/mission/registry.json"
  printf '\n%s: %d passed, %d failed\n' "$(basename "$0")" "$PASS" "$FAIL"
  exit 1
fi

# Byte-identity baseline on the LIVE store, taken before any scratch-clone
# work begins.
LIVE_STORE_HASH_BEFORE="$( [ -f "$LIVE_STORE" ] && sha256sum "$LIVE_STORE" | awk '{print $1}' || echo "absent" )"

SCRATCH_HOME="$(mktemp -d "${TMPDIR:-/tmp}/mission-terminal-rollover-scratch.XXXXXX")"
cleanup_scratch() { rm -rf "$SCRATCH_HOME"; cleanup_test_tmp; }
trap cleanup_scratch EXIT

if ! git clone --quiet --no-hardlinks -- "$LIVE_ROOT" "$SCRATCH_HOME/repo" >/dev/null 2>&1; then
  skip "could not clone the repo into a scratch dir — rollover has nothing safe to act on"
  vacuous_exit
fi
ROOT="$SCRATCH_HOME/repo"

COMMON="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
MROOT="$COMMON/autopilot/mission"
STORE="$MROOT/terminal-rollovers.json"

# Seed the scratch clone's own (isolated) common dir from the frozen snapshot.
# terminal-rollovers.json and legacy-terminal-dispositions.json are the TOOL'S OWN
# OUTPUT, so the snapshot carries neither: both start clean, exactly as on a fresh
# repo, and are (re)derived inside the clone below. The sealed graph + sources are
# overwritten in the clone's tree with their frozen copies so a move/archive of the
# host's docs/ files cannot change what admission reads.
mkdir -p "$(dirname "$MROOT")"
cp -R "$FIXTURE/mission" "$MROOT"
cp "$FIXTURE/mission-next-touch-debt-retirement-execution-graph.json" \
   "$FIXTURE/mission-next-touch-debt-retirement-sources.json" "$ROOT/docs/"

# mission-routing-admission.js additionally requires (unconditionally, not just
# for the graph under test) that registry.json's repo_identity, EVERY mission
# entry's repo_identity, and every mission state's repo_identity equal
# `git-common-dir:<the repo-root passed to it>` exactly — a single foreign
# entry fails admission outright with MISSION_EVIDENCE_CORRUPT before any
# graph-specific logic runs. The copied snapshot is entirely stamped with the
# LIVE host's common dir, which can never equal the scratch clone's own
# (freshly cloned) common dir. Content digests (adoption_key, policy_hash,
# receipt_digest, config_digest, …) are computed over hashes/other content and
# do not incorporate this string, and validateMissionState() does not
# recompute config_digest from config — confirmed empirically before relying
# on it here — so rebinding every occurrence of the literal live identity
# string to the scratch identity is a faithful re-identification of the same
# evidence, not a fabrication of new evidence.
node -e '
const fs = require("fs");
const path = require("path");
const root = process.argv[1];
const oldId = process.argv[2];
const newId = process.argv[3];
function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { walk(p); continue; }
    if (!ent.isFile()) continue;
    let buf;
    try { buf = fs.readFileSync(p, "utf8"); } catch { continue; }
    if (buf.includes(oldId)) fs.writeFileSync(p, buf.split(oldId).join(newId));
  }
}
walk(root);
' "$MROOT" "git-common-dir:@FIXTURE_COMMON_DIR@" "git-common-dir:$COMMON"

# Find a graph that has MORE THAN ONE COMPLETE adoption — the exact condition that
# produces the ambiguity. Without one, there is nothing for rollover to resolve.
read -r GRAPH INTEGRATED OTHER <<EOF
$(node -e '
const fs=require("fs"),path=require("path");
const mroot=process.argv[1];
const reg=JSON.parse(fs.readFileSync(path.join(mroot,"registry.json"),"utf8"));
const byGraph={};
for(const [k,v] of Object.entries(reg.missions||{})){
  if(!v||!v.mission_graph_digest) continue;
  let st;try{st=JSON.parse(fs.readFileSync(path.join(mroot,v.state_ref),"utf8"))}catch{continue}
  (byGraph[v.mission_graph_digest]=byGraph[v.mission_graph_digest]||[]).push({k,state:st.state});
}
for(const [g,list] of Object.entries(byGraph)){
  const complete=list.filter(a=>a.state==="COMPLETE");
  if(complete.length<2) continue;
  // the integrated one is whichever has integrated+zero-residue evidence
  let integrated=null;
  for(const a of complete){
    for(const d of fs.readdirSync(mroot,{withFileTypes:true}).filter(x=>x.isDirectory())){
      const base=path.join(mroot,d.name,a.k);
      if(!fs.existsSync(base))continue;
      for(const at of fs.readdirSync(base).filter(n=>n.startsWith("attempt-"))){
        const b=path.join(base,at,"authority","terminal-bundle.json");
        const l=path.join(base,at,"terminal","icc-lifecycle-receipt.json");
        if(!fs.existsSync(b)||!fs.existsSync(l))continue;
        try{
          const B=JSON.parse(fs.readFileSync(b,"utf8")),L=JSON.parse(fs.readFileSync(l,"utf8"));
          if(B.integration_state==="integrated"&&L.zero_residue===true)integrated=a.k;
        }catch{}
      }
    }
    if(integrated)break;
  }
  if(!integrated)continue;
  const other=complete.find(a=>a.k!==integrated);
  console.log(g,integrated,other?other.k:"");
  break;
}' "$MROOT")
EOF

if [ -z "${GRAPH:-}" ] || [ -z "${INTEGRATED:-}" ]; then
  skip "no graph with multiple COMPLETE adoptions and integration evidence — nothing to roll over"
  vacuous_exit
fi

roll() { node "$RECONCILE" rollover --repo-root "$ROOT" --graph-digest "$GRAPH" --canonical-adoption "$1" 2>&1; }

# ---- a COMPLETE adoption without integration evidence is refused
if [ -n "${OTHER:-}" ]; then
  # buffer first: `cmd | grep -q` under `set -o pipefail` returns 141 (SIGPIPE) when
  # grep exits early on a match, silently inverting every assertion. The repo's own
  # .githooks/pre-push carries the same warning.
  out="$(roll "$OTHER")"
  grep -qE 'ROLLOVER_(INTEGRATION|REPLAY)' <<< "$out" \
    && ok "refuses a COMPLETE adoption lacking integrated/zero-residue evidence" \
    || bad "accepted an adoption with no integration evidence: ${out:0:90}"
else
  skip "no second COMPLETE adoption to test refusal against"
fi

# ---- a nonexistent adoption is refused
out="$(roll "$(printf 'e%.0s' $(seq 64))")"
grep -q 'ROLLOVER_CANONICAL' <<< "$out" \
  && ok "refuses an adoption key that does not belong to the graph" \
  || bad "accepted a foreign adoption key: ${out:0:90}"

# ---- malformed inputs are refused
out="$(node "$RECONCILE" rollover --repo-root "$ROOT" --graph-digest not-a-digest --canonical-adoption "$INTEGRATED" 2>&1)"
grep -q 'ROLLOVER_GRAPH' <<< "$out" \
  && ok "refuses a malformed graph digest" || bad "accepted a malformed graph digest: ${out:0:90}"

# ---- THE load-bearing check: observed_head must be an ancestor of HEAD.
# Temporarily point the evidence at a commit that is not in history and confirm refusal.
EVID="$(node -e '
const fs=require("fs"),path=require("path");
const mroot=process.argv[1], key=process.argv[2];
for(const d of fs.readdirSync(mroot,{withFileTypes:true}).filter(x=>x.isDirectory())){
  const base=path.join(mroot,d.name,key);
  if(!fs.existsSync(base))continue;
  for(const at of fs.readdirSync(base).filter(n=>n.startsWith("attempt-"))){
    const l=path.join(base,at,"terminal","icc-lifecycle-receipt.json");
    if(fs.existsSync(l)){console.log(l);process.exit(0)}
  }
}' "$MROOT" "$INTEGRATED")"

if [ -n "$EVID" ] && [ -f "$EVID" ]; then
  cp "$EVID" "$EVID.testbak"
  [ -f "$STORE" ] && cp "$STORE" "$STORE.testbak"
  rm -f "$STORE"
  # a well-formed SHA that is certainly not in this history
  node -e 'const fs=require("fs");const p=process.argv[1];const d=JSON.parse(fs.readFileSync(p,"utf8"));
    d.observed_head="0123456789abcdef0123456789abcdef01234567";fs.writeFileSync(p,JSON.stringify(d,null,2))' "$EVID"
  out="$(roll "$INTEGRATED")"
  grep -q 'ROLLOVER_NOT_SHIPPED' <<< "$out" \
    && ok "refuses when observed_head is NOT an ancestor of HEAD (replay still possible)" \
    || bad "accepted a rollover whose output is not in shipped history — the WO exemption would be unsound: ${out:0:90}"
  mv "$EVID.testbak" "$EVID"
  [ -f "$STORE.testbak" ] && mv "$STORE.testbak" "$STORE" || rm -f "$STORE"
else
  skip "could not locate lifecycle evidence for the ancestry case"
fi

# ---- the valid canonical is accepted and asserts no fabrication
OUT="$(roll "$INTEGRATED")"
grep -q '"status":"ROLLED_OVER"' < <(printf '%s' "$OUT") \
  && ok "accepts the integrated adoption" || bad "rejected the valid canonical: ${OUT:0:160}"
grep -q '"synthesized_work_orders":0' < <(printf '%s' "$OUT") \
  && grep -q '"mutated_receipts":0' < <(printf '%s' "$OUT") \
  && grep -q '"history_rewritten":false' < <(printf '%s' "$OUT") \
  && ok "asserts zero synthesis, zero mutation, zero history rewrite" \
  || bad "missing the no-fabrication assertions"

# ---- idempotent
grep -q '"writes":0' < <(printf '%s' "$(roll "$INTEGRATED")") \
  && ok "re-running writes nothing (idempotent)" || bad "not idempotent"

# ---- bind the clone's routing config to the graph the rollover fixtures
# actually belong to, before letting admission read $STORE.
#
# The rollover records seeded above (and the $GRAPH digest discovered from the
# copied registry) belong to docs/mission-next-touch-debt-retirement-*.json —
# the historical graph mission-terminal-reconcile.js's own header names
# (c1c6f577…). The LIVE repo's .claude/mission-routing-config.json — which the
# clone inherited via `git clone` — now points at a different, unrelated
# graph (docs/mission-qualification-verdict-stability-*.json) with no legacy
# terminal-rollover records at all, so admission never consults $STORE and the
# tamper below would go undetected for the wrong reason (nothing read the
# file), not because detection works. Point the CLONE's config back at the
# graph these fixtures were minted under so admission's graph digest lines up
# with $GRAPH and it actually loads $STORE.
cat > "$ROOT/.claude/mission-routing-config.json" <<CONFIGJSON
{
  "schema_version": 1,
  "graph_path": "docs/mission-next-touch-debt-retirement-execution-graph.json",
  "sources_path": "docs/mission-next-touch-debt-retirement-sources.json"
}
CONFIGJSON

# The historical graph is sealed (its graph_digest is bound into the rollover
# records), so its reservation paths cannot follow later file moves: it still
# names hooks/tests/dispatch-review.test.sh and hooks/tests/resolve-review-loop.test.sh,
# which were since split into per-topic suites. Admission requires every
# required/output path the graph names to exist, so materialise any such
# absent repo-relative file path in the scratch clone (the clone is
# disposable; the live tree is never touched). Not limited to hooks/tests:
# any host-side move of a path the frozen graph names must not turn this red.
while IFS= read -r p; do
  [ -n "$p" ] && [ ! -e "$ROOT/$p" ] && mkdir -p "$(dirname "$ROOT/$p")" && : > "$ROOT/$p"
done < <(node -e '
const g=require(process.argv[1]);const out=new Set();
JSON.stringify(g,(k,v)=>{if(typeof v==="string"&&/^(hooks|scripts|src|docs|skills|references|agents|platforms|\.claude)\/[A-Za-z0-9_.\/-]+\.[A-Za-z0-9]+$/.test(v))out.add(v);return v});
console.log([...out].join("\n"))' "$ROOT/docs/mission-next-touch-debt-retirement-execution-graph.json")

# requireExactLegacyTerminalDisposition() (mission-routing-admission.js) also
# checks a legacy-terminal-dispositions.json artifact whose current_graph_digest
# field must match the CONFIG's graph digest exactly. The copied snapshot's
# disposition file was stamped against whatever graph the LIVE repo's config
# pointed at when it was last reconciled there — not necessarily $GRAPH — so
# re-derive it inside the clone for $GRAPH before calling admission.
legacy_out="$(node "$RECONCILE" legacy --repo-root "$ROOT" --graph-digest "$GRAPH" 2>&1)"
grep -q '"status":"RECONCILED"' < <(printf '%s' "$legacy_out") \
  && ok "legacy B/C disposition reconciled for the clone's bound graph" \
  || bad "could not reconcile legacy disposition for \$GRAPH: ${legacy_out:0:160}"

# ---- admission ignores a TAMPERED rollover rather than trusting it
if [ -f "$STORE" ]; then
  cp "$STORE" "$STORE.testbak"
  node -e '
    const fs=require("fs");const p=process.argv[1];const d=JSON.parse(fs.readFileSync(p,"utf8"));
    const k=Object.keys(d.rollovers)[0];
    d.rollovers[k].superseded.push({adoption_key:"f".repeat(64),state:"COMPLETE",disposition:"forged"});
    fs.writeFileSync(p,JSON.stringify(d,null,2));' "$STORE"
  # digest no longer matches the body, so the rollover must be discarded and the
  # original ambiguity must come back — a tampered file must never buy admission.
  out="$(node "$ADMISSION" --repo-root "$ROOT" --level l3 2>&1)"
  grep -q 'ambiguous' <<< "$out" \
    && ok "a tampered rollover is discarded and admission returns to fail-closed" \
    || bad "admission trusted a rollover whose digest does not match its body"
  mv "$STORE.testbak" "$STORE"
  out="$(node "$ADMISSION" --repo-root "$ROOT" --level l3 2>&1)"
  grep -q '"status":"READY"' <<< "$out" \
    && ok "restoring the intact rollover restores READY" || bad "READY did not recover after restore"
else
  skip "no rollover store to tamper with"
fi

# Byte-identity proof: the entire harness ran against the scratch clone's own
# common dir, so the LIVE host's store must be untouched.
# Body assertions only: the live-store check below always ok/bad-s, so it must not count.
[ "$PASS" -gt 0 ] || bad "no body assertion executed (a run past the preconditions must assert something)"
LIVE_STORE_HASH_AFTER="$( [ -f "$LIVE_STORE" ] && sha256sum "$LIVE_STORE" | awk '{print $1}' || echo "absent" )"
[ "$LIVE_STORE_HASH_BEFORE" = "$LIVE_STORE_HASH_AFTER" ] \
  && ok "live host mission-terminal-rollovers.json is byte-identical before/after (scratch clone never touched it)" \
  || bad "live host mission-terminal-rollovers.json CHANGED (before=$LIVE_STORE_HASH_BEFORE after=$LIVE_STORE_HASH_AFTER)"

printf '\n%s: %d passed, %d failed\n' "$(basename "$0")" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
