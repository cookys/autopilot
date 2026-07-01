#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(AUTOPILOT_HARNESS_NOW=2026-07-20T00:00:00.000Z node "$REPO_ROOT/bin/autopilot.js" harness report --stale-after 14d)"
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
assert_contains "$PARSED" "total=6" "harness report loads default records"
assert_contains "$PARSED" "stale=6" "harness report marks old records stale"
assert_contains "$PARSED" "verified=4" "harness report counts verified records"
assert_contains "$PARSED" "warning=1" "harness report counts warning records"
assert_contains "$PARSED" "unverified=1" "harness report counts unverified records"
assert_contains "$PARSED" "unavailable=0" "harness report counts unavailable records"
assert_contains "$PARSED" "not_ready=6" "harness report counts records below default H3 readiness"
assert_contains "$PARSED" "attention=6" "harness report counts stale or not-ready records"
assert_contains "$PARSED" "has_codex=true" "harness report includes codex record"
assert_contains "$PARSED" "codex_level=H2" "harness report preserves harness level"
assert_contains "$PARSED" "required_level=H3" "harness report defaults readiness to H3"
assert_contains "$PARSED" "copilot_reasons_unique=true" "harness report emits unique readiness reasons"

OUT="$(AUTOPILOT_HARNESS_NOW=2026-07-02T00:00:00.000Z node "$REPO_ROOT/bin/autopilot.js" harness report --stale-after 14d --format warning)"
EXIT=$?
assert_eq "0" "$EXIT" "harness warning report exits 0"
assert_contains "$OUT" "AUTOPILOT_HARNESS_ATTENTION count=6" "warning report includes stale or H3-unready records"
assert_contains "$OUT" "required_level=H3" "warning report names required level"
assert_contains "$OUT" "codex:" "warning report includes fresh H2 codex for H3 readiness"
assert_contains "$OUT" "level_below_H3" "warning report explains H3 readiness gap"
assert_contains "$OUT" "claude-code:" "warning report includes unavailable claude"
assert_contains "$OUT" "copilot-cli:" "warning report includes unverified copilot"
assert_contains "$OUT" "... 1 more" "warning report truncates long attention list"

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

finalize_test
