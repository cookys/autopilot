#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(AUTOPILOT_HARNESS_NOW=2026-08-04T03:00:00.000Z node "$REPO_ROOT/bin/autopilot.js" harness report --stale-after 14d)"
EXIT=$?
assert_eq "0" "$EXIT" "harness report exits 0"

PARSED="$(REPORT_JSON="$OUT" node - <<'NODE'
const report = JSON.parse(process.env.REPORT_JSON);
console.log(`total=${report.summary.total}`);
console.log(`stale=${report.summary.stale}`);
console.log(`verified=${report.summary.verified}`);
console.log(`warning=${report.summary.warning}`);
console.log(`unverified=${report.summary.unverified}`);
console.log(`unavailable=${report.summary.unavailable}`);
console.log(`not_ready=${report.summary.not_ready}`);
console.log(`attention=${report.summary.attention}`);
console.log(`has_codex=${report.records.some((record) => record.id === 'codex')}`);
console.log(`codex_level=${report.records.find((record) => record.id === 'codex').harness_level}`);
console.log(`required_level=${report.required_level}`);
const copilot = report.records.find((record) => record.id === 'copilot-cli');
console.log(`copilot_reasons_unique=${new Set(copilot.readiness_reasons).size === copilot.readiness_reasons.length}`);
NODE
)"
assert_contains "$PARSED" "total=7" "harness report loads default records"
assert_contains "$PARSED" "stale=4" "harness report marks old records stale" # expectations track src/harness/capabilities/*.json — update when records refresh
assert_contains "$PARSED" "verified=4" "harness report counts verified records"
assert_contains "$PARSED" "warning=2" "harness report counts warning records"
assert_contains "$PARSED" "unverified=1" "harness report counts unverified records"
assert_contains "$PARSED" "unavailable=0" "harness report counts unavailable records"
assert_contains "$PARSED" "not_ready=7" "harness report counts records below default H3 readiness"
assert_contains "$PARSED" "attention=7" "harness report counts stale or not-ready records"
assert_contains "$PARSED" "has_codex=true" "harness report includes codex record"
assert_contains "$PARSED" "codex_level=H2" "harness report preserves harness level"
assert_contains "$PARSED" "required_level=H3" "harness report defaults readiness to H3"
assert_contains "$PARSED" "copilot_reasons_unique=true" "harness report emits unique readiness reasons"

OUT="$(AUTOPILOT_HARNESS_NOW=2026-08-04T03:00:00.000Z node "$REPO_ROOT/bin/autopilot.js" harness report --stale-after 14d --format warning)"
EXIT=$?
assert_eq "0" "$EXIT" "harness warning report exits 0"
assert_contains "$OUT" "AUTOPILOT_HARNESS_ATTENTION count=7" "warning report includes stale or H3-unready records"
assert_contains "$OUT" "required_level=H3" "warning report names required level"
assert_contains "$OUT" "codex:" "warning report includes fresh H2 codex for H3 readiness"
assert_contains "$OUT" "level_below_H3" "warning report explains H3 readiness gap"
assert_contains "$OUT" "claude-code:" "warning report includes unavailable claude"
assert_contains "$OUT" "copilot-cli:" "warning report includes unverified copilot"
assert_contains "$OUT" "... 2 more" "warning report truncates long attention list"

CUSTOM_DIR="$TEST_TMP/capabilities-ok"
mkdir -p "$CUSTOM_DIR"
cat > "$CUSTOM_DIR/custom.json" <<'JSON'
{
  "id": "custom-harness",
  "display_name": "Custom Harness",
  "kind": "cli",
  "status": "verified",
  "harness_level": "H2",
  "last_checked_at": "2026-07-01",
  "verified_at": "2026-07-01",
  "expires_at": "2026-08-01",
  "evidence": {
    "source": "test",
    "command": "custom --version",
    "result": "custom 1.0"
  },
  "capabilities": {
    "read_only_dispatch": "verified"
  },
  "auth_domains": {
    "driver_cli": "verified",
    "provider_quota": "not-applicable"
  }
}
JSON

OUT="$(node "$REPO_ROOT/bin/autopilot.js" harness report --capabilities-dir "$CUSTOM_DIR" --now 2026-07-05T00:00:00.000Z --stale-after 14d --required-level H2)"
EXIT=$?
assert_eq "0" "$EXIT" "harness report supports custom capability dir"
assert_contains "$OUT" "\"total\": 1" "custom dir report loads one record"
assert_contains "$OUT" "\"stale\": 0" "custom dir report honors fresh verified record"
assert_contains "$OUT" "\"not_ready\": 0" "custom dir report honors required-level readiness"
assert_contains "$OUT" "\"auth_domains\"" "custom dir report emits auth domain separation"

OUT="$(node "$REPO_ROOT/bin/autopilot.js" harness report --capabilities-dir "$CUSTOM_DIR" --now 2026-07-05T00:00:00.000Z --stale-after 14d --required-level H2 --format warning)"
EXIT=$?
assert_eq "0" "$EXIT" "harness warning supports zero-attention path"
assert_contains "$OUT" "AUTOPILOT_HARNESS_OK" "warning report has OK path when fresh and ready"

