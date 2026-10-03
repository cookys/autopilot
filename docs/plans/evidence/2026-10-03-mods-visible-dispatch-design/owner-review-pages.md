# 摘要（繁體中文）
1. 七個頁面全是「單檔、手寫 HTML、無框架」的靜態頁：python http.server 直出，資料與 SVG 內嵌，沒有 JSON 輪詢，更新靠重新產檔。
2. 共通骨架：頂部一句話結論或待決問題 -> 卡片/表格/並排圖 -> 證據連結（原圖 PNG、manifest、SHA256）；狀態用 PASS/FAIL/PENDING 色票徽章。
3. 決策頁（B04）把「要你回答的一句話」放最上面，選項列成 接受/不接受/先不決定，且附「這份裁決不做的事」與更正揭露；沒有任何按鈕或表單，裁決靠口頭回給 agent。
4. 對 autopilot 最有用的四塊：逐階段索引加狀態徽章（8460）、before/after 並排加數字表（B04/PERF）、一句話 callout 加時間軸（8790）、決策頁範式；全部可用靜態檔產生。
5. 建議：每專案一個 python http.server 目錄，日期/主題分資料夾，index.html 為索引；頁面第一屏放結論與狀態徽章；暗色/亮色變數與手機寬度沿用既有慣例。
6. 風險（只記錄不修）：全部明文 HTTP 或自簽 TLS（8460，CN=<lan-host>，到 2028-12）、無認證、python http.server 目錄可列出（5190 根目錄與日期目錄直接列檔）；頁面含內部路徑與 commit 雜湊。

# Owner review pages — read-only survey (2026-10-03)

Method: GET only (`curl -sk -m 15`), plus the Artifact tool `read` for the claude.ai page. Same-origin follow-ups, one level: 8460 (`comparisons/20261002/`, `progress/`), 5197 (`/` = wizhall index), 5190 (`/`, `/2026-09-15/`, `/2026-09-15/PERF-curtain-recheck/`). No forms submitted, nothing modified. Raw fetches saved in `.../scratchpad/research/f/`. No secrets or emails seen on the pages that were fetched. The Artifact read output did name a hotmail address in a different page (P2, MSN explainer, not the artifact); not reproduced here.

## Per-page findings

### 1. http://<lan-host>:8790/  "c4140 加速進度"
- Project and purpose: plan 069 Phase 2, making the local Qwen 3.8 Flash-Next model faster on dell-c4140 (4x V100). It is a plain-language progress report for the owner.
- Type: progress/status dashboard written as narrative, one page, "updated 2026-10-03 18:45" in the subtitle.
- Layout (top to bottom):
  - H1 plus subtitle (plan, update time, machine, service port).
  - A `callout` box with a one-sentence verdict ("what was gained, what the gate blocked, what is tonight's big item").
  - Numbered H2 sections. Each finding is a `.card` with a status tag in the title (`追查中` bad, `已修好` good, `解除`, `定案`).
  - Inline hand-written SVG: a timeline bar (normal run then server death then 9 failed), four-box run-vs-baseline strip, P vs P3 bar comparison with ms values, page-cache diagram.
  - KPI grid (`.grid .kpi`): big number, label, delta in green (e.g. decode 25.89 ms, 8.4% faster).
  - A vertical `.timeline` list with state classes `done / now / void` for the overnight chain schedule.
  - Footer "sources" naming CEO-LOG.md, `/data/bench/ab/chain*.out`, `parity-*.json`.
  - A legend of quality rules E1/E2/E3 (verbatim-identical, distribution-equal, quality-for-speed that only the owner may decide).
- Data source: static, hand-typed into the HTML (numbers in text and SVG). No script.
- Served by: Python 3.14 `SimpleHTTP/0.6` (http.server), HTTP/1.0, no auth.
- Interactivity: none (only light/dark via `prefers-color-scheme` plus `data-theme` override tokens).
- Fast-review devices: one-sentence callout first; every finding carries a PASS/FAIL-style tag; explicit "invalid result" markers (`void`); KPIs with deltas; "what is running now" timeline with a `now` dot and end time.

