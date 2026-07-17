#!/usr/bin/env bash
# Independent depth-0 adversarial harness for scripts/engine-capability-state.js

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="$ROOT/scripts/engine-capability-state.js"
PASS=0; FAIL=0
TESTDIR="$(mktemp -d)"
export ENGINE_CAPABILITY_DIR="$TESTDIR"
trap 'rm -rf "$TESTDIR"' EXIT

ok()   { PASS=$((PASS+1)); printf 'PASS: %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf 'FAIL: %s\n' "$1"; }
reset(){ rm -f "$TESTDIR/capability.jsonl" "$TESTDIR/.lock"; }
arrlen(){ node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(0,'utf8')).length))"; }
jq_get(){ node -e "let d=JSON.parse(require('fs').readFileSync(0,'utf8'));let v=d;for(const k of '$1'.split('.'))v=Array.isArray(v)?v[Number(k)]:v[k];process.stdout.write(String(v))"; }

event_json() { # runner model role status confidence ttl observed [reset_at]
  local runner="$1" model="$2" role="$3" status="$4" conf="$5" ttl="$6" observed="$7" reset="${8:-null}"
  local reset_str="null"
  if [ "$reset" != "null" ]; then reset_str="\"$reset\""; fi
  cat <<JSON
{
  "schema_version": 1,
  "observed_at": "$observed",
  "runner": "$runner",
  "model": "$model",
  "role": "$role",
  "runner_version": "v1.0.0",
  "capability": {
    "quota": {
      "status": "$status",
      "confidence": "$conf",
      "ttl_seconds": $ttl,
      "reset_at": $reset_str,
      "evidence": "test evidence"
    }
  }
}
JSON
}

# 1. Monotonic event_id assignment, event_id ignored from input
reset
echo "$(event_json codex gpt-5.5 reviewer available high 3600 2026-07-02T00:00:00Z)" | node "$CLI" record >/tmp/c1 2>/dev/null
id1=$(jq_get event_id </tmp/c1)
echo "$(event_json codex gpt-5.5 reviewer available high 3600 2026-07-02T00:01:00Z)" | node "$CLI" record >/tmp/c2 2>/dev/null
id2=$(jq_get event_id </tmp/c2)
[ "$id1" = "1" ] && [ "$id2" = "2" ] && ok "1: monotonic event_id assigned" || bad "1: got id1='$id1' id2='$id2'"

# 2. Schema validation check
reset
# valid works
echo "$(event_json codex gpt-5.5 reviewer available high 3600 2026-07-02T00:00:00Z)" | node "$CLI" record >/dev/null 2>&1; ec_valid=$?
# invalid schema_version fails
echo "$(event_json codex gpt-5.5 reviewer available high 3600 2026-07-02T00:00:00Z)" | sed 's/"schema_version": 1/"schema_version": 2/' | node "$CLI" record >/dev/null 2>&1; ec_bad_ver=$?
# invalid status fails
echo "$(event_json codex gpt-5.5 reviewer BOGUSSTATUS high 3600 2026-07-02T00:00:00Z)" | node "$CLI" record >/dev/null 2>&1; ec_bad_status=$?

[ "$ec_valid" = "0" ] && [ "$ec_bad_ver" = "1" ] && [ "$ec_bad_status" = "1" ] && ok "2: schema validation guards record" || bad "2: ec_valid=$ec_valid ec_bad_ver=$ec_bad_ver ec_bad_status=$ec_bad_status"

# 3. Merge rules: high confidence beats older medium/low
reset
# Event 1: low confidence status=available at t=0
echo "$(event_json codex gpt-5.5 reviewer available low 3600 2026-07-02T00:00:00Z)" | node "$CLI" record >/dev/null
# Event 2: high confidence status=exhausted at t=-5m (older but high confidence)
echo "$(event_json codex gpt-5.5 reviewer exhausted high 3600 2026-07-02T00:01:00Z)" | node "$CLI" record >/dev/null
# Event 3: medium confidence status=available at t=+5m (newer but lower confidence than high)
echo "$(event_json codex gpt-5.5 reviewer available medium 3600 2026-07-02T00:02:00Z)" | node "$CLI" record >/dev/null

status=$(node "$CLI" current --runner codex --model gpt-5.5 --role reviewer --now 2026-07-02T00:03:00Z | jq_get capability.quota.status)
[ "$status" = "exhausted" ] && ok "3: high confidence beats older/newer medium/low" || bad "3: got status='$status' want exhausted"

# 4. Merge rules: expired high becomes unknown at deterministic --now
reset
echo "$(event_json codex gpt-5.5 reviewer exhausted high 60 2026-07-02T00:00:00Z)" | node "$CLI" record >/dev/null
# at t=30s, not expired
status_30s=$(node "$CLI" current --runner codex --model gpt-5.5 --role reviewer --now 2026-07-02T00:00:30Z | jq_get capability.quota.status)
# at t=90s, expired
status_90s=$(node "$CLI" current --runner codex --model gpt-5.5 --role reviewer --now 2026-07-02T00:01:30Z | jq_get capability.quota.status)

[ "$status_30s" = "exhausted" ] && [ "$status_90s" = "unknown" ] && ok "4: expired high becomes unknown" || bad "4: status_30s=$status_30s status_90s=$status_90s"

