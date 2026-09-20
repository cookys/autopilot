# Durable repair-lock — 解鎖路徑先行,鎖才准回來(P6D KR3 的第二階段)

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: 無狀態拒絕被實測繞過(terminalization 之外的路徑把 BOUNDARY_REJECTED campaign 排水/succession 掉而未修復 —— 例如 host 直驅 reducer 的 no_effect_release);或 engine_terminal_evidence 欄位在真實終局分類點被接線(目前是死欄位)。
- **Context**: v2.34.32 原出貨 durable claim-bound repair lock + 四 Mission 後盾,pre-merge review 兩枚 🔴 殺掉:解鎖路僅存於 mission-v2 ready/follow_up 排水(legacy receipt 永無解)、bypass enum 欄位無生產寫入者(死碼)、projection roundtrip 不攜帶 lock(PROJECTION_HASH_MISMATCH 毒工件)、no_effect_release 一發繞過全部後盾、finalize-abort 冪等被打破。重來的入場條件(缺一不可):(1) engine-derived terminal evidence 在真實分類點接線且**能清除既有鎖**;(2) legacy receipt 顯式處理;(3) buildProjection/restoreProjection 條件式攜帶 + roundtrip fixture;(4) no_effect_release 拒絕帶鎖 claim(與 (1) 同時);(5) 鎖寫入前置(claim 非 terminal/released、mission 非 terminal)+ CLI 冪等分支順序;(6) 帶鎖 mission 可經 enum 抵達終局的 planted 測試。證據:reviewer 報告(probe-roundtrip/hashcompat/lockwrite/escape/idem 五腳本,project archive)。
- **Effort**: L(設計 + 六前置 + 測試)
- **Source**: 2026-08-21 pre-merge review(autopilot:reviewer);`docs/projects/_archive/2026/08/2026-08-21-p6d-corrective-gates/`(歸檔後)。

