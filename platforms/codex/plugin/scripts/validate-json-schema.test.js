'use strict';
// Run: node --test scripts/validate-json-schema.test.js
//
// Binds the lossless-round-trip contract of parseNumber/assertJsonValue with
// planted positives and negatives, so the property is verified by this
// suite and not only by the shipped official-qualification-defaults.json
// artifact happening to be canonical. See docs/BACKLOG.md
// "`validate-json-schema.js` 拒絕所有非整數數字" and the 🟠 hetero-review
// follow-up that added the -0 case (parseNumber's integer branch used to
// accept "-0" via Number.isSafeInteger(-0)===true, then
// JSON.stringify(-0)==='0' silently dropped the sign).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readJson, assertJsonValue } = require('./validate-json-schema');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-validate-json-schema-test-'));

// Writes {"x": <literal>} as raw bytes (not via JSON.stringify, so the exact
// source literal under test — including ones JSON.stringify would never
// itself produce, like "1.50" — reaches parseNumber verbatim) and runs it
// through the real file-preflight path (readJson -> preflightJsonSource).
function preflightLiteral(literal) {
  const file = path.join(tempRoot, `lit-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, `{"x": ${literal}}`);
  return readJson(file, 'fixture');
}

function assertRejected(literal, note) {
  test(`REJECTED: ${literal}${note ? ` (${note})` : ''}`, () => {
    assert.throws(
      () => preflightLiteral(literal),
      (error) => {
        assert.ok(
          error.code === 'UNSUPPORTED_JSON_NUMBER' || error.code === 'INVALID_JSON_INPUT',
          `expected UNSUPPORTED_JSON_NUMBER or INVALID_JSON_INPUT, got ${error.code}: ${error.message}`,
        );
        return true;
      },
    );
  });
}

function assertAccepted(literal, expectedValue) {
  test(`ACCEPTED: ${literal}`, () => {
    const doc = preflightLiteral(literal);
    assert.equal(doc.x, expectedValue === undefined ? Number(literal) : expectedValue);
  });
}

// --- Required planted negatives (must still be rejected) --------------------
assertRejected('-0', 'sign-lossy integer: JSON.stringify(-0) === "0"');
assertRejected('1e2', 'reformats to "100" on canonical re-serialize, byte-mismatch');
assertRejected('.5', 'invalid JSON at the parser layer — no leading digit before "."');
assertRejected('1.50', 'trailing zero lost on canonical re-serialize ("1.5")');
assertRejected('0.1000000000000000000000001', 'rounds to the same double as 0.1, byte-mismatch');
assertRejected('1e999', 'overflows to Infinity, not finite JSON');
assertRejected('9007199254740993', 'unsafe integer — reparses to a different double (9007199254740992)');

// --- Required planted positives (must still be accepted) --------------------
assertAccepted('0.75');
assertAccepted('0.9166666666666666');
assertAccepted('100');
assertAccepted('-42');
assertAccepted('1.5');

// --- assertJsonValue: the in-memory-value boundary (no source literal at all,
// e.g. validateJsonSchema() called directly on a constructed object) --------
test('assertJsonValue REJECTED: -0 as an in-memory value (Object.is(-0))', () => {
  assert.throws(
    () => assertJsonValue(-0, '$'),
    (error) => {
      assert.equal(error.code, 'UNSUPPORTED_JSON_NUMBER');
      return true;
    },
  );
});

test('assertJsonValue REJECTED: NaN as an in-memory value', () => {
  assert.throws(
    () => assertJsonValue(NaN, '$'),
    (error) => {
      assert.equal(error.code, 'UNSUPPORTED_JSON_NUMBER');
      return true;
    },
  );
});

test('assertJsonValue REJECTED: Infinity as an in-memory value', () => {
  assert.throws(
    () => assertJsonValue(Infinity, '$'),
    (error) => {
      assert.equal(error.code, 'UNSUPPORTED_JSON_NUMBER');
      return true;
    },
  );
});

test('assertJsonValue ACCEPTED: a finite non-integer in-memory value', () => {
  assert.doesNotThrow(() => assertJsonValue(0.9166666666666666, '$'));
});

test('assertJsonValue ACCEPTED: 0 (positive zero) is not confused with -0', () => {
  assert.doesNotThrow(() => assertJsonValue(0, '$'));
  assert.ok(!Object.is(0, -0), 'sanity: positive zero is not -0');
});
