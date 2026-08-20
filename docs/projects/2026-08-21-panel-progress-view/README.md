# Panel progress view — plan-review 的 PANEL 層可觀測性

## Project Goal
> **Final goal**: 一條指令回答「哪席在飛、哪些完成、deadline 剩多少」— 對進行中的 plan-review panel。
> **Success criteria**: KR1 live 渲染(dispatch-status --panels);KR2 紅綠(stash 驗證舊碼紅);KR3 全套件綠 + preflight 8/8 + v2.34.31。
> **Scope boundary**: 含 panel manifest 發射 + 渲染 + 循序/併發之「決策」;不含併發實作、通知/喚醒、席位語意變更。

## Coverage ledger(plan §4)
P1 manifest 發射 / P2 渲染 / P3 測試+docs+release。

## Progress
| Item | Status |
|---|---|
| Admitted deliverable: panel observability (P1-P3) | in progress |

Plan: ../../plans/2026-08-21-panel-progress-view.md
