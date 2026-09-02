#!/usr/bin/env bash
# qualification-feed-adopt.test.sh — contract for `adopt-qualification-defaults.js --from`.
#
# The property under test is the TRUST POSTURE, not the happy path: a feed is a remote document
# written by someone else, and every case below either proves a value is re-derived locally, or
# proves a refusal fires. A feed entry must get no easier path than a shipped default.
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
. "$SELF_DIR/lib.sh"

REPO_ROOT="$(cd "$SELF_DIR/../.." && pwd)"
ADOPT="$REPO_ROOT/scripts/adopt-qualification-defaults.js"
CAPSTATE="$REPO_ROOT/scripts/engine-capability-state.js"
SCORECARD="$REPO_ROOT/scripts/engine-scorecard.js"
SAMPLE="$REPO_ROOT/docs/plans/evidence/2026-09-02-qualification-feed/sample-feed.json"

CACHE="$TEST_TMP/feed-cache"
SC="$TEST_TMP/sc"; CAP="$TEST_TMP/cap"
mkdir -p "$SC" "$CAP"

jf() { node -e '
const doc = JSON.parse(process.argv[1]);
const v = process.argv[2].split(".").reduce((a,k)=>(a==null?a:(Array.isArray(a)?a[Number(k)]:a[k])), doc);
process.stdout.write(v === undefined || v === null ? "null" : (typeof v === "object" ? JSON.stringify(v) : String(v)));
' "$1" "$2" 2>/dev/null; }

adopt() { node "$ADOPT" "$@" --feed-cache-dir "$CACHE" --store "$SC" --capability-store "$CAP"; }

# ── 1. the sample feed is readable, and the digest is OURS ───────────────────
# The feed advertises its own `digest`. We report it and use our own hash of the bytes we
# actually received — a hash you did not compute is a claim, not a fact (ADR-0001).
OUT="$(node "$ADOPT" list --from "$SAMPLE" --feed-cache-dir "$CACHE" --json 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "0" "list --from reads the sample feed"
assert_eq "$(jf "$OUT" counts.defaults)" "29" "all 29 defaults are read"
assert_eq "$(jf "$OUT" counts.strikes)" "1" "the strike is read"
assert_eq "$(jf "$OUT" counts.priors)" "53" "all 53 priors are read"
assert_eq "$(jf "$OUT" source_kind)" "path" "a filesystem source is reported as such"
OURS="$(jf "$OUT" digest)"
assert_eq "$(printf '%s' "$OURS" | wc -c | tr -d ' ')" "64" "the digest is a sha256 of what we received"
assert_eq "$(jf "$OUT" digest_matches_advertised)" "false" \
  "the sample feed's advertised digest does NOT match ours — reported, not fatal"

# ── 1b. a DECLARED digest basis turns a difference into a stated fact ────────
# The model-dyno feed's `digest` is a producer-internal change-detection fingerprint over a subset
# of the document, not a hash of the wire bytes. Before the producer declared that, we could only
# observe "it differs from ours" and had to warn — which alarmed every reader about something
# working as designed. With `digest_basis` present we say which it is.
#
# What must NOT change: the basis is a REPORTING input only. It can never make us adopt the
# producer's digest, and our cache key stays our own hash of the received bytes.
WITH_BASIS="$TEST_TMP/feed-with-basis.json"
node -e '
const fs = require("fs");
const doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
doc.digest_basis = "sha256 over defaults+strikes+priors with per-prior timestamps removed";
fs.writeFileSync(process.argv[2], `${JSON.stringify(doc, null, 2)}\n`);
' "$SAMPLE" "$WITH_BASIS"

OUTB="$(node "$ADOPT" list --from "$WITH_BASIS" --feed-cache-dir "$CACHE" --json 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "0" "a feed declaring digest_basis is read"
assert_eq "$(jf "$OUTB" advertised_digest_is_producer_internal)" "true" \
  "a declared basis marks the advertised digest as producer-internal"
assert_eq "$(jf "$OUTB" digest_matches_advertised)" "false" \
  "the comparison is still performed and still reported honestly"
BASIS_DIGEST="$(jf "$OUTB" digest)"
# INDEPENDENTLY derived, not just self-consistent. Checking "it is 64 hex chars" and "the cache
# directory is named after it" would both stay true if we adopted the producer's value — the check
# would be a shadow of the answer it is meant to test (references/evidence-discipline.md). sha256sum
# is the outside opinion.
EXPECTED_DIGEST="$(sha256sum "$WITH_BASIS" | cut -d' ' -f1)"
assert_eq "$BASIS_DIGEST" "$EXPECTED_DIGEST" \
  "our digest is sha256 of the FILE BYTES — a declared basis never makes us adopt the producer's value"
assert_file_exists "$CACHE/$BASIS_DIGEST/feed.json" \
  "and the cache is addressed by that hash, never the advertised one"

OUTB_TEXT="$(node "$ADOPT" list --from "$WITH_BASIS" --seat GLM-5.3:cc-shim --feed-cache-dir "$CACHE" 2>&1)"
assert_contains "$OUTB_TEXT" 'producer-internal fingerprint' \
  "the human output states what the advertised digest actually is"
assert_not_contains "$OUTB_TEXT" 'DOES NOT match ours' \
  "and stops reporting an expected difference as a discrepancy"

# The louder wording must survive for a feed that explains nothing: an unexplained difference is
# still worth a warning, and this is the assertion that stops the calmer branch swallowing both.
assert_contains "$OUT" 'null' "the basis-less sample reports no basis"
OUT_TEXT_NOBASIS="$(node "$ADOPT" list --from "$SAMPLE" --seat GLM-5.3:cc-shim --feed-cache-dir "$CACHE" 2>&1)"
assert_contains "$OUT_TEXT_NOBASIS" 'DOES NOT match ours' \
  "a feed with no declared basis still gets the loud warning"

# ── 2. seat_hash is RE-DERIVED, and a stale basis is named precisely ─────────
# The sample feed predates effort partitioning, so it advertises the three-field hash. Saying
# WHICH basis it used is the difference between an actionable message and noise.
FIRST="$(jf "$OUT" defaults.0.applicability.seat_hash_derived)"
assert_eq "$(jf "$OUT" defaults.0.applicability.seat_hash_basis)" "legacy_three_field" \
  "a pre-effort feed hash is identified as the three-field basis, not as 'unknown'"
assert_eq "$(jf "$OUT" defaults.0.applicability.seat_hash_matches)" "false" \
  "and it is reported as not matching our derivation"
# Our derivation must equal what the shipped CLI computes — one algorithm, not two.
ENG="$(jf "$OUT" defaults.0.seat.engine)"; RUN="$(jf "$OUT" defaults.0.seat.runner)"
ROLE="$(jf "$OUT" defaults.0.seat.role)"; EFF="$(jf "$OUT" defaults.0.seat.effort)"
CLI_HASH="$(node "$CAPSTATE" seat-hash --engine "$ENG" --runner "$RUN" --role "$ROLE" --effort "$EFF" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).seat_hash))')"
assert_eq "$FIRST" "$CLI_HASH" \
  "the feed reader's seat_hash equals engine-capability-state.js's — a third implementation would drift"

# ── 3. the strike's seat_hash is re-derived too ──────────────────────────────
# This is the case that matters most: believing the feed's strike seat_hash would let the
# producer decide which local seat a strike attaches to. A strike on the wrong seat is recorded
# and never counted.
assert_eq "$(jf "$OUT" strikes.0.effort)" "null" \
  "the sample strike carries no effort — the legacy partition, not a wildcard"
STRIKE_DERIVED="$(jf "$OUT" strikes.0.seat_hash_derived)"
STRIKE_CLI="$(node "$CAPSTATE" seat-hash --engine "$(jf "$OUT" strikes.0.engine)" \
  --runner "$(jf "$OUT" strikes.0.runner)" --role "$(jf "$OUT" strikes.0.role)" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).seat_hash))')"
assert_eq "$STRIKE_DERIVED" "$STRIKE_CLI" "an effort-less strike re-derives to the legacy seat hash"

# ── 4. environment differences are reported, never gating ────────────────────
assert_contains "$OUT" '"gating": "exam identity only' "the gating rule is stated in the output"

# ── 5. adopt writes a row stamped with where it came from ────────────────────
OUT2="$(adopt adopt --from "$SAMPLE" --seat GLM-5.3:cc-shim --role implementer 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "0" "adopt --from succeeds"
assert_eq "$(jf "$OUT2" count)" "1" "exactly the selected seat is adopted"
ROW="$(head -1 "$SC/scorecard.jsonl")"
assert_eq "$(jf "$ROW" provenance.adopted_from.digest)" "$OURS" \
  "adopted_from records OUR digest, not the feed's advertised one"
assert_eq "$(jf "$ROW" provenance.adopted_from.advertised_digest_matches)" "false" \
  "and records that the advertised digest disagreed"
assert_eq "$(jf "$ROW" effort)" "high" "the adopted row carries its effort"

# ── 6. the adopted seat answers at ITS effort, and not at the legacy one ─────
# Without this, Phase 1's partitioning would be invisible at the point it matters.
SS_HIGH="$(ENGINE_SCORECARD_DIR="$SC" ENGINE_CAPABILITY_DIR="$CAP" node "$SCORECARD" seat-status \
  --engine GLM-5.3 --runner cc-shim --role implementer --effort high)"
assert_eq "$(jf "$SS_HIGH" admission_status)" "qualified" "the adopted seat is qualified at effort=high"
SS_LEGACY="$(ENGINE_SCORECARD_DIR="$SC" ENGINE_CAPABILITY_DIR="$CAP" node "$SCORECARD" seat-status \
  --engine GLM-5.3 --runner cc-shim --role implementer)"
assert_eq "$(jf "$SS_LEGACY" admission_status)" "no_record" \
  "and the legacy partition is a DIFFERENT seat with no row — omitting --effort is not a wildcard"

# ── 7. adoption is idempotent ────────────────────────────────────────────────
OUT3="$(adopt adopt --from "$SAMPLE" --seat GLM-5.3:cc-shim --role implementer 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "1" "a second adopt of the same seat refuses"
assert_contains "$OUT3" 'refused_already_adopted' "and says why"

# ── 8. local evidence always wins, feed or not ───────────────────────────────
# The feed path must not have its own, weaker collision rule.
SC2="$TEST_TMP/sc2"; CAP2="$TEST_TMP/cap2"; mkdir -p "$SC2" "$CAP2"
node -e '
const fs = require("fs");
// A LOCAL self-qualified row for the same seat. Minimal on purpose: the collision rule keys on
// engine+runner+role and the absence of an official-default provenance, nothing else.
fs.writeFileSync(process.argv[1], JSON.stringify({
  event_id: 1, engine: "GLM-5.3", runner: "cc-shim", role: "implementer", status: "failed",
}) + "\n");
' "$SC2/scorecard.jsonl"
OUT4="$(node "$ADOPT" adopt --from "$SAMPLE" --seat GLM-5.3:cc-shim --role implementer \
  --feed-cache-dir "$CACHE" --store "$SC2" --capability-store "$CAP2" 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "1" "a feed default cannot land on a seat that holds local evidence"
assert_contains "$OUT4" 'refused_local_evidence_present' "and the refusal names the reason"

# ── 9. --priors append as PROVISIONAL, and cannot become qualifications ──────
SC3="$TEST_TMP/sc3"; CAP3="$TEST_TMP/cap3"; mkdir -p "$SC3" "$CAP3"
OUT5="$(node "$ADOPT" adopt --from "$SAMPLE" --seat grok-4.5:grok --role implementer --priors \
  --feed-cache-dir "$CACHE" --store "$SC3" --capability-store "$CAP3" 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "0" "adopt --priors succeeds"
assert_contains "$OUT5" '"appended": 53' "all 53 priors are appended"
assert_contains "$OUT5" '"refused": 0' "none were refused"
PRIOR_CHECK="$(node -e '
const fs = require("fs");
const rows = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").map(JSON.parse);
const priors = rows.filter((r) => r.evidence.source === "external_prior");
const bad = priors.filter((r) => r.evidence.state === "qualified");
process.stdout.write(JSON.stringify({ priors: priors.length, qualified_priors: bad.length }));
' "$CAP3/qualification-evidence.jsonl")"
assert_eq "$(jf "$PRIOR_CHECK" priors)" "53" "the priors landed as external_prior evidence"
assert_eq "$(jf "$PRIOR_CHECK" qualified_priors)" "0" \
  "NO prior is qualified — a feed cannot manufacture a qualification it did not earn upstream"

# ── 10. refusals: transport and shape ────────────────────────────────────────
OUT6="$(node "$ADOPT" list --from "http://example.invalid/feed.json" --feed-cache-dir "$CACHE" 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "1" "a plain-http feed URL is refused"
assert_contains "$OUT6" 'must be https' "and the refusal names the transport rule"

NOTJSON="$TEST_TMP/not-a-feed.json"; printf '{"artifact_type":"something-else"}\n' > "$NOTJSON"
OUT7="$(node "$ADOPT" list --from "$NOTJSON" --feed-cache-dir "$CACHE" 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "1" "a document that is neither a feed nor a defaults artifact is refused"
assert_contains "$OUT7" 'not a qualification feed' "and says what it looked at"

BADJSON="$TEST_TMP/bad.json"; printf 'not json at all\n' > "$BADJSON"
OUT8="$(node "$ADOPT" list --from "$BADJSON" --feed-cache-dir "$CACHE" 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "1" "malformed JSON is refused"

# ── 11. the cache is content-addressed and re-readable offline ───────────────
assert_file_exists "$CACHE/current.json" "a current manifest is written"
assert_file_exists "$CACHE/$OURS/feed.json" "the body is cached under OUR digest"
CACHED_SHA="$(sha256sum "$CACHE/$OURS/feed.json" | cut -d' ' -f1)"
assert_eq "$CACHED_SHA" "$OURS" "the cached bytes hash to the directory that holds them"

finalize_test