NO_MUTATION_DIR="$TEST_TMP/capabilities-no-mutation"
mkdir -p "$NO_MUTATION_DIR"
cat > "$NO_MUTATION_DIR/no-mutation.json" <<'JSON'
{
  "id": "no-mutation",
  "display_name": "No Mutation",
  "kind": "cli",
  "status": "verified",
  "harness_level": "H3",
  "last_checked_at": "2026-07-01",
  "verified_at": "2026-07-01",
  "expires_at": "2026-08-01",
  "evidence": {
    "source": "test",
    "command": "no-mutation --version",
    "result": "no-mutation 1.0"
  },
  "capabilities": {
    "read_only_dispatch": "verified"
  }
}
JSON
OUT="$(node "$REPO_ROOT/bin/autopilot.js" harness report --capabilities-dir "$NO_MUTATION_DIR" --now 2026-07-05T00:00:00.000Z --required-level H3)"
EXIT=$?
assert_eq "0" "$EXIT" "harness report loads H3-level record missing H3 capability"
assert_contains "$OUT" "\"ready\": 0" "H3 readiness requires mutation_dispatch"
assert_contains "$OUT" "mutation_dispatch_not_verified" "H3 missing capability reason is explicit"

NO_GATE_DIR="$TEST_TMP/capabilities-no-gate"
mkdir -p "$NO_GATE_DIR"
cat > "$NO_GATE_DIR/no-gate.json" <<'JSON'
{
  "id": "no-gate",
  "display_name": "No Gate",
  "kind": "cli",
  "status": "verified",
  "harness_level": "H4",
  "last_checked_at": "2026-07-01",
  "verified_at": "2026-07-01",
  "expires_at": "2026-08-01",
  "evidence": {
    "source": "test",
    "command": "no-gate --version",
    "result": "no-gate 1.0"
  },
  "capabilities": {
    "read_only_dispatch": "verified",
    "mutation_dispatch": "verified"
  }
}
JSON
OUT="$(node "$REPO_ROOT/bin/autopilot.js" harness report --capabilities-dir "$NO_GATE_DIR" --now 2026-07-05T00:00:00.000Z --required-level H4)"
EXIT=$?
assert_eq "0" "$EXIT" "harness report loads H4-level record missing H4 capability"
assert_contains "$OUT" "\"ready\": 0" "H4 readiness requires blocking_gate"
assert_contains "$OUT" "blocking_gate_not_verified" "H4 missing capability reason is explicit"

OUT="$(node - "$REPO_ROOT" "$CUSTOM_DIR" <<'NODE'
const path = require('path');
const root = process.argv[2];
const dir = process.argv[3];
const { buildCapabilityReport } = require(path.join(root, 'src', 'harness', 'capabilities'));
try {
  buildCapabilityReport({ dir, staleAfter: '', now: '2026-07-05T00:00:00.000Z' });
  console.log('unexpected-ok');
} catch (error) {
  console.log(error.message);
}
NODE
)"
EXIT=$?
assert_eq "0" "$EXIT" "harness report API empty staleAfter process exits 0"
assert_contains "$OUT" "invalid duration" "harness report API rejects empty staleAfter"

SAME_DAY_DIR="$TEST_TMP/capabilities-same-day-expiry"
mkdir -p "$SAME_DAY_DIR"
cat > "$SAME_DAY_DIR/same-day.json" <<'JSON'
{
  "id": "same-day",
  "display_name": "Same Day",
  "kind": "cli",
  "status": "verified",
  "harness_level": "H2",
  "last_checked_at": "2026-07-01",
  "verified_at": "2026-07-01",
  "expires_at": "2026-07-01",
  "evidence": {
    "source": "test",
    "command": "same-day --version",
    "result": "same-day 1.0"
  },
  "capabilities": {
    "read_only_dispatch": "verified"
  }
}
JSON
OUT="$(node "$REPO_ROOT/bin/autopilot.js" harness report --capabilities-dir "$SAME_DAY_DIR" --now 2026-07-01T12:00:00.000Z --required-level H2)"
EXIT=$?
assert_eq "0" "$EXIT" "harness report treats date-only expiry as end-of-day"
assert_contains "$OUT" "\"stale\": 0" "same-day expiry remains fresh until the day ends"
OUT="$(node "$REPO_ROOT/bin/autopilot.js" harness report --capabilities-dir "$SAME_DAY_DIR" --now 2026-07-01T23:59:59.999Z --required-level H2)"
EXIT=$?
assert_eq "0" "$EXIT" "harness report keeps date-only expiry fresh through final millisecond"
assert_contains "$OUT" "\"stale\": 0" "same-day expiry is exclusive of next day"
OUT="$(node "$REPO_ROOT/bin/autopilot.js" harness report --capabilities-dir "$SAME_DAY_DIR" --now 2026-07-02T00:00:00.000Z --required-level H2)"
EXIT=$?
assert_eq "0" "$EXIT" "harness report expires date-only record at next day boundary"
assert_contains "$OUT" "ttl_expired" "same-day expiry becomes stale on next day"

BAD_DIR="$TEST_TMP/capabilities-bad"
mkdir -p "$BAD_DIR"
cat > "$BAD_DIR/bad.json" <<'JSON'
{
  "id": "bad-harness",
  "status": "verified"
}
JSON

OUT="$(node "$REPO_ROOT/bin/autopilot.js" harness report --capabilities-dir "$BAD_DIR" 2>&1)"
EXIT=$?
assert_eq "1" "$EXIT" "harness report fails invalid records"
assert_contains "$OUT" "display_name must be a non-empty string" "invalid record error names missing field"

