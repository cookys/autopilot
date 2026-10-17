#!/usr/bin/env bash
# qualification-prices.test.sh — seat unit prices (BL-0024): validation, cache, exact lookup,
# and the implementer ladder's same-effort price ordering.
. "$(dirname "$0")/lib.sh"

INHERITED_CACHE_DIR="${AUTOPILOT_PRICES_CACHE_DIR:-}"
PRICES="$REPO_ROOT/scripts/qualification-prices.js"
TOPO="$REPO_ROOT/scripts/resolve-dispatch-topology.js"
# The pre-price topology resolver runs from a throwaway tree under TEST_TMP (symlinks to the real repo, plus the old copy).
BASETREE="$TEST_TMP/basetree"
BASELINE="$BASETREE/scripts/resolve-dispatch-topology.js"

FAKE_BIN_DIR="$TEST_TMP/fake-bin"; mkdir -p "$FAKE_BIN_DIR"
printf '#!/usr/bin/env bash\n[ "${1:-}" = "--version" ] && { printf "1.1.10\\n"; exit 0; }\nexit 0\n' > "$FAKE_BIN_DIR/agy"
chmod +x "$FAKE_BIN_DIR/agy"
export PATH="$FAKE_BIN_DIR:/usr/bin:/bin"
export HOME="$HOOK_HOME"
export AUTOPILOT_PRICES_CACHE_DIR="$TEST_TMP/prices-cache"
FIX="$TEST_TMP/fix"; mkdir -p "$FIX"

# mkfix <out> <js-mutator>: writes a valid base document, applies the mutator `d => ...`.
mkfix() {
  node - "$1" "$2" <<'NODE'
const fs = require('fs');
const row = (model, inp, out, extra = {}) => ({
  engine: model, runner: 'agy', model, model_ref: `ref/${model}`,
  usd_per_mtok_input_micro: inp, usd_per_mtok_output_micro: out, usd_per_mtok_cache_read_micro: null,
  effective: '2026-10-01', verified: new Date().toISOString().slice(0, 10),
  source_url: `https://prices.example.com/${model}`, billing: 'metered', effective_basis: 'sourced', ...extra,
});
const d = {
  schema: 'model-dyno.model-prices.v1', generated_at: new Date().toISOString(), stale_after_days: 7,
  rows: [
    row('seat-exp', 5000000, 25000000),
    row('seat-cheap', 100000, 400000),
    row('seat-sub', 1000000, 2000000, { billing: 'subscription' }),
    row('seat-assumed', 1, 1, { effective_basis: 'assumed' }),
    // engine != model, as in a real scorecard row (engine 'kimi-k2.8-preview', model 'kimi-code/kimi-for-coding').
    row('prov/pricey', 9000000, 9000000, { engine: 'Alpha' }),
    row('prov/thrifty', 1000, 1000, { engine: 'Zulu' }),
  ],
};
eval(`(${process.argv[3]})`)(d);
fs.writeFileSync(process.argv[2], JSON.stringify(d));
NODE
}

cur_digest() { node -e "try{process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).digest)}catch{}" "$AUTOPILOT_PRICES_CACHE_DIR/current.json"; }

assert_eq "${INHERITED_CACHE_DIR#"$TEST_TMP"/}" "prices-cache" "lib.sh points the price cache at the sandbox"

# --- accept + cache -------------------------------------------------------------------------
mkfix "$FIX/good.json" "d => d"
OUT="$(node "$PRICES" fetch --from "$FIX/good.json" 2>&1)"; EX=$?
assert_eq "$EX" "0" "good document accepted"
GOOD="$(cur_digest)"
assert_neq "" "$GOOD" "cache written"
ST="$(node "$PRICES" status)"
assert_contains "$ST" '"n_rows": 6' "status counts rows"
assert_contains "$ST" '"n_subscription_rows": 1' "status marks subscription rows"
assert_contains "$ST" '"n_assumed_rows": 1' "status marks assumed rows"

