# Dead-gate mutation record — verdict-bytes preservation (2026-08-21)

Per plan R3 KR3 (red direction of the bidirectional pin, evidence-discipline §13): one
recorded mutation per rail, executed against the implemented tree, restored from scratch
backups (`cp`, never `git checkout` — the uncommitted-wash trap).

## Rail 1 — envelope (plan-review-normalize.js)

- **Mutation**: `unratified: salvageUnratifiedPayload(transport, bytes)` →
  `unratified: null` at the failure-classification return.
- **Result**: `plan-review-transport-fixes.test.sh` → **19 passed, 6 failed** — exactly the
  salvage-positive assertions (N1 ×2, N5b ×2, N7 ×2); every negative control (N2/N3/N4/
  N5a/N6/N8) stayed green, so the reds are the gate, not collateral.
- **Restore**: verified `PASS 25 assertions`.

## Rail 2 — shell (dispatch-review.sh)

- **Mutation**: the `salvage_unratified_verdict … "${BEGIN:-}" "${END:-}"` call in
  `emit_no_verdict` → `:` (field emits its init value `null` on every path).
- **Result**: `dispatch-review.test.sh` → **313 passed, 3 failed** — exactly the three
  salvage-positive assertions (A frozen-notice, B block-then-die, B-ship valid-proof);
  all null-expectation fixtures (B2/E/F/G) and all 306 pre-existing assertions stayed
  green.
- **Restore**: file restored from scratch backup; final green run recorded in the KR-final
  suite run (see project README verification row).

## Guard mutation (reader allowlist)

- The synthetic authority-consumer red proof for `check-canonical-invariants.sh`
  `reader-allowlist[unratified-columns]` is a PERMANENT test case, not a one-off record:
  `hooks/tests/check-canonical-invariants.test.sh` case 5b plants
  `src/engine/rogue-consumer.js` reading `result.unratified_verdict || result.verdict`
  → exit 1 naming the file; case 5c proves the set is closed-but-not-a-token-ban
  (allowlisted location passes).
