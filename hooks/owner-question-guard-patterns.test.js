/**
 * Table-driven phrase tests for hooks/owner-question-guard.js findOwnerQuestion. Run: node --test hooks/owner-question-guard-patterns.test.js
 * SHOULD = sentences that wait for the owner to approve / decide / answer (must be found); SHOULD_NOT = sentences that must pass.
 * Origin: the peer report of 2026-10-27 (<host> PEACE): "要你批准", "會等你批准", "要我…嗎" were not found, so one push
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
  '已完成清理，沒有要你決定的事。',
  '這步不需要你批准，我直接做。',
  'Nothing here needs your approval.',
];

// The independent acceptance's 30 sentences (decfix cv1 evidence/probe.js), verbatim.
const ACCEPT_YES = ['我不會替你決定，等你回覆。','等待你的核准才能 release。','- 請你決定 deployment 的時間。','- Shall I publish version two?','Would you like a separate hotfix branch?','Can I proceed with migration?','要我刪掉舊索引嗎？','我能修改 production 嗎？','能否讓我部署？','請核准這次上線。','需要您的確認才能前進。','Please confirm whether we should deploy.','Waiting for your sign-off on release.','請你同意我再操作。','沒有你的批准就不能部署。'];
const ACCEPT_NO = ['所有 changes 已驗證完成。','- release 已經完成。','- No approval is required from you.','You do not need to approve this release.','No need for your approval.','章節標題：如何判斷是否完成？','服務會等待佇列清空。','函式檢查參數是否合法。','> Shall I release v2?','```text\n請你批准 release\n```','日誌內容是「要我重試嗎？」。','`waiting for your approval` 是訊息常數。','前一位同事說 “Can I proceed with migration?”','部署已獲同意，正在進行。','難道程式還不夠清楚嗎？'];
SHOULD.push(...ACCEPT_YES, '我不會替你決定，等你回覆。', '請核准這次上線。');
SHOULD_NOT.push(...ACCEPT_NO, '還有什麼好說的嗎？', '他問：「要我推到遠端嗎？」', '> 要不要推送？', '// TODO: should I retry?');

// The independent acceptance's second round, 32 sentences (cv2 evidence/new-phrases.js), verbatim.
const ACCEPT2_YES = [
'不必改 API，但請你批准資料庫切換。',
'測試不用你處理；等你同意後才會 tag。',
'Build is green, but I need your permission before rollout.',
'* 請你核准 cache 清除。',
'1. 要我停用舊的 worker 嗎？',
'請您授權我調整 firewall。',
'尚未得到你的同意，不能執行 reset。',
'沒有您的核准就不會刪除 bucket。',
'Awaiting your confirmation before restarting the service.',
'Please choose the backup region.',
'May I rotate the staging token now?',
'Would you like me to archive the old dashboard?',
'等你拍板再建立 release branch。',
'你確認後我再重啟 daemon。',
'請回覆是否接受這個 schema 變更。',
'可以先發佈測試環境嗎？',
'* Waiting for your confirmation before deleting the snapshots.'];
const ACCEPT2_NO = [
'無需你核准這次 cleanup；已經執行完畢。',
'不需要你確認，流程已結束。',
'You do not need to confirm this patch, everything is finished.',
'No approval is needed for the scheduled cleanup.',
'測試輸出「請你授權我重新整理」。',
'> Please choose the backup region.',
'```bash\n# Waiting for your permission\necho done\n```',
'`May I rotate the token?` 是測試輸入。',
'- 所有 worker 都已重啟，狀態 healthy。',
'1. 備份已落盤，沒有待決事項。',
'難道修復 cache 還會不清楚嗎？',
'函式會確認使用者是否可以登入。',
'文件標題：如何選擇 shard？',
'I am not waiting for your approval.',
'不需要你批准這件事，真的不必你同意。'];
SHOULD.push(...ACCEPT2_YES, '## 請你核准這次上線', '可以先發佈測試環境嗎?如果不行請告訴我。', '這個 schema 要採用方案 B 嗎?我先等著。', '要我推到遠端嗎?如果不要我就跳過。', 'Release heading: please approve the rollout', '章節標題：請你核准這次上線。',
  '這不是要你決定的事、要你批准後才能部署。', '能不能請你確認一下', '是不是要你批准', '* 要你核准 rollout', '- Please confirm the release date.',
  'Is the migration ok to start?', '可以先發佈測試環境嗎？');
SHOULD_NOT.push(...ACCEPT2_NO, '版本 v1.2中文說明。', '網址是 https://x.com/a?b=1中文，已確認。', '章節標題：如何判斷是否完成？',
  '## 如何選擇 shard？', '/* should I retry?\n * 要你批准 */\n程式碼註解已略過。', 'See https://example.com/a?b=1 for details.');

// RECALL TRADE-OFF (depth-0 decision: a missed owner question costs far more than one extra card prompt, so any sentence that ends with a
// question mark is treated as asked of the owner). These sentences were "must not trigger" in round 1 and now do; they are pinned here so the change is
// visible and any later narrowing has to touch this table on purpose. Not deleted from the regression set, only moved.
const RECALL_TRADEOFF = ['為什麼會這樣？因為 cache 過期。'];

test('recall trade-off sentences are pinned as triggering', () => {
  assert.deepStrictEqual(RECALL_TRADEOFF.filter((x) => findOwnerQuestion(x) === null), []);
});

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
