# Site loop review (post-commit `4225985`)

Engines: **codex gpt-5.6-sol @ max** · **claude-fable-5 @ max**  
Commit: local only (`develop` ahead of origin by 1). **Not pushed.**  
Sol dispatch status: `explored_dirty` (answer usable; working tree clean aside from this review file).

> **Do not overwrite this file with raw engine dumps** — the Merged section is the SSOT for the fix pass.

---

## Merged verdict

Both engines: **FIX-THEN-SHIP**

| Engine | Verdict | Superpower this pass |
|--------|---------|----------------------|
| **sol** | FIX-THEN-SHIP | **Rendered** 5 zh-TW routes + light/dark; found **site-wide hidden `<h1>`** (CDP-confirmed) |
| **fable** | FIX-THEN-SHIP | **Ship hygiene**: unpublished commit, internal md → public pages, broken search index |

### Independent verification (this session)

`google-chrome` headless CDP on `http://127.0.0.1:5173/autopilot/zh-TW/`:

| Route | h1 text (slice) | computed `display` | box |
|-------|-----------------|--------------------|-----|
| `/zh-TW/` | Claude Code 讓你寫得快… | **`none`** | w=0 |
| `/zh-TW/levels` | 四層差在拓撲… | **`none`** | w=0 |
| `/zh-TW/install` | 兩行裝好… | **`none`** | w=0 |

Root cause: `custom.css` `.vp-doc h1 { display: none }` (for PageHero dual-title) also matches component heroes under `.lp-hero h1` / `h1.ph__title` (same or lower specificity, later rule wins).

---

## Dual TOP (merged priority)

Do these first (union of both TOP-5, severity-ranked, de-duped):

