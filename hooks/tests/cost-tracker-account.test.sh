#!/usr/bin/env bash
# cost-tracker.js — every costs.jsonl row carries `account`, the hash alias of scripts/lib/account-alias.js
# (AUTOPILOT_ACCOUNT, else acct-<hash of org uuid + email> from <CLAUDE_CONFIG_DIR>/.claude.json, else
# acct-<hash of the config dir>). The file never contains the fixture email or organization uuid.
. "$(dirname "$0")/lib.sh"

TR="$TEST_TMP/transcript.jsonl"
CFG="$TEST_TMP/cfg"; mkdir -p "$CFG"
METRICS="$CFG/metrics"
LEDGER="$METRICS/costs.jsonl"
FIX_EMAIL="cost-account-fixture@example.com"
FIX_ORG="00000000-0000-4000-8000-0000000000bb"
printf '{"oauthAccount":{"organizationUuid":"%s","emailAddress":"%s"}}' "$FIX_ORG" "$FIX_EMAIL" > "$CFG/.claude.json"
payload() { printf '{"session_id":"%s","transcript_path":"%s","hook_event_name":"Stop","cwd":"%s"}' "$1" "$TR" "$TEST_TMP"; }
turn() { printf '{"type":"assistant","requestId":"%s","message":{"id":"%s","model":"claude-sonnet-5","usage":{"input_tokens":10,"output_tokens":7,"cache_read_input_tokens":100,"cache_creation_input_tokens":5}}}\n' "$1" "$1"; }
last_account() { tail -n 1 "$LEDGER" | node -e 'const r = JSON.parse(require("fs").readFileSync(0, "utf8")); process.stdout.write(String(r.account));'; }
sha8() { printf %s "$1" | sha256sum | cut -c1-8; }

# 1. identity tier: acct-<sha8(org\nemail)> from the config dir's .claude.json
turn t1 > "$TR"
CLAUDE_CONFIG_DIR="$CFG" run_hook cost-tracker.js "$(payload ct-acct-1)"
assert_eq 0 "$__RUN_EXIT" "stop 1 exit 0"
assert_eq "acct-$(sha8 "$FIX_ORG
$FIX_EMAIL")" "$(last_account)" "row account is the org+email hash"
LEDGER_TEXT="$(cat "$LEDGER")"
assert_not_contains "$LEDGER_TEXT" "$FIX_EMAIL" "costs.jsonl does not contain the email"
assert_not_contains "$LEDGER_TEXT" "$FIX_ORG" "costs.jsonl does not contain the organization uuid"
# negative control: the scan sees the email when it is there
assert_contains "$LEDGER_TEXT$FIX_EMAIL" "$FIX_EMAIL" "control: the scan can find the email"

# 2. AUTOPILOT_ACCOUNT wins; an invalid value falls through to the identity tier
turn t2 >> "$TR"
CLAUDE_CONFIG_DIR="$CFG" AUTOPILOT_ACCOUNT=ci-runner-2 run_hook cost-tracker.js "$(payload ct-acct-1)"
assert_eq "ci-runner-2" "$(last_account)" "AUTOPILOT_ACCOUNT is used as is"
turn t3 >> "$TR"
CLAUDE_CONFIG_DIR="$CFG" AUTOPILOT_ACCOUNT='Ops@x' run_hook cost-tracker.js "$(payload ct-acct-1)"
assert_eq "acct-$(sha8 "$FIX_ORG
$FIX_EMAIL")" "$(last_account)" "invalid AUTOPILOT_ACCOUNT falls through"

# 3. no .claude.json: acct-<sha8(realpath config dir)>
CFG2="$TEST_TMP/cfg2"; mkdir -p "$CFG2"
LEDGER="$CFG2/metrics/costs.jsonl"
turn t4 >> "$TR"
CLAUDE_CONFIG_DIR="$CFG2" run_hook cost-tracker.js "$(payload ct-acct-1)"
assert_eq "acct-$(sha8 "$(realpath "$CFG2")")" "$(last_account)" "missing .claude.json falls to the config dir hash"
assert_not_contains "$(cat "$LEDGER")" "$FIX_EMAIL" "still no email after the fallback rows"

# 4. AUTOPILOT_COSTS_FILE redirects the writer; without it the metrics dir ledger is used
CFG3="$TEST_TMP/cfg3"; mkdir -p "$CFG3"
SCRATCH="$TEST_TMP/scratch/x.jsonl"
turn t5 >> "$TR"
CLAUDE_CONFIG_DIR="$CFG3" AUTOPILOT_COSTS_FILE="$SCRATCH" run_hook cost-tracker.js "$(payload ct-env-1)"
assert_eq 1 "$(grep -c ct-env-1 "$SCRATCH" 2>/dev/null || echo 0)" "env override: row appended to AUTOPILOT_COSTS_FILE"
assert_eq "no" "$(test -e "$CFG3/metrics/costs.jsonl" && echo yes || echo no)" "env override: nothing under <config>/metrics/costs.jsonl"
turn t6 >> "$TR"
CLAUDE_CONFIG_DIR="$CFG3" run_hook cost-tracker.js "$(payload ct-env-2)"
assert_eq 1 "$(grep -c ct-env-2 "$CFG3/metrics/costs.jsonl" 2>/dev/null || echo 0)" "no env: row appended to <config>/metrics/costs.jsonl"

finalize_test
