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
# Why it runs against a clone of the REAL repository rather than a synthetic
# fixture: a Mission state must satisfy ~20 validator predicates and
# `repo_identity` is bound to the git common dir, so a hand-fabricated JSON
# fixture is neither cheap nor more faithful. Every case below either makes no
# writes or restores what it touched — but "restores" is not enough on its
# own: mission-terminal-reconcile.js and mission-routing-admission.js derive
# their common dir purely from `git -C <repo-root>`, so pointing --repo-root at
# a SCRATCH CLONE (full history, its own independent .git) instead of the live
# worktree gets the same real-Mission-state faithfulness while making it
# structurally impossible for this harness to touch the live host's
# .git/autopilot/mission — no restore-on-failure race, no live-store mutation
# window at all. A live-store byte-identity check at the end is a belt-and-
# braces regression guard on top of that isolation.
#
# NOTE: hooks/tests/mission-routing-admission.test.sh is RED on develop independently
# of this work (scripts/verify-preexisting.sh: head=fail, base=fail), so it cannot
# serve as the oracle here.
set -uo pipefail

LIVE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RECONCILE="$LIVE_ROOT/scripts/mission-terminal-reconcile.js"
ADMISSION="$LIVE_ROOT/scripts/mission-routing-admission.js"
PASS=0; FAIL=0

ok()  { PASS=$((PASS+1)); printf 'PASS: %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FAIL: %s\n' "$1"; }
skip() { printf 'SKIP: %s\n' "$1"; }

LIVE_COMMON="$(git -C "$LIVE_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
LIVE_MROOT="$LIVE_COMMON/autopilot/mission"
LIVE_STORE="$LIVE_MROOT/terminal-rollovers.json"

if [ ! -f "$LIVE_MROOT/registry.json" ]; then
  skip "no Mission registry in this clone — rollover has nothing to act on"
  printf '\n%s: %d passed, %d failed\n' "$(basename "$0")" "$PASS" "$FAIL"; exit 0
fi

# Byte-identity baseline on the LIVE store, taken before any scratch-clone
# work begins.
LIVE_STORE_HASH_BEFORE="$( [ -f "$LIVE_STORE" ] && sha256sum "$LIVE_STORE" | awk '{print $1}' || echo "absent" )"

SCRATCH_HOME="$(mktemp -d "${TMPDIR:-/tmp}/mission-terminal-rollover-scratch.XXXXXX")"
cleanup_scratch() { rm -rf "$SCRATCH_HOME"; }
trap cleanup_scratch EXIT

if ! git clone --quiet --no-hardlinks -- "$LIVE_ROOT" "$SCRATCH_HOME/repo" >/dev/null 2>&1; then
  skip "could not clone the repo into a scratch dir — rollover has nothing safe to act on"
  printf '\n%s: %d passed, %d failed\n' "$(basename "$0")" "$PASS" "$FAIL"; exit 0
fi
ROOT="$SCRATCH_HOME/repo"

COMMON="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
MROOT="$COMMON/autopilot/mission"
STORE="$MROOT/terminal-rollovers.json"

# .git/autopilot/mission is untracked runtime state, not part of git history,
# so a fresh clone's .git does not carry it — copy the live snapshot into the
# scratch clone's own (isolated) common dir. terminal-rollovers.json is
# excluded: it is the TOOL'S OWN OUTPUT (not mission/evidence input), each
# record's repo_identity is bound to the git-common-dir it was written under
# (by design — see the header above), and the live copy's records are bound
# to the live common dir. Carrying a stale record into the scratch clone
# would make every fresh rollover computed under the scratch common dir look
# like a conflicting "different rollover" for the same graph (ROLLOVER_REPLAY)
# even though nothing is actually wrong — so rollover.json starts clean here,
# same as it does the first time this ever runs on a fresh repo.
mkdir -p "$(dirname "$MROOT")"
cp -R "$LIVE_MROOT" "$MROOT"
rm -f "$MROOT/terminal-rollovers.json"

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
  printf '\n%s: %d passed, %d failed\n' "$(basename "$0")" "$PASS" "$FAIL"; exit 0
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
printf '%s' "$OUT" | grep -q '"status":"ROLLED_OVER"' \
  && ok "accepts the integrated adoption" || bad "rejected the valid canonical: ${OUT:0:160}"
printf '%s' "$OUT" | grep -q '"synthesized_work_orders":0' \
  && printf '%s' "$OUT" | grep -q '"mutated_receipts":0' \
  && printf '%s' "$OUT" | grep -q '"history_rewritten":false' \
  && ok "asserts zero synthesis, zero mutation, zero history rewrite" \
  || bad "missing the no-fabrication assertions"

# ---- idempotent
printf '%s' "$(roll "$INTEGRATED")" | grep -q '"writes":0' \
  && ok "re-running writes nothing (idempotent)" || bad "not idempotent"

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
LIVE_STORE_HASH_AFTER="$( [ -f "$LIVE_STORE" ] && sha256sum "$LIVE_STORE" | awk '{print $1}' || echo "absent" )"
[ "$LIVE_STORE_HASH_BEFORE" = "$LIVE_STORE_HASH_AFTER" ] \
  && ok "live host mission-terminal-rollovers.json is byte-identical before/after (scratch clone never touched it)" \
  || bad "live host mission-terminal-rollovers.json CHANGED (before=$LIVE_STORE_HASH_BEFORE after=$LIVE_STORE_HASH_AFTER)"

printf '\n%s: %d passed, %d failed\n' "$(basename "$0")" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
