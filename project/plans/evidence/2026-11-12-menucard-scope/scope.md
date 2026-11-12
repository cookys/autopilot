# 範圍聲明：menucard 併入卡片路由（PM 01M708ZG）

## 1. 目標

非 PM team session 不再自己開操作員卡：AskUserQuestion / 互動選單改以 request-decision 送 PM（問題、選項、建議），走 SYNTHESIS §4 第 2 項同一道閘（ask-decision）。PM 授權內自決；授權外才在 PM 主機的 PM 佇列開卡並轉回答覆。r2a 的 lane 端阻塞 hook 與 lane 自有卡片收掉，只留可重用部分。

## 2. 現況（develop HEAD）

- `hooks/hooks.json:101-109`：PreToolUse `AskUserQuestion` 掛 `ask-decision.js`。PermissionRequest（:326-335）、Notification（:337-346）只掛 `awaiting-owner.js`；Stop 掛 `owner-question-guard.js`（:248-256）。
- `hooks/ask-decision.js:69-72` 只處理無 `agent_id` 的主執行緒；:74-91 經 `openDecision()` 寫 origin `ask_user_question` 的卡；:23-24 fail-open、從不輸出 permission decision。不分角色。
- `hooks/owner-question-guard.js:35` 只認 `d-`+8 hex；:184-204 偵測到等 owner 就 block 一次，要求 `open-decision.js open`；不認 request id、不分角色。
- `scripts/open-decision.js:608-635` `openDecision()` 無角色檢查；CLI open（:559-602）只檢 `--executor`（:567）、`--target`（:572-575）、`--not-authorized`（:576-579，`checkNotAuthorized` :191-207）。旗標表 :122、:358-359 無 `--irreversible`，`open --irreversible` 在 :132 成為未知參數 exit 2。
- `hooks/awaiting-owner.js:225-235` 的 `permission_prompt` 經 `hooks/permission-block-lib.js:48-60` 開 origin `permission_prompt` 偵測卡（不按鍵，:5-9）。
- `scripts/request-decision.js`、`scripts/lib/team.js` 不存在。

## 3. 會改的檔案

| 檔案 | 變更 | r2a → 卡片路由 |
|---|---|---|
| `scripts/lib/team.js`（新） | 讀 `~/.autopilot/team.json`；缺檔一律 solo（mode 檔出現前不生效）；檔在但壞 JSON、未知角色或讀不了 = lane | 取代 P6 `resolve-operator-channel.js` |
| `scripts/open-decision.js` | library 與 CLI open 加角色閘：team 且非 PM → exit 4、不寫、指向 `request-decision.js`；PM 端加 `open --from-request <r-id>` | P2 改為角色閘；§4 第 2、3 項 |
| `hooks/ask-decision.js` | 非 PM team：PreToolUse deny + `permissionDecisionReason` 指向 `request-decision.js`，不開卡；PM / solo 照舊 | P3a 只留 deny |
| `scripts/request-decision.js`（新） | `send`/`forward`；發 `r-` id 並存本機，送一行 `AUTOPILOT-REQ/1`，設 `waiting_on_operator <r-id>`；read_only/reversible 送 PM exit 3 | 取代 P6 `[操作員決定]` |
| `scripts/lib/menu-card-content.js`（新） | 只留 redact-then-truncate（`hooks/_shared/secret-patterns.js` `redact()`） | P1 的 redact |
| `hooks/owner-question-guard.js` | 非 PM team 認 `r-` id，理由改指 `request-decision.js` | §4 第 4 項 |
| `hooks/session-start.js` 與 Codex 副本 | 依角色分支，非 PM 無開卡行（副本路徑實作前確認） | §4 第 4 項 |

另登記新腳本於 `scripts/CLAUDE.md`。`hooks/hooks.json` 不改：deny 不需新註冊。

## 4. 會加或改的測試

