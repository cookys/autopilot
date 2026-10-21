# 可發現性盤點：surface 組（mods、hooks、四組腳本、AGENTS.md／portability）

調查日期 2026-10-21，repo 在 develop，唯讀。roundtable 由別組查，本組不含（`roundtable-window.js`、`lib/room-log.js` 從第 3 項的 87 個減掉，剩 85）。
`mods/` 實際只有 live、viewer、roundtable 三個，所以 roundtable 以外的就是 live 與 viewer，加上共用的 `mods/register.ts`。

## 白話總結

本組共 **147 項**：A 自動 55／B 入口有教 22／C 只有事後提醒 4／D 找不到 4／E 不需 agent 61／F 死碼嫌疑 1。另有 2 處文件本身寫錯（不算在字母內）。

整體印象比預期好：mods 面板幾乎所有資料都由 hook 或常駐 watcher 自動餵，agent 不用動手；hooks 的擋下訊息大多把正確做法寫進去了（Lane:、Budget-Ack、Engine: … (intentional:) 都在訊息裡）。真正的洞集中在三處：

1. **待決卡仍是 mods 唯一需要 agent 主動寫入、但入口沒教的區塊**（第一輪項 1–4，本輪重新確認仍成立，見主表 #1）。
2. **非 Claude agent 的入口（AGENTS.md）完全沒提 mods、待決卡、dispatch rail、hetero review，也沒標哪些規則靠 Claude Code hook 才會被執行**（主表 #2–#4）。Codex／OpenCode 沒有 SessionStart 注入，所以連那張 12 列 skill 觸發表都拿不到。
3. **`check-guidance-eval.js` 是「發版切點必過」的閘門，但全 repo 沒有任何東西會去跑它**（主表 #5，F）。這正是 CLAUDE.md 警告的「閘門存在不等於有在跑」。

最嚴重三項：#1 待決卡整串（owner 看不到東西）、#2 AGENTS.md 缺口（非 CC agent 不知道有這些功能）、#5 check-guidance-eval.js 無觸發點（guidance 改動可能未經 eval 就出貨）。

---

## 主表（C／D／F）

