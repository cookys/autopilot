## 目標

把 Cursor CLI(`cursor-agent`)接成 autopilot 的異質引擎 rail,並讓使用者能逐角色設定
hetero engine 走哪個引擎。**本 session 已完成並合進 develop**;此交接是為了 clear ctx 後接續
剩下的 backlog,不是為了接續一項未完成的工作。

## 現況

- Branch `develop` @ `b1a14e0c`,**乾淨**,無殘留 worktree、無 stash。
- **領先 origin/develop 1 個 commit**(`b1a14e0c` 的 knowledge/docs 路由)—— 其餘全部已推。
- 版本 **v2.34.44**。preflight 8/8、全套件 282/282、gates 全綠。
- 本 session 出貨(全部走 `/l4` foreman + sonnet leaves + depth-0 跨家族權威 panel):
  - **v2.34.41** — `dispatch-plan-review.js` 註解裡的 `*/` 讓整支 parse 不了,躺了一天
  - **plan** `docs/plans/2026-08-26-cursor-cli-adaptor.md` — 3 輪 6 代 hetero review,44 個 blocker 全數裁決修復
  - **v2.34.42** — cursor rail 本體(plan Phase 1–4)
  - **v2.34.43** — 逐角色 hetero 路由設定檔 + backlog 清掃
  - **v2.34.44** — runner→binary 唯一擁有者 + 版本驗不過即拒絕席次
  - **evidence** `docs/plans/evidence/2026-08-27-cursor-grok-46-fast-qualify/` — implementer 資格考 24/24

## 已決事項(不重議)

- **資格閘不拆,override 顯式且留痕** — Board 裁示,已機器化於 `resolve-review-loop.sh`。
- **雙席 decorrelation 預設關、可開、開了要警告** — 同上。
- **cursor 只 earned 了 implementer** — `cursor-grok-4.6-high-fast`,90 天效期自 2026-08-27。
  `review`/`plan` 維持 `gpt-5.6-sol`/codex(唯一過 reviewer 考的);`consult`/`discuss` 只能 override。
- **schema runner enum 是語法表,admission 才是閘** — 推翻了本 session 稍早「整批延到 Phase 5」的裁決。
- **雙席比對用 runner 軸,不用模型家族軸** — 家族軸會擋掉出廠預設,且一條 cursor rail 同時服務
  grok 與 gpt id,家族軸剛好漏掉裁示點名的情況。
- **Phase 5 只考了 implementer** — 其餘角色未考,依使用者裁示「設定檔先做」。

## 下一步

1. `git push origin develop`(領先 1 個 commit)。
2. 若要用 cursor 當 implementer,編輯 `.claude/review-loop-config.md`:
   `implementer_engine: cursor-grok-4.6-high-fast` / `implementer_runner: cursor` / `implementer_effort: high`
   —— 已 earned,**不需要 override 檔**。
3. Backlog(無觸發器,依價值排序):
   - `dispatch-review.sh:146-147,239` 用 `[ -r ] && . … || true` + `command -v` 守 alias 拒絕,
     lib 讀不到就靜默跳過(fail-open),而 `dispatch-author.sh:111-112` 是無條件 source —— 不對稱。
   - `discuss_*` 設定欄位**沒有任何 consumer**(已在 schema description 與文件中據實標明)。
   - parallel suite 的 flake 已查明是 `/tmp` 陳舊 hetero worktree 殘留,非程式碼問題,附證據在 backlog。
   - GLM 的四條 🔵(e2e stub 只斷言 `--model`、`dispatch-review.test` 缺 nonzero+stdout 組合、
     `grok46|codex53` 在兩個 wrapper 各自重述而非取自 `cursor_is_enabled_id`)。
   - `consult`/`discuss` 沒有評量套件 —— 要 earned 就得先有人寫考卷。

## 驗證方式

```bash
AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh   # 8/8
node scripts/check-js-syntax.js                                   # 549 files
bash scripts/sync-codex-plugin-skills.sh --check                  # mirror parity
scripts/resolve-review-loop.sh >/dev/null && echo ok              # roster resolves
node scripts/engine-scorecard.js seat-status \
  --engine cursor-grok-4.6-high-fast --runner cursor --role implementer   # qualified
```

## Read-order

1. `docs/plans/2026-08-26-cursor-cli-adaptor.md` — plan 本體,
   Review log 記了三輪六代的軌跡與「為何 blocker 數不收斂」。
2. `references/hetero-dispatch.md` — cursor rail 契約、consult 席次、
   `--runner` 列表。
3. `project-config-template/review-loop-config.md` — 新的
   `consult_*` / `discuss_*` / `allow_same_runner_dual_seat` 欄位與 override 契約。
4. `docs/plans/evidence/2026-08-27-cursor-grok-46-fast-qualify/README.md`
   — 資格考結果,含 grok rail 失敗 vs cursor rail 通過的對照與其歸因限制。

## 陷阱

**本 session 新發現 — 已路由至 `references/evidence-discipline.md` §17–19,此處僅留指標:**
一個 assumption 可能有多份獨立副本(修一份不等於修完);fail-closed 守衛裡的上限若截斷不拒絕就是
帶長度前綴的 bypass;代理指標不是量測(我把 `raw/` 目錄數當成派工數,報錯了一個數字)。

**操作面,未寫成 reference:**
- `scripts/load-endpoints-env.sh` 必須在 **bash** 裡 source **且呼叫** `autopilot_load_endpoints_env`
  —— 只 source 會什麼都不載入,且靜默。
- `cursor-agent` 會**自動更新**(本 session 中途 2026.08.11 → 2026.08.25)。版本綁定的探針證據
  跨 session 可能已失效,plan §0.1 的探針表就是舊版跑的。
- 資格考的 `--execute` 花真錢。`--plan` 免費且會印出完整 argv,先跑它。

**繼承自上一份 handoff(2026-08-23),當時未被路由出去,仍有效:**
- test-integrity 設定**從 base commit 讀**;測試 range 的 base 必須含 `.claude/test-integrity-config.md`,
  否則回 `source: template, matched: 0`,會被誤判成「修了沒生效」。
- **qc-gate 只認 `QC-Verdict: PASS` 字彙**,`SHIP-AS-IS` 不吃;trailer 必須與 `Co-Authored-By` 同末段。
- **foreman 停車不自醒**:等自己的背景子程序時不會被喚醒,只有 depth-0 `SendMessage` 能救
  (已寫入 `level-front-door.md`)。
- **CC foreman 的 `owner_absent` 是假象**:`stage-acquire` 跑在瞬時 shell 裡,watcher 判 dead 但
  agent 還活著。看 git artifacts,別信這個訊號。
- 判紅**只信 Summary 段**;`preflight-release-routing` 裡的 `FAIL [slash-entry-probe]` 是嵌套 fixture。

**已路由出本檔的內容**(依 `references/knowledge-routing.md` §3):
`references/evidence-discipline.md` §17–19 + §10 延伸(discipline)、
`skills/ceo-agent/references/level-front-door.md` §3 兩條 panel 操作規則(discipline)、
`.claude/knowledge/vendor-quota-shapes.md`(可公開事實,已過揭露閘)、
`~/.claude/projects/<slug>/memory/`(機器本地:引擎清單與路由決策)。
