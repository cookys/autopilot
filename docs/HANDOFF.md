## 目標

無進行中工作。這份 handoff 記錄的是一個**收束完成**的狀態：2026-09-03～04 兩天出了五個版本（v2.35.11–v2.35.15），全部 merge、push，記下「下一個 session 需要知道但不在 code 裡」的東西。

## 現況

- **branch**: `develop`；本機比 origin 多三個 no-bump docs／comment commit（`62297210`、`1b85e47a` 與這份 handoff），**尚未 push**，`origin/develop` 在 `0ed8680f`
- **working tree**: 乾淨；`docs/projects/` 沒有進行中專案（09-02 兩個已出貨專案已搬進 `_archive/`，INDEX 過期的 08-28 In-Progress 列已刪）
- **version**: 2.35.15（27 hooks：14 default-on／13 opt-in）
- **測試**: 最後一次全套在 `479552c0` 上 311 檔（310 綠 + `suite-oracle-lock` 因繞鎖 env 被繼承而單獨重跑 32 條綠）

**DONE**（皆已 merge 並 push）：

| 版本 | merge | 內容 |
|---|---|---|
| v2.35.11 | `a4d5d8f9` | named endpoint 明文私網 opt-in（`_TRANSPORT=plaintext-private`，只收私網 IP literal）、`engine-qualify implementer --endpoint` 與路由對齊、團隊本機模型食譜 |
| v2.35.12 | `3949e2ab` | `--runner opencode` implementer 軌道；muse-spark-1.3（OpenCode Go）考過 24/24 |
| v2.35.13 | `219de2a6` | agy 信封格式錯降級為遙測遺失（狀態看 git、信封原文留 log） |
| v2.35.14 | `013ca863` | opencode 軌道 effort → `--variant`（`max`→`xhigh`）；不帶 effort 現在送 xhigh |
| v2.35.15 | `72dfa052` | `foreman-guard` PreToolUse hook；context-budget／dispatch-model-guard／cost-tracker 改 default-on；工頭一刀一命與接手 read-list 上限 |

**考試新增合格席**（implementer，全部 24/24）：qwen3.8-flash-next（cc-shim，本機 SGLang，event 186，每 case 中位數 14 s，全板最快）、muse-spark-1.3 contributor（opencode；預設檔 187、low 191、medium 192，三檔速度無差）、gemini-3.8-flash low／medium／high（agy，188–190，速度 15／21／26 s 線性）。合格席共 18。

**IN-FLIGHT**: 無。沒有背景派工、沒有等待中的 review。cuda（visionforge session）已確認拉到 `1b332f83`。

## 已決事項(不重議)

- **loopback 規則不放寬成一般 http**——明文只對私網 IP literal 且要顯式 opt-in，多人共用的正解是部署端 TLS + api-key；`dispatch-local-openai.js` 不重啟當 implementer 路徑，不加第三個 adaptor（cc-shim 就是 Anthropic 協定的 adaptor）。
- **agy 信封無效 = 遙測遺失，不是判決**——8/22 三席 gemini 的 row 不改，翻案靠重考。
- **`minimal` 不進 effort 詞彙**（除非開 L）：要動 scorecard／evidence／schema／seat 分區一整排驗證器。
- **cuda 稽核六項全做、不 fleet-wide 廣播**——operator 2026-09-04 決定；只回 cuda。
- **context-budget 對子代理不量**——它只看得到父 transcript；工頭天花板 = Bash 上限 + 一刀一命，等 CC 提供子代理 transcript 再補（BACKLOG）。
- **`--engine` 收 vendor id、`--model-version` 維持 strict TOKEN**——參數層文法必須等於 evidence 編譯器文法；sweep 對 provider/model id 派生 version token（`/`→`:`）。
- **runImplQualification 已移出 verdict-stability D6 逐位元組同位清單**——釘值只能指 origin/develop 上的 commit，刻意改動落地前無法前移。

## 下一步

沒有被指派的下一步。2026-09-04 本 session 已收掉的舊帳：

- **`ladder --role implementer` 回 `[]` 不是 bug**：磁碟 view 一律把 qualified 投影成 provisional（ADR-0001，`engine-scorecard.js --help` 明寫），只有 `--require-evidence --scope-file --identity-file`（`resolve-review-loop.sh --check-scorecard` 才帶）能產出候選，而 `write-scope` 只凍結了 consult/discuss。看席位用 `seat-status`。記在 memory `engine-qualify-administration-gotchas`。
- **evidence store 兩列 fixture（event 271/272）已隔離**：identity `e|r|f|m|0`、指紋全 a/b/c、consult、`degraded`、0/10，2026-08-28T09:26Z 寫入。現在與 08-28 當時的樹都沒有任何測試發這組參數，transcript 也找不到指令，最可能是當天 consult-discuss administration session 的手動 smoke。備份 `qualification-evidence.jsonl.bak-fixture-quarantine-2026-09-04`（55 列，sha 相符），隔離檔 `.test-residue-quarantined-20260904`，主檔 53 列；consult `current` 前後都 7 席、flash-next 仍 qualified。`run.sh` 自 09-02 起有 sha256 前後 guard，同類再犯會被抓。
- **`~/.autopilot/engine-scorecard/qualification-evidence.jsonl`（19 列）是孤兒檔**：code 只讀 `engine-capability/` 那份；19 列中 11 列與正本重複、8 列（08-28／29 的 consult/discuss `degraded` 早期嘗試）不在正本。沒動它，也不用動。
- **BACKLOG「dispatch-model-guard 在 headless 回 ask 會卡」已刪**：實測 CC 2.1.259 `-p` 下 ask 立即變 `is_error` tool_result 帶原因，兩種權限模式皆然。紀錄在 hook 檔頭、`references/multi-agent-portability.md` §5、memory `cc-headless-hook-ask-auto-denies`。