# --- reject whole + keep previous cache ------------------------------------------------------
reject() { # <name> <mutator>
  mkfix "$FIX/bad.json" "$2"
  node "$PRICES" fetch --from "$FIX/bad.json" >/dev/null 2>&1; local ex=$?
  assert_eq "$ex" "1" "reject: $1"
  assert_eq "$(cur_digest)" "$GOOD" "reject keeps previous cache: $1"
}
reject "bad schema string" "d => { d.schema = 'model-dyno.model-prices.v2'; }"
reject "http source_url" "d => { d.rows[0].source_url = 'http://prices.example.com/x'; }"
reject "negative price" "d => { d.rows[0].usd_per_mtok_input_micro = -1; }"
reject "fractional price" "d => { d.rows[0].usd_per_mtok_output_micro = 1.5; }"
reject "string price" "d => { d.rows[0].usd_per_mtok_output_micro = '5'; }"
reject "price above 2^53" "d => { d.rows[0].usd_per_mtok_output_micro = 2 ** 53; }"
reject "source_url dot-segment" "d => { d.rows[0].source_url = 'https://prices.example.com/a/../x'; }"
reject "source_url encoded dot-segment" "d => { d.rows[0].source_url = 'https://prices.example.com/a/%2e%2e/x'; }"
reject "source_url double-encoded dot-segment" "d => { d.rows[0].source_url = 'https://prices.example.com/a/%252e%252e/x'; }"
reject "source_url backslash-ending authority" "d => { d.rows[0].source_url = 'https://prices.example.com\\\\..\\\\x'; }"
reject "source_url backslash scheme and dot-segment" "d => { d.rows[0].source_url = 'https:\\\\\\\\prices.example.com\\\\a\\\\..\\\\x'; }"
reject "source_url userinfo" "d => { d.rows[0].source_url = 'https://u:p@prices.example.com/x'; }"
reject "source_url query" "d => { d.rows[0].source_url = 'https://prices.example.com/x?a=1'; }"
reject "source_url fragment" "d => { d.rows[0].source_url = 'https://prices.example.com/x#f'; }"
reject "bad billing" "d => { d.rows[0].billing = 'free'; }"
reject "bad basis" "d => { d.rows[0].effective_basis = 'guess'; }"
reject "duplicate seat" "d => { d.rows.push({ ...d.rows[0] }); }"
reject "one bad row among good ones" "d => { d.rows[3].usd_per_mtok_input_micro = -5; }"
# the throttle counts failed attempts too: after a rejected fetch no second attempt within the window
rm -rf "$AUTOPILOT_PRICES_CACHE_DIR"
mkfix "$FIX/rej.json" "d => { d.schema = 'nope'; }"
node "$PRICES" fetch --from "$FIX/rej.json" --if-stale-hours 24 >/dev/null 2>&1
assert_eq "$?" "1" "first attempt runs and is rejected"
assert_file_exists "$AUTOPILOT_PRICES_CACHE_DIR/last-attempt" "attempt stamped"
node "$PRICES" fetch --from "$FIX/good.json" --if-stale-hours 24 >/dev/null 2>&1
assert_eq "$(cur_digest)" "" "no reconnect within 24 h of a failed attempt"
node "$PRICES" fetch --from "$FIX/good.json" >/dev/null 2>&1
GOOD="$(cur_digest)"
# an unpriced (null) row and an unknown extra field stay acceptable
mkfix "$FIX/null.json" "d => { d.rows[1].usd_per_mtok_input_micro = null; d.rows[1].extra = 1; }"
node "$PRICES" fetch --from "$FIX/null.json" >/dev/null 2>&1
NULL_RC=$?
assert_eq "$NULL_RC" "0" "null price (unknown) is accepted"
assert_contains "$(node "$PRICES" price --model seat-cheap --runner agy)" '"price_micro_per_mtok": null' "null input price reads as unknown"
node "$PRICES" fetch --from "$FIX/good.json" >/dev/null 2>&1
# http transport is refused by the shared fetcher
node "$PRICES" fetch --from "http://127.0.0.1:1/x.json" >/dev/null 2>&1
assert_eq "$?" "1" "http fetch URL refused"

# --- price lookup: exact, null when unknown (no row or a null side); assumed basis is still priced ----------------------------------------
assert_contains "$(node "$PRICES" price --model seat-cheap --runner agy)" '"price_micro_per_mtok": 500000' "price = input+output"
assert_contains "$(node "$PRICES" price --model seat-sub --runner agy)" '"billing": "subscription"' "subscription row priced, flagged"
assert_contains "$(node "$PRICES" price --model seat-assumed --runner agy)" '"price_micro_per_mtok": 2' "assumed basis with a price is known (basis dates the price, not its source)"
assert_contains "$(node "$PRICES" price --model seat-assumed --runner agy)" '"effective_basis": "assumed"' "assumed basis shown as reference"
assert_contains "$(node "$PRICES" price --model seat-ex --runner agy)" '"price_micro_per_mtok": null' "no substring match (seat-ex vs seat-exp)"
assert_contains "$(node "$PRICES" price --model seat-exp --runner codex)" '"price_micro_per_mtok": null' "runner must match exactly"

