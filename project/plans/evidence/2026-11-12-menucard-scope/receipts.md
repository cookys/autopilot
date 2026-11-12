# Receipts — menucard A1–A5（2026-11-12）

Harness 禁止本工作階段 git commit / push / PR。下列各階段都沒有 commit。SHA：pending harness commit。負向對照已做過並還原；下面的紅燈行是該次突變的斷言輸出。本輪在還原後重跑綠燈（見各階段 pass 與最後一節）。

測試一律 `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID`，stdin 來自 `/dev/null`。`scripts/open-decision.test.js` 不存在，未跑。

## A1 `scripts/lib/team.js`

- commit sha: pending harness commit
- test command: `node --test scripts/lib/team.test.js`
- pass count: 7（exit 0；含在本輪合併的 `node --test` 24 通過裡）
- negative control: 把缺檔分支改回「本機 hub.toml 存在則 lane」→ `missing file + hub.toml present is solo` 紅。已還原。
- red output line: `'lane' !== 'solo'`

## A2 角色閘（`scripts/open-decision.js`）

- commit sha: pending harness commit
- test command: `node --test scripts/open-decision-role-gate.test.js`
- pass count: 7（exit 0；含在本輪合併的 `node --test` 24 通過裡）
- negative control: library `openDecision` 的角色閘改成 `if (false && routed && routed.code === 4)` → `scripts/open-decision-role-gate.test.js` 紅
- red output line: `'ok' !== 'error'`

## A3 ask-decision deny

- commit sha: pending harness commit
- test command: `bash hooks/tests/ask-decision-gate.test.sh`
- pass count: 20 assertions（exit 0）
- negative control: 角色檢查改成 `if (false && role !== 'solo' && role !== 'pm')` → `hooks/tests/ask-decision-gate.test.sh` 紅
- red output line: `lane: denies: '"permissionDecision":"deny"' not found in output`

## A4 `scripts/request-decision.js`、`--from-request`

- commit sha: pending harness commit
- test command: `node --test scripts/request-decision.test.js`
- pass count: 10（exit 0；含在本輪合併的 `node --test` 24 通過裡）
- negative control: `scripts/lib/menu-card-content.js` 改成 `const redacted = raw`（不呼叫 `redact()`）→ `scripts/request-decision.test.js` 紅
- red output line: `credential leaked: <synthetic test token>`

## A5 guard、session-start

- commit sha: pending harness commit
- test command: `bash hooks/tests/owner-question-guard.test.sh`
- pass count: 67 assertions（exit 0）
- negative control: 非 PM 的 `r-` 放行條件改成 `role !== 'solo'`（PM 也放行）→ `hooks/tests/owner-question-guard.test.sh` 紅
- red output line: `pm with only an r- id still blocks: blocks: '"decision":"block"' not found in output`
- session-start test command: `bash hooks/tests/session-start-token-discipline.test.sh`
- session-start pass count: 13 assertions（exit 0）
- session-start negative control: `ownerQuestionLine` 改成 `if (true || role === 'solo' || role === 'pm') return OPEN_CARD_LINE` → `hooks/tests/session-start-token-discipline.test.sh` 紅
- session-start red output line: `lane context has no open-card line: unexpected 'open a card' in output`

## 本輪終驗（還原後，2026-11-12）

- `node --test scripts/lib/team.test.js scripts/open-decision-role-gate.test.js scripts/request-decision.test.js` → exit 0；tests 24、pass 24、fail 0
- `bash hooks/tests/ask-decision-gate.test.sh` → exit 0；PASS 20 assertions
- `bash hooks/tests/owner-question-guard.test.sh` → exit 0；PASS 67 assertions
- `bash hooks/tests/session-start-token-discipline.test.sh` → exit 0；PASS 13 assertions
- `scripts/open-decision.test.js` → 檔案不存在，未跑
- `bash scripts/sync-all.sh --check` → exit 0；`ok: true`；failures 空
- `node scripts/check-claude-md-inventory.js` → 含在上述 sync-all 裡，exit 0