仍在的、已評估未動工：

1. **BACKLOG 其餘八筆**（`docs/BACKLOG.md` Active entries 前段）：工頭 context 量不到、effort `minimal`、feed 列表兩個顯示瑕疵、opencode 用量解析、gate 測試改 scratch copy、`endpoints test --model`、`local-deployment.js` 政策對齊。每筆都有 Trigger。
2. **suite oracle lock 殘留**（BACKLOG 🔵）：`kill -9` 一次 suite 後 `.owner` 留著死 pid，下一次被拒。若又撞到：確認沒有活的 `run.sh` 後 `AUTOPILOT_SUITE_ORACLE_LOCK=0`，然後**不帶那個 env** 單跑 `hooks/tests/suite-oracle-lock.test.sh` 補證。訊息清晰度同一筆。
3. 若要正式切 implementer 到 flash-next：改 `.claude/review-loop-config.md` 三欄加 `implementer_endpoint: qwen38`（endpoints.env 已有 `QWEN38` 三鍵，plaintext-private）。

## 驗證方式

```bash
cd /home/cookys/projects/autopilot
git status --porcelain              # 應為空
git log --oneline -3                # 62297210 → 1b85e47a → handoff commit
node -p "require('./.claude-plugin/plugin.json').version"   # 2.35.15
node scripts/check-hook-inventory.js --check   # in sync: 27 hooks (14 default-on, 13 opt-in)
AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh   # ✅ 8/8 for v2.35.15
node scripts/engine-scorecard.js seat-status --engine qwen3.8-flash-next --runner cc-shim --role implementer --effort high   # qualified, event 186
wc -l ~/.autopilot/engine-capability/qualification-evidence.jsonl   # 53
```

## Read-order

1. `/home/cookys/projects/autopilot/CHANGELOG.md` — v2.35.11 到 v2.35.15 五節；每節寫了 QC 抓到什麼、哪些成立、與行為改變（default-on、xhigh 轉送）。
2. `/home/cookys/projects/autopilot/docs/plans/2026-09-04-foreman-cost-discipline.md` — cuda digest 的稽核與 D1–D5，含「工頭 context 量不到」的誠實限制。
3. `/home/cookys/projects/autopilot/skills/engine-onboarding/references/local-model-team-recipe.md` — 本機模型接 implementer 的正規做法與 opt-in 的邊界。
4. `/home/cookys/projects/autopilot/docs/plans/evidence/2026-09-03-muse-spark-opencode-qualify/README.md` — 第二次施測 24 題白燒的完整紀錄（argv 文法 vs 編譯器文法）。

## 陷阱

- **Bash 工具跑的是 zsh**：`grep --include=*.md` 會被 glob 成 `no matches found`、`echo ====x` 會觸發 `=cmd` 展開、`$VA` 不做字詞切分（`--variant minimal` 變一個參數）。需要 bash 語意就 `bash -c '…'`。`load-endpoints-env.sh` 只能在 bash 下 source。
- **`pkill -f`／`pgrep -f` 會比對到自己這條指令**——殺用 PID，數行程把樣式拆變數且同一條指令不要再出現字面。
- **並行 suite 會撞**：`resolve-review-loop-consult-discuss-gate` 會 `chmod 000` 真的 evals 檔（已進 serial tail）；`engine-qualify.test.sh` 在負載下會超過 600 s，用 `AUTOPILOT_TEST_SUITE_TIMEOUT_SECS=1200`。
- **`git stash list` 的 `stash@{0}`（evidence-discipline §20/§21）是別的 session 的**，不要 pop、不要清。
- **送審 diff 不要過濾 `':!platforms/codex'`**；review spec 直接寫「鏡像是逐位元組同步、別報 drift」。
- **新 hook 要進 `profiles/hook-classes.json`** 並重釘 catalog 的 `hook_classes_sha256`，否則 profile payload build 直接紅。
- **opencode `--variant` 對未知值不驗證、靜默退回 provider 預設**（≈medium）；`bogus` 也 rc=0。

## 已路由出去的耐久內容

- **memory**（`~/.claude/projects/-home-cookys-projects-autopilot/memory/`）：`engine-qualify-administration-gotchas.md`（更新：effort default 被擋、本機模型走 `--endpoint`、D6 同位釘值、argv 文法＝編譯器文法、opencode rail）、`foreman-guard-default-on.md`（新）、`pkill-self-match-trap.md`（新）、`zsh-bash-tool-quirks.md`（新，本次 handoff 路由）。
- **repo**：BACKLOG 九筆、CHANGELOG 五節、`docs/ironlaw-to-gate-map.md` #6、四份 evidence bundle README（flash-next、muse-spark ×2、gemini 3.8 三檔）。
