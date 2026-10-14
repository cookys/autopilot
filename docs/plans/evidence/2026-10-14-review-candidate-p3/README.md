# P3 live run: review-only readiness profile (BL-0090 P3)

Engine: `node bin/autopilot.js engine review-candidate`, autopilot plugin 3.0.0-alpha.6 (worktree lane/review-candidate-p3),
`AUTOPILOT_LEVEL=l4`, `--campaign-disposition-policy acceptance-bound`. Throwaway repo under the session scratchpad, no
governance file (default `off`), seal mission-mode off. Setup: `p3-setup.js` (trivial range: add `sub(a,b)` returning a-b).

Unlike the P1 run, the throwaway repo's `.claude/review-loop-config.md` is an unedited copy: implementer stays
`grok-4.7` / runner `grok` (host quota exhausted today) and `verification_author_present: true` (Qwen3.8-Max-Preview,
qoderclicn) stays as configured.

Result: status converged, phase campaign_terminal_ready, verdict SHIP-AS-IS, exit 0. Ledger:
strict_l5_provider_readiness:ready, campaign_intake:admitted, adoption_admission:admitted, campaign_verification:passed,
4x dispatch_review:reviewed, full_diff_review:passed, full_suite:passed, campaign_scope:passed, final_panel_seat_reap:removed.
`implementation` is null (0 implementer calls).

Readiness probe list (strict_level l4, the `selections` of the consumed receipt): reviewer (cc-shim/MiniMax-M3), qc:1
(claude-native/claude-fable-5-1), qc:2 (cc-shim/GLM-5.2), qc:3 (cc-shim/MiniMax-M3), qc:4 (qoderclicn/Qwen3.8-Max-Preview).
No implementer and no verification_author seat was probed, so the exhausted grok implementer no longer blocks admission.
