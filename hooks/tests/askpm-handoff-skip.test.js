'use strict';
// A handoff resume line is not a question for the PM: the hook must not log it as an ask.
const test = require('node:test');
const assert = require('node:assert/strict');
const { isInjected, isHandoffResume } = require('../askpm-log');

test('handoff resume instruction is injected, a real question about handoff is not', () => {
  const line = 'read /run/user/1001/autopilot/handoff/35c203e4-be96-4b82-824f-7b0a46c4969c.md 接續';
  assert.equal(isHandoffResume(line), true);
  assert.equal(isInjected(line), true);
  assert.equal(isInjected('這個 handoff 是不是寫太長了'), false);
  assert.equal(isInjected('read the handoff doc and tell me what is left'), false);
});