### 2. https://claude.ai/artifact/MNcLywhxk5EdqLoZpzRVSd  "KV Cache 校準"
- Purpose: explainer for the same c4140 effort (FP8 E4M3 KV-cache scale calibration on V100, with calibration pack, three approaches, bench table).
- Type: explainer plus embedded interactive instrument, published as a private claude.ai artifact (no capabilities declared, no runtime contract pin).
- Layout: single 46rem reading column, eyebrow line (machine, GPUs, model), H1, lede, then H2 sections: why FP8; what E4M3 looks like (bit-field chips); interactive lab; per-layer table; three approaches table (chosen row highlighted `tr.pick`); why corpus matters; "how far we got" numbered steps; bench table FP16 vs E4M3 first vs E4M3 fixed; footer with sources.
- Data source: embedded JS array (24 per-layer K/V entries from the published calibration manifest), synthetic samples generated client-side; canvas histogram.
- Served: claude.ai artifact (Google Fonts only). 
- Interactivity: yes, client-side only: layer `<select>`, scale slider, preset buttons (calibrated / 1.0 / too small / too big), live readouts (saturated %, zero %, coarse %, RMS error) and a one-line verdict. No persistence.
- Fast-review devices: analogy callout; "pick" row highlighted in the options table; before/after bench columns with ranges; honest caveat on what is simulated vs raw.

### 3. http://<lan-host>:8765/  "MSN 紀錄解密原理"
- Purpose: teaching page for a separate fleet job (factoring RSA moduli with GNFS/CADO-NFS to recover MSN Plus! logs); explains why sieving "collisions" (duplicate relations) are normal.
- Type: long-form explainer with a status diagram.
- Layout: H1, yellow "lead" box answering the exact question asked, TOC `nav`, 8 numbered H2 sections (idea, GNFS flow, lattice sieving, collisions, excess, ETA, glossary), tables in scroll wrappers, figures with captions, one SVG flow diagram of the 6 GNFS steps with a "you are here" marker and a failure-loop arrow, plus a "fleet status" note (idx0-4 in sieving).
- Data: static text and SVG; no scripts, no fetch.
- Served: Python 3.13 http.server.
- Interactivity: none (anchor TOC only).
- Fast-review devices: the lead box answers the question first; "you are here" marker; ETA section; glossary.

### 4. https://<lan-host>:8460/  "Test-game NFS convergence stages"
- Purpose: evidence gallery for the Harbor Run (NFS-style racing game) visual-quality convergence effort; one directory per stage (`stages/stage-NN-.../index.html`).
- Type: index of evidence/recheck reports with navigation banners to the latest comparison and the progress/Gantt page.
- Structure:
  - Two boxed banner links at top: latest comparison (`comparisons/20261002/`, "before/after side by side") and progress (`progress/`).
  - A flat `<ul>` of ~40 stages: link, status span (`status-pass/fail/pending/unverified` = green/red/amber/grey), 12-char commit hash in `<code>`, ISO timestamp, backend (webgpu/webgl/OFFLINE Blender).
  - Raw status strings are shown unnormalised (`COMPLETE_WITH_SOURCE_AUDIT_FAIL`, `FAILED_HANDOFF`, `UNVERIFIED`, `HOLD_...`); most non-PASS values still get the amber "pending" class. Only the status is coloured, there is no summary count at top.
- Sub-pages (one level):
  - `comparisons/20261002/` (~150 KB, no JS): header chips (freeze date, source commit, "91 side-by-side pairs - 135 raw images", current game build, "partial improvement integrated - AAA still FAIL"), then ~41 sections each with a headline, one paragraph, then a `.pair` of figures (before vs after, per backend WebGPU and classic WebGL), each figure with a dimension line and a full SHA-1/256 under the caption, original PNG linked on click.
  - `progress/`: dark page; three status cards ("playable base built", "NFS quality 0/6" in red, "implementation blocked"); `history-gantt.svg`; a 7-row "distance to done" table (work package / still to do / status); dependency order; links to stage evidence; `progress.json`; honest "UNVERIFIED" note; footer disclaiming what is not exposed.