NO_VERIFIED_AT_DIR="$TEST_TMP/capabilities-no-verified-at"
mkdir -p "$NO_VERIFIED_AT_DIR"
cat > "$NO_VERIFIED_AT_DIR/no-verified-at.json" <<'JSON'
{
  "id": "no-verified-at",
  "display_name": "No Verified At",
  "kind": "cli",
  "status": "verified",
  "harness_level": "H2",
  "last_checked_at": "2026-07-01",
  "verified_at": null,
  "expires_at": "2026-08-01",
  "evidence": {
    "source": "test",
    "command": "missing --version",
    "result": "missing 1.0"
  },
  "capabilities": {
    "read_only_dispatch": "verified"
  }
}
JSON
OUT="$(node "$REPO_ROOT/bin/autopilot.js" harness report --capabilities-dir "$NO_VERIFIED_AT_DIR" 2>&1)"
EXIT=$?
assert_eq "1" "$EXIT" "harness report fails verified record without verified_at"
assert_contains "$OUT" "verified_at is required when status is verified" "verified records require verified_at"

ENUM_DIR="$TEST_TMP/capabilities-enum"
mkdir -p "$ENUM_DIR"
cat > "$ENUM_DIR/bad-enum.json" <<'JSON'
{
  "id": "bad-enum",
  "display_name": "Bad Enum",
  "kind": "cli",
  "status": "verified",
  "harness_level": "H2",
  "last_checked_at": "2026-07-01",
  "verified_at": "2026-07-01",
  "expires_at": "2026-08-01",
  "evidence": {
    "source": "test",
    "command": "bad --version",
    "result": "bad 1.0"
  },
  "capabilities": {
    "read_only_dispatch": "typo"
  }
}
JSON
OUT="$(node "$REPO_ROOT/bin/autopilot.js" harness report --capabilities-dir "$ENUM_DIR" 2>&1)"
EXIT=$?
assert_eq "1" "$EXIT" "harness report fails invalid capability values"
assert_contains "$OUT" "capabilities.read_only_dispatch must be one of" "invalid capability enum fails closed"

BAD_AUTH_DOMAIN_DIR="$TEST_TMP/capabilities-bad-auth-domain"
mkdir -p "$BAD_AUTH_DOMAIN_DIR"
cat > "$BAD_AUTH_DOMAIN_DIR/bad-auth-domain.json" <<'JSON'
{
  "id": "bad-auth-domain",
  "display_name": "Bad Auth Domain",
  "kind": "cli",
  "status": "verified",
  "harness_level": "H2",
  "last_checked_at": "2026-07-01",
  "verified_at": "2026-07-01",
  "expires_at": "2026-08-01",
  "evidence": {
    "source": "test",
    "command": "bad-auth --version",
    "result": "bad-auth 1.0"
  },
  "capabilities": {
    "read_only_dispatch": "verified"
  },
  "auth_domains": {
    "DriverCLI": "verified"
  }
}
JSON
OUT="$(node "$REPO_ROOT/bin/autopilot.js" harness report --capabilities-dir "$BAD_AUTH_DOMAIN_DIR" 2>&1)"
EXIT=$?
assert_eq "1" "$EXIT" "harness report fails invalid auth domain keys"
assert_contains "$OUT" "auth_domains key must be lowercase token" "invalid auth domain key fails closed"

BAD_AUTH_VALUE_DIR="$TEST_TMP/capabilities-bad-auth-value"
mkdir -p "$BAD_AUTH_VALUE_DIR"
cat > "$BAD_AUTH_VALUE_DIR/bad-auth-value.json" <<'JSON'
{
  "id": "bad-auth-value",
  "display_name": "Bad Auth Value",
  "kind": "cli",
  "status": "verified",
  "harness_level": "H2",
  "last_checked_at": "2026-07-01",
  "verified_at": "2026-07-01",
  "expires_at": "2026-08-01",
  "evidence": {
    "source": "test",
    "command": "bad-auth --version",
    "result": "bad-auth 1.0"
  },
  "capabilities": {
    "read_only_dispatch": "verified"
  },
  "auth_domains": {
    "driver_cli": "maybe"
  }
}
JSON
OUT="$(node "$REPO_ROOT/bin/autopilot.js" harness report --capabilities-dir "$BAD_AUTH_VALUE_DIR" 2>&1)"
EXIT=$?
assert_eq "1" "$EXIT" "harness report fails invalid auth domain values"
assert_contains "$OUT" "auth_domains.driver_cli must be one of" "invalid auth domain value fails closed"

DUP_DIR="$TEST_TMP/capabilities-dup"
mkdir -p "$DUP_DIR"
cp "$CUSTOM_DIR/custom.json" "$DUP_DIR/a.json"
cp "$CUSTOM_DIR/custom.json" "$DUP_DIR/b.json"
OUT="$(node "$REPO_ROOT/bin/autopilot.js" harness report --capabilities-dir "$DUP_DIR" 2>&1)"
EXIT=$?
assert_eq "1" "$EXIT" "harness report fails duplicate ids"
assert_contains "$OUT" "duplicate capability id" "duplicate capability id fails closed"

