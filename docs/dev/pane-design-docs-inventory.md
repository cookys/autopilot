# Pane、band 與待決頁設計文件盤點

## 指定資料摘要

- `docs/plans/evidence/2026-10-06-tui-band/README.md`：記錄先完成 TUI 再驗收的決策、單行 band、ⓘ 圖例、主題色規則，以及 codeforge 獨立產品與共用風格指南的分工。
- `e8a13e95d`：依 codeforge ux-v7 實作 O4 shell；進度列置於主視窗內，待決頁包含卡片列表、逐卡進度及 0/7/8/9 快捷列。

## 文件清單

範圍為指定目錄中受 Git 追蹤的 Markdown；排除僅以 panel 指稱評審席的無關命中。日期及 SHA 是各檔最近一次提交；摘要依各檔前 40 行。

| 路徑 | 日期 | SHA | 摘要 |
|---|---|---|---|
| `docs/plans/evidence/2026-10-06-tui-band/README.md` | 2026-11-03 | `1f627cc59` | 記錄 band TUI 的業主決策、圖例、主題色原則及實機探針。 |
| `docs/plans/evidence/2026-10-06-tui-band/spike-REPORT.md` | 2026-10-06 | `1e2b7626c` | 記錄終端 TUI 元件、色彩與互動探針。 |
| `docs/plans/evidence/2026-10-03-mods-spikes/S4.md` | 2026-10-04 | `532930ed1` | 記錄終端圖片在 ssh 和 tmux 下的呈現限制。 |
| `docs/plans/evidence/2026-10-03-mods-spikes/S8-band-timing.md` | 2026-10-05 | `187db51a1` | 記錄 live band 的互動更新時效探針。 |
| `docs/plans/evidence/2026-10-03-mods-spikes/S9-band-redesign.md` | 2026-10-05 | `3876955b9` | 描述以專案、階段、時間和進度回答回訪者問題的 band 改版。 |
| `docs/plans/evidence/2026-10-03-mods-visible-dispatch-design/inputs.md` | 2026-10-03 | `be21eac1d` | 彙整 mods 與工作回合檢視頁設計的輸入及業主決策。 |
| `docs/plans/evidence/2026-10-03-mods-visible-dispatch-design/owner-review-pages.md` | 2026-10-03 | `be21eac1d` | 整理業主審閱頁的靜態頁骨架及證據連結。 |
| `docs/plans/evidence/2026-10-03-mods-visible-dispatch-design/fable-proposal.md` | 2026-10-03 | `be21eac1d` | 提出一個生產者與三個消費者的工作回合紀錄設計。 |
| `docs/plans/evidence/2026-10-03-mods-visible-dispatch/u5-spike.md` | 2026-10-16 | `26aa05535` | 盤點 live pane 顯示目前工作與進度的限制。 |
| `docs/plans/evidence/2026-10-04-mods-p1c/hand-c3-brief.md` | 2026-10-04 | `526eeb399` | 定義以回訪者需求為中心的 band 改版工作。 |
| `docs/plans/evidence/2026-10-04-mods-p1c/wiring-inventory.md` | 2026-10-04 | `d99d21a64` | 盤點資料來源至 band、pane、toast 與審閱頁的接線。 |
| `docs/plans/evidence/2026-10-06-stage-graph/p7/contract.md` | 2026-10-10 | `4ca4f9e7a` | 定義 watcher 資料契約及 band 和 panel 文法。 |
| `docs/plans/evidence/2026-10-10-tui-followups/README.md` | 2026-10-10 | `59cf82ba9` | 記錄截圖、鍵盤分頁及支出圖的 TUI 後續探針。 |
| `docs/plans/evidence/2026-10-10-tui-v2/README.md` | 2026-10-10 | `4ca4f9e7a` | 記錄業主核准的 TUI v2 分頁、圖示、色彩和資訊圖設計。 |
| `docs/plans/evidence/2026-10-10-tui-v2/i18n.md` | 2026-10-10 | `4ca4f9e7a` | 提出 live TUI 國際化設計。 |
| `docs/plans/evidence/2026-10-10-tui-v2/ia.md` | 2026-10-10 | `4ca4f9e7a` | 提出 live TUI 資訊架構與視覺比較。 |
| `docs/plans/evidence/2026-10-13-live-pane/plan-review/README.md` | 2026-11-03 | `1f627cc59` | 索引 live pane 設計系統計畫的評審證據。 |
| `docs/plans/evidence/2026-10-13-live-pane/plan-review/rubric-g1a.md` | 2026-10-13 | `cf24f4032` | 列出 live pane 設計系統計畫的評審準則。 |
| `docs/plans/evidence/2026-10-13-live-pane/plan-review/rubric.md` | 2026-10-13 | `cf24f4032` | 列出 live pane 設計系統計畫的評審準則。 |
| `docs/plans/evidence/2026-11-17-pane-bottom-anchor/README.md` | 2026-11-17 | `dc70945fe` | 記錄 pane 底部定位及版面案例的修復證據。 |
| `docs/plans/evidence/2026-11-18-pane-batch1/chrome-report.md` | 2026-11-18 | `4b168ba7c` | 記錄 pane 外框與導覽列的第二輪 UX 工作。 |
| `docs/plans/evidence/2026-11-18-pane-batch1/round2-finish-report.md` | 2026-11-18 | `200296e90` | 記錄 pane 第二輪收尾與版面修正。 |
| `mods/live/design.md` | 2026-11-23 | `c71103976` | 說明 O4 band shell 版面、規則及 codeforge ux-v7 來源。 |
| `mods/live/docs/v74/SPLIT.md` | 2026-11-20 | `702c937e6` | 將 ux-v7.4 終端畫面設計分解為實作工作。 |
| `mods/live/docs/v74/fixture.md` | 2026-11-23 | `c71103976` | 定義 v7.3 截圖與設計稿共用的示意資料。 |
| `mods/live/docs/w1-host-row.md` | 2026-11-18 | `98cf58d03` | 釐清 pane 正文列與 host 外框的邊界及量測方式。 |
| `mods/live/evidence/pane-g2a2/EVIDENCE.md` | 2026-11-23 | `c71103976` | 記錄統一分頁導覽、過期資訊與頁框的 UX 驗收。 |
| `mods/live/evidence/pane-g2b2/receipt.md` | 2026-11-23 | `c71103976` | 記錄現況、艦隊與額度頁的版面和資料一致性修正。 |
| `mods/live/ux-gate2-evidence/receipt.md` | 2026-11-18 | `1ee946d61` | 記錄待決卡內容順序、短頁與主題色等 UX 驗收。 |
| `mods/live/x2b-evidence.md` | 2026-11-23 | `c71103976` | 記錄短頁面依嚴重度分配內容列的設計與驗收。 |
