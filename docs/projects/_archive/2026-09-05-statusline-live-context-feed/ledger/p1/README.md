# P1 — codeforge live context files (2026-09-05)

- Hands: sonnet, worktree `codeforge-wt-live`, branch `feat/live-context-file`, commit `2c578a6` (13 files, +1053/−5). Report: `report.json`.
- Depth-0 re-derivation: `cargo test` 857 passed / 0 failed (run by depth-0 in the worktree); `cargo clippy -D warnings` clean per report.
  Both writers run by depth-0 on the real P0 payloads as single-line stdin (`AUTOPILOT_LIVE_DIR=/run/user/1000/autopilot/p1check`, tmpfs):
  `context/<sid>.json` and `context/<sid>.tasks.json` produced, schema 1, mode 0600, `tasks[0].id == a9c9b5673eb39f842`, `tokenCount 47688`.
  First attempt with the pretty-printed ledger copies wrote nothing: `read_status_input` reads ONE line, which is what
  Claude Code sends; the fixture shape was wrong, not the code. Noted for P2 fixtures (single-line).
- Tests present for every §2.5 rule: `findmnt_tmpfs_selects_xdg_candidate`, `findmnt_ext4_everywhere_falls_back_and_warns_once`,
  `missing_findmnt_falls_back_to_proc_mounts`, `ext4_override_falls_through_to_tmpfs_xdg`, `write_live_json_sets_mode_and_leaves_no_tmp`,
  `sanitize_session_id_matches_shared_vectors`, fixture tests for both writers.
- Hetero seat: MiniMax-M3 via cc-shim (effort high, 15m) on `diff.patch` + `spec.md` → **SHIP-AS-IS**, non-empty NO-FINDING-PROOF
  (checked/evidence/conclusion present). Artifact: `review-minimax.json`.
- Integration: merged `--no-ff` into codeforge `main`, worktree removed, `cargo install --path .` on aimax395.
