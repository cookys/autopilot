# Observation-first skills — 驗證合約必答 + 密度去硬編碼 + 演化規則

> Status: R3 — R2 判定:gpt-5.5/grok/GLM SHIP-AS-IS;opus 1 blocking(紅綠 base-run 語意)+ MiniMax 2 kernels,本版吸收
> Evidence base: `docs/projects/_archive/2026-07-06-eval-instruments/report.md`

## 背景:量測已定案的五件事

| # | 發現 | 數字 |
|---|------|------|
| 1 | 散文不改變行為;操作程序與機械合約才會 | campaign R1/R2、t10-t13 零增益、t14 p=0.279 |
| 2 | 管線價值 = 模型與任務難度的落差 | haiku t2 0/3→3/3;M3 t13 3/3→2/3 @12× |
| 3 | 驗證是法官、審查是偵探(verify-first) | 救援保留 -36%、稅砍 4×、倒退消除 |
| 4 | 象限規則:模型強 或 驗證強,才可降審 | t2×medium 驗證 = 100% 逃逸 |
| 5 | 兩份真相必漂移 | reviewer_runner enum 雙站點(K7/K8) |

## 設計原則

**強制只放在觀測層;干預層一律 evidence-triggered。**
觀測(事後跑 verify、記 ledger、advisory review)可強制;干預(gating 審查迴圈、修復輪、程序要求)預設關、憑證據開。

## Scope(三項編輯)

### A. dev-flow:驗證合約必答(修訂版 — 存在 ≠ 強度)

Sizing(全尺寸)intake 必答:**「這個任務做完,跑什麼命令能客觀證明?」**

**R1 五家共識洞**:提供命令 ≠ 驗證強。`true`/`echo done`/`python -c "import mymod"` 都是命令;把「存在」當「強」= 把逃逸懸崖(t2×medium 100% 逃逸)寫進制度;且「禁止假驗證」是散文,依論點 #1 無效。修訂為**機械分層**:

| 答案 | 機械判定 | 路由 |
|------|---------|------|
| 命令,且通過**紅綠驗證** | 見下方紅綠語意 | 紅綠通過 ⇒ **驗證錨定恆成立**(ratchet + 一輪 advisory review)。review 降為**非 gating** 需三條件**同時**:紅綠通過 **且** implementer scorecard-qualified(機械定義:`engine-scorecard.js` status=qualified,由 `engine-qualify.sh` 的 known-bad 零漏放 bar 產生 — 非主觀判斷)**且** risk=low(opus R2:連言架構 — 單靠騙過紅綠拿不掉否決權)|
| 命令,但未過紅綠(vacuous)或紅無法成立 | 自動降級 | 同「無驗證」列 |
| 「沒有客觀驗證」(合法誠實答案) | 記入 run summary | **審查 gating 常駐**,不分模型強弱(零機械觀測不可證偽;reviewer 是唯一觀測通道,保留否決權;模型強只降輪數 ≤2,不降為零)。此 gating review **優先派工具可執行的原生 reviewer**(能實跑探索性檢查),而非 diff-text 軌(MiniMax R2)|

**紅綠語意(opus R2 blocking 修訂 — in-diff 測試檔的 base-run 規則)**:
- **base 定義**:dispatcher 釘死的 immutable base SHA(engine `--base`;dev-flow inline = intake 時的 HEAD)。dirty tree 不是 base — 驗證只對釘死狀態跑。
- **base-run = base 的產品碼 + diff 中的驗證 artifact 套上去跑**(否則純新增 TDD 案例 — 測試檔在 diff 裡 — 會被誤降級)。
- **紅的資格**:必須是 **assertion/行為失敗**;基礎設施錯誤(檔案不存在、import error、collect 0)**不算紅** — `test -f newfile`、`git diff --quiet` 類 artifact-存在探針因此無法冒充紅綠。套上 artifact 後仍是基礎設施錯誤 → 降級。
- **紅必須可重現**(flaky base-fail 重跑一次確認;不可重現 → 降級)— 誠實計帳,防環境噪音冒充紅。

