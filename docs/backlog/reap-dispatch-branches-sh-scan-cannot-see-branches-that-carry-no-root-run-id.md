# `reap-dispatch-branches.sh scan` cannot see branches that carry no `root_run_id`

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: 下一次要盤點 dispatch 殘留分支時；或再出現「分支堆積但 scan 回報乾淨」。
- **Context**: `scan` 以 `root_run_id` 為 key，沒帶 id 的殘留分支完全隱形——2026-08-06 清出的 20 個就是這樣躲過的。缺的是一個**報告-only 的 `--all` 模式**列出 `unattributed`，不自動刪（preserve-first 是這支工具的既有立場，不要為了方便破例）。目前 usage 只有 `--repo/--into/--pattern/--inventory-file`。刪任何分支前先 `pin-evidence-anchors.js apply --exclude-ref <待刪ref>`：receipt 綁的是 commit SHA 不是內容，這個 repo 已經永久失去過 4 個 commit 的證據。
- **Effort**: S。
- **Source**: 2026-08-06 dispatch residue cleanup（20 → 1 branches, 6.3 GB reclaimed）。