| # | Sev | Axis | Source | Finding | Concrete fix |
|---|-----|------|--------|---------|--------------|
| 1 | 🔴 | B/C | **sol** (+ verified) | Hero `<h1>` site-wide `display:none` | Scope to `.vp-doc > h1` **or** restore `.vp-doc .lp-hero h1, .vp-doc h1.ph__title { display: block }`; smoke 5 routes |
| 2 | 🔴 | E | **fable** | Commit not pushed → prod 404 | **You** decide push `develop` (not done) |
| 3 | 🟠 | G/A | **fable** | Internal work md built as public pages (NARRATIVE/WEEKLY/*-PANEL…) | `srcExclude` + move `public/logo-*.html` out of public |
| 4 | 🟠 | A | **fable** | Local search indexes only internal md, not Vue copy | Remove `themeConfig.search` this pass |
| 5 | 🟠 | D/E | **sol** | Landing centerpiece ≠ frozen「同一張工單、兩種一天」; day-one buried ~6k px on mobile | Replace nested-ring block with dual-timeline; keep rings on Demo |
| 6 | 🟠 | A/E | **sol** | Landing shows only 1 of 2 install commands; day-one CTA skips install block | Both commands or Install CTA only; anchors 安裝/第一天/第二天 |
| 7 | 🟠 | D/C | **fable** | Levels 前因/後果 fragment bullets | Retitle + merge into full sentences |
| 8 | 🟠 | G | **sol** | Proof / Multi-harness claims lack receipt links | Link CHANGELOG / evals / portability matrix |
| 9 | 🟠 | B | **sol** | Recipe command `white-space:pre` overflows on 390px | `pre-wrap` + `overflow-wrap:anywhere` for prose cmds |
| 10 | 🟡 | E/G | **fable** | EN links to zh-TW deck unmarked | Label `(zh-TW)` |

### Copy alignment (both)

- Signature: freeze「今天，我們**發**隕石給 CEO。」(fable)
- Audience line: one freeze wording across Landing + StoryChrome (fable)
- Levels token claim: context-first, fee secondary (sol)
- EN “Install in 5 minutes” → “Open install guide” (sol)
- levels.md title 懶到哪一層 → 委派層級 (sol)

### Quick wins ordered (<2h start)

1. **Fix h1 CSS** + visual smoke (🔴) — ~15m  
2. `srcExclude` + remove search + move logo compare html (fable 2–3) — ~20m  
3. Install command honesty + day-one CTA path (sol 3) — ~20m  
4. Levels copy + signature/audience freeze (fable) — ~20m  
5. Mobile command wrap + light contrast + scroll-margin anchors — ~25m  
6. EN deck language labels — ~10m  
7. **Push** only after 1–3 (or with them) — your call  
8. Landing dual-timeline rewrite + Proof receipts — next loop if time

### Out of scope (agreed)

IA restructure `/start`·`/reference/*`; Demo state-machine rewrite; logo redesign; invent metrics; full EN marketing rewrite; custom.css full split.

---

## Fable (complete)

證據蒐集完成。整理成最終 review 報告。

---

# Autopilot 產品站 loop review（commit `4225985`）

## 1. VERDICT：**FIX-THEN-SHIP**

品牌線、巢狀 loop 敘事、DAY-2-SPLIT、logo、行動版與暗亮雙主題的體質**都已到位**；但「網站根本還沒推上線」加上「內部工作文件被打包成公開頁、而且是站內搜尋唯一搜得到的內容」兩件事，必須先修再談上線。

---

## 2. TOP 5 Findings

### 🔴 1 · 轉換路徑（E）· 網站尚未部署——所有轉換價值目前為 0
- **Where**: `git status` → `develop...origin/develop [ahead 1]`；`4225985`（唯一的 website commit）只在本地。`https://cookys.github.io/autopilot/` 實測 **404**；`.github/workflows/website.yml` 觸發條件是 push（develop/main 皆可），從未跑過。
- **Fix**: push develop → 確認 Actions `website` job 綠 → curl 200。我沒有替你 push（發布是對外動作），這是唯一需要你出手的一步。

### 🟠 2 · 誠實／品牌（G/F）· 10+ 份內部工作文件被建成公開頁面
- **Where**: `website/` 根目錄的工作 md 全部進了 build——dist 裡實際存在 `NARRATIVE.html`、`WEEKLY.html`、`TA.html`、`LOOP-REVIEW.html`、`LANDING-UX-PANEL.html`、`DAY1-UX-PANEL.html`、`GROWTH-PANEL.html`、`PANEL-ENG.html`、`LOGO-PANEL.html`、`README.html`，另外 `website/public/logo-compare.html`、`logo-plane-compare.html` 逐字複製到 dist 根。
- **Problem**: 這些頁面以 VitePress 預設 doc 樣式渲染——正是 NARRATIVE.md:71 明令禁止的「內頁退回 doxygen」；且 WEEKLY／TA／panel log 是定位工作紀錄，不該當公開產品頁被 Google 收錄。
- **Fix**: `config.mts` 加一行 `srcExclude: ['NARRATIVE.md','WEEKLY.md','TA.md','README.md','LOOP-REVIEW.md','*-PANEL.md']`；兩個 logo 比較 html 移出 `public/`（例如 `website/_dev/`）。Landing footer 的「敘事定稿」連到 GitHub blob（`Landing.vue:185`），不受影響。

### 🟠 3 · IA／導航（A）· 站內搜尋是「反向的」：產品文案搜不到，只搜得到內部文件
- **Where**: `config.mts:61-63` 開了 local search，但全站文案都住在 Vue 元件裡，md 殼只有 frontmatter。實測 build 出的索引：EN 索引 `@localSearchIndexroot.*.js` 中「隕石」×29、`worktree` ×1——**全部來自上面那批內部 md**（元件裡幾十次的 worktree 一個都沒進索引）；zh 索引連「快速安裝／委派／onboard」都是 **0 筆**。
- **Problem**: 訪客打開搜尋，得到的不是空白就是 WEEKLY／panel 內部筆記——比沒有搜尋更糟。
- **Fix**: 本輪直接拿掉 `themeConfig.search`（修完 #2 後索引近乎全空，留著只剩誤導）；「文案回 md 或建 md 鏡像」留給下一輪。

### 🟠 4 · 文案／排版（D/C）· Levels 頁「前因／後果」欄是斷句碎片牆
- **Where**: `LevelsPage.vue:198-216`（zh）、`:241-259`（EN）。後果欄 8 顆 bullet 裡有連續斷句：「附加：Claude Code 的 Fable 等高智慧模型就緒後」→「最聰明的腦只坐主腦做規劃協調」→「省 token／fee」——一句話被切成三顆點，單顆讀起來像沒寫完。且「前因／後果」是 recipes 的 cause→effect 卡語意，搬到 levels 變成「什麼的前因？」。
- **Fix**: 見下方 COPY fixes #3、#4。

### 🟡 5 · 轉換路徑（E）· EN 頁面連到 zh-TW 專用 deck 卻沒標語言
- **Where**: `Landing.vue:630-633`（`Workshop hands-on`）、`InstallPage.vue:11-14` 的兩個 DECK 常數 + `:89`（EN sourceText）+ `:449`（`Open workshop deck`）——全部指向 `deck3-fable5.zh-TW.html`（連結本身活著，實測 200）。
- **Problem**: EN 訪客點「Workshop hands-on」進到整份中文投影片，會以為走錯地方。
- **Fix**: EN 文案補 `(zh-TW)` 標記，例：`Workshop hands-on (zh-TW)`／`Open workshop deck (zh-TW)`。誠實標示即可，不必藏。

---

## 3. COPY fixes（zh-TW 優先，7 條）

1. **簽名對齊凍結**（`Landing.vue:19` badge2）：NARRATIVE.md:23 與 TA.md 凍結簽名是「今天，我們**發**隕石給 CEO。」，站上寫成「今天，隕石**丟**給 CEO。」
   → `badge2: '今天，我們發隕石給 CEO。'`（EN `:191` 已是 hand，免改）
2. **受眾句三版本收斂成一版**：`Landing.vue:18`「被雜事跟 AI 一堆 diff 收尾搞到很煩的人」vs `StoryChrome.vue:84`「被雜事跟 AI 產出搞到爆的人」vs 凍結「快被雜事跟 AI 產能壓垮的人」。三個 surface 三種寫法會被讀成隨手寫。
   → 全站統一採凍結版：「給想當 CEO 的人 · 也給快被雜事跟 AI 產能壓垮的人」。
3. **Levels 欄位標題**（`LevelsPage.vue:197,208`）：
   → 「前因」→「**為什麼要分層**」；「後果」→「**分層之後你得到什麼**」（EN：`Cause`→`Why levels exist`、`Effect`→`What you get`）。
4. **Levels 後果欄碎片合併**（`LevelsPage.vue:209-216`），8 顆 → 4 顆完整句：
   ```
   選層級＝選「多少工作離開主腦 ctx」。
   附加紅利：Fable 這類高智慧模型只坐主腦做規劃協調，機械實作卸給較省的異質引擎——省 token 也省 fee。
   你平常只在進場設紅線，真卡死才補一句。
   GATE 不因層級變鬆。
   ```
5. **Landing loopFoot 內部口吻外漏**（`Landing.vue:124`）：「——那是附錄，不是這頁主菜」是講給 panel 聽的設計規則，不是講給訪客聽的。
   → 「巢狀 loop 與工程狀態總表收在「完整流程」，當工程附錄看。」（EN `:295` 同步：`Nested loops + the full state table live on Demo, as the engineering appendix.`）
6. **「交第一槍」**（`InstallPage.vue:133`）：台灣慣用語是「開第一槍」。
   → 「冷啟動穩了，再開第一槍」。
7. **EN "leave the chair" 不夠自然**（`Landing.vue:193` h1b、`:240` autoTag、`StoryChrome.vue:57`）：
   → `Autopilot lets you step away.`／autoTag `Step away`（三處一起換，維持一致）。

---

## 4. UX fixes（7 條）

1. **`config.mts` 加 `srcExclude`**（對應 Top-2）——一行擋掉全部內部頁。
2. **移除 `themeConfig.search`**（`config.mts:61-63`，對應 Top-3）。
3. **`public/logo-compare.html`、`logo-plane-compare.html` 移出 public/**——public 目錄逐字進 dist 根。
4. **light 模式表頭對比**（`custom.css:2306-2312`）：`.eng-table th` 的 `background: rgba(0,0,0,0.25)` 疊在白底 ≈ `#bfbfbf`，配 `--text-3: #475569` 的 0.72rem 大寫字約 4.07:1，低於 AA 4.5。
   → 加 `html:not(.dark) .eng-table th { background: rgba(15, 23, 42, 0.05); }`。
5. **補 og:image**（`config.mts:27-40` 只有 og:title/description/type）：現在分享連結是純文字卡。做一張 1200×630（飛機 logo + 簽名句）放 `public/assets/og-card.png`，加 `og:image` + `twitter:card: summary_large_image`。
6. **補 `sitemap: { hostname }` 與 `public/robots.txt`**——兩行，配合上線。
7. **`config.mts:23-25` 註解與行為不符**：註解說 `appearance: 'dark'`「respects system preference when unset」——VitePress 的 `'dark'` 是無視系統偏好、預設暗色（跟隨系統的是 `true`）。暗色優先是對的產品選擇，**改註解就好**，別改行為。

---

## 5. OUT OF SCOPE（這一輪不做）

- **IA 改版**：GROWTH-PANEL 的 `/start`、`/autonomy`、`reference/*` 收納——下一輪獨立做。
- **Demo 狀態表逐格對 SSOT 重驗**：前幾輪（LOOP-REVIEW.md R1-R4）已做過，本輪抽查未見矛盾。
- **搜尋的「正解」**（文案回 md 或建索引鏡像）：本輪先關掉止血。
- **`custom.css` 拆檔重構**：4586 行單檔可維護性是真議題，但風險大於本輪收益。
- **EN 全站行銷級潤稿**：只修最刺眼的自然度點（見 COPY #7）。
- **deck 內容 vs 網站敘事的保鮮審計**：屬 upstream-freshness 議題，另開。

---

## 6. QUICK WINS（依序，總計 < 2 小時）

1. **push develop**，確認 `website` workflow 綠、線上 200（約 15 分，唯一需要你決定的動作）
2. `srcExclude` + 移走兩個 logo html（15 分）
3. 拿掉 local search（5 分）
4. EN deck 連結補 `(zh-TW)`（10 分）
5. 簽名句 + 受眾句對齊凍結（10 分）
6. Levels 標題與後果欄改寫（20 分）
7. light 表頭對比 CSS 一行（5 分）
8. og:image + sitemap + robots（20 分，og 圖另需產一張）

---

## 附：本輪驗證通過、不用動的東西

巢狀 loop 敘事（人只在外圈）與凍結一致；write ≠ review、artifact-not-self-report 全站貫徹；DAY-2-SPLIT（landing day1/day2 卡 + `/install#day-one` `#day-two`）齊全；logo 三檔（light 石板/dark 銀、amber 只在尾焰、無鳥嘴，SVG 內註解自證）與 favicon 正確；footer「Cookys / Stranity」無姓氏；landing 無狀態機傾倒；無假數據、multi-harness 誠實不吹對等；無中國用語；RWD 覆蓋完整（含 `recipe-ce` span-2 的 900px 重設）；圖片資產最大 280KB；deck 與 Stranity 外連實測皆活。

`★ Insight ─────────────────────────────────────`
這輪最大的教訓是 **VitePress 的兩個隱形預設**：(1) source 目錄裡「每一個 md」都會變成公開頁，工作文件放 `website/` 根目錄等於直接發布——要嘛 `srcExclude`，要嘛搬去 `docs/`；(2) local search 只索引 md 管線的內容，全 Vue 元件的站等於自願放棄搜尋——這是「文案住哪裡」的架構決策，不是開關問題。
`─────────────────────────────────────────────────`

兩個需要你拍板的點：**(a)** develop 要不要現在 push（我不代發）；**(b)** 搜尋是「先關」還是你想這輪就做 md 鏡像（我建議先關，md 鏡像成本高且會產生雙份文案要保鮮）。


---

## Codex / sol (complete)

## 1. VERDICT

`FIX-THEN-SHIP` — the product story and visual system are fundamentally sound, but a site-wide CSS rule hides every hero headline, and the landing/conversion path still diverges from the frozen narrative.

Coverage: all priority files and routes, plus Philosophy, Proof, Skills, and Multi-harness. Rendered the five priority zh-TW routes at 390×844, both themes on Landing, and desktop light mode on Install. Architecture/Roadmap and a full English visual pass were not audited.

What passes: top navigation exposes Demo, Levels, Recipes, and Install; `/autopilot/` base/locale links work; no priority route has page-level mobile overflow; light/dark aircraft logos switch correctly; favicon geometry has no amber beak; the Cookys / Stranity footer is correct. Workshop links [#9](https://cookys.github.io/ai-coding-slides/deck3-fable5.zh-TW.html#9) and [#18](https://cookys.github.io/ai-coding-slides/deck3-fable5.zh-TW.html#18) resolve and match the cited material.

## 2. TOP 5

1. 🔴 Critical · B/C/D · [custom.css](/home/codepower/projects/autopilot/website/.vitepress/theme/custom.css:1241) · The global `.vp-doc h1 { display: none }` also hides every component hero `<h1>`. Landing, Demo, Levels, Recipes, and Install all rendered with `display:none`, zero height, and no accessible page heading. Fix by scoping the rule to direct Markdown headings, such as `.vp-doc > h1`, or removing it; add a route smoke check asserting one visible `<h1>` per page.

2. 🟠 Major · D/E · [NARRATIVE.md](/home/codepower/projects/autopilot/website/NARRATIVE.md:20), [Landing.vue](/home/codepower/projects/autopilot/website/.vitepress/theme/components/Landing.vue:434) · The frozen landing centerpiece is “同一張工單、兩種一天,” but the implementation repeats the nested-loop abstraction already shown on Demo. On 390 px, the page is about 7,462 px tall and day one starts more than 6,000 px down. Replace only this comparison section with the same-ticket, two-timeline story; keep rings and state detail on Demo.

3. 🟠 Major · A/E · [Landing.vue](/home/codepower/projects/autopilot/website/.vitepress/theme/components/Landing.vue:398), [StoryChrome.vue](/home/codepower/projects/autopilot/website/.vitepress/theme/components/StoryChrome.vue:60), [InstallPage.vue](/home/codepower/projects/autopilot/website/.vitepress/theme/components/pages/InstallPage.vue:299) · Landing and the pre-footer expose only `marketplace add`, while installation actually requires two commands. The day-one CTA then jumps to `/install#day-one`, past the full command block. Show both commands everywhere or show only an Install CTA; link first-time users to `/install`, with visible `安裝／第一天／第二天` anchors.

4. 🟠 Major · G · [ProofPage.vue](/home/codepower/projects/autopilot/website/.vitepress/theme/components/pages/ProofPage.vue:75), [MultiHarnessPage.vue](/home/codepower/projects/autopilot/website/.vitepress/theme/components/pages/MultiHarnessPage.vue:17) · The trust pages promise evidence and verified platform boundaries, but none of the claims links to a changelog entry, experiment result, corpus, or portability reference. Add direct receipts to each Proof claim and a compact skills/agents/hooks/delegation matrix on Multi-harness, including explicit “verified / unverified” states.

5. 🟠 Major · B/C · [custom.css](/home/codepower/projects/autopilot/website/.vitepress/theme/custom.css:1731), [RecipesPage.vue](/home/codepower/projects/autopilot/website/.vitepress/theme/components/pages/RecipesPage.vue:316) · Human-readable command examples remain `white-space: pre`. At 390 px, some blocks scroll to 763 px inside a 348 px container. Wrap prose-like commands with `pre-wrap` and `overflow-wrap:anywhere`; retain horizontal scrolling only for tables and ASCII diagrams.

## 3. COPY fixes

| Where | Replace with |
|---|---|
| Landing comparison lead | 「同一張工單，差別不是 AI 會不會寫。差別是：每個小規格都要你回來點頭，還是只有踩到紅線才找你。」 |
| Install day-one afternoon | 「第一天是校準，不是假裝已經全自動。你確認工作單與驗收標準。完整委派從第二天 `/l3` 開始。」 |
| Proof H2 | 「假設：把 review skill 塞進 reviewer 會抓得更準。A/B 結果：沒有提升。查看實驗資料。」 |
| Multi-harness hero | 「Claude Code 是完整路徑；其他平台只承諾下表已驗證的能力。」 |
| Levels token claim | 「主因是保住主腦 context。把機械實作卸給合適引擎時，token／費用也可能下降。」 |
| English CTA | Replace unsupported “Install in 5 minutes” with “Open install guide.” |
| [zh-TW/levels.md](/home/codepower/projects/autopilot/website/zh-TW/levels.md:3) title | 「委派層級」取代「懶到哪一層」，與導覽及頁面主題一致。 |

## 4. UX fixes

1. Restore one visible, semantic `<h1>` per route.
2. Replace Landing’s nested-ring section with a four-beat same-ticket dual timeline.
3. Create one reusable two-command install block; add copy buttons and first-use/day-one/day-two anchors.
4. Add `scroll-margin-top` to `#day-one` and `#day-two` so fixed navigation does not cover their headings.
5. Wrap recipe/trace commands on mobile; keep `.eng-table-wrap` and ASCII diagrams scrollable.
6. Promote visual `.eng-h2` paragraphs to real `<h2>` elements; cards remain `<h3>`.
7. Replace light-mode `#64748b` small text in [custom.css](/home/codepower/projects/autopilot/website/.vitepress/theme/custom.css:3748) with `var(--text-3)` or darker—the current combination is about 4.39:1.
8. Turn the custom `<footer class="lp-footer">` into a pre-footer `<section>` so the page has only one semantic `contentinfo` landmark. Re-enable internal dead-link checking in [config.mts](/home/codepower/projects/autopilot/website/.vitepress/config.mts:22).

## 5. OUT OF SCOPE

- Do not redesign the aircraft logo or add another mascot treatment.
- Do not simplify the Demo state machine; its engineering depth is intentional.
- Do not add invented adoption metrics, testimonials, stars, or timing claims.
- Do not restructure the whole IA into `/start` or `/reference/*` this pass.
- Do not claim cross-harness parity beyond verified capabilities.
- Do not rewrite Architecture or Roadmap during this correction pass.

## 6. QUICK WINS

1. Scope the hidden-H1 CSS rule and smoke-test all five routes — ~15 minutes.
2. Show both install commands and change the day-one CTA to `/install` — ~20 minutes.
3. Add command wrapping, anchor offsets, and the light-text contrast fix — ~25 minutes.
4. Apply the seven copy replacements, including removing “5 minutes” — ~15 minutes.
5. Add existing Proof/portability source links and correct the duplicate footer landmark — ~35 minutes.
6. After pushing `4225985`, recheck the public “敘事定稿” link; it currently returns 404 because local `develop` is one commit ahead of `origin/develop`.

Review only; no source files were changed.