安全邊界(gpt-5.5 R1):verify-cmd 由 dispatcher 撰寫、在**隔離 worktree** 執行、期望唯讀;`terraform apply` 類有副作用命令不是驗證 — 文件明載,並誠實標注「無 bwrap 即無硬沙箱」的既有邊界(BACKLOG 已有)。
釐清(grok R1):verify-first 的引擎語意(v2.32.6)本就**仍派一輪 advisory review** — 被降的是 review 的否決權,不是觀測本身;plan 據此措辭,「跳過審查」的說法不再出現。

### B. 密度去硬編碼(修訂版 — 六站點,兩站點保留字面值)

| 站點 | 處置 |
|------|------|
| `skills/l4/SKILL.md:21` ≥3 reviewers | 改「家族數/panel 由 resolver 決定」**但保留 lens 下限:「homogeneous(全 Claude)panel 維持 ≥3 lens 下限」**(opus R1:resolver 只管 families 不管 panel size — 低風險 required_families=1 時單 lens 就能過;下限是 resolver 未覆蓋的真實安全屬性,BACKLOG:resolver 增發 `min_panel_size` 後才可拆) |
| `level-front-door.md:302` | 同上 |
| `level-front-door.md:314` | 隨 302 改寫 |
| `level-front-door.md:478`(ledger 範例「claude ×N (≥3 lenses)」) | 隨 302 同步(opus R1:原 grep 會抓到它但原 scope 沒列 — 內部不一致修正) |
| `quality-pipeline/references/code-review.md:195`「depth-0 ≥3 fan-out」 | 補入 scope(opus R1:原 grep 漏網的第五份漂移副本) |
| `finish-flow/SKILL.md:60`「max 3 rounds」 | **保留字面值 3**(opus R1:這是 quality-pipeline 的同質修復迴圈,非 engine implement-review;finish-flow 不 consult resolver,指過去會懸空或把上限鬆到 5-7 — 與 M3 churn 證據反向)。加一句註記:「/l5 /l6 情境下 engine 迴圈另由 resolver 治理」 |

通則(GLM R1):任何指向 resolver 的措辭附 fail-safe:「resolver 不可用時退回字面值 3」— 失效必須收斂,不得發散。

### C. 演化規則入法(CLAUDE.md conventions,~12 行)

1. **童子軍規則**:觸碰 skill 時順手向合約卡修剪;north-star gate 逐版看守。
2. **成績單前置**:重寫/刪除 skill 前必須有 eval ON/OFF 證據;無證據的重寫 = 無證據的信任。

## Non-goals(不變 + 新增)

- ❌ 不動 `description:` frontmatter;❌ 不重寫方法論 skill;❌ 不做全面每輪重注入(tier-gated 先量測);❌ 不把干預變強制
- ❌ 本 plan 不實作「驗證強度評分軸」(五家共識的缺口,但屬 resolver/engine 新功能)— 開 BACKLOG:`verify_strength` 作為 density 第三輸入;紅綠驗證是它的最小可行前身
- ❌ 不改 resolver 本體(`min_panel_size` 增發同樣 BACKLOG — 條目須寫成**家族無關**:任何 required_families=1 的單家族 panel 都有單 lens 弱點,不限 Claude;並註明 lens 多樣 ≠ 家族去相關,同家族多 lens 共享盲點 — MiniMax/opus R2)

## 驗收(修訂 — 逐站點清單取代單一 grep)

- A:dev-flow 含三列路由表;紅綠驗證的 base-FAIL 條款有引擎參數對應;「沒有客觀驗證」路由語句存在;副作用警語存在
- B:六站點逐一 diff 檢查(表列即驗收清單);輔助 grep 修正為 **case-insensitive** 且涵蓋 `max [0-9]+ rounds`(opus R1:原 grep 對 code-review.md:195 漏報、對 finish-flow 形態不匹配 — 單一 grep 不是健全的完備性 gate,故降為輔助)
- C:CLAUDE.md 兩條規則 ≤12 行
- BACKLOG 兩條新條目(verify_strength 軸、min_panel_size)存在
- 機械 gates 全綠;north-star prose 淨減或持平
- 本 plan R2 過五家族聯審才派實作

## 風險

- dev-flow 入口協定 + 散文無 oracle → 五家族聯審(R1 已抓 5 條真洞,制度有效)
- 審查 churn → 裁決規則不變:finding 須含具體失敗情境
