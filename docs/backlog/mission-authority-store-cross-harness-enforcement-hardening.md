# Mission authority store 與 cross-harness enforcement hardening

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: 需要把 Mission `enforce` 宣稱擴到目前未有 executable blocking adapter 的 harness，或 threat model 升級為防止惡意 same-UID worker 刪改 `.git` 內 registry/state；若只是誠實 agent 的 branch/session reset，v2.34.0 local registry 已足夠。
- **Context**: 本次只實作 current-host 可驗證的 Git-common-dir durable registry、CAS 與 fail-closed adapter。防惡意本機程序需要獨立 UID、root-owned/remote daemon 或具 authenticity 的 authority service；精確 provider token/tool/cost telemetry 也只能在 host 真能觀測時加入。未有實證前不得用 HMAC、自述 counter 或 skill prose 假裝形成安全邊界。
- **Effort**: L
- **Source**: 2026-07-28 Mission P1/P2 parity audit與獨立 Architect/Ops/Skeptic review；`governance-correction.md`

## 2026-10-21 eunavail follow-up

- **Context**: `provider_error` 且來源為 `harness_structured`（eunavail 引入，develop `1049739fd`）來自 cc-shim 信封暫存檔。同一 UID 的 worker 可以偽造該檔，再殺掉自己的 claude 行程，把 FAIL 變成 `infra_abort`。這與本條目相同的 same-UID 威脅模型缺口，已記在 `docs/plans/2026-08-22-implementer-qualification-suite.md` 的 Addendum。
- **Source**: eunavail g1 6cfe9f98

