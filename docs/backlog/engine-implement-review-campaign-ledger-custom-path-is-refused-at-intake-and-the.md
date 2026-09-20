# `engine implement-review --campaign-ledger <custom path>` is refused at intake and the refusal burns a grant attempt

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14


- **Trigger**: **FIRED — measured 2026-09-14**: `campaign_ledger_path_mismatch` ("must be the repository-wide canonical Git common-dir ledger"); the claim for attempt 1 was consumed and `mission grant` minted attempt 2.
- **Context**: the flag exists in `--help` but only one value is accepted; either drop the flag or make intake validate it before the claim is spent.
- **Effort**: Fix.
- **Source**: this dogfood.

**Discovery**: when starting any work, `grep <topic>` here. Plan-doc-as-roadmap (`docs/plans/_archive/2026/05/2026-05-14-retro-roundup.md`) post-archive 後遷移 entries 也都歸這裡。

## Audit snapshot（2026-08-28，post lifecycle-hygiene sweep）

- **65 real entries**：2 個 Board decisions、63 個 trigger 尚未成立的 conditional work；`<Topic title>` 範例不計入。
- Platform capability trigger activation 的 D1 closed claims、D2 agy structured usage、D3 Codex production recovery 與 D4 strict-L5 trust root 已由 depth 0 驗證完成，依 lifecycle hygiene 從 backlog 刪除而非保留完成態條目。
- 14 個 technical gaps（A01–A14）已由 [`next-touch-debt-retirement`](projects/_archive/2026-08-03-next-touch-debt-retirement/README.md) D1–D8 核銷並自本檔刪除。
- 14 個 struck-through RESOLVED/SHIPPED entries（2026-08-18 至 2026-08-27 累積）依同一 lifecycle hygiene 規則從本檔刪除（history 留在 CHANGELOG／git）；一個混合條目（`Contract-first escalation and local-repair gates`）因 class (a) 仍未出貨而保留。
- 63 個 conditional entries 主要是四類：等待仍未出現的外部平台／runner contract、等待 telemetry／事故樣本達門檻、等待新 runner／consumer，以及未來擴大 threat model／自動復原範圍才需要的 hardening。

---

