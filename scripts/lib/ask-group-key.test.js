'use strict';

const assert = require('node:assert');
const { createHash } = require('node:crypto');
const { normalizeQuestion, groupKey } = require('./ask-group-key');

assert.strictEqual(
  groupKey('How are you?'),
  groupKey('  HOW\tare\nyou?!  '),
  'case, whitespace, and punctuation should not affect the key',
);

assert.strictEqual(
  groupKey('你 好嗎？'),
  groupKey('你好嗎?'),
  'Chinese whitespace and full-width punctuation should not affect the key',
);

const sharedPrefix = '同'.repeat(80);
const firstQuestion = `${sharedPrefix}甲`;
const secondQuestion = `${sharedPrefix}乙`;
assert.notStrictEqual(
  groupKey(firstQuestion),
  groupKey(secondQuestion),
  'questions differing after a shared 80-character prefix should have different keys',
);

for (const invalidInput of [
  '',
  '   \t\n',
  '！？!?.,;：；·—…',
  null,
  undefined,
  123,
]) {
  assert.strictEqual(
    normalizeQuestion(invalidInput),
    '',
    `normalizeQuestion should return an empty string for ${String(invalidInput)}`,
  );
  assert.strictEqual(
    groupKey(invalidInput),
    null,
    `groupKey should return null for ${String(invalidInput)}`,
  );
}

for (const normalInput of [
  'How are you?',
  '你 好嗎？',
  '固定 Input #42！',
  'abc',
]) {
  assert.match(
    groupKey(normalInput),
    /^[0-9a-f]{16}$/,
    'a normal input should produce exactly 16 lowercase hexadecimal characters',
  );
}

const fixedInput = '固定 Input #42！';
const expectedNormalized = '固定input42';
const independentlyComputedKey = createHash('sha256')
  .update(expectedNormalized, 'utf8')
  .digest('hex')
  .slice(0, 16);

assert.strictEqual(
  normalizeQuestion(fixedInput),
  expectedNormalized,
  'the fixed input should normalize to the expected text',
);
assert.strictEqual(
  groupKey(fixedInput),
  independentlyComputedKey,
  'the fixed input should produce the independently computed key',
);

console.log('all tests passed');