- Data source: static generated HTML; `progress.json` is linked but not fetched by the page.
- Served: Python 3.14 http.server over HTTPS, self-signed cert (CN=<lan-host>, valid to 2028-12-22). Needs `-k` / browser warning.
- Interactivity: none (links and click-to-zoom).
- Fast-review devices: banner to "latest", coloured status per stage, hash per stage, side-by-side same-camera pairs with checksums, a red "0/6" headline instead of a percentage.

### 5. http://<lan-host>:5197/bmw-b04-decide.html  "BMW B04 - 已裁決：接受"
- Purpose: owner decision page for a car-model (BMW) geometry change on the "wizhall" line: is the trunk-seam change acceptable?
- Type: decision page (now resolved; the verdict is kept at the top, dimmed question below).
- Layout: dark single column (max 1100 px). Header with breadcrumb links to wizhall progress and the B03 shoot page. Top green verdict card (date, verbatim owner quote, what the verdict changes in the data, and "what this ruling does NOT do"). Dimmed `.q` box: "the one sentence we need you to answer". Two figures (rear, rear 3/4), each a single JPEG composite (full-frame before/after, yellow boxes where change was measured, 4x zoom of the seam) plus links to original before/after PNGs. A pixel-count table per camera (changed px >2/255 and strong >32/255; 12 cameras, only 2 changed). A red "correction after the ruling" box disclosing a transcription error in the table and offering to revoke. The coordinator's visual observation is placed after the images and labelled "one observer, not a verdict". "What your choice decides": three `.opt` boxes (accept / not accept / defer) with consequences and remaining attempt budget. A record footer cites `decision_sheet_manifest.json` with all 25 file SHA256 verified.
- Data: static; images and manifest are files under `bmw/b04_decision/`.
- Interactivity: none. The decision is communicated out-of-band (the owner's words are pasted into the page afterwards).
- Fast-review devices: question and options are explicit; evidence before opinion; numeric table but with a rule not to argue from pixel area; errata disclosed.

### 6. http://<lan-host>:5197/bmw-b03-shoot.html  "BMW B03 - 補拍 14 張"
- Purpose: capture instructions to the owner/operator: 14 reshoot photos of a car rear door, each shown as a simulated-camera guide render.
- Type: shoot/capture checklist page.
- Layout: dark, same CSS family as B04. Breadcrumb links (wizhall progress, B04, contact sheet JPEG). Red `.warn` box with the three things that waste a shoot (no messenger apps, no crop/filter/flip, lighting); green `.good` box with "work-saving" facts (right side only 09-14, one photo may cover several IDs, batches allowed); a "left/right definition" box. Then an auto-fit `.grid` of 14 `figure`s: guide PNG (click for full), id such as `L-OPEN-02`, tag (door closed / open 45 deg), a one-line shot description, side, lens mm, door angle. Anchors per ID.
- Data: static. Served the same way as 5.
- Interactivity: none.
- Fast-review devices: pre-flight warnings first; every shot individually addressable by anchor; contact sheet for one-glance review.

### 7. http://<lan-host>:5190/2026-09-15/PERF-curtain-recheck/index.html  "Curtain threshold re-measurement"
- Purpose: performance re-measurement for the Real-World 3D (webgpu) loading curtain: does `curtain_async_ratio` 0.7 vs 0.9 still matter after patch P02?
- Type: evidence/recheck report.
- Layout: light page. Two coloured `.conclusion` boxes at top: an orange "this is informational, no decision needed, threshold stays 0.7" and a green "result: 0.7 and 0.9 equally fast (median 32.4 s vs 32.9 s), real blocker is another ~10 s, handed to the 110 line". Then numbered H2 sections: (1) 6-row readings table by arm; (2) comparison across three measurement phases with deltas; (3) timeline with plain-language summary, then `<details>` "engineering details (skip)" that holds code references with file:line and a per-run table; (4) cost screenshots, `.pair` flex grids of GPU-readback captures per camera spot and time point (arm x at-lift/+4 s) with a prose "what I saw" note; paths list at the end (small grey text).
- Data: static HTML tables; images are sibling PNGs. Served by http.server.
- Interactivity: `<details>` only.
- Fast-review devices: "needs a decision / does not need a decision" stated first; conclusion in two lines; plain summary before engineering detail; same-arm A/B image pairs.
- Index context: `http://<lan-host>:5190/` is a small "owner 目檢" page (original-size A/B image rows, "full evidence directory" link); `/2026-09-15/` is a bare python directory listing of ~16 job-named folders. So the date folder is itself the index, with no curated page per day.

### Also seen: http://<lan-host>:5197/ (wizhall index, linked from B03/B04)
- Large (83 KB) generated page, "由 build.py 產生" (generated by a script, timestamp in the banner): "current progress" opinion box (long bold narrative, verdict, numbered next-cut rules), a coordinator's image opinion section, reference-image comparison, then "round by round (newest first)" with 165 `<img>`; one small script (drag-to-compare between rounds, described as "drag left/right to compare round 35 left vs round 36 right"). Same dark CSS family as B03/B04.

## Synthesis

### 1. The owner's de-facto review-page pattern
- Single self-contained HTML file per page: inline CSS, optional inline SVG, almost no JS (only the artifact lab and the wizhall slider use it). Opens instantly on a phone.
- Human-language conclusion first (callout, lead, conclusion box, verdict card), evidence second, engineering detail folded or last. Pages say explicitly whether the owner must decide ("這頁是知會，不需要你做決定" vs "要你回答的就這一句").
- Status vocabulary with colour: green/amber/red tags (PASS/FAIL/PENDING/UNVERIFIED, 已修好/追查中/作廢). Invalid results are shown (void/strikethrough) instead of removed.
- Evidence is linkable and checksummed: original-size PNG on click, manifest JSON, SHA hashes, commit hash chips, source file list in footer.
- Comparison shape: same camera, same resolution, before left / after right (flex or 2-column grid), A vs B arms, plus a small numbers table. Opinion is placed after the images and labelled as one observer's view.
- Honesty blocks: "what this does not do", errata after the verdict, "UNVERIFIED" for what the author could not check.
- Plain-language Traditional Chinese, short sentences, subject stated, spec/jargon demoted into `<details>` or tables.
- Visual conventions: dark or light with CSS variable tokens and `prefers-color-scheme`, max-width 760-1100 px reading column, rounded cards, `auto-fit minmax()` grids, tabular numerals.
- Update model: regenerate and overwrite (build.py or hand-written), with "updated YYYY-MM-DD HH:MM" at top; no live data, no auth, no state.
- Serving model: a Python `http.server` per project on a LAN host/port; date-named folders under a root (`2026-09-15/<job>/index.html`); an index page per project (8460 stage list, 5197 round list) and "latest" banners.

### 2. What maps to autopilot's needs
| Autopilot need | Existing pattern to copy |
|---|---|
| Per-round / project / phase / result status | 8460 stage index (row = id, status tag, commit chip, timestamp, backend) plus a "N of M" headline in red/green (progress page "0 / 6"); 8790 `.timeline` with `done/now/void`. Improve: add a count-by-status line at the top, which 8460 lacks, and normalise status strings to a small set. |
| Dispatch status (who is running, how long, last result) | 8790 overnight chain timeline with a `now` dot and "ends ~21:30"; KPI tiles. Needs a data-fed table (engine, role, started, elapsed, last verdict) because none of these pages shows live elapsed time; they were hand-updated. |
| Visual compare (before/after, diff, metrics) | B04 composite JPEG (full + 4x zoom + changed-region boxes) with original PNG links and a per-camera changed-pixel table; 8460 comparison pairs with dimensions and SHA under each figure; PERF page same-arm pairs plus a readings table. |
| Decision pages (owner picks A/B) | B04: one-sentence question, evidence before opinion, three options with consequences (accept / reject / defer), "does not authorise" list, errata and revoke path, manifest hashes. There is no button; the answer is typed back to the agent and then recorded on the page as a verbatim quote. |
| Evidence trail | Footer sources (8790), manifest + SHA256 (B04), commit chips (8460), `progress.json` link. |

### 3. Recommended conventions for an autopilot-generated review page
- Serving: static files only; one `python3 -m http.server --bind <LAN ip or 127.0.0.1>` per project root (matches 8790, 8765, 5190, 5197, 8460 exactly). Pick a port per project and record it in the project README. Offer plain HTTP by default; HTTPS with a self-signed cert only if the owner already runs it.
- URL scheme: `/<YYYY-MM-DD>/<job-or-round-id>/index.html` (as in `5190/2026-09-15/PERF-curtain-recheck/`), root `index.html` as the project index, optional `/latest/` redirect or banner link to the newest round. Keep sibling assets (png, json, manifest) next to the page with relative links so a folder copy is portable.
- Project index (`/index.html`): header (project, last updated time, commit); a one-line headline with counts (e.g. "6 rounds: 3 PASS, 2 FAIL, 1 running"); a table or list per round with status tag, commit chip, timestamp, engine/seat, and link; banner links to latest report and to the currently open decision.
- Round page skeleton, in this order:
  1. Title and "updated" time.
  2. One or two coloured conclusion boxes: result sentence, and whether the owner must decide ("需要你決定" or "知會，不需要決定").
  3. If decision: the single question, then options with consequences, then a "this ruling does not authorise" list.
  4. Evidence: before/after or A/B pairs (same camera and size, original linked), metrics table with deltas.
  5. Dispatch/status strip: who ran, how long, last result, unverified items marked `UNVERIFIED`.
  6. `<details>` engineering detail (diff stats, file:line, command lines).
  7. Footer: sources and hashes (repo paths, commit, manifest), and "what this page does not claim".
- Style: reuse the shared token set (`--bg --card --ink --muted --line --good --bad --warn --accent`), light/dark via `prefers-color-scheme` plus `data-theme`, `max-width` 920-1100 px, 16 px gutter, `lang="zh-Hant-TW"` for owner-facing text, tags as pill spans (good/bad/warn/acc), SVG inline for timelines.
- Generation: a script emits the HTML from a JSON of record (like wizhall's build.py and `progress.json`), so the page is derived from the repo state rather than hand-written. Per ADR-0001, the page should show re-derived evidence (hashes, artifact paths) rather than attestations.
- Decision capture: since existing decision pages have no controls, keep the "owner replies in chat; agent records verbatim quote and date back onto the page" loop; do not add forms or write endpoints.

### 4. Risks (noted, not changed)
- Every host is plain HTTP except 8460, which uses a self-signed certificate (CN=IP, issuer same, not before 2026-09-19, expires 2028-12-22); the progress page itself says the sandbox refused LAN HTTPS, so cross-environment verification is unreliable.
- No authentication or access control on any page. If the servers bind 0.0.0.0 (not verifiable from this host; I did not probe sockets remotely), any LAN peer can read them.
- python `http.server` exposes directory listings (confirmed for `5190/` date folder `2026-09-15/`, which lists 16 job folders) and also serves any file under the root, including sibling manifests and raw evidence.
- Pages disclose internal paths (`/data/bench/ab/chain*.out`, `docs/projects/...`), commit hashes, model/engine names, and a mailbox-style path in the MSN explainer (not reproduced). The Harbor progress page claims it does not expose repo or login data, which is a statement, not a check.
- Content staleness: pages are hand-regenerated, so "updated" timestamps are the only freshness signal (8460 progress is dated 2026-10-01 while stage list reaches 41; 8790 says 18:45 while the schedule says chain10 in progress). An autopilot generator must stamp the generation time and the commit.
- The artifact page loads Google Fonts from a third party (design guidance requires this; just note it).
- Decisions recorded on pages are copied by an agent, not signed; B04 shows a real transcription error that the owner's verdict was based on. A generator should copy numbers from the machine-readable result rather than retyping.