| # | 名稱 | 它做什麼 | agent 何時該用 | 判定＋證據 | 建議放進哪個入口 | 不用會怎樣 |
|---|------|----------|----------------|------------|------------------|------------|
| 1 | live mod「待決」分頁 ← `scripts/open-decision.js open／close` 與 `[待決回覆]` | 面板讀 `<git-common-dir>/autopilot/decisions/<scope>.json` 顯示待決卡；owner 按送出後 mod 用 `$.prompt.submit` 送 `[待決回覆]` 開頭的 prompt（`mods/live/model.ts:1572`、`mods/live/register.ts:702`） | 任何要等 owner 決定的時刻；收到 `[待決回覆]` 時要關卡 | **D**（入口零命中）＋ hook 只事後提醒。第一輪項 1–4 全部成立，本輪補充確認：`grep -rn "open-decision" skills agents AGENTS.md src/hooks/handlers` 對 skills／agents／AGENTS／注入文字零命中；唯一事後提醒是 `hooks/owner-question-guard.js:100-117`（訊息缺必填旗標與 close）。這是 mods 裡**唯一**需要 agent 主動寫入的區塊（其餘見附錄 A） | 依第一輪：機制類先做（M1 重寫 guard 訊息、M2 讓 UserPromptSubmit host 自動關 `[待決回覆]`、M3 SessionStart 注入加 2–3 行）；指引類（ceo-agent DOA 段）等 eval | owner 看不到待決；已答的卡永遠掛在面板上 |
| 2 | `AGENTS.md`（非 CC agent 的唯一入口） | agents.md 規格的通用 readme | Codex／OpenCode／agy 進 repo 時第一個讀的檔 | **D**：`grep -ciE "mods\|open-decision\|待決\|dispatch-\|hetero" AGENTS.md` 全 0；只有「Orchestration Discipline」一節是通則（不點名任何 rail 或腳本）。`grep -nE "dev-flow\|trigger" AGENTS.md` 零命中：也沒有 skill 觸發表。Codex 的 hooks 只註冊 PostCompact 與 dirty-protected-paths（`platforms/codex/hooks/hooks.json`），OpenCode 的 session 注入已停用（`platforms/opencode/README.md:29-30`），所以 `BASE_AUTOPILOT_CONTEXT`（`src/hooks/handlers/session-start.js:3`）在這兩個平台都不會注入 | AGENTS.md 加一小節「Where the automation lives」：一行指向 `scripts-inventory`／各 rail 的 reference、一行說明待決卡是檔案 API 可由任何 agent 寫入（但面板只在 Claude Code）、一行說明哪些護欄只在 CC hook 下才執行（見 #3） | 非 CC depth-0 不知道有 `dispatch-*` rail、待決卡、hetero review，只能靠 skill description 碰運氣 |
| 3 | 「哪些規則靠 hook 才強制」沒標 CC 專屬 | `Lane:`、`Budget-Ack:`、`Bash-Cap:`、`Engine:` 首行、foreman-guard 40 次上限、orchestrator-edit-gate 全是 Claude Code hook 強制 | 非 CC controller 照 skill 派工時，需要知道這些在自己平台是**文字約定而不是被擋** | **D**：`skills/l5/references/hetero-impl-loop.md:322-325` 寫 `Lane:` is required，沒有說明只有 CC 的 `subagent-budget` hook 會擋。`references/multi-agent-portability.md` §5（hooks 不可攜）只談 hook 系統差異，§7「Claude-Code-only」表只列 `/goal` `/loop` `Monitor` nested dispatch `TaskCreate`，**沒列 autopilot 自己的 CC 專屬面**：mods（live/viewer/roundtable 的 header 都寫 Claude Code only：`mods/live/register.ts:1`、`mods/viewer/register.ts:1`）、`show` 工具、上述 hook 護欄 | `references/multi-agent-portability.md` §7 補一列「autopilot 自帶的 CC 專屬面」；AGENTS.md 引用該列 | 非 CC agent 以為自己受護欄保護或以為面板會顯示；實際沒有 |
| 4 | Codex／OpenCode 的 hook 設定未被 AGENTS.md 完整描述 | Codex：`PostCompact`、`Stop`、`SessionEnd`（`platforms/codex/hooks/hooks.json`）；OpenCode：`tool.execute.after` 只做 intent capture（`.opencode/plugin-package/server.ts:202`） | 想知道自己平台上哪些自動行為存在 | **C/D**：AGENTS.md:53 與 `multi-agent-portability.md:300` 都寫 `.opencode/plugins/autopilot.ts`，**該路徑不存在**（`ls .opencode/plugins` 報不存在；實際是 `.opencode/plugin-package/server.ts`、`platforms/opencode/plugin/server.ts`）。AGENTS.md 的 Build 段有講 Codex PostCompact，但沒有彙整成「各平台實際有哪些自動行為」 | 修正兩處路徑；AGENTS.md 加平台自動行為三行表 | 照 AGENTS.md 找不到檔；OpenCode agent 誤以為有 session 注入與 resume hint |
| 5 | `scripts/check-guidance-eval.js` | 發版切點閘門：guidance manifest（skills／references／agents／project-config-template）有改動的檔必須與 eval change pack 逐 byte 相同、scorer 重算要 SHIP（檔頭 1-14 行；計畫 `docs/plans/2026-10-06-dev-flow-stage-graph.md:155-158` 寫「at each cut」） | 每次 cut／發版前 | **F（閘門無觸發點）**：`git grep -lF "check-guidance-eval" -- . ':!platforms' ':!docs/plans' ':!CHANGELOG.md'` 只有它自己、`hooks/tests/check-guidance-eval.test.sh`、CLAUDE.md 名單；`grep -n guidance scripts/preflight-release.sh scripts/sync-manifest.json` 零命中。沒有任何 hook、preflight、sync ritual、skill 會呼叫 | `scripts/preflight-release.sh`（或 `sync-manifest.json` 加一個 ritual）呼叫它；`skills/finish-flow/SKILL.md` 的 Release hygiene 列補一句。屬機制類（讓已說的閘門真的發生），不需 eval | guidance 改動可能未經 eval 就出貨，計畫的 KR3「passes at every cut」變成無人檢查的宣稱 |
| 6 | `bash-launch-guard`（藏在 `hooks/depth0-delegate-gate.js` 裡，不在 hooks.json、不在 39 個 hook 的計數裡） | 對**所有深度**的 Bash：拒絕沒有喚醒路徑的裸 detach 背景啟動（`detectDetachNoWake`）、pkill／pgrep -f 自我比對（預設 deny）、zsh `=` 展開（只警告）。`hooks/depth0-delegate-gate.js:221-235` | 派背景工作、殺程序時 | **C**：`git grep -n bash-launch-guard -- skills agents AGENTS.md references` 零命中；只有 `hooks/README.md:196` 在 depth0-delegate-gate 那列裡。擋下訊息自帶 `advice`（`:225`），pkill 那條只寫「Set AUTOPILOT_BASH_GUARD_PKILL_MODE=warn\|off to relax」（`:230`），沒說正確寫法（用 PID，memory 有但 repo 沒有）。本 session 實際收到過它的 zsh 警告，證明有在跑 | pkill 訊息補正確做法；README 把 bash-launch-guard 拆成獨立一列 | 低：訊息大致自足；缺的是 pkill 的正確寫法與它「全深度生效」這件事沒人知道 |
| 7 | `.githooks/pre-push` 的 QC-Verdict 訊息 | 受保護路徑 push 無審查證據就擋，訊息教加 `QC-Verdict: PASS (reviewer <id>, <date>)` trailer（`.githooks/pre-push:191-194`） | 被擋後補 trailer | **C（輕）**：訊息沒說 trailer 必須和 `Co-Authored-By` 在同一個**末段**，否則 parse 不到（auto-memory `git-trailer-final-paragraph.md` 記過；`git grep -nE "final paragraph\|末段" -- skills references AGENTS.md .githooks` 零命中，所以 repo 內沒教）。`skills/quality-pipeline/SKILL.md:59` 有教「stamp QC-Verdict」但沒提格式陷阱 | 訊息加一行「trailer 要與 Co-Authored-By 同一末段」；quality-pipeline 同句 | agent 照做卻被擋兩次，靠猜 |
| 8 | `owner-question-guard` 與 `depth0-delegate-gate`（default-on，只有事後訊息） | 前者見項 1；後者在 depth-0 連續 8 次唯讀呼叫後提醒委派，guarded 模型（fable）在 block 模式下 deny（`:300-312`） | 被擋／被提醒時 | **C**：`git grep -lF depth0-delegate-gate -- skills agents AGENTS.md references` 零命中。deny 訊息寫了該怎麼做（「delegate to an Explore/survey subagent (model: sonnet)」），夠用 | 不必動；`ceo-agent/references/depth0-control-loop.md` 若要補只加一行 | 低 |
| 9 | 文件錯誤：`multi-agent-portability.md:385-387` | 寫「autopilot's own Stop hooks … never return `decision: block`」 | — | 舉的兩個例子（cost-tracker、session-summary）是對的，但 `owner-question-guard` 是 default-on 的 Stop hook 且會 `decision: block`（`hooks/owner-question-guard.js:110`），與 `/goal` 同時存在的互動沒被評估 | 該段補一句例外 | 低 |