FUTURE_DIR="$TEST_TMP/capabilities-future"
mkdir -p "$FUTURE_DIR"
cat > "$FUTURE_DIR/future.json" <<'JSON'
{
  "id": "future-harness",
  "display_name": "Future Harness",
  "kind": "cli",
  "status": "verified",
  "harness_level": "H3",
  "last_checked_at": "2026-08-01",
  "verified_at": "2026-08-01",
  "expires_at": "2026-09-01",
  "evidence": {
    "source": "test",
    "command": "future --version",
    "result": "future 1.0"
  },
  "capabilities": {
    "read_only_dispatch": "verified",
    "mutation_dispatch": "verified"
  }
}
JSON
OUT="$(node "$REPO_ROOT/bin/autopilot.js" harness report --capabilities-dir "$FUTURE_DIR" --now 2026-07-01T00:00:00.000Z)"
EXIT=$?
assert_eq "0" "$EXIT" "harness report loads future-dated record for stale warning"
assert_contains "$OUT" "last_checked_in_future" "future last_checked_at is stale"
assert_contains "$OUT" "verified_at_in_future" "future verified_at is stale"
assert_contains "$OUT" "\"ready\": 0" "future-dated record is not counted ready"
assert_contains "$OUT" "\"not_ready\": 1" "future-dated record is counted not ready"

BAD_DATE_DIR="$TEST_TMP/capabilities-bad-date"
mkdir -p "$BAD_DATE_DIR"
cat > "$BAD_DATE_DIR/bad-date.json" <<'JSON'
{
  "id": "bad-date",
  "display_name": "Bad Date",
  "kind": "cli",
  "status": "verified",
  "harness_level": "H3",
  "last_checked_at": "2026-06-31",
  "verified_at": "2026-06-30",
  "expires_at": "2026-08-01",
  "evidence": {
    "source": "test",
    "command": "bad-date --version",
    "result": "bad-date 1.0"
  },
  "capabilities": {
    "read_only_dispatch": "verified",
    "mutation_dispatch": "verified"
  }
}
JSON
OUT="$(node "$REPO_ROOT/bin/autopilot.js" harness report --capabilities-dir "$BAD_DATE_DIR" 2>&1)"
EXIT=$?
assert_eq "1" "$EXIT" "harness report fails invalid calendar dates"
assert_contains "$OUT" "must be a valid calendar date" "invalid calendar date fails closed"

BAD_DATETIME_DIR="$TEST_TMP/capabilities-bad-datetime"
mkdir -p "$BAD_DATETIME_DIR"
cat > "$BAD_DATETIME_DIR/bad-datetime.json" <<'JSON'
{
  "id": "bad-datetime",
  "display_name": "Bad Datetime",
  "kind": "cli",
  "status": "verified",
  "harness_level": "H3",
  "last_checked_at": "2026-06-31T00:00:00.000Z",
  "verified_at": "2026-06-30T00:00:00.000Z",
  "expires_at": "2026-08-01",
  "evidence": {
    "source": "test",
    "command": "bad-datetime --version",
    "result": "bad-datetime 1.0"
  },
  "capabilities": {
    "read_only_dispatch": "verified",
    "mutation_dispatch": "verified"
  }
}
JSON
OUT="$(node "$REPO_ROOT/bin/autopilot.js" harness report --capabilities-dir "$BAD_DATETIME_DIR" 2>&1)"
EXIT=$?
assert_eq "1" "$EXIT" "harness report fails invalid ISO datetime calendar values"
assert_contains "$OUT" "must be a valid calendar date" "invalid ISO datetime calendar value fails closed"

OUT="$(node "$REPO_ROOT/bin/autopilot.js" harness report --capabilities-dir "$CUSTOM_DIR" --now 2026-06-31T00:00:00.000Z 2>&1)"
EXIT=$?
assert_eq "1" "$EXIT" "harness report fails invalid ISO datetime now value"
assert_contains "$OUT" "now must be a valid calendar date" "invalid ISO datetime now fails closed"

SECRET_DIR="$TEST_TMP/capabilities-secret"
mkdir -p "$SECRET_DIR"
cat > "$SECRET_DIR/secret.json" <<'JSON'
{
  "id": "secret-harness",
  "display_name": "Secret Harness",
  "kind": "cli",
  "status": "verified",
  "harness_level": "H3",
  "last_checked_at": "2026-07-01",
  "verified_at": "2026-07-01",
  "expires_at": "2026-08-01",
  "evidence": {
    "source": "test",
    "command": "probe --token sk-123456789012345678901234",
    "result": "secret 1.0"
  },
  "capabilities": {
    "read_only_dispatch": "verified",
    "mutation_dispatch": "verified"
  }
}
JSON
OUT="$(node "$REPO_ROOT/bin/autopilot.js" harness report --capabilities-dir "$SECRET_DIR" 2>&1)"
EXIT=$?
assert_eq "1" "$EXIT" "harness report fails secret-shaped evidence"
assert_contains "$OUT" "contains secret-shaped value" "secret-shaped evidence fails closed"
assert_not_contains "$OUT" "sk-123456789012345678901234" "secret-shaped evidence is redacted from errors"

