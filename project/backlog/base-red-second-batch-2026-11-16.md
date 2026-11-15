# develop 第二批套件在基準點就已經是紅的

2026-11-16 第二批全套對照基準 `761162e91`。這些套件在基準點就失敗，不是該工作線新引入的。

`test-pipefail-grep-q` 早已列在 BL-0313，不重複記在這裡。2026-11-16 仍紅的證據寫在該條的 Context 與 `base-red-suite-list.md`。

`runner-binary` 另見 BL-0414：單獨跑是綠的，負載高時才紅。這次是全套對照基準也紅。

## L2（原點名八支，去掉已歸 BL-0313 的一支）

- `dispatch-review-a`
- `blind-kimi-agy`
- `review-family-dispatch-guard`
- `role-kit-kimi`
- `review-loop-resolver-b`
- `doc-drift-gate`
- `runner-binary`

## L1（七檔）

- `account-layer-list`
- `affected-suites-jobs`
- `affected-suites`
- `check-quota-adapters`
- `runtime-paths.neg`
- `status-events-src-dq`
- `status-events-src-review`