---

## 附錄 A：自動（agent 不需主動用）

### mods（live／viewer）
| 項目 | 判定 | 證據 |
|------|------|------|
| live band（`ui.render AbovePrompt`） | A | `mods/live/register.ts:774`；資料由 runs-watch 發布，`hooks/runs-watch-autostart.js:1-40` 於 SessionStart／UserPromptSubmit 自動啟動 watcher |
| 現況分頁（位置、背景工作、最近對話） | A | 讀 `<live>/runs/<key>.json`、`turn/<sid>.json`、`context/<sid>.json`（`register.ts:7-30,376-378`）；turn 由 `awaiting-owner`（hosted 在 `advisory-relay`／`audit-log`）寫 |
| 現況「要你處理」 | A | `hooks/awaiting-owner.js` 寫 `attention/<sid>.json`（hooks.json 8 個事件） |
| 現況「任務」 | A（有前提） | `hooks/session-tasks.js` 折 TaskCreate／TaskUpdate 事件；Sonnet≥5／Fable≥5 預設關閉任務工具，`README.md:204-208` 與 `scripts/scaffold-config.js:311` 由 onboard 寫 `CLAUDE_CODE_ENABLE_TODO_TOOLS`，面板沒開時顯示 `tasks.todo_hint`（`mods/live/locales/en.json:60`） |
| 派工分頁 | A | `src/status/runs-watch.js` 彙整 dispatch ledger、`foreman-activity.js`、`decisions-sidecar.js` |
| 用量分頁 | A | `src/status/spend-history.js` 由 runs-watch 寫 `runs/spend-history.json` |
| 殘留分頁 | A | `src/status/residue.js`（runs-watch.js 建構）；`hooks/residue-auto-reap.js` 自動清 |
| toast（advisories） | A | `mods/live/advisories.ts` 讀 `<live>/advisories/<sid>.jsonl`，由 cost-tracker／version-drift／context-budget T1／suggest-compact 寫（`hooks/README.md` advisory bridge 列） |

