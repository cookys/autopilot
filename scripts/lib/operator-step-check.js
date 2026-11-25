'use strict';

function checkOperatorSteps(steps) {
  const joined = steps.join('\n');
  const reasons = [];
  if (!/(?:https?:\/\/[^\s]+|\b(?:\d{1,3}\.){3}\d{1,3}\b|(?:~\/|\/)[^\s/]+|\b[\w.-]+:\d+\b)/i.test(joined)) reasons.push('缺少位置：網址、IP、主機:port 或檔案路徑');
  if (!/`[^`]+`|執行|輸入|寫入|貼上|點|按|打開|\b(?:run|type|write|open|click)\b/i.test(joined)) reasons.push('缺少動作：指令或要點選的操作');
  if (!/驗證|確認|應該看到|預期|\b(?:verify|check|expect)\b/i.test(joined)) reasons.push('缺少驗證：做完後如何確認結果');
  steps.forEach((step, i) => { if (Array.from(step).length < 12) reasons.push(`第 ${i + 1} 個步驟少於 12 字元`); });
  return { ok: reasons.length === 0, reasons };
}
module.exports = { checkOperatorSteps };
