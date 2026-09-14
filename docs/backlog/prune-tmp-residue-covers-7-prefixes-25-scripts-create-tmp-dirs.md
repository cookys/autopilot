# `prune_tmp_residue` covers 7 prefixes; 25 scripts create `/tmp` dirs

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: `/tmp` 再次被 autopilot 殘留撐大，或有人要為 CI runner 加磁碟配額時。
- **Context**: `prune_tmp_residue` 只被四個 dispatch 腳本呼叫，共 7 個 pattern（`dispatch-author-*`／`dispatch-explore-*`／`dispatch-review-*`／`dispatch-hetero-*`／`hetero-*-log-*`／`pi-rpc-session-*`／`hetero-detach-state-*`）。一次 `mkdtempSync|mktemp -d` 全掃（2026-08-16）數出 **25 個會建 `/tmp` 目錄的腳本，沒有一個自己 prune**——被 caller 的前綴涵蓋的只有 `pi-rpc-session-`（dispatch-hetero）與 `dispatch-author-codex-`（前綴匹配 `dispatch-author-*`）。無 owner 的包含 **production 路徑**，不只是 test fixture：`dispatch-anthropic-review-`（`dispatch-anthropic-review.js:276`，由 `dispatch-author.sh:959` 呼叫，而 dispatch-author 只 prune 自己的前綴）、`dispatch-contract-`、`dispatch-plan-review-`、`qc-panel-`／`qc-refute-b-`／`qc-emit-`、`next-touch-evidence-`、`hook-multiplexer-benchmark-`、`verify-red-green-`、`eval-selftest-`、`run-ledger-*-test-`，以及整個 `autopilot-*` 家族。
- **實測**（2026-08-16，開發機 `/tmp` 22506 項）: `dispatch-anthropic-review-*` 484 個（420 個 >3d，5.4 MB）、`qc-emit-*` 28 個、`ctxbud*` 175 個。**位元組小、entry/inode 大**——真正撐爆 `/tmp` 的是別人的殘骸，但這是 autopilot 自己該收的部分。
- **修法**: 讓 `prune_tmp_residue` 的 pattern 清單成為**單一事實來源**（例如 `lib/tmp-prefixes.sh`／`.json`），由建立者各自認領前綴，並加一個掃描 gate 讓「新增 `mkdtemp` 前綴但沒登記」變成紅燈。要嘛讓 `hooks/tests/lib.sh` 的 `cleanup_test_tmp` 也掃同前綴過期殘留。先確認它真的會 fire——別再多一個「存在但沒在工作」的腳本（見 `references/evidence-discipline.md`）。
- **Effort**: S（單點補 pattern）／M（做成單一事實來源 + gate）。
- **Source**: 2026-08-06 dispatch residue cleanup（782 項 `/tmp`、1.9 GB）；2026-08-08 複驗仍成立；2026-08-16 全掃擴大範圍——原標題「test-fixture prefixes」低估了，production dispatch 前綴同樣無 owner。