# 5. Merge rules: newer medium/low beats older medium/low
reset
echo "$(event_json codex gpt-5.5 reviewer limited medium 3600 2026-07-02T00:00:00Z)" | node "$CLI" record >/dev/null
echo "$(event_json codex gpt-5.5 reviewer available medium 3600 2026-07-02T00:01:00Z)" | node "$CLI" record >/dev/null

status=$(node "$CLI" current --runner codex --model gpt-5.5 --role reviewer --now 2026-07-02T00:02:00Z | jq_get capability.quota.status)
[ "$status" = "available" ] && ok "5: newer medium/low beats older medium/low" || bad "5: got status=$status"

# 6. report lists all active capability records
reset
echo "$(event_json codex gpt-5.5 reviewer available high 3600 2026-07-02T00:00:00Z)" | node "$CLI" record >/dev/null
echo "$(event_json agy gemini-1.5 reviewer exhausted high 3600 2026-07-02T00:00:00Z)" | node "$CLI" record >/dev/null

report_len=$(node "$CLI" report --capability quota --now 2026-07-02T00:00:00Z | arrlen)
[ "$report_len" = "2" ] && ok "6: report lists 2 entries" || bad "6: report_len=$report_len"

# 7. prune deletes expired events but keeps latest
reset
# Event 1: expired, not latest (same runner/model/role follows)
echo "$(event_json codex gpt-5.5 reviewer available high 60 2026-07-02T00:00:00Z)" | node "$CLI" record >/dev/null
# Event 2: expired, but IS latest for this runner/model/role
echo "$(event_json codex gpt-5.5 reviewer exhausted high 60 2026-07-02T00:01:00Z)" | node "$CLI" record >/dev/null

prune_out=$(node "$CLI" prune --now 2026-07-02T00:03:00Z)
remaining=$(wc -l < "$TESTDIR/capability.jsonl" | tr -d ' ')
[ "$remaining" = "1" ] && ok "7: prune keeps latest even if expired" || bad "7: remaining=$remaining prune_out='$prune_out'"

# 8. classify-error subcommand
c_quota=$(node "$CLI" classify-error --string "exceeded your current billing quota for OpenAI")
c_rate=$(node "$CLI" classify-error --string "rate limit reached 429 too many requests")
c_overload=$(node "$CLI" classify-error --string "529 error overloaded capacity")
c_auth=$(node "$CLI" classify-error --string "invalid API key authorization failed")
c_net=$(node "$CLI" classify-error --string "connection timed out network error fetch failed")
c_unknown=$(node "$CLI" classify-error --string "some random successful or generic log message")
c_grok402=$(node "$CLI" classify-error --string "API error (status 402 Payment Required): Grok Build usage balance exhausted")

[ "$c_quota" = "quota_exhausted" ] && \
[ "$c_rate" = "rate_limited" ] && \
[ "$c_overload" = "overloaded" ] && \
[ "$c_auth" = "auth_failed" ] && \
[ "$c_net" = "network_failed" ] && \
[ "$c_unknown" = "unknown" ] && \
[ "$c_grok402" = "quota_exhausted" ] && ok "8: classify-error categories map correctly" || \
bad "8: quota=$c_quota rate=$c_rate overload=$c_overload auth=$c_auth net=$c_net unknown=$c_unknown grok402=$c_grok402"

# 9. (P6 F4) merged `current` exposes per-field native_observed_at — the native event's OWN
#    time, NOT the aggregate observed_at (which follows the latest event of any field). A fresh
#    quota-only event must not make a stale native signal look fresh.
reset
cat <<'JSON' | node "$CLI" record >/dev/null
{"schema_version":1,"observed_at":"2026-06-30T00:00:00Z","runner":"agy","model":"m","role":"implementer","capability":{"quota":{"status":"unknown","confidence":"low","ttl_seconds":0,"reset_at":null,"evidence":null},"skill_transport":{"native":"supported","prompt_pack":"unknown"}}}
JSON
cat <<'JSON' | node "$CLI" record >/dev/null
{"schema_version":1,"observed_at":"2026-07-03T00:00:00Z","runner":"agy","model":"m","role":"implementer","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":86400,"reset_at":null,"evidence":null}}}
JSON
cur=$(node "$CLI" current --runner agy --model m --role implementer --now 2026-07-03T01:00:00Z)
nat_obs=$(printf '%s' "$cur" | jq_get capability.skill_transport.native_observed_at)
top_obs=$(printf '%s' "$cur" | jq_get observed_at)
[ "$nat_obs" = "2026-06-30T00:00:00Z" ] && [ "$top_obs" = "2026-07-03T00:00:00Z" ] \
  && ok "9: native_observed_at tracks the native event, not the aggregate" \
  || bad "9: nat_obs=$nat_obs top_obs=$top_obs"

# 10. (P6 F2) prune keeps the latest native-signal carrier even when its quota TTL is expired
#     and it is not the latest event for the key (else the native signal reverts to unknown).
prune_out=$(node "$CLI" prune --now 2026-07-03T01:00:00Z)
nat_after=$(node "$CLI" current --runner agy --model m --role implementer --now 2026-07-03T01:00:00Z | jq_get capability.skill_transport.native)
[ "$nat_after" = "supported" ] && ok "10: prune protects the native-signal carrier row" \
  || bad "10: native after prune=$nat_after ($prune_out)"

echo "----"
echo "engine-capability-state unit tests: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
