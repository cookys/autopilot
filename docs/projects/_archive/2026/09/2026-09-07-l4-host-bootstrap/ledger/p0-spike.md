# P0 spike — isolated l4 fail sites on the real roster (2026-09-07, re-run 2026-09-06 on the branch)

Host: aimax395, autopilot's own resolved roster (grok-4.5/grok implementer, MiniMax-M3/cc-shim reviewer,
VA qoderclicn/Qwen3.8-Max-Preview, 3 QC seats). Each probe varies exactly one thing (g1 chair R9).

| Probe | level | roster change | develop (before P1) | branch (after P1) |
|---|---|---|---|---|
| A | `l4` | none (full roster) | `strict_l5_provider_bootstrap_invalid` — constructor guard | derives, `strict_level: l4`, `omitted_seats: []` |
| A2 | `l4` | VA absent + QC empty | (same guard) | derives, `omitted_seats: [verification_author, qc_panel]`, 2 seats |
| B | `l5` | `verification_author_present:false`, QC complete | `strict_l5_provider_roster_incomplete` — "requires the verification-author seat" | unchanged |
| C | `l5` | VA present, `qc_panel_seats:[]` | `strict_l5_provider_roster_incomplete` — "exact QC roster is incomplete" | unchanged |
| D | `l5` | VA present, `qc_panel_seats_complete:false` only | same as C | unchanged |
| E | `l6` | as B | same as B | unchanged |
| F | `l5` | the A2 roster | — | `strict_l5_provider_roster_incomplete` (VA) — P1 done-when |
| G | `l7` | none | `strict_l5_provider_bootstrap_invalid` | unchanged (message now names l4, l5 or l6) |

Code sites: constructor guard (`createStrictL5ProviderBootstrap`), VA and QC checks in
`deriveStrictL5InvocationPolicy` — both now consult `LEVEL_ROSTER_PROFILE[level]`.

CLI observable (P2 done-when, real roster with VA removed via `REVIEW_LOOP_CONFIG_OVERRIDE`, QC complete):
`AUTOPILOT_LEVEL=l4 engine implement-review … --campaign-contract <missing>` prints
`"strict_l5_provider_readiness":{"status":"ready"` and `"strict_level":"l4"` and blocks at `campaign_intake`
(the campaign file), with no `reviewer_qualification` ledger entry.

Finding recorded for docs (not a plan deviation): the managed engine's level-independent terminal-QC gate
(`validateReviewRoster` with `requireTerminalPanel`, `prepare_implementation_loop`) still requires a complete
QC panel of `min_panel_size` seats for any `--campaign-contract` run. "QC optional at l4" is a bootstrap
roster-profile rule; a roster with no resolvable QC seats blocks at `prepare_implementation_loop` before
readiness, exactly as it does at l5/l6.