### hooks（default-on，不需 agent 配合）
advisory-relay、audit-log、awaiting-owner、cost-tracker、dirty-protected-paths、intent-capture、log-error、reload-watch、residue-auto-reap、runs-watch-autostart、session-handoff、session-start、session-tasks、state-checkpoint、suggest-compact、version-drift-check、context-budget、failure-escalation、ask-decision：皆 A。證據：`hooks/hooks.json` 對應列，行為與 knob 見 `hooks/README.md:166-200`（Tier A 表）。其中 ask-decision 自動開關 AskUserQuestion 的卡（`hooks/ask-decision.js`），context-budget T2 的訊息自帶交接指示。

### 其他平台 hook
| 項目 | 判定 | 證據 |
|------|------|------|
| Codex `PostCompact` `post-compact.js` | A | `platforms/codex/hooks/hooks.json` |
| Codex `Stop`／`SessionEnd` dirty-protected-paths | A | 同上 |
| OpenCode `tool.execute.after` intent capture | A | `.opencode/plugin-package/server.ts:202` |

### 腳本 lib（被其他腳本、hook 呼叫，28 項）
`lib/json-emit.sh`（48 個呼叫端）、`lib/brain-spend.js`（`hooks/cost-fuse.js`、`cost-tracker.js`）、`lib/residue-config.js`、`lib/jsonl-store.js`、`lib/extract-json-object.js`（`dispatch-discuss.js:86`、`engine-qualify.js:109`）、`lib/headless-seat-derive.js`（`engine-qualify.js:669`）、`lib/grok-effort.js`（`qualification-review-provider.js:1161`）、`lib/config-path.js`（42）、`lib/load-source.js`、`lib/json-fields.sh`、`lib/test-identity.sh`（`.githooks/lib/test-identity-gate.sh:6`）、`lib/semver.js`、`lib/bash-wait-rules.js`、`lib/sealed-docs.js`、`lib/compaction-handoff.js`（`hooks/state-checkpoint.js`）、`lib/bash-launch-rules.js`（`hooks/depth0-delegate-gate.js`）、`lib/engine-spelling.js`（`engine-scorecard.js:10`）、`lib/qualification-trust.js`、`lib/retro-loop-metrics.js`、`lib/transcript-attribution.js`（二者 `retro-review-loop.js:26,31`）、`lib/effort-scale.js`、`lib/runner-binary.js`、`lib/live-state-dir.js`（33）、`lib/kimi-containment.js`、`lib/opencode-containment.js`、`lib/workflow-snapshot.js`、`lib/opencode-discovery-probe.js`（`preflight-portability.sh`）、`config-keys.json`（`hooks/subagent-budget.js` 等）。全部 A。

