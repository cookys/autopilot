# Official codex plugin as a peer consult channel

No sidecar existed in history. Original row text from 5d0b29c1d^:docs/BACKLOG.md. The effort value is recorded as S (the original parenthetical said the spike's consult channel had already shipped).

> ### 官方 codex plugin(openai/codex-plugin-cc)作「同級 consult 通道」的 Spike 評估
> - **Trigger**: first session after install already fired and the first spike finished (2026-07-05, the install session). Residual trigger: after the GPT-5.3-Codex-Spark quota reset (2026-07-07 12:44), measure the `/codex:review` channel (the review subcommand is locked to Spark and has no model flag — when quota is dead the whole review channel is unavailable, and the error is honest rather than a fake verdict); and the next time a write path is needed, measure the `rescue --write` sandbox posture.
> - **Context**: 2026-07-05 static read of the cloned plugin confirmed the command surface: `/codex:review`, `/codex:adversarial-review` (JSON schema output), `/codex:rescue` with background/model/effort (via the codex-rescue subagent), `/codex:transfer`, plus status/result/cancel/setup. Architecture is an app-server broker (structured protocol, no stdout-scrape late-flush class) plus a resumable codex thread, and an optional Stop-time review gate hook that overlaps the qc gate and was expected to stay off. Position: a peer consult whose opinion enters context, complementary to the dispatch rails. The spike was meant to check runtime stability, thread-resume usefulness, the rescue write surface (sandbox default read-only, but the fix-flow escape posture needs a live measurement), and coexistence with autopilot hooks.
> - **First spike result (2026-07-05)**: setup green (ChatGPT auth, advanced runtime). The task/consult channel with model gpt-5.5 finished a repo-grounded technical assessment in 9 seconds (read real files, conclusion correct). Labor (implementation plus artifact verification) stays on the rails. Install side effect: wrote `.claude/settings.json` (enabledPlugins) in the cwd repo, then gitignored. Review gate left off.
> - **Effort**: S
> - **Source**: 2026-07-05 orchestrator-economy absorb (an X thread prompted it; depth-0 did the first source read).

Audit finding (section 3.3, dropped by 5d0b29c1d): the consult channel shipped. Codex review calibration and the rescue write sandbox posture have no follow-up row. Origin self. Trigger-Type event.

Restored 2026-10-19 from 5d0b29c1d^; see docs/plans/evidence/2026-10-19-backlog-deletion-audit/REPORT.md