# --- ladder ----------------------------------------------------------------------------------
row() { # engine effort latency [model]
  node - "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$1" "$2" "$3" "${4:-}" <<'NODE'
const [file, engine, effort, lat, model] = process.argv.slice(2);
const r = { engine, runner: 'agy', family: 'test-family', role: 'implementer', model_version: '1.0', version_source: 'runtime',
  corpus_version: '1.0', harness_version: '1.0', runner_version: '1.1.10',
  prompt_config_hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', date: '2026-08-01',
  quality: 0.95, capability_score: 0.95, status: 'qualified', admission_status: 'qualified',
  latency: { sample_wall_time_s: Number(lat) }, event_id: 1, baseline_event_id: 1, qualified_at: '2026-08-01T00:00:00.000Z', effort };
if (model) r.model = model;
require('fs').appendFileSync(file, JSON.stringify(r) + '\n');
NODE
}
ladder() { node "$1" --json --out "$TEST_TMP/topo.json" >/dev/null 2>&1; node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).implementer_ladder.map(r=>r.rung).join(','))" "$TEST_TMP/topo.json"; }

: > "$ENGINE_SCORECARD_DIR/scorecard.jsonl"
row seat-exp high 10
row seat-cheap high 20
row seat-unknown high 5
row seat-assumed high 6
row seat-sub high 30
row seat-low-exp low 99
row Alpha medium 1 prov/pricey
row Zulu medium 99 prov/thrifty
mkdir -p "$BASETREE/scripts"
for e in "$REPO_ROOT"/* "$REPO_ROOT"/.[!.]*; do
  [ -e "$e" ] || continue; b="$(basename "$e")"
  case "$b" in scripts|.git) continue ;; esac
  ln -s "$e" "$BASETREE/$b"
done
for e in "$REPO_ROOT"/scripts/* "$REPO_ROOT"/scripts/.[!.]*; do
  [ -e "$e" ] || continue; b="$(basename "$e")"
  [ "$b" = "resolve-dispatch-topology.js" ] && continue
  ln -s "$e" "$BASETREE/scripts/$b"
done
# Pinned to the commit before this feature (1dfa7b9e). Never develop/HEAD: those contain the price logic,
# which would make the comparison self-against-self. No fallback to another ref.
PRE_PRICE_COMMIT=1dfa7b9e
HAVE_BASE=1
if ! git -C "$REPO_ROOT" show "$PRE_PRICE_COMMIT:scripts/resolve-dispatch-topology.js" > "$BASELINE" 2>/dev/null; then
  HAVE_BASE=0
  echo "SKIP [qualification-prices] pre-price comparison: commit $PRE_PRICE_COMMIT is not readable in this clone (shallow or pruned history); hard-coded orders below still run"
fi

# no cache: identical to the pre-price ordering
rm -rf "$AUTOPILOT_PRICES_CACHE_DIR"
NOCACHE="$(ladder "$TOPO")"
[ "$HAVE_BASE" = 1 ] && assert_eq "$NOCACHE" "$(ladder "$BASELINE")" "no cache: ladder identical to the pre-price ordering"
assert_eq "$NOCACHE" "seat-low-exp/low@agy,Alpha/medium@agy,Zulu/medium@agy,seat-assumed/high@agy,seat-cheap/high@agy,seat-exp/high@agy,seat-sub/high@agy,seat-unknown/high@agy" "no cache: effort, then engine name"

# corrupt cache behaves as no cache
mkdir -p "$AUTOPILOT_PRICES_CACHE_DIR"; echo '{garbage' > "$AUTOPILOT_PRICES_CACHE_DIR/current.json"
assert_eq "$(ladder "$TOPO")" "$NOCACHE" "corrupt cache: same as no cache"
rm -rf "$AUTOPILOT_PRICES_CACHE_DIR"

# with prices: same effort -> cheap first; sub uses its retail price; unknown and assumed last
node "$PRICES" fetch --from "$FIX/good.json" >/dev/null 2>&1
PRICED="$(ladder "$TOPO")"
assert_eq "$PRICED" "seat-low-exp/low@agy,Zulu/medium@agy,Alpha/medium@agy,seat-assumed/high@agy,seat-cheap/high@agy,seat-sub/high@agy,seat-exp/high@agy,seat-unknown/high@agy" "priced: effort, then price asc (assumed-basis row with a price is known), unknown last"
assert_contains "$PRICED" "Zulu/medium@agy,Alpha/medium@agy" "price is matched on the scorecard row's model id (engine name order would put Alpha first)"
# Seats whose price is unknown keep the pre-price tie-break (latency, then engine name) among themselves.
UNK="seat-unknown/high@agy,seat-cheap/high@agy"
sub_order() { node -e "const l=process.argv[1].split(',');process.stdout.write(process.argv[2].split(',').sort((a,b)=>l.indexOf(a)-l.indexOf(b)).join(','))" "$1" "$UNK"; }
if [ "$HAVE_BASE" = 1 ]; then
  BASE_L="$(ladder "$BASELINE")"
  assert_eq "$(sub_order "$PRICED")" "$(sub_order "$BASE_L")" "unknown-priced seats keep the pre-price tie-break order"
  assert_neq "$BASE_L" "$PRICED" "priced ordering differs from the pre-price ordering (prices are used)"
fi
assert_eq "$(sub_order "$PRICED")" "seat-cheap/high@agy,seat-unknown/high@agy" "unknown seat sorts after a priced one (hard-coded)"

# top-level extras (unpriced, content_digest, source_revision, n_rows) are accepted; status counts unpriced
mkfix "$FIX/extras.json" "d => { d.unpriced = [{engine:'x',runner:'agy',model:'x',reason:'no list price'}]; d.content_digest = 'abc'; d.source_revision = 'r1'; d.n_rows = 6; }"
node "$PRICES" fetch --from "$FIX/extras.json" >/dev/null 2>&1
assert_eq "$?" "0" "top-level unpriced/content_digest/source_revision/n_rows accepted"
assert_contains "$(node "$PRICES" status)" '"n_unpriced": 1' "status shows the unpriced count"
assert_eq "$(ladder "$TOPO")" "$PRICED" "extras do not change the order"
node "$PRICES" fetch --from "$FIX/good.json" >/dev/null 2>&1

# two unknown seats (no row, and a row with a null input) keep the pre-price tie-break among themselves
node "$PRICES" fetch --from "$FIX/null.json" >/dev/null 2>&1
NULLED="$(ladder "$TOPO")"
UNK="seat-unknown/high@agy,seat-cheap/high@agy"
assert_eq "$(sub_order "$NULLED")" "seat-cheap/high@agy,seat-unknown/high@agy" "two unknown seats: pre-price tie-break order (hard-coded)"
[ "$HAVE_BASE" = 1 ] && assert_eq "$(sub_order "$NULLED")" "$(sub_order "$(ladder "$BASELINE")")" "two unknown seats keep the pre-price order"
node "$PRICES" fetch --from "$FIX/good.json" >/dev/null 2>&1

# stale prices: warned, still used
mkfix "$FIX/stale.json" "d => { d.rows.forEach(r => { r.verified = '2025-01-01'; }); }"
node "$PRICES" fetch --from "$FIX/stale.json" >/dev/null 2>&1
assert_contains "$(node "$PRICES" status)" "verified more than 7 days ago" "stale rows warned"
assert_eq "$(ladder "$TOPO")" "$PRICED" "stale prices still order the ladder"

# --if-stale-hours throttles
BEFORE="$(cur_digest)"; mkfix "$FIX/other.json" "d => { d.rows[0].usd_per_mtok_input_micro = 7; }"
node "$PRICES" fetch --from "$FIX/other.json" --if-stale-hours 24 >/dev/null 2>&1
assert_eq "$(cur_digest)" "$BEFORE" "fresh cache: --if-stale-hours skips the fetch"

# the real ~/.autopilot was never touched
assert_file_absent "$HOME/.autopilot/qualification-prices/current.json" "test used the override dir only"

# --- SessionStart refresh: detached spawn, throttled by the script, opt-out honoured ------------
SPY="$TEST_TMP/spy.js"
cat > "$SPY" <<'JS'
const cp = require('child_process');
cp.spawn = function (c, a) { require('fs').appendFileSync(process.env.SPY_LOG, JSON.stringify(a) + '\n'); return { on() {}, unref() {} }; };
JS
ss() { rm -f "$TEST_TMP/spy.log"; echo '{"source":"startup","cwd":"/tmp"}' | env "$@" SPY_LOG="$TEST_TMP/spy.log" NODE_OPTIONS="--require $SPY" node "$REPO_ROOT/hooks/session-start.js" >/dev/null 2>&1; if [ -f "$TEST_TMP/spy.log" ]; then grep -c 'qualification-prices.js' "$TEST_TMP/spy.log" || true; else echo 0; fi; }
assert_eq "$(ss AUTOPILOT_PRICES_FETCH=1)" "1" "session-start starts the price refresh"
assert_eq "$(ss AUTOPILOT_PRICES_FETCH=0)" "0" "AUTOPILOT_PRICES_FETCH=0 turns the refresh off"
mkdir -p "$HOME/.autopilot"; echo '{"prices_fetch":false}' > "$HOME/.autopilot/config.json"
assert_eq "$(ss AUTOPILOT_PRICES_FETCH=1)" "0" "config prices_fetch:false turns the refresh off"
rm -f "$HOME/.autopilot/config.json"

finalize_test