## 附錄 B：入口有教

| 項目 | 判定 | 證據 |
|------|------|------|
| `show` 工具（`mcp__autopilot__show`） | B | `mods/viewer/show.ts:19-22` description；`isDeferred: false`（`register.ts:27`）。消費端沒有 CLAUDE.md 那條 Don't，只靠 description |
| 審查分頁 | B | 資料來源 `scripts/hetero-review-loop.js collect` 寫 `review-rounds/<key>.json`（`:607-615`），skills/hetero-review 教；plan review 走 `dispatch-plan-review`。若用其他方式審查，分頁就是空的（不是缺陷） |
| foreman-guard | B | `skills/l4/SKILL.md`、`skills/l5/SKILL.md`、`skills/l5/references/hetero-impl-loop.md:306-307`（含 `Bash-Cap:`）、`level-front-door.md` |
| cost-fuse | B | `skills/ceo-agent/references/level-front-door.md`；訊息自帶「dispatch to hands」做法（`hooks/cost-fuse.js:321`） |
| dispatch-model-guard | B | `level-front-door.md:232`；deny 訊息列兩種合法重派（`hooks/dispatch-model-guard.js:210-216`） |
| subagent-budget（Lane:／Budget-Ack:） | B | `level-front-door.md:485`、`hetero-impl-loop.md:322-328`；deny 訊息含 `LANE_FORMAT_HELP` 與 Budget-Ack 格式（`hooks/subagent-budget.js:59,476-482`） |
| run-approval-gate | B | `depth0-control-loop.md`、`level-front-door.md` |
| orchestrator-edit-gate（opt-in） | B | `skills/ceo-agent/references/depth0-control-loop.md:60` |
| `cost-digest.js` | B | `level-front-door.md` |
| `distill-scan.js`、`identifier-scan.js`、`distill-consolidate.sh`、`distill-sync-setup.sh` | B | `skills/distill/SKILL.md`、`skills/distill/references/sync-setup.md`、`references/knowledge-routing.md` |
| `retro-review-loop.js` | B | `skills/retro/SKILL.md`、`skills/retro/references/data-collection.md` |
| `measure-task-width.sh` | B | `skills/ceo-agent/references/task-prompt-templates.md` |
| `project-detect.js`、`scaffold-config.js` | B | `skills/onboard/SKILL.md:32` |
| `check-plan-graduation.js`、`doc-drift-gate.js`、`check-config-docs.js`、`check-tmp-residue-registry.js`、`preflight-release.sh` | B | `references/plan-template.md`、`references/backlog-entry.md`、`skills/doc-sync`、`skills/finish-flow/SKILL.md`（Release hygiene）、`references/hetero-dispatch.md` |

（B 共 22 項：mods 2、hooks 6、腳本 14。上表合併列出。）

## 附錄 E：不需 agent

