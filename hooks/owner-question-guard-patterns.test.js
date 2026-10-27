/**
 * Table-driven phrase tests for hooks/owner-question-guard.js findOwnerQuestion. Run: node --test hooks/owner-question-guard-patterns.test.js
 * SHOULD = sentences that wait for the owner to approve / decide / answer (must be found); SHOULD_NOT = sentences that must pass.
 * Origin: the peer report of 2026-10-27 (twgs-revival PEACE): "要你批准", "會等你批准", "要我…嗎" were not found, so one push
 * question was asked 4-5 times without a card. Negative control: `git stash`-style removal of the new patterns turns the SHOULD
 * table red (see the commit message); the SHOULD_NOT table guards the other side (no pattern may be widened into a false alarm).
 * Pure function test: no I/O.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { findOwnerQuestion } = require('./owner-question-guard.js');

const SHOULD = [
  // the three sentences of the report
  '合入之後，推到遠端那一步要你批准。',
  'push 會等你批准。',
  '要我推到遠端嗎？',
  // approval verbs after 要/需要/得/會等/待/等
  '需要你核准這個 release 才能繼續。',
  '這一步得你同意。',
  '等你授權我再動 production。',
  '待你確認後我再推。',
  '你批准後我再合併。',
  '須經 owner 同意才能刪除。',
  '等 owner 回覆後再繼續。',
  '請你確認是否合併。',
  // yes/no questions put to the owner
  '需要我先建立分支嗎？',
  '我可以直接重寫歷史嗎？',
  '這樣可以嗎？',
  '好嗎？',
  'OK 嗎？',
  '方案 A 還是方案 B？',
  '是否要把這批一起發？',
  '要不要把 develop 推到遠端，還在等你決定。',
  // english
  'Shall I push to origin?',
  'Want me to go ahead and merge?',
  "I'm waiting for your approval before pushing.",
  'This needs your go-ahead.',
  "Waiting on the owner's decision.",
  'May I delete the branch?',
  'Can I go ahead and push?',
  'Do you want option A or B?',
  'Is it ok to push?',
  'Let me know whether to proceed.',
];

const SHOULD_NOT = [
  // statements of completed work
  '已經推到遠端，測試全部通過。',
  '我已合入 develop 並完成驗收。',
  '上一輪 owner 批准了這個方案，已照辦。',
  'owner 之前同意過這個做法，所以我直接做。',
  'I pushed the branch and opened the PR.',
  'The review approved the change; merging now.',
  '檔案已更新，下一步我會自行跑完整套件。',
  // quoting someone else's question
  '他問：「要我推到遠端嗎？」這是引用別人的問題。',
  '> 要不要推送？\n以上是上一則訊息的引用。',
  // code
  '`// TODO: should I retry?` 這行是原始碼註解。',
  '```js\n// shall I push? 要你批准\nconst x = 1;\n```\n程式碼如上。',
  // rhetorical questions
  '這不是很簡單嗎？',
  '難道這樣會比較好？',
  // the word appears but nobody is asked
  '測試檢查是否存在 lockfile。',
  '函式會回傳是否成功。',
  'The function returns whether the file exists.',
  '等待背景工作完成。',
  '這批變更需要經過測試。',
  'You can read the log under /tmp.',
  '為什麼會這樣？因為 cache 過期。',
  '已完成清理，沒有要你決定的事。',
  '這步不需要你批准，我直接做。',
  'Nothing here needs your approval.',
];

test('SHOULD table is big enough and every sentence is found', () => {
  assert.ok(SHOULD.length >= 20);
  const missed = SHOULD.filter((s) => findOwnerQuestion(s) === null);
  assert.deepStrictEqual(missed, []);
});

test('SHOULD_NOT table is big enough and no sentence is found', () => {
  assert.ok(SHOULD_NOT.length >= 15);
  const flagged = SHOULD_NOT.filter((s) => findOwnerQuestion(s) !== null);
  assert.deepStrictEqual(flagged, []);
});
