# Test-Integrity Gate — 對抗 delegate self-test false-green

> Status: DRAFT v4(round-4 修 config-default 拆清 + rename_escape;待 round-5 最終確認 P1a → 派 agy）
> Owner: cookys
> Date: 2026-06-25
> Semver: PATCH(新 script + 擴 reference + wiring;非新 skill/agent。見 §8 對 codex MINOR 異見的回應）

## 1. 背景與動機

### 1.1 痛點
記憶 [[feedback_delegate-selftest-false-green]]:被委派的 implementer 自己寫的綠燈 ≠ 達標。兩種湊綠手法:
- **(A) 寫放水測試**:新斷言太弱、只測 happy path。
- **(B) 廢掉既有測試湊綠**:刪、skip、弱化、或**遮蔽/排除**既有測試。

使用者判定:**兩者都要防,B 更迫切**。

### 1.2 既有材料
- `check-disjointness.sh` — git-artifact allowlist/denylist(`validate`,never self-report)。契約 **FILES ONLY**。
- `dispatch-hetero.sh` — worktree 隔離 + git-artifact 驗證。
- `resolve-qc-gate.sh` / `resolve-doa.sh` — per-project config-resolution 範式。
- `.qc/<sha>.verdict.json` + pre-push qc-gate — 既有 reviewer verdict 機制。

### 1.3 為何現在處理
長期 false-green 風險,`/l5` hetero impl 放大它(外部引擎自報綠燈更不可信)。

## 2. 設計(round-2:推翻 v0 的「additions-only 就夠」)

### 2.0 v0 為何不足(gpt-5.5 round-1 反駁,已採納)
- 「弱化必產生 `-` 行」**為假**:改 test glob **之外**的 `conftest.py`/共用 fixture/mock/snapshot/golden/runner-config 即可放水,零 `-` 行。
- additions-only **照樣廢測試**:`test.only`、module 層 `pytestmark=skip`、斷言前 `return`、`collect_ignore`、`importorskip` 皆純新增。
- 結論:**additions-only 是必要但遠不充分**。真正的強 gate 是「被執行的測試集合不得縮減」。

### 2.1 分層設計(核心)
測試完整性是**多面**的,單一靜態規則必為 theater。改採三層,**全部 post-commit、讀 git/runner artifact、never self-report**:

**L0 — 永遠跑的靜態層(純 git-artifact,語言無關):**
1. **Test-file additions-only**:test-path 檔 hunk 不得含 `-` 行 → 抓 in-place 弱化(`assertEqual→assertTrue` 必產生 `-` 行)與刪除。
   - **rename 例外的收窄**(round-4 Maj-2):`-M` 純搬移**僅當目的地仍在 test-path / 仍可被發現**才算 ok;**test→非 test 路徑、或 rename 成不符 test-path 慣例的名字 = `rename_escape` 違規**(等同把測試移出覆蓋面),需 depth-0 override。
2. **Skip/solo-marker denylist**:新增行不得引入 skip/solo/xfail marker(集合見 §2.2,含 `test.only`/`xfail`/`importorskip`/`this.skip`/`#[ignore]`/`pending` 等)。
3. **Integrity-surface watch**:同一 diff 若**觸碰**「測試完整性面」中的**非 test 檔**(conftest/fixtures/helpers/mocks、snapshot/golden、runner-config: pytest.ini·jest.config·go test flags·playwright/cypress config、package scripts、CI workflow、coverage 門檻),**不自動 pass** → 標 `surface_touch` 要求 reviewer 簽核。

**L1 — 偵測到 test runner 時的語意強層(best-effort,需可執行環境):**
4. **Executed-set invariance**(round-2 Crit-1 修正:不只看 collected,要看**實際會執行**):比對 base vs head 的**「被收集且非 skip/xfail/todo/filtered」測試集合**。`--collect-only` 不夠(skipped 仍在 collection 內)→ 以 **report/junit-xml 執行狀態**為準(`pytest -rs` / junit、`jest --listTests`+狀態、`go test -list` 等)。**任何 base 測試從 runnable 轉為 skipped/xfail/todo/filtered/消失即違規** → 抓 skip/`test.only`/config 排除/`collect_ignore`/整目錄停用,**無論手法在不在 test 路徑**。
   - **runner 存在但 collection/執行失敗**(candidate 可能故意弄壞 runner,round-2 Maj-5)→ 視同可疑,block mode 下**要求 depth-0 override**,不靜默放行。
   - **repo 根本無測試框架**(偵測不到任何 runner)→ `l1: unavailable`,由 L0 + reviewer 兜底。

**為何分層解決 round-1 反駁**:collection-diff(L1)抓「集合縮減」類(skip/solo/排除,含 additions-only 與 out-of-path);additions-only(L0-1)抓「in-place 弱化」類(`-` 行);surface-watch(L0-3)把「改共用 fixture/config 放水」逼進 reviewer。三者互補。

### 2.2 落點 — `scripts/check-test-integrity.sh`(sibling,不污染 FILES-ONLY 的 check-disjointness)
- **輸入**:`validate --range <base>..<head> [--repo <dir>] [--no-l1]`;讀 `git diff -M`,L1 在 `<base>`/`<head>` 兩個 checkout/worktree 跑 collector。
- **test-path 辨識**:預設慣例集 + `.claude/test-integrity-config.md` 覆寫(同 qc-gate resolution 序)。慣例集需含(round-1 §4 補齊):`**/*_test.go` `**/*_test.py` `**/test_*.py` `**/*.{test,spec}.{js,ts,jsx,tsx,mjs,cjs,mts,cts}` `**/__tests__/**` `tests/**` `test/**` `spec/**` `**/*_spec.rb` `**/*Test.java` `src/test/**` e2e/cypress/playwright dirs `**/*.feature` Bats `*.bats`。`test_paths_matched: 0` ⇒ 顯著「可能漏配」警告。
- **skip/solo-marker(supplement,非主 gate)**:JS/TS `xit|xdescribe|xtest|\.(skip|only|todo|failing)\b|fdescribe|fit`;Py `@(pytest\.mark\.(skip|xfail))|unittest\.skip\w*|pytest\.(skip|importorskip)|^\s*pytestmark\s*=`;Go `t\.Skip(Now)?`;Rust `#\[ignore\]`;Java/Kotlin `@(Ignore|Disabled)`;Ruby `\b(pending|skip)\b|^\s*xit`。**明示:regex 只是補充,L1 collection-diff 才是主力。**
- **integrity-surface(非 test 檔但屬完整性面)**:`**/conftest.py` `**/fixtures/**` `**/factories/**` `**/__mocks__/**` `**/__snapshots__/**` `**/*.snap` golden dirs、**runner setup**(`**/setupTests.*` `**/jest.setup.*` `**/vitest.setup.*` `**/*.matchers.*` 自訂 matcher/serializer 慣例)、`pytest.ini`/`tox.ini`/`setup.cfg [tool:pytest]`/`pyproject.toml [tool.pytest]`、`jest.config.*`/`vitest.config.*`/`playwright.config.*`/`cypress.config.*`、`package.json` scripts、`.github/workflows/**`、coverage 設定。
  - **殘留明示**(round-2 Crit-2):任意 `src/**` 下被既有測試 import 的 helper 被改弱、而測試仍被收集且仍綠 —— 此「green-but-meaningless」**任何確定性 gate 都抓不到**(見 §4),靠 reviewer / mutation testing;surface glob 只涵蓋慣例命名,非全稱保證。可選強化(P1b+):用 import-graph 推導「被測試 import 的非 test 檔」動態擴充 surface(較重,後續評估)。
- **輸出**:JSON `{ok, mode, violations:[{layer,file,kind,line,detail}], surface_touches:[...], l1:"ok|unavailable|skipped", test_paths_matched:N, source}`;exit 0 ok|warn|off / 1 block-violation / 2 usage。
- **config 解析語意(round-4 Maj-1 拆清)**:
  - **無 override config**(專案沒放 `.claude/test-integrity-config.md`)⇒ 用**內建預設 + `mode=warn`**(正常情況,非錯誤)。
  - **config 存在但 malformed/無法解析** ⇒ **fail-closed `block`**(這才是「壞掉」)。
  - 兩者語意不同,實作不得混為一談。
- **`surface_touch` 在 block 模式的判定(round-3 Maj-1 釘死)**:`mode=block` 時,任何 `surface_touch` **本身就是 block-violation(exit 1)**,除非被對應的 depth-0 verdict(§2.3,digest 相符)覆蓋;`mode=warn` 時僅列出不阻擋。**不得實作成「block 模式下 surface_touch 永遠只 warn」** —— 那會重開 fixture/config 旁路。

### 2.3 Override 逃生閥(round-1 §6 + round-2 Maj-3 硬化 — provenance 機械強制)
合法改既有測試/fixture 時,override **僅接受 depth-0 / 人類控制端產生**,且 **provenance 由 gate 機械驗證,不只宣稱**:
- verdict 存於 **denylist 保護路徑**(`.qc/<sha>.verdict.json`,§2.4 列入 candidate-denied)→ candidate 結構上無法自寫。
- verdict **內含 candidate tree 的 digest + changed-path 摘要**;gate 驗 `digest == git rev-parse HEAD^{tree}`(或 range 對應)→ 防止挪用舊 verdict 蓋新改動。
- commit trailer `Test-Integrity-Override:` 僅作索引;**裸 trailer 無對應、digest 不符、或 verdict 不在保護路徑 ⇒ 仍 fail**。

### 2.4 保護 gate 自身(round-1 §7 + round-2 Maj-4 — 解 config deadlock)
- gate 腳本與 **config 皆從可信 base ref / 已安裝 plugin 讀**,**不從 candidate worktree / head** 取 → candidate 改了也不生效。
- `check-test-integrity.sh`、`.claude/test-integrity-config.md`、`.qc/**`、`.gitattributes`、hook/wiring 檔 **進 dispatch denylist** → candidate 觸碰即 `validate` 違規。
- **合法 config 更新走 depth-0-only 工作流**(與 override 同信任面:depth-0 改 base ref 的 config,非 candidate 改 head),避免「既是客製又被禁」的死結。

### 2.5 強度與 wiring
- **全域預設 `warn`**([[project_cc-workflow-methodology-learnings]] shadow→calibrate→gate)→ 不改變既有 workflow 行為,**維持 PATCH**(round-2 Minor-6)。
- `/l5` hetero 路徑的 `block` 是 **per-project opt-in config**(`.claude/test-integrity-config.md` 設 `mode: block`),**非預設行為變更** → 不觸發 MINOR。
- 接 `skills/quality-pipeline/`;可選接 pre-push qc-gate。

## 3. Phases
| Phase | 內容 | Bump |
|---|---|---|
| **P1a(L0,迫切)** | additions-only + skip/solo denylist + surface-watch + override(depth-0)+ gate 自保護 + config 範本 + wiring | PATCH |
| **P1b(L1)** | executed-set invariance(per-runner collector,best-effort)| PATCH |
| **P2(A)** | reviewer-owned acceptance:implementer allowlist 結構排除 test-author 權 | 另議 |

P1a 可單獨 ship(靜態、無 runtime 依賴)。**P1b 不可直接機械 dispatch**(round-3 Maj-2):per-runner 的 normalized test-id / xfail-todo-filtered 映射 / command discovery / timeout / base-head 失敗分類需先寫 per-runner design spec,否則機械實作者會亂猜(= delegate-selftest-false-green 的翻版)。**本輪 agy dispatch 範圍 = 僅 P1a。** P2 視 calibration。

## 4. Out-of-scope(spike 依據)
2026-06-25 三方 spike(我 + agy/Gemini + codex gpt-5.5)+ arXiv 查證:
- **ACDL runtime 剪枝 DSL** — arXiv 2605.01920 自承是**給人看的標記語言**,不主張 runtime 省 token;diff 結構化 autopilot 已有。**借名換機制,不做。**
- **SAL/OPA membrane/IEEC ledger** — arXiv 2604.22136/2604.08601 真實,但三方判 local 工具 **security theater**;審計性 `tree.js` 已覆蓋。**不做。**
- **LangGraph.js + SQLite / 改寫 GitHub App** — 三方一致 double-state、product pivot。**不做。**
- **CRDAL 字面「Reviewer 寫測試對抗分工」** — arXiv 2603.24768 講電池設計元認知 anti-fixation,與測試無關;本機制獨立成立,**不掛 CRDAL 名**。
- **語意「green-but-meaningless」殘留**(改共用 helper 讓測試仍被收集且仍綠、但斷言變無意義)— **任何確定性 gate 都抓不到**;明示交給 reviewer / mutation testing,不在本 gate 範圍(但 surface-watch 會把這類 helper 改動逼進 reviewer)。

## 5. Risks
| # | Risk | Mitigation |
|---|---|---|
| R1 | 大重構搬移測試大量 trip | 預設 `warn`;`-M` rename;depth-0 override |
| R2 | test-path/surface glob 漏語言 → 假陰性 | config 可覆寫;`matched:0` 顯著警告;L1 collection-diff 補位 |
| R3 | skip-regex 跨語言不全 | 明示只是 supplement;L1 才是主力 |
| R4 | override 被被約束者自簽湊綠 | **僅信 depth-0 verdict、worktree 外產生**;裸 override fail |
| R5 | 收緊既有寬鬆斷言的合法修正也被擋 | 正是 reviewer 逃生閥用途;收緊本就該獨立簽核 |
| R6 | **改 glob 外的 conftest/fixture/config 放水**(round-1 🔴#1) | surface-watch 標 `surface_touch` 強制 reviewer;L1 collection-diff 抓集合縮減 |
| R7 | **additions-only 的 test.only / module-skip / collect_ignore**(round-1 🔴#2) | solo/skip denylist + L1 collection-diff(集合縮減即違規) |
| R8 | implementer 改 gate 腳本/config 本身(round-1 🟠#7) | gate 從可信 base 跑;gate 檔進 denylist(§2.4) |
| R9 | L1 需可執行 runner,跨 repo/語言未必有 | L1 best-effort;**僅「無框架」才 `unavailable` 放行**;「有 runner 但跑掛」→ block 下要求 depth-0 override(R10) |
| R10 | **candidate 故意弄壞 runner 讓 L1 失敗以繞過**(round-2 Maj-5) | runner-detected-but-failed ≠ unavailable;block 下要求 depth-0 override,不靜默 pass |
| R11 | **改 src/** 下被測試 import 的 helper 弱化、測試仍綠**(round-2 Crit-2 殘留) | 確定性 gate 不保證;surface-watch 抓慣例命名,全稱靠 reviewer / mutation testing(§4 明示) |

## 6. Acceptance Criteria
### Functional — L0
- [ ] 刪 test 函式 → `deleted_line`。
- [ ] `assertEqual(x,5)`→`assertTrue(x)` → 產生 `-` 行 → `deleted_line`。
- [ ] 新增 `it.skip(`/`it.only(`/`@pytest.mark.skip`/`pytestmark = skip` → `skip_marker`/`solo_marker`。
- [ ] 純新增 test case(只 `+`)→ ok。
- [ ] `git mv` test→test(目的地仍在 test-path)→ ok;**test→非 test 路徑 / 不符慣例名 → `rename_escape` 違規**。
- [ ] 同 diff 改 `conftest.py`/`jest.config`/`pytest.ini`/`.github/workflows` → `surface_touch`;**`mode=block` 無 depth-0 verdict ⇒ exit 1**;`mode=warn` ⇒ 列出不阻擋。
- [ ] candidate 改 `check-test-integrity.sh` 或 `test-integrity-config.md` → denylist 違規(§2.4)。
- [ ] `Test-Integrity-Override` 無 depth-0 worktree-外 verdict → 仍 fail;有 → 放行。
- [ ] **config 不存在 → 內建預設 + warn(非錯誤)**;**config 存在但 malformed → fail-closed block**;`matched:0` → 漏配警告。
### Functional — L1(runner 偵測到時)
- [ ] 加 `test.only` 遮蔽其餘 → executed-set 縮減 → 違規(即使 L0 漏抓)。
- [ ] 既有測試加 `@pytest.mark.skip`(仍在 collection 內但**轉 skipped**)→ executed-set 縮減 → 違規(Crit-1:`--collect-only` 會漏、執行狀態抓得到)。
- [ ] `collect_ignore`/`norecursedirs`/`testPathIgnorePatterns` 停用一批 → executed-set 縮減 → 違規。
- [ ] **repo 無框架** → `l1:"unavailable"`,不誤判 pass;**有 runner 但 collection 跑掛** → block 下要求 depth-0 override(不靜默 pass)。
- [ ] override verdict 的 tree-digest 與 HEAD 不符(挪用舊 verdict)→ 仍 fail。
### Wiring(三處掛鉤鐵律)
- [ ] quality-pipeline reference 描述 + 呼叫時機;SKILL Available Scripts 表;`CLAUDE.md` inventory(alphabetical-by-purpose)。
### Release
- [ ] PATCH bump via `sync-version.js`(四 count flag 全帶,[[project_sync-version-disabled-count-footgun]]);CHANGELOG + INDEX + mirror parity。

## 7. Inspired By / Credit
源自使用者轉述的 loop-engineering 建議書。2026-06-25 spike:術語(ACDL/CRDAL/SAL/IEEC)**皆真實 arXiv 2026 論文**(我原判「杜撰」被 spike 推翻 — [[feedback_spike-before-assert]] 落自己頭上),但建議書對 ACDL/CRDAL/SAL 的應用是誤讀/誤植;唯一真 delta = 測試完整性,經三方背書。**v0→v1 由 gpt-5.5 xhigh 對抗式 loop review 推翻 additions-only 充分性而重構**([[feedback_verify-reviewer-claims.md]] 的正向案例:外部 reviewer 找到我自己沒看到的 Critical 洞)。

## 8. 變更歷史
- 2026-06-25 v0 — brainstorm 收斂 + 三方 spike 初稿(additions-only 單層)。
- 2026-06-25 v1 — gpt-5.5 round-1 判 RECONSIDER:additions-only 不充分。重構為 L0 靜態 + L1 collection-invariance + surface-watch + depth-0 override + gate 自保護。
  - codex 異見 #8(應 MINOR):**不採納** — autopilot semver 政策明訂「新 script = PATCH」(CLAUDE.md §Versioning),codex 不知此 repo 慣例;新 gate 雖預設 block 仍是 script+wiring,非新 skill/agent。保留 PATCH。
- 2026-06-25 v2 — gpt-5.5 round-2 判 FIX-THEN-SHIP。修:L1 改 executed-set(非僅 collected,解 collected-but-skipped 漏);surface 補 setupTests/matcher + 明示 imported-helper 殘留;override 加 tree-digest 機械驗證(§2.3);config 從 base ref 讀 + depth-0 更新工作流解 deadlock(§2.4);broken-runner≠unavailable 要求 override(R10);全域預設 warn 確認 PATCH(§2.5)。新增 R10/R11。
- 2026-06-25 v3 — gpt-5.5 round-3:6 個 round-2 finding 全 RESOLVED。剩 2 Major:(1)surface_touch 語意 → 釘死「block 模式無 depth-0 verdict 即 exit 1」(§2.2/§6);(2)L1 collector 對機械實作者規格不足 → **P1b 移出本輪 dispatch,需先寫 per-runner design spec**;本輪 agy 只做 P1a。
- 2026-06-25 v4 — gpt-5.5 round-4(P1a-scoped):surface_touch RESOLVED。修 2 Major:(1)config 預設拆清「不存在→預設+warn」vs「壞掉→fail-closed block」(§2.2/§6);(2)rename 收窄 —— test→非 test 路徑 = `rename_escape` 違規(§2.1/§6),堵純 git mv 移出覆蓋面的旁路。
