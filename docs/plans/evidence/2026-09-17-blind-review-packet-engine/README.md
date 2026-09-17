# Evidence — blind review redesign cut 1a-B (plan `docs/plans/2026-09-17-blind-review-packet-engine.md`)

Base `bee8da3d` (v2.36.60) · grant base `e097d782` (plan + mission docs committed) · candidate `f81f9425` · merge `e43cc44d` (v2.36.61).

## Plan loop
- `ladder-classify.json` — probe U0 (every noun had local hits) → no consult.
- `g1-artifact.json` / `g1-dispositions.json` / `g1-receipt.txt` / `plan.as-reviewed-g1.md` — GLM-5.2 READY, gpt-5.6-sol STOP 4 blockers, all folded
  (no-fallback packet identity, `reviewDiff` sanitizes caller packet, absent-not-null, exact §4.1 commands + base evidence).
- `g2-artifact.json` / `g2-dispositions.json` / `g2-receipt.txt` / `plan.as-reviewed-g2.md` — terminal; gpt-5.6-sol READY, GLM-5.2 CONDITIONAL 1 non-blocking
  (blind-only gate on `reviewOptions.packet`), folded. Growth 1.14×.
- `base-suites-bee8da3d.txt` — the thirteen §4.1 commands at base (next-touch-validation re-run on a temp branch: it dies on a detached HEAD).

## Campaign (attempt 1, `grant.json`, `prepared.json`, `impl-brief.md`, `impl-run1.json`)
- implement committed `f81f9425` (cursor-grok-4.6-low, 1994 s, 13 files = every sealed path), scope passed.
- in-rail review MiniMax-M3/cc-shim SHIP-AS-IS (`review-minimax-inrail-raw.log`) — args carried `--timeout 5024s`: first live proof of v2.36.60.
- `campaign_verification` FAILED in-rail; only `receipt_digest`/`argv_hash`/`env_fingerprint` recorded anywhere (run output, work order, ledger) — BACKLOG row.
- repair refused: `campaign mutation budget exhausted` because `changed_files 13 >= max_changed_files 13` — BACKLOG row. TERMINAL_STOP → `session-mode set --level l3 --entry-level l5 --fallback precondition_failed`.

## Depth-0 verification
- `head-suites-f81f9425.txt` — all thirteen §4.1 commands exit 0 at the candidate on temp branch `head-tmp-c1b`.
- `git diff --stat e097d782..f81f9425 -- scripts bin/autopilot.js src/runners` empty; 13 changed files ⊆ §2.5.
- Engine diff read at depth-0 against §1 items 1–6: faithful (no-fallback, `delete reviewOptions.packet`, blind gate, absent-not-null, optional key inside digested body, two-layer panel rule, `FINAL_PANEL_SEAT_OPTIONAL_KEYS`, schema line).
- `live-probe-minimax.json` — the CANDIDATE engine's `reviewDiff` with `packet:{repo, baseSha e097d782, candidateSha f81f9425}` against real MiniMax-M3: `packet.packet_hash` 037b0aba…, 3382 entries, 895 denied paths, SHIP-AS-IS.
- Second family: `review-codex-r1-quota.json` — codex usage limit until 2026-09-19 (no verdict). `review-glm-r1.json` + `review-glm-r1-raw.log` — GLM-5.2 FIX-THEN-SHIP, 2 🟠 (mirrors missing, BACKLOG not updated): REFUTED — the diff I sent excluded `platforms/` and `docs/`; the commit contains all four mirrors and the BACKLOG edit, `sync-codex-plugin-skills.sh --check` and `check-backlog-entries.js` exit 0 at `f81f9425`.

## Integration
- `integration-record.json` — `record-integration.js` merge receipt (source `f81f9425…`, accepted `e43cc44d…`).
- reap / lifecycle receipts: see the files added at closeout.