EXTRA_SECRET_DIR="$TEST_TMP/capabilities-extra-secret"
mkdir -p "$EXTRA_SECRET_DIR"
cat > "$EXTRA_SECRET_DIR/extra-secret.json" <<'JSON'
{
  "id": "extra-secret",
  "display_name": "Extra Secret",
  "kind": "cli",
  "status": "verified",
  "harness_level": "H3",
  "last_checked_at": "2026-07-01",
  "verified_at": "2026-07-01",
  "expires_at": "2026-08-01",
  "evidence": {
    "source": "test",
    "command": "extra --version",
    "result": "extra 1.0"
  },
  "capabilities": {
    "read_only_dispatch": "verified",
    "mutation_dispatch": "verified"
  },
  "debug_token": "sk-123456789012345678901234"
}
JSON
OUT="$(node "$REPO_ROOT/bin/autopilot.js" harness report --capabilities-dir "$EXTRA_SECRET_DIR" 2>&1)"
EXIT=$?
assert_eq "1" "$EXIT" "harness report fails secret-shaped extra fields"
assert_contains "$OUT" "record contains secret-shaped value" "full record secret scan fails closed"
assert_not_contains "$OUT" "sk-123456789012345678901234" "secret-shaped extra field is redacted from errors"

EXTRA_FIELD_DIR="$TEST_TMP/capabilities-extra-field"
mkdir -p "$EXTRA_FIELD_DIR"
cat > "$EXTRA_FIELD_DIR/extra-field.json" <<'JSON'
{
  "id": "extra-field",
  "display_name": "Extra Field",
  "kind": "cli",
  "status": "verified",
  "harness_level": "H3",
  "last_checked_at": "2026-07-01",
  "verified_at": "2026-07-01",
  "expires_at": "2026-08-01",
  "evidence": {
    "source": "test",
    "command": "extra --version",
    "result": "extra 1.0"
  },
  "capabilities": {
    "read_only_dispatch": "verified",
    "mutation_dispatch": "verified"
  },
  "unexpected": "value"
}
JSON
OUT="$(node "$REPO_ROOT/bin/autopilot.js" harness report --capabilities-dir "$EXTRA_FIELD_DIR" 2>&1)"
EXIT=$?
assert_eq "1" "$EXIT" "harness report fails unknown top-level fields"
assert_contains "$OUT" "unknown field: unexpected" "unknown top-level fields are not emitted"

OUT="$(node "$REPO_ROOT/bin/autopilot.js" harness report --capabilities-dir "$TEST_TMP/missing-capabilities" 2>&1)"
EXIT=$?
assert_eq "1" "$EXIT" "harness report fails missing capability dir"
assert_contains "$OUT" "capability directory not found" "missing capability dir is fail-closed"

OUT="$(node "$REPO_ROOT/bin/autopilot.js" harness report --capabilities-dir= 2>&1)"
EXIT=$?
assert_eq "1" "$EXIT" "harness report fails empty capability dir"
assert_contains "$OUT" "capability directory must be a non-empty path" "empty capability dir does not fall back to default"

OUT="$(node "$REPO_ROOT/bin/autopilot.js" harness report --unknown 2>&1)"
EXIT=$?
assert_eq "2" "$EXIT" "harness report usage errors exit 2"
assert_contains "$OUT" "unknown harness report argument" "unknown argument reports error"
assert_contains "$OUT" "Usage:" "unknown argument prints usage"

OUT="$(node "$REPO_ROOT/bin/autopilot.js" harness report --required-level H9 2>&1)"
EXIT=$?
assert_eq "2" "$EXIT" "harness report invalid required level exits 2"
assert_contains "$OUT" "required_level must be one of" "invalid required level reports usage error"

OUT="$(node "$REPO_ROOT/bin/autopilot.js" harness report --stale-after= 2>&1)"
EXIT=$?
assert_eq "2" "$EXIT" "harness report empty stale-after exits 2"
assert_contains "$OUT" "invalid duration" "empty stale-after reports usage error"

OUT="$(node "$REPO_ROOT/bin/autopilot.js" harness report --format --stale-after 14d 2>&1)"
EXIT=$?
assert_eq "2" "$EXIT" "harness report missing option value before flag exits 2"
assert_contains "$OUT" "--format requires a value" "missing value before flag reports direct error"

SKILL="$REPO_ROOT/skills/harness-maintenance/SKILL.md"
assert_file_exists "$SKILL" "harness-maintenance skill exists"
SKILL_BODY="$(cat "$SKILL")"
assert_contains "$SKILL_BODY" "node bin/autopilot.js harness report --stale-after 14d" "skill points to harness report"
assert_contains "$SKILL_BODY" "driver availability" "skill separates driver availability from provider quota"
assert_contains "$SKILL_BODY" "below the required harness level" "skill blocks below-level implementation from memory"

CLAIMS_SCRIPT="$REPO_ROOT/scripts/platform-capability-claims.js"
CLAIMS_INPUT="$TEST_TMP/platform-capability-probe-input.json"
CLAIMS_RECEIPT="$TEST_TMP/platform-capabilities.json"
NODE_REALPATH="$(realpath "$(command -v node)")"
NODE_VERSION="$(node --version | sed 's/^v//')"
node - "$CLAIMS_INPUT" "$NODE_REALPATH" "$NODE_VERSION" <<'NODE'
const fs = require('fs');
const [file, binaryRealpath, cliVersion] = process.argv.slice(2);
const observedAt = new Date().toISOString();
const claims = ['D2', 'D3', 'D4', null].map((consumerId, index) => ({
  capability_id: `test-${consumerId ? consumerId.toLowerCase() : 'optional'}-capability`,
  consumer_id: consumerId,
  target_identity: {
    runner: 'node', model: null, role: 'test', effort: null, endpoint: null,
    family: 'nodejs', binary_realpath: binaryRealpath, cli_version: cliVersion,
  },
  official_contract: {
    locator: 'https://nodejs.org/api/cli.html#-v---version',
    retrieved_at: observedAt,
    document_sha256: String(index + 1).repeat(64),
    assertion: `test ${consumerId || 'optional'} capability is supported`,
  },
  live_evidence: {
    cli_version: cliVersion,
    probe_command_sha256: String(index + 4).repeat(64),
    probe_output_sha256: String.fromCharCode(97 + index).repeat(64),
    behavior_class: 'version-report',
    observed_at: observedAt,
    ttl_seconds: 3600,
    result: `test ${consumerId || 'optional'} capability is supported`,
    transport_binding: {
      execution_model: null,
      execution_effort_argument: null,
      normalized_model: null,
      normalized_effort: null,
    },
  },
  agreement: true,
}));
fs.writeFileSync(file, `${JSON.stringify({ schema_version: 1, claims }, null, 2)}\n`);
NODE

