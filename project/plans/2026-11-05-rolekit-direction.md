# 方向提案：角色套件（role kit）讓弱模型也做得好

> Status: draft for plan review (frozen rubric, at most two generations). Owner: PM program (operator decides budget and go). Branch: none yet (plan only, no code). Size: L (direction plus spikes plus a gated A/B; nothing ships by default). Frame: autopilot develop `63308bd8f`, read-only investigation "rolekit-probe 2026-11-05" (facts and sources in the Appendix of this plan). Related: `project/plans/2026-10-31-repo-relayout-3-0-0.md`, `project/backlog/consumer-rules-in-claude-md.md` (BL-0388).

> PM rulings 2026-11-05 (fleet message from the PM session `pm--claude`; the A/B budget cap is the operator's own decision relayed by the PM):
> 1. Plan review with a frozen rubric, at most two generations.
> 2. A/B budget cap 75 USD, decided by the operator. Subscription billing only: no API-key billing path.
> 3. Five spikes are approved now: one mechanism each, minimal haiku calls, results recorded in evidence, no default change, no merge of any dispatch behaviour.
> 4. 3.0.0 follows the relayout plan plus two items: reserve `roles/` (layout-lint top-level allowlist and export whitelist) and the BL-0388 consumer-side fix. See the amendment in `project/plans/2026-10-31-repo-relayout-3-0-0.md` (section "E1").
> 5. Operator decision d-c76529c3 (2026-11-05, relayed by the PM; original: 「做，撥額度｜補充：一樣 bump 3.0.0.x 不要推進 3.1」): go. A/B uses about 75 USD of quota, subscription billing only. Run the pilot first; the pilot result goes to the PM, who decides whether to run the full matrix. The prereg and the mechanical verdict are stamped before any run. The real-model part starts only after G37 account registration is done. Versions follow the current 3.0.0 bump rule (alpha or patch number, never 3.1); every "3.0.0.x" in this plan means that.

日期 2026-11-05（台北）。作者 autopilot depth-0。狀態：草案，待 plan review 和 operator 確認。不含程式。
事實細節與出處：本文附錄（來源為 rolekit-probe 2026-11-05 的唯讀調研，附 file:line）。

## 0. 先講前例（找不到原話，找到一個負面結果）
- operator 說的「上次跟你討論的」，在 repo、memory、BACKLOG、plans、commit 裡都找不到。最接近的是：
  - 2026-07-15 skill-transport A/B（project/plans/_archive/2026/07/2026-07-15-skill-transport-payoff-ab.md）：把 skill 方法論 pack 塞給弱 reviewer（haiku），H2 判為不成立；塞給 implementer（codex spark），差異是 0。所以目前是關著的。
  - v2.33.0 capability-adaptive profiles：弱模型目前拿到的是一份不分角色的 profiles/guided.md。
  - BL-0206（10/18 原話）是照功能拆成 engine、flow、lab 三塊，不是照角色拆。
- 教訓：「多給弱模型一包說明」已經證明沒用。角色套件要贏，靠的不是多塞字，而是三件事一起做：**縮小**（只給這個角色要的）、**定型**（輸出有固定格式）、**機器驗收**（交出來的東西由腳本檢查，ADR-0001）。A/B 要測的是這整組，而且要有安慰劑對照組。

## 1. Problem

弱模型今天拿到的是一份不分角色的 `profiles/guided.md`，沒有任何角色拿到自己專屬的 CLAUDE.md 或 skill 集（附錄「現況」）。要回答的是：把「縮小、定型、機器驗收」三件事一起做成角色套件，能不能讓同一個弱模型在各角色任務上明顯變好；而 2026-07-15 的前例是只塞 skill 本文，結果為負。

## 2. OKR / KRs

- KR1: 五個 spike 各自回答一個機制問題（一次性 config dir 或 cwd 的 CLAUDE.md 是否載入、`--append-system-prompt`、`--setting-sources project` 下 cwd 的 CLAUDE.md、`codex exec` 是否讀 skill、套件編譯器雛形），結果寫進 evidence，只用 haiku 跑幾次，不改任何預設、不合併任何 dispatch 行為。
- KR2: A/B 在任何正式執行前先預註冊並蓋章；成功門檻是至少 3 個角色的 B 對 A 縮小差距 (B−A)/(D−A) ≥ 50%，且 B 明顯優於安慰劑組 C；不成立就照實記錄、不出貨。
- KR3: A/B 總花費不超過 75 USD 上限（估計約 50 USD），且只走訂閱計費，沒有 API 金鑰計費路徑。
- KR4: 3.0.0 的完成條件只多兩項：保留 `roles/` 位置（layout-lint 頂層白名單與匯出白名單）、BL-0388 使用端那半邊；本計畫其餘內容不進 3.0.0。
- KR5: dispatch 預設只在 A/B 成立之後才改成走套件。

## 2.5 Global Constraints

- 只走訂閱計費，不開 API 金鑰計費路徑；A/B 預算上限 75 USD，由 operator 決定（PM 裁定 2026-11-05）。
- 五個 spike 每個只驗一個機制、只用最少的 haiku 呼叫、結果記錄在 evidence、不改預設、不合併（PM 裁定 2026-11-05）。
- 子行程一律用一次性 config dir，只放憑證，不給真的 `~/.claude`；證據只記憑證路徑不記內容。
- 評測遵守 `references/evidence-discipline.md`：預註冊並蓋章、安慰劑對照組、discordant pair 檢定、每個新檢查附負控制。
- 改寫 skill 內容依 scorecard-first 規則另行處理，不在本計畫範圍內（relayout 計畫 §8）。
- 不新增託管 CI；測試與合併閘門在本機跑（operator 規則，`CLAUDE.md` Process rules）。
- 本計畫的 plan review 用凍結的 rubric，最多兩代（PM 裁定 2026-11-05）。

## 3. 設計

### 3.1 角色清單與每個套件裡放什麼
每個套件 = 一張角色卡（≤ 2 KB，當作該角色的 CLAUDE.md / AGENTS.md）＋ 只屬於這個角色的 skill ＋ 工具白名單 ＋ 輸出格式 ＋ 驗收腳本。
角色沿用 src/engine/roles.js 和 agents/ 已有的定義，不另造：

| 角色 | 角色卡重點 | skill（只放這些） | 工具 | 輸出與機器驗收 |
|---|---|---|---|---|
| planner | 六要素 Task Prompt、切成可平行的單位、不寫程式 | plan-template、六要素 contract | 唯讀 | plan 的 JSON 骨架；腳本檢查欄位完整、驗收條件可執行 |
| implementer | 只改 scope 內的檔、先紅後綠、不碰 protected path | test-strategy（TDD 段）、completeness-scan | 只能在 worktree 內讀寫、跑測試 | diff ＋ 紅綠證據；verify-red-green、completeness-scan、scope 檢查 |
| reviewer | 三條紅線、四級嚴重度、每條都要 file:line | reviewer.md 方法論 | `--tools ""`（diff 由 dispatch 提供） | findings JSON；adjudicate-findings 驗格式、引用的行要存在 |
| verifier（verification_author） | 寫會先紅的測試、mutation 要被抓到 | evidence-discipline、verify-red-green | worktree 讀寫、跑測試 | 測試加 mutation 結果；腳本重跑確認 |
| debugger | 先蒐證、再縮範圍、提假說、驗證，不猜 | debug 方法論 | 唯讀加跑指令 | 假說和證據表；不直接修 |
| explorer | 查到就引出處，沒查到就說沒有 | survey-lite、引用規則 | 唯讀 | 帶出處的清單；腳本抽查出處存在 |
foreman／owner 先不做成套件（它是強模型的位置，不在「弱模型做好」的範圍）。

### 3.2 dispatch 時怎麼只給這一份（各 harness）
做法：套件用同一種格式寫一份（roles/<role>/），由腳本按 harness 編譯，概念跟現在 platforms/ 的鏡像同步一樣。子行程照現行做法放進一次性的 config dir，裡面只放憑證（不碰真的 ~/.claude）。
- Claude Code（claude 2.1.318；spike 2026-11-05，0 次模型呼叫，證據是 claude 失敗前寫進 session 轉錄的「請求形狀」，不是模型回應）：
  - verified：沒有 `--system-prompt-file`。角色卡用 `--system-prompt "$(cat role.md)"`（取代預設 system prompt，角色卡文字在 system 區塊）或 `--append-system-prompt`（S3：文字接在預設 system 區塊尾端；注意 `--system-prompt-snapshot on` 預設下 resume 會沿用第一次的 prompt）。
  - verified（S1）：一次性 `CLAUDE_CONFIG_DIR` 裡的 CLAUDE.md 與 skills/ 在預設 setting sources 下會被讀；加 `--setting-sources project` 後兩者都不會被讀。結論限於空目錄加預設 sources；在 seed-claude-config 播了憑證的目錄裡再放 CLAUDE.md 是否被重設沒測。
  - verified（S2）：`--setting-sources project` 時 cwd 的 CLAUDE.md 會被讀。
  - verified（S5，claude 實跑）：`--setting-sources project --system-prompt "$(cat role.md)" --plugin-dir <kit plugin> --tools "Read,Grep"` 生效：init.tools 只剩 Grep、Read，plugin skill 出現在 init.skills（內建 plugin 與內建 skills 仍在）。`--allowedTools` 是權限規則不是縮面，縮面用 `--tools`。
  - unverified：模型實際有沒有照角色卡做。現有派工路徑沒有放角色卡的旋鈕，自己處理憑證又不被允許；待 G37 帳號註冊（d-2a19fdb5）或 rail 加旋鈕之後驗證。
- codex（codex-cli 0.166.0）：
  - verified（只驗 `codex debug prompt-input`）：專案 `.agents/skills`、`CODEX_HOME/skills`、專案 AGENTS.md 與 `CODEX_HOME/AGENTS.md` 都進了 prompt-input。
  - unverified：`codex exec` 實跑（需要憑證；排在 G37 帳號註冊 d-2a19fdb5 之後，在那之前記為 blocked，不算完成，驗證時只用最便宜的模型、say OK 等級）；工具白名單：codex 沒有 `--tools` 等價旗標，只有 `-s` 沙箱與 `-c`（具體 key 未驗）。換 `CODEX_HOME` 會連 auth 一起換掉，需 rail 另行處理。
- agy（agy 1.5.0）：unverified。`--help` 沒有 system-prompt 旗標，也沒有工具白名單；HOME 下的 GEMINI.md 會不會被讀尚未驗證（先前 1.4.4 的實測見附錄）。`agy -p` 不讀 skill（verified negative，見附錄），所以方法論要寫進角色卡；隔離靠 worktree。
- opencode：`--agent` 加上 `{file:}`，`OPENCODE_DISABLE_PROJECT_CONFIG=1` 實測有效。
BL-0388（使用端收不到 plugin 的 CLAUDE.md）分兩半處理：
- dispatch 出去的子行程：角色套件由 autopilot 直接寫進子行程的 system prompt、CODEX_HOME 或 HOME，完全不依賴 plugin 的 CLAUDE.md 會不會被讀，所以這半邊由套件本身解掉。
- 使用者自己開的頂層 session：照 BL-0388 原本的修法，把使用端需要的規則改由 skill、hook 或 reference 帶。這半邊會直接影響 public 版的使用者，建議排進 3.0.0。

### 3.3 怎麼證明「弱模型也做得好」
- 任務集固定且事先凍結，重用現有的：reviewer 用 evals/known-bad（13 個植入缺陷）加 reviewer-bench；implementer 和 verifier 用 engine-qualify 各角色考卷的任務；planner 和 debugger 各 10 題，由 evals/ 的凍結 pack 產生。
- 組別（同一個弱模型、同一批任務）：A 現行 brief ｜ B 角色套件 ｜ C 安慰劑套件（字數相同、內容不相干） ｜ D 強模型＋現行 brief（當上限）。安慰劑用來排除「只是字多了」的效果。7/15 那次其實有安慰劑組（`evals/skill-transport`，等長 placebo，見附錄），它缺的是完整套件（縮小後的 skill、固定輸出、工具白名單、機器驗收）；它只測了 skill 本文 pack。
- 弱模型：haiku 5.5 為主，另加一個非 Claude 的便宜席位（例如 flash 或 kimi），看效果能不能跨模型家族成立。
- 指標：各角色一個主指標（reviewer：植入缺陷的抓到率，以及誤報的 MUST-FIX 數；implementer：驗收測試通過、而且紅綠證據成立；verifier：mutation 被抓到的比率；planner：腳本驗收的欄位完整率；debugger：假說命中率）。總指標是「縮小差距比例」＝(B−A)/(D−A)。
- 判定：事先登記並蓋章（prereg、stamp），用 discordant pair 做檢定。成功門檻：至少 3 個角色、B 對 A 縮小差距 ≥ 50%，而且 B 明顯優於 C。不成立就照實記錄，不出貨。唯一的機械判定（門檻、檢定、排除規則）在 A 階段的預註冊裡定案，正式評測前要蓋章（stamp），蓋章後不得改。
- 花費：6 角色 × 4 組 × 每組 20 題 × 2 個弱模型，約 960 格。haiku 約 0.016 USD/格；D 組用 sonnet 約 0.2–0.3 USD/格，只跑 6×20=120 格。估計約 50 USD，上限 75 USD（留 50% 餘裕，否則抽樣起伏就可能觸發停損）。先跑 pilot（每組 3 題），確認儀器沒壞再跑正式的。

### 3.4 跟 3.0.0 定稿的關係，以及建議
- 定稿 §1 的「依角色重排」，是指檔案依用途分層（skills、scripts、evidence 等），不是 dispatch 角色；§8 明文把「改寫 skill 內容」排除在範圍外，要另外照 scorecard-first 處理。兩件事不是同一個軸，P2–P5 沒辦法直接拿角色套件當重排的單位。
- 建議：3.0.0 照定稿走（P2–P5 → 白名單匯出 → 轉私有），只多做兩件小事，讓 3.0.0.x 不用再搬一次：
  1. layout-lint 的頂層白名單和匯出白名單，預留 `roles/` 這個位置（空目錄加 README）。
  2. BL-0388 的使用端那半邊（規則改由 skill、hook 或 reference 帶），因為它影響 public 版的使用者。
- 跟 3.0.0 並行、現在就能做（便宜、不動定稿）：五個 spike——一次性 config dir 或 cwd 裡的 CLAUDE.md 會不會被讀、`--append-system-prompt`、`--setting-sources project` 下 cwd 的 CLAUDE.md、`codex exec` 讀不讀 skill、套件編譯器的雛形。每個 spike 只用 haiku 跑幾次。
- `codex exec` 的真模型驗證排在 G37 帳號註冊（d-2a19fdb5）之後；在那之前 S 階段對這一項記為 blocked，不算完成。驗證時仍只用最便宜的模型、say OK 等級。
- 3.0.0.x：套件內容加 A/B 評測；評測成立才把 dispatch 預設改成走套件。
- 不建議塞進 3.0.0 的理由：7/15 的前例是負面結果，套件效果還沒證明；改 skill 內容依規要先有 eval；把它混進重排，會讓 3.0.0 的完成條件多一個未知數。

## 4. Phases

- **S（現在，與 3.0.0 並行）**：五個 spike（KR1）。零模型呼叫的請求形狀部分已完成（見 3.2 與附錄「Spike 結果」），剩下的真模型回應驗證待憑證路徑。每個一條小 lane，互不依賴，不動 relayout 定稿。
- **R（3.0.0 內，兩件小事）**：在 relayout 計畫的修訂 E1 登記，由該計畫的階段承接（頂層白名單在 P4、匯出白名單在 C2、BL-0388 使用端修正排在 P4 之後 C2 之前）。
- **A（3.0.0.x）**：角色套件內容與 A/B 評測：預註冊、pilot（每組 3 題）確認儀器沒壞、再跑正式；成本守 KR3。
- **D（3.0.0.x，A 成立才做）**：把 dispatch 預設改成走套件，另立 lane 與審查。

## 5. Test / validation

- A/B 設計見 3.3：組別 A 現行 brief、B 角色套件、C 等長安慰劑、D 強模型上限；任務集重用 `evals/known-bad`、`evals/reviewer-bench`、engine-qualify 各角色考卷任務，planner 與 debugger 各 10 題由 `evals/` 凍結 pack 產生。
- 判定由事先蓋章的 prereg 以腳本機械得出，不由 depth-0 臨場判斷。
- spike 的驗證是實跑加記錄的證據檔，每個附一個會失敗的對照呼叫（負控制）。

## 6. Risks + inversion

- 重演 7/15 的負面結果：只多塞字沒有效果。對策：A/B 含等長安慰劑組 C，並把套件定義成縮小加定型加機器驗收的整組。
- 一次性 config dir 或 cwd 的 CLAUDE.md 不被載入（記憶有 config-dir 重設陷阱）。對策：spike 已驗證預設 sources 下讀得到、`--setting-sources project` 下改用 cwd 的 CLAUDE.md 或 `--system-prompt`；seeded 憑證目錄與真模型回應仍待驗。
- agy 無頭模式不讀 skill、沒有細的工具白名單。對策：方法論寫進角色卡，隔離靠 worktree。
- 成本上限貼著預估值，抽樣起伏就觸發停損、整批作廢。對策：上限 75 USD，約留 50% 餘裕，先跑 pilot。
- 把本計畫混進 3.0.0 重排，會讓完成條件多一個未知數。對策：3.0.0 只多兩件小事。
- 保留的 `roles/` 位置長期空著變成死目錄。對策：只放一份 README，成本接近零；3.0.0.x 評測不成立時在 E1 修訂中撤銷。
- 改 skill 內容依規要先有 eval。對策：套件內容的 A/B 先做，預設不動。

## 7. Out of scope

- foreman／owner 套件（強模型的位置，不在「弱模型做好」的範圍）。
- 任何程式、任何 dispatch 預設變更。
- 改寫 skill 內容（另依 scorecard-first 處理）。
- 3.0.0 重排本身的內容，除了 E1 登記的兩件小事。

## 8. Open questions

- 第二個非 Claude 便宜席位選 flash 還是 kimi（只有 operator 的額度與偏好能定）。
- 方向本身要不要做：本計畫在 plan review 與 operator 確認前只是草案。

## Review log

- 2026-11-05：PM 裁定見檔首；plan review（凍結 rubric、最多兩代）尚未開始。
- g1 2026-11-05：astra chair，CONDITIONAL，0 blocker；R1/R2/R13 accepted_nonblocking，已在同一 commit 修正（R13：7/15 有安慰劑組，缺的是完整套件；R1：codex exec 真模型驗證排在 d-2a19fdb5 之後；R2：判定規則在 A 階段預註冊定案並蓋章）。
- 2026-11-05 (after plan review): wording changed per operator decision d-c76529c3: every "3.1" is now "3.0.0.x", the header gains ruling 5. The design is unchanged.

## 附註（跟本提案無關，但查的時候發現）
- 定稿 P3（`project/plans/2026-10-31-repo-relayout-3-0-0.md:100`）寫了「新增 .github/workflows/test.yml」，跟 operator「不用 hosted CI」的規則衝突。PM 2026-11-05 裁定拿掉，已記入該計畫的修訂 E1（改成本機跑）。

## 附錄：本文依賴的調研事實與出處（rolekit-probe 2026-11-05，develop `63308bd8f`，唯讀；[未驗證] = 沒有文件網址也沒有實跑紀錄）
**先前討論**
- repo 內找不到 operator「每個角色都有自己的 skill set、dispatch 時給不同 CLAUDE.md / skill set」的原話；搜過 project/plans、project/projects、project/backlog（含 BL-0388、BL-0206 sidecar）、docs/adr、references、skills、agents、`.claude/knowledge`、CHANGELOG、`project/handoff/HANDOFF.md`、git log。
- skill-transport A/B：`project/plans/_archive/2026/07/2026-07-15-skill-transport-payoff-ab.md:16`（假說：weak reviewer 吃 methodology pack 後抓到率上升）；同檔 `:3` 與 `:112-121`（reviewer 臂 H2 REFUTED，haiku delta -1、placebo delta -1；implementer 臂 codex spark 8 task x {nopack,pack}，H1 CONFIRMED，D=0）。CHANGELOG v2.32.34（約 `CHANGELOG.md:8117-8131`）同結論。它測的是「prompt-pack 注入 skill 本文」，不是「角色卡 + 精選 skill + 縮小工具面」。
- BL-0206 按功能拆 engine / flow / lab：`project/backlog/BACKLOG.md:727`，sidecar `project/backlog/split-autopilot-into-hetero-engine-flow-lab.md`。
- 現成的「一個角色一份指令本文」：`references/hetero-dispatch.md:936-938`（`.opencode/agent-bodies/*.body.md`，可餵 `agy -p`）；skill pack 旗標 `references/hetero-dispatch.md:944-955`（`--skill-mode off|prompt|native|auto`，預設 off，reviewer 永不收 skill pack）。

**現況**
- 角色定義單一來源：`src/engine/roles.js:10-14`（ROLE_IDS = owner, implementer, reviewer, verification_author, explorer）、`:47`（CAPABILITY_ROLE_IDS 另加 consult、discuss）、`:37-41`（舊別名）；`src/engine/execution-profile.js:40-41`（PROVISIONAL_ROLES、PROTECTED_ROLES）；`references/model-routing.md:21-34`（路由表角色）；`agents/README.md:1-12`（三個方法論 agent）。
- 各派工角色今天收到的東西：implementer 只有六要素 Task Prompt（`references/multi-agent-portability.md` agy spike）；Claude child 旗標 `scripts/dispatch-hetero.sh:3950-3982`；reviewer `scripts/dispatch-review.sh:1916,1966`（`-p --setting-sources project --strict-mcp-config --tools ""`）；verification_author `scripts/dispatch-author.sh:24,1395,1443`；explorer 回傳狀態 `references/hetero-dispatch.md:880-899`。沒有任何角色拿到專屬 CLAUDE.md 或專屬 skill 集；注入物只有 brief、可選 skill pack（off）、角色無關的 guided/autonomous profile（`src/engine/profile-runtime.js:560-585`）、reviewer/author 的工具全關。
- 子目錄規則只有文字約束：`AGENTS.md:5`、`references/hetero-dispatch.md` invariant 8（BL-0387，`project/backlog/brief-reads-subdir-agents-md.md`）。

**子行程 config dir 的注入點**
- 一次性 config dir 只放憑證：`scripts/lib/seed-claude-config.js:1-12`；用法 `references/hetero-dispatch.md:259-262`、`scripts/dispatch-review.sh:1968`、`scripts/dispatch-author.sh:1449`；account layer `references/hetero-dispatch.md:740-763`。
- `--plugin-dir`（有實跑）：`scripts/run-eval-batch.sh:142-152`、`scripts/probe-skill-frontmatter-portability.sh:382`、`src/harness/capabilities/claude-code.json:32`；`src/engine/profile-runtime.js:568-579` 在 `--bare` 探針用了 `--system-prompt-file`，但 claude 2.1.318 的 `--help` 沒有這個旗標（spike 2026-11-05），本計畫改用 `--system-prompt` / `--append-system-prompt`。
- 兩項 repo 內原本無紀錄的機制（config dir 或 cwd 的 CLAUDE.md / skills 是否載入、`--append-system-prompt`）已由 spike 2026-11-05 驗證，見下方「Spike 結果」。

**BL-0388**：`project/backlog/BACKLOG.md:1992-2005`，sidecar `project/backlog/consumer-rules-in-claude-md.md`。BL-0383 即時注入測試顯示 `--plugin-dir` 載入的 plugin 完全不帶入任何 CLAUDE.md，所以「dispatch 時給不同 CLAUDE.md」不能靠 plugin 內放 CLAUDE.md，必須由 dispatch 端放進子行程 cwd 或 config dir；skill、hook、reference 才是 plugin 送得到的載體。

**各 harness**
- Claude Code：`--tools ""`、`--strict-mcp-config`、`--setting-sources project`（`scripts/dispatch-review.sh:1478-1501,1880,1916`）；`--settings`（`scripts/dispatch-hetero.sh:3951`）；`--permission-mode dontAsk`（`src/engine/profile-runtime.js:582`）；官方 plugin 文件 https://code.claude.com/docs/en/plugins-reference （`references/multi-agent-portability.md:13`）。
- codex：暫存 `CODEX_HOME` 內的 AGENTS.md 與 repo AGENTS.md 都會載入（`src/harness/capabilities/codex.json:31`，codex-cli 0.163.0 實跑）；`codex exec` 載 skill 的行為 [未驗證]（`references/hetero-dispatch.md:941` 的整體敘述為負面）；官方 https://developers.openai.com/codex/skills 。
- agy：暫存 HOME 內 `~/.gemini/GEMINI.md`、`AGENTS.md` 實測載入（`src/harness/capabilities/agy.json` notes，agy 1.4.4）；`agy -p` 不載 skill（`references/multi-agent-portability.md` agy spike 2026-06-11，verified negative）；無細粒度工具白名單，靠 worktree 隔離。
- OpenCode：`--agent` 加 `{file:}`（`references/multi-agent-portability.md:141-145`）；`OPENCODE_DISABLE_PROJECT_CONFIG=1` 實測有效（同檔 `:101-125`）；官方 https://opencode.ai/docs/skills/ 。

**評測基礎設施**
- `evals/skill-onoff/README.md`（真 `--plugin-dir` 載入、凍結 pack、prereg 與 stamp、`ONOFF_MAX_USD` 總上限、auth/quota 失敗立即停）；`evals/skill-transport/`（reviewer 臂 312 cell 矩陣含等長 placebo 臂，report.js 算 discordant pair 與 flip band；implementer 臂 8 task x {nopack,pack}）；`evals/known-bad/`（13 個植入缺陷）、`evals/reviewer-bench/`；`scripts/engine-qualify.js` 各角色 `*-eval-generator.js`；`references/evidence-discipline.md`。
- 要新增：「角色套件」arm 型別（角色卡 + skill 集 + 工具面打包成一個 arm，並以 config dir 或 cwd 注入子行程；現有 runner 走 `--plugin-dir`）、弱模型當受測者的矩陣、三條對照臂（裸奔、等長 placebo、角色套件）。
- 已記錄的 cell 成本：Haiku pilot 一格 0.0162 USD、`--max-budget-usd` 是呼叫後才檢查可超額一次（`evals/skill-onoff/README.md`）；findings-batch Sonnet 預估 0.19–0.30 USD/格；dcard-v3 35 cell 約 5.27 USD（上限 7.00）。

**與 relayout 計畫的關係**
- `project/plans/2026-10-31-repo-relayout-3-0-0.md` §1（`:26-64`）依檔案用途分層，不是依派工角色；§8（`:151-153`）把改寫 skill 內容排除在範圍外；P2–P5 在 `:80-111`；「頂層目錄與根目錄檔案都有白名單」在 §1 末；頂層白名單實作在 `scripts/lib/repo-layout.js:165`（`allowlists.top_dirs`，每項有 `since` 階段）與 `scripts/layout-lint.js:156`。
- 新增頂層目錄（如 `roles/`）要先過 layout-lint 的頂層白名單並登錄。

**Spike 結果 2026-11-05（rolekit-probe，0 次模型呼叫；claude 2.1.318、codex-cli 0.166.0、agy 1.5.0）**：S1 一次性 CLAUDE_CONFIG_DIR 的 CLAUDE.md 與 skills 預設會讀、`--setting-sources project` 下不讀（verified，請求形狀）；S2 `--setting-sources project` 讀 cwd 的 CLAUDE.md（verified）；S3 `--append-system-prompt` 可用，且沒有 `--system-prompt-file`（verified）；S4 codex 的 `.agents/skills`、`CODEX_HOME/skills`、兩處 AGENTS.md 進 prompt-input（verified，`codex exec` 未實跑）；S5 claude 角色套件 argv 全數 verified，codex 部分 verified、無工具白名單旗標，agy unverified。

**仍未驗證**：(1) 模型實際有沒有照角色卡做（現有派工路徑沒有放角色卡的旋鈕，待 G37 帳號註冊 d-2a19fdb5 或 rail 加旋鈕之後驗證）；(2) `codex exec` 實跑；(3) agy 的 GEMINI.md 載入與工具限制；(4) 先前 H1/H2 的否定結果只涵蓋 skill 本文 prompt-pack，「角色卡 + 縮窄 skill + 縮小工具面」整組套件從未被測過；套件編譯器雛形尚未做。

## 附錄：G25 role-bundle 實驗併入（2026-11-05 PM 裁示）

PM go-ledger G25（三家討論的結論：不拆分 autopilot，先在可量測的實驗後面做角色套件）併入本方向並結案；角色矩陣、凍結任務、對照組與安慰劑組、預註冊與封存、成本上限、停止規則本文都已涵蓋，不再重複。

下面四點仍有用，記為 B 組的**次要讀數**。它們**不屬於已封存的判定**；除非在 pilot 封存之前先寫進預註冊，否則只作參考，不影響 SHIP 或 NOT-SHIP。

1. **載入的輸入 token 數**：量第一輪實際載入的 token（含快取校正後的成本），不用「裝了幾個技能」當指標。
2. **聯合防線**：token 減少只有在關鍵缺陷的找出率沒有下降、誤報沒有增加、權限沒有放寬三者同時成立時才算數。
3. **越界率**：每一百個 session 中，呼叫了角色允許清單以外技能的次數。
4. **套件身分入帳**：把渲染後的套件雜湊寫進派工的任務紀錄，行為差異才能追到是哪一版套件造成的。

提醒：十個案例只支撐有限度的推行，不足以宣稱可靠度。