- **opt-in 12 個 hook**（accumulator、batch-format、branch-protection、check-console、commit-secret-scan、config-protection、design-quality、exec-boundary、large-file-warner、mcp-health、session-summary、test-runner）：由使用者在 `~/.autopilot/config.json` `hooks.<stem>` 或 `AUTOPILOT_HOOK_<STEM>` 打開（`hooks/opt-in-manifest.json:2`），經 `hooks/opt-in-multiplexer.js:32-55` 分派。擋下訊息都是 stderr＋exit 2，大多附做法（branch-protection 給 `git checkout -b`，`:75-85`；commit-secret-scan 給 `git diff --cached`，`:67-70`）。輕微缺口：`exec-boundary` E1／E2／E4 沒提 `sanctioned_roots` 等 override（只有 E3 提 `allow_sql`，`hooks/exec-boundary.js:104`）、`config-protection` 沒提關閉方式（`:40`）。因為是 opt-in 且使用者自己開，不進主表。
- **mods**：legend 分頁、`/show` 指令（人類用，答案不進模型：`mods/viewer/register.ts:28,42`）、viewer 視窗的 AI 摘要／提問按鈕（mod 自己呼叫 haiku，`mods/viewer/assist.ts:1-4`）、`mods/register.ts`（組裝）。
- **git hooks**：`.githooks/pre-commit`（sync/check ritual，訊息說各 ritual 附修復指令，`:62`）、`post-merge`、`pre-merge-commit`；Codex `platforms/codex/hooks/pre-effect.js`（檔頭自述 UNREGISTERED probe，`:3-9`）。
- **Sync, drift & release gates（CI／release）**：sync-all.sh、sync-version.js、sync-agent-bodies.sh、sync-model-routing.sh、sync-codex-plugin-skills.sh、sync-opencode-plugin.sh、check-canonical-invariants.sh、check-settings-changelog.js、check-reference-sizes.js、check-supersession-anchors.js、check-claude-md-inventory.js、check-contract-schema.js、check-hook-inventory.js、check-js-syntax.js、check-optin-changelog.js、check-readme-parity.js、preflight-portability.sh、report-roster-field-consumers.js、validate.sh、validate-json-schema.js、test-doc-drift-gate.sh、check-stage-vocab.js：多數被 `.githooks/pre-commit` 或 `scripts/preflight-release.sh`／`sync-manifest.json` 呼叫（例：`check-optin-changelog.js`、`check-settings-changelog.js`、`report-roster-field-consumers.js` 皆在 `preflight-release.sh`）。
- **Setup & install**：dev-setup.sh、dev-update.sh（`docs/installation.md:249`）、install-hooks.sh、install-antigravity.sh／.ps1、install-opencode.sh、setup-symlinks.sh／.ps1、agy-shell-guard.zsh（人類 shell 設定）、statusline-live-tee.js（`hooks/README.md:352` 給自訂 status line 的人；`hooks/context-budget.js:72` 內部 require）。
- **Skills tooling／evals**：task-width-fleet.sh、task-width-ingest.py（獨立收件服務，`scripts/task-width-ingest.py:2`）、run-eval-batch.sh、run-skill-opt.sh、toggle-payload-capture.js（診斷，`docs/settings-reference.md`）、benchmark-hook-multiplexer.js、validate-hook-multiplexer-benchmark.js、run-grok-implementer-ab.sh、validate-grok-implementer-ab.js、test-grok-effort.sh。
- E 共 61 項（mods 4、hooks 12、extras 3、腳本 42）。

## 方法與限制

- 讀過的程式：`hooks/hooks.json`、`hooks/opt-in-multiplexer.js`、各 hook 的擋下／deny 文字段、`mods/register.ts`、`mods/live/register.ts` 檔頭、`mods/viewer/register.ts`、`show.ts`、`assist.ts` 檔頭、`platforms/codex/hooks/hooks.json`、`.opencode/plugin-package/server.ts` 的 hook 註冊處、`AGENTS.md` 全文、`multi-agent-portability.md` §5–§8、`.githooks/pre-push` 訊息段。
- 第 3 項 87 個腳本用腳本批次 grep（入口＝skills／agents／AGENTS.md／references／session-start handler；呼叫端＝scripts／hooks／src／bin／.githooks），再對零入口零呼叫者逐個人工 grep；批次 grep 會把 `platforms/codex/plugin` 的鏡像算成呼叫端，已手動剔除後才下 F 判定。
- 未驗證：消費端專案 cwd 下相對路徑 `scripts/open-decision.js` 是否可解（沿用第一輪的「未實測」）；Codex／agy 是否實際觸發任何 CC hook（portability 文件自己標未驗證）。
- 未讀完：opt-in hook 的 stderr 文字沒有逐一讀全（accumulator、test-runner、design-quality、mcp-health、large-file-warner、session-summary、check-console、batch-format 只確認是 stderr 通知、不阻擋）。