OUT="$(node "$CLAIMS_SCRIPT" generate --input "$CLAIMS_INPUT" --output "$CLAIMS_RECEIPT" 2>&1)"
EXIT=$?
assert_exit_code "$EXIT" 0 "capability claim generator accepts dual-evidence input"

GENERATE_REPROBE_CASE=0
for GENERATE_REPROBE_ARGS in \
  "--reprobe-binary $NODE_REALPATH" \
  "--reprobe --reprobe-binary $NODE_REALPATH"; do
  GENERATE_REPROBE_CASE=$((GENERATE_REPROBE_CASE + 1))
  GENERATE_REPROBE_OUTPUT="$TEST_TMP/generate-with-reprobe-$GENERATE_REPROBE_CASE.json"
  OUT="$(node "$CLAIMS_SCRIPT" generate --input "$CLAIMS_INPUT" --output "$GENERATE_REPROBE_OUTPUT" \
    $GENERATE_REPROBE_ARGS 2>&1)"
  EXIT=$?
  assert_exit_code "$EXIT" 1 "generate rejects consumer-only arguments: $GENERATE_REPROBE_ARGS"
  assert_contains "$OUT" "--reprobe-binary is valid only with validate-consumer" \
    "generate reports its closed command grammar: $GENERATE_REPROBE_ARGS"
  assert_file_absent "$GENERATE_REPROBE_OUTPUT" \
    "invalid generate grammar creates no receipt: $GENERATE_REPROBE_ARGS"
done

OUT="$(node "$CLAIMS_SCRIPT" validate-consumers --receipt "$CLAIMS_RECEIPT" --consumer D2 --consumer D3 --consumer D4 --reprobe 2>&1)"
EXIT=$?
assert_exit_code "$EXIT" 0 "capability claims validate complete required partition"
assert_contains "$OUT" "validated consumers D2,D3,D4" "complete consumer validation is explicit"

OUT="$(node "$CLAIMS_SCRIPT" validate-consumer --receipt "$CLAIMS_RECEIPT" --consumer D2 --emit-claim-ids --reprobe 2>&1)"
EXIT=$?
assert_exit_code "$EXIT" 0 "single consumer emits validated IDs"
assert_contains "$OUT" "cap-v1-" "single consumer emits content-addressed claim ID"

SELECTED_VERSION_BIN="$TEST_TMP/selected-version"
printf '#!/usr/bin/env bash\nprintf "selected v%s\\n"\n' "$NODE_VERSION" > "$SELECTED_VERSION_BIN"
chmod +x "$SELECTED_VERSION_BIN"
OUT="$(node "$CLAIMS_SCRIPT" validate-consumer --receipt "$CLAIMS_RECEIPT" --consumer D2 \
  --emit-claim-ids --reprobe --reprobe-binary "$SELECTED_VERSION_BIN" 2>&1)"
EXIT=$?
assert_exit_code "$EXIT" 0 "single consumer revalidates the selected portable binary"
assert_contains "$OUT" "cap-v1-" "selected portable binary preserves receipt claim IDs"

SELECTED_WRONG_VERSION_BIN="$TEST_TMP/selected-wrong-version"
printf '#!/usr/bin/env bash\nprintf "selected 0.0.1\\n"\n' > "$SELECTED_WRONG_VERSION_BIN"
chmod +x "$SELECTED_WRONG_VERSION_BIN"
OUT="$(node "$CLAIMS_SCRIPT" validate-consumer --receipt "$CLAIMS_RECEIPT" --consumer D2 \
  --reprobe --reprobe-binary "$SELECTED_WRONG_VERSION_BIN" 2>&1)"
EXIT=$?
# Policy change (v2.34.20, owner decision 2026-08-18): version drift WARNS, it does not block —
# these CLIs self-update, so a vendor's auto-updater could otherwise kill every dispatch. The
# drift must still be detected and surfaced, which is what the two assertions below require.
# Rewritten, not deleted: a binary that is genuinely absent still fails closed (asserted next).
assert_exit_code "$EXIT" 0 "selected binary version drift warns instead of failing closed"
assert_contains "$OUT" "current_version_drift:0.0.1" "selected binary drift reports its observed version"

ABSENT_OUT="$(node "$CLAIMS_SCRIPT" validate-consumer --receipt "$CLAIMS_RECEIPT" --consumer D2 \
  --reprobe --reprobe-binary "$TEST_TMP/definitely-not-installed" 2>&1)"
