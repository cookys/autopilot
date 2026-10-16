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
assertRejected('9007199254740992', '2**53 — exactly representable but adjacent integers collapse (Number.isSafeInteger is false)');

// --- Required planted positives (must still be accepted) --------------------
assertAccepted('0.75');
assertAccepted('0.9166666666666666');
assertAccepted('100');
assertAccepted('-42');
assertAccepted('1.5');
assertAccepted('0.5');

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

// Regression case: a caller that hands validateJsonSchema a JS value directly
// (not a JSON string through readJson/preflightJsonSource) used to bypass the
// unsafe-integer check entirely — 2**53 slipped through assertJsonValue as a
// "finite double" and only failed later as a misleading "must have type
// integer" schema error instead of the explicit UNSUPPORTED_JSON_NUMBER this
// magnitude deserves. See hooks/tests/execution-profile.test.sh's
// `validateJsonSchema({ type: 'integer' }, Number.MAX_SAFE_INTEGER + 1)` case.
test('assertJsonValue REJECTED: 2**53 as an in-memory integer value (unsafe magnitude)', () => {
  assert.throws(
    () => assertJsonValue(2 ** 53, '$'),
    (error) => {
      assert.equal(error.code, 'UNSUPPORTED_JSON_NUMBER');
      return true;
    },
  );
});

test('assertJsonValue REJECTED: Number.MAX_SAFE_INTEGER + 1 as an in-memory integer value', () => {
  assert.throws(
    () => assertJsonValue(Number.MAX_SAFE_INTEGER + 1, '$'),
    (error) => {
      assert.equal(error.code, 'UNSUPPORTED_JSON_NUMBER');
      return true;
    },
  );
});

// A lossless NON-integer in-memory value must keep being accepted regardless
// of the integer-magnitude guard above — Number.isInteger(0.5) is false, so
// it must fall through untouched.
test('assertJsonValue ACCEPTED: 0.5 as an in-memory value', () => {
  assert.doesNotThrow(() => assertJsonValue(0.5, '$'));
});

test('assertJsonValue ACCEPTED: 0 (positive zero) is not confused with -0', () => {
  assert.doesNotThrow(() => assertJsonValue(0, '$'));
  assert.ok(!Object.is(0, -0), 'sanity: positive zero is not -0');
});

// --- Lone surrogates (strings and object keys) -------------------------------
// Raw bytes are written so the escape text reaches the preflight verbatim.
function preflightRaw(text) {
  const file = path.join(tempRoot, `raw-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, text);
  return readJson(file, 'fixture');
}

function assertStringRejected(name, text) {
  test(`lone surrogate REJECTED: ${name}`, () => {
    assert.throws(() => preflightRaw(text), (error) => {
      assert.equal(error.code, 'UNSUPPORTED_JSON_STRING');
      return true;
    });
  });
}

assertStringRejected('lone high in a value', '{"x": "a\\ud800b"}');
assertStringRejected('lone low in a value', '{"x": "a\\udc00b"}');
assertStringRejected('high at end of string', '{"x": "ab\\ud800"}');
assertStringRejected('lone high in an object key', '{"a\\ud800": 1}');
assertStringRejected('lone low in an object key', '{"\\udc00": 1}');
assertStringRejected('reversed pair (low then high)', '{"x": "\\udc00\\ud800"}');
assertStringRejected('lone surrogate nested in an array', '{"x": ["ok", "\\ud800"]}');

test('lone surrogate ACCEPTED: a valid escaped pair (U+1F600) in value and key', () => {
  const doc = preflightRaw('{"x": "\\ud83d\\ude00", "\\ud83d\\ude00": 1}');
  assert.equal(doc.x, '\u{1F600}');
});

test('assertJsonValue: lone surrogate rejected in value and key, pair accepted', () => {
  assert.throws(() => assertJsonValue('\ud800', '$'), { code: 'UNSUPPORTED_JSON_STRING' });
  assert.throws(() => assertJsonValue({ '\udc00': 1 }, '$'), { code: 'UNSUPPORTED_JSON_STRING' });
  assert.doesNotThrow(() => assertJsonValue({ '\u{1F600}': '\u{1F600}' }, '$'));
});

// --- Invalid UTF-8 and BOM (file level) --------------------------------------
function assertBytesRejected(name, bytes) {
  test(`encoding REJECTED: ${name}`, () => {
    assert.throws(() => preflightRaw(Buffer.from(bytes)), { code: 'INVALID_JSON_INPUT' });
  });
}
assertBytesRejected('encoded surrogate ED A0 80', [0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xed, 0xa0, 0x80, 0x22, 0x7d]);
assertBytesRejected('truncated sequence', [0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xe2, 0x82, 0x22, 0x7d]);
assertBytesRejected('lone 0xFF', [0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]);
assertBytesRejected('leading BOM', [0xef, 0xbb, 0xbf, 0x7b, 0x7d]);

// node:test runs the cases after this file finishes loading, so clean up on
// process exit; a failed run (non-zero code) keeps the directory for debugging.
process.on('exit', (code) => {
  if (code === 0) fs.rmSync(tempRoot, { recursive: true, force: true });
});