| 測試檔 | 斷言 | 負控制 |
|---|---|---|
| `scripts/lib/team.test.js`（新） | 缺檔（含 hub.toml）→ solo；明寫 pm/lane/lead/solo；壞 JSON → lane | 缺檔改回依 marker 判 lane → 紅 |
| `scripts/open-decision-role-gate.test.js`（新） | lane/lead 走 CLI 與 library 皆 exit 4、scope 檔不變；PM、solo 照舊 | 拿掉閘，或只擋 CLI → 紅 |
| `hooks/tests/ask-decision-gate.test.sh`（新） | 非 PM team → deny JSON、無新 entry；PM/solo → 無輸出、寫 entry | 空輸出放行突變 → 紅 |
| `scripts/request-decision.test.js`（新，stub fleet） | 一行含問題/選項/建議與 `r-` id；read_only 送 PM exit 3；irreversible 缺 snapshot/blast radius 拒送；憑證被遮 | 拿掉 `redact()` → 紅 |
| `hooks/tests/owner-question-guard.test.sh`（既有） | 非 PM team 含 `r-` id 不擋；PM 只有 `r-` id 仍擋 | PM 接受 `r-` → 紅 |
| session-start 固定文字測試（既有，檔名待確認） | 兩棵樹依角色分支 | 非 PM 含開卡行 → 紅 |

## 5. 不碰

- 遊戲 VM lane 權限提示路徑（hangar 擷取、PM 不開卡決定 allow/deny）。repo 中 autopilot 在權限提示上的碼：`hooks/awaiting-owner.js:225-235`、`hooks/permission-block-lib.js:48-60`、`scripts/permission-prompt-watch.js`（`permission-block-lib.js:2-3`）——不改，範圍外；hangar 是否呼叫未查證。
- hub answer log（`GET /v1/answers/log`）。
- fleet 程式碼；hangar 程式碼與 mode 檔推送。
- `hooks/menu-card.js`、PM 面板 `mods/live/`、`fleet approve`、`checkNotAuthorized`。
- 答覆遞送（relay、redeliver、ACK、patrol，SYNTHESIS §4 第 5–6 項）另案。

## 6. 待 PM 確認

1. **Q3 兩說並存**：(a) r2a「operator pre-trusts by hand; no automation」（PM 01M70B8A2J）；(b) PM 01M70D7FH9「menucard Q3 改為工具在 manifest 範圍內替操作員信任」。不選，待 PM 確認。
2. **不可逆例外 vs 現碼**。規則原文：「until that log is live, keep opening your own-session card for irreversible ops only (`open-decision.js open --irreversible`), and send the PM its id so the panel mirror shows it.」但該旗標不存在（:122、:358-359），SYNTHESIS §1 第 9 項主張不加。閘是否放行、怎麼放行待定；定案前 lane 一律 exit 4。
3. library 閘也擋 `permission-block-lib.js:56`（`openBlockedCard` 回 null）。接受或豁免？
4. 作廢的 r2a 項目：§2.5 #1–#3、#6（lane verify、固定 fleet 路徑、`AUTOPILOT_MENU_CARD`）；`menu-card.js`；`verifyOnce` 改動；`--origin menu_card`/`--dedupe-key`/`--menu-kind`/`--expires-at`/`--hook-pid` 與 `menu_*` 關閉原因；P0 S2–S6；P3a 第 2–8 步；P3b；P4；P5 lane 帳本根；P6 `resolve-operator-channel.js` 與 `[操作員決定]`；KR1–3、KR5 須改寫。
5. Q1（逾時拒絕）照舊；ask-decision 直接拒絕，自然成立。

## 7. 驗收與順序

| 階段 | 內容 | 快速驗證 |
|---|---|---|
| A0 | spike：deny 理由送到模型（S1 縮小） | 本目錄 `spike.md` |
| A1 | `team.js` | `node --test scripts/lib/team.test.js` |
| A2 | 角色閘 | `node --test scripts/open-decision-role-gate.test.js` |
| A3 | ask-decision deny | `bash hooks/tests/ask-decision-gate.test.sh` |
| A4 | `request-decision.js`、`--from-request` | `node --test scripts/request-decision.test.js` |
| A5 | guard、session-start | `bash hooks/tests/owner-question-guard.test.sh` |

A0 ∥ A1 → A2 → A5 依序，每階段獨立 commit；mode 檔出現前不生效。合併前才跑全套：完整 suite、`bash scripts/validate.sh`、`node scripts/check-hook-inventory.js --check`、`node scripts/sync-version.js --check`。