ABSENT_EXIT=$?
assert_exit_code "$ABSENT_EXIT" 1 "a genuinely absent binary still fails closed"
assert_contains "$ABSENT_OUT" "version_probe_error" "absent binary reports the fail-closed reason"

OUT="$(node "$CLAIMS_SCRIPT" validate-consumer --receipt "$CLAIMS_RECEIPT" --consumer D2 \
  --reprobe-binary "$SELECTED_VERSION_BIN" 2>&1)"
EXIT=$?
assert_exit_code "$EXIT" 1 "selected binary override requires immediate revalidation"
assert_contains "$OUT" "--reprobe-binary requires --reprobe" "selected binary cannot bypass revalidation"

CLAIMS_MUTATOR="$TEST_TMP/mutate-capability-receipt.js"
cat > "$CLAIMS_MUTATOR" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const [source, destination, action] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(source, 'utf8'));
function canonical(input) {
  if (Array.isArray(input)) return input.map(canonical);
  if (!input || typeof input !== 'object') return input;
  return Object.fromEntries(Object.keys(input).sort().map((key) => [key, canonical(input[key])]));
}
function digest(input) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex');
}
const firstRequiredId = value.consumer_manifest.consumers[0].required_claim_ids[0];
const firstRequired = value.claims.find((claim) => claim.claim_id === firstRequiredId);
const optionalId = value.consumer_manifest.optional_unconsumed_claim_ids[0];
switch (action) {
  case 'unknown-field': value.unexpected = true; break;
  case 'claim-id-tamper': {
    const replacement = `cap-v1-${'0'.repeat(64)}`;
    firstRequired.claim_id = replacement;
    value.consumer_manifest.consumers[0].required_claim_ids[0] = replacement;
    value.consumer_manifest.consumers[0].required_claim_ids.sort();
    break;
  }
  case 'blocked-required': firstRequired.status = 'blocked'; break;
  case 'substituted-required': value.consumer_manifest.consumers[0].required_claim_ids[0] = `cap-v1-${'f'.repeat(64)}`; break;
  case 'optional-smuggle': value.consumer_manifest.consumers[0].required_claim_ids.push(optionalId); value.consumer_manifest.consumers[0].required_claim_ids.sort(); break;
  case 'unknown-consumer': value.consumer_manifest.consumers[0].consumer_id = 'D9'; break;
  case 'duplicate-consumer': value.consumer_manifest.consumers[1].consumer_id = 'D2'; break;
  case 'duplicate-claim': value.claims.push(JSON.parse(JSON.stringify(value.claims[0]))); value.claims.sort((a, b) => a.claim_id.localeCompare(b.claim_id)); break;
  case 'unpartitioned': value.consumer_manifest.optional_unconsumed_claim_ids = []; break;
  case 'manifest-digest-drift': value.consumer_manifest_digest = '0'.repeat(64); break;
  default: throw new Error(`unknown action: ${action}`);
}
if (action !== 'manifest-digest-drift') {
  value.consumer_manifest_digest = digest(value.consumer_manifest);
}
const receiptBody = { ...value };
delete receiptBody.receipt_digest;
value.receipt_digest = digest(receiptBody);
fs.writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`);
NODE

assert_receipt_rejected() {
  local action="$1"
  local expected="$2"
  local mutated="$TEST_TMP/receipt-$action.json"
  node "$CLAIMS_MUTATOR" "$CLAIMS_RECEIPT" "$mutated" "$action"
  OUT="$(node "$CLAIMS_SCRIPT" validate-consumers --receipt "$mutated" --consumer D2 --consumer D3 --consumer D4 2>&1)"
  EXIT=$?
  assert_exit_code "$EXIT" 1 "capability receipt rejects $action"
  assert_contains "$OUT" "$expected" "$action reports a specific fail-closed reason"
}

assert_receipt_rejected unknown-field "unknown field"
assert_receipt_rejected claim-id-tamper "claim-ID tampering"
assert_receipt_rejected blocked-required "is not validated"
assert_receipt_rejected substituted-required "unknown or substituted claim ID"
assert_receipt_rejected optional-smuggle "optional claim smuggled"
assert_receipt_rejected unknown-consumer "unknown consumer"
assert_receipt_rejected duplicate-consumer "duplicate consumer"
assert_receipt_rejected duplicate-claim "duplicate claim ID"
assert_receipt_rejected unpartitioned "unpartitioned receipt claim row"
assert_receipt_rejected manifest-digest-drift "consumer manifest digest drift"

OUT="$(node "$CLAIMS_SCRIPT" validate-consumer --receipt "$CLAIMS_RECEIPT" --consumer D2 --claim-id "cap-v1-$(printf 'f%.0s' {1..64})" --reprobe 2>&1)"
EXIT=$?
assert_exit_code "$EXIT" 1 "downstream consumer rejects substituted claim ID"
assert_contains "$OUT" "downstream claim-ID drift" "downstream drift fails before consumption"

CLAIMS_INPUT_MUTATOR="$TEST_TMP/mutate-capability-input.js"
cat > "$CLAIMS_INPUT_MUTATOR" <<'NODE'
const fs = require('fs');
const [source, destination, action, fakeBinary] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(source, 'utf8'));
switch (action) {
  case 'missing-official': delete value.claims[0].official_contract; break;
  case 'missing-live': delete value.claims[0].live_evidence; break;
  case 'stale': value.claims[0].live_evidence.observed_at = '2020-01-01T00:00:00.000Z'; break;
  case 'version-mismatch': value.claims[0].live_evidence.cli_version = '0.0.0'; break;
  case 'contradiction': value.claims[0].agreement = false; value.claims[0].live_evidence.result = 'contradicted'; break;
  case 'agy-tier-effort-mismatch':
    value.claims[0].target_identity.runner = 'agy';
    value.claims[0].target_identity.model = 'Gemini 3.6 Flash (High)';
    value.claims[0].target_identity.effort = 'high';
    value.claims[0].target_identity.family = 'google';
    value.claims[0].live_evidence.transport_binding.execution_model = 'gemini-3.6-flash-medium';
    value.claims[0].live_evidence.transport_binding.normalized_model = 'gemini-3.6-flash-medium';
    value.claims[0].live_evidence.transport_binding.normalized_effort = 'high';
    break;
  case 'agy-direct-effort-argument':
    value.claims[0].target_identity.runner = 'agy';
    value.claims[0].target_identity.model = 'Gemini 3.6 Flash (High)';
    value.claims[0].target_identity.effort = 'high';
    value.claims[0].target_identity.family = 'google';
    value.claims[0].live_evidence.transport_binding.execution_model = 'gemini-3.6-flash-high';
    value.claims[0].live_evidence.transport_binding.execution_effort_argument = 'high';
    value.claims[0].live_evidence.transport_binding.normalized_model = 'gemini-3.6-flash-high';
    value.claims[0].live_evidence.transport_binding.normalized_effort = 'high';
    break;
  case 'fake-binary':
    for (const claim of value.claims) {
      claim.target_identity.binary_realpath = fakeBinary;
      claim.target_identity.cli_version = '1.2.3';
      claim.live_evidence.cli_version = '1.2.3';
    }
    break;
  default: throw new Error(`unknown action: ${action}`);
}
fs.writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`);
NODE

assert_input_rejected() {
  local action="$1"
  local expected="$2"
  local input="$TEST_TMP/input-$action.json"
  node "$CLAIMS_INPUT_MUTATOR" "$CLAIMS_INPUT" "$input" "$action" ""
  OUT="$(node "$CLAIMS_SCRIPT" generate --input "$input" --output "$TEST_TMP/output-$action.json" 2>&1)"
  EXIT=$?
  assert_exit_code "$EXIT" 1 "claim generation rejects $action evidence"
  assert_contains "$OUT" "$expected" "$action evidence reports fail-closed reason"
}

assert_input_rejected missing-official "missing field: official_contract"
assert_input_rejected missing-live "missing field: live_evidence"
# Policy change (v2.34.20, owner decision 2026-08-18): wall-clock age of a RECORDED
# observation is advisory, so generation must SUCCEED and say so loudly. It was fatal, and
# that made the rail unusable by construction — probe-harness-capabilities.sh replays a
# hardcoded observed_at for the four D3 claims, so no re-probe could ever clear it.
# The neighbouring version-mismatch and contradiction cases below still fail closed, which
# is what keeps this from being a blanket weakening.
assert_input_warned() {
  local action="$1"
  local expected="$2"
  local input="$TEST_TMP/input-$action.json"
  node "$CLAIMS_INPUT_MUTATOR" "$CLAIMS_INPUT" "$input" "$action" ""
  OUT="$(node "$CLAIMS_SCRIPT" generate --input "$input" --output "$TEST_TMP/output-$action.json" 2>&1)"
  EXIT=$?
  assert_exit_code "$EXIT" 0 "claim generation accepts $action evidence"
  assert_contains "$OUT" "$expected" "$action evidence is still surfaced as an advisory"
}

assert_input_warned stale "recorded evidence expired"
assert_input_rejected version-mismatch "required claim"
assert_input_rejected contradiction "required claim"
assert_input_rejected agy-tier-effort-mismatch "mismatched agy model-tier/effort metadata"
assert_input_rejected agy-direct-effort-argument "execution_effort_argument must be null for agy production transport"

FAKE_VERSION_BIN="$TEST_TMP/fake-version"
printf '#!/usr/bin/env bash\nprintf "fake 1.2.3\\n"\n' > "$FAKE_VERSION_BIN"
chmod +x "$FAKE_VERSION_BIN"
FAKE_INPUT="$TEST_TMP/fake-input.json"
FAKE_RECEIPT="$TEST_TMP/fake-receipt.json"
node "$CLAIMS_INPUT_MUTATOR" "$CLAIMS_INPUT" "$FAKE_INPUT" fake-binary "$FAKE_VERSION_BIN"
node "$CLAIMS_SCRIPT" generate --input "$FAKE_INPUT" --output "$FAKE_RECEIPT" >/dev/null
printf '#!/usr/bin/env bash\nprintf "fake 1.2.4\\n"\n' > "$FAKE_VERSION_BIN"
chmod +x "$FAKE_VERSION_BIN"
OUT="$(node "$CLAIMS_SCRIPT" validate-consumer --receipt "$FAKE_RECEIPT" --consumer D2 --reprobe 2>&1)"
EXIT=$?
# Same policy change: drift warns, it does not reject. The observed replacement version must
# still appear, so a silent swap remains impossible.
assert_exit_code "$EXIT" 0 "current binary version drift warns on a previously valid claim"
assert_contains "$OUT" "current_version_drift:1.2.4" "current version drift reports observed replacement version"

finalize_test
