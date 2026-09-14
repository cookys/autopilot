# Qualification CLI transport — runtime identity capture

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: When any CLI harness (codex / claude) grows a verifiable runtime model-identity signal in headless mode, or before promoting a CLI-transport qualification to a decision where alias drift would be material.
- **Context**: CLI transports return no model id, so administered identity is operator-asserted (pre-run probe recorded per the v2.34.15 governance rule; the HTTP path caught glm-5.2→glm-5.3 exactly via its runtime echo). `resolvedModel` in `qualification-review-provider.js` is the wired-but-dead field awaiting a real signal. The other seven items of the original v2.34.15 hardening row shipped in the 2026-08-17 hardening round (stdin data fence; hermetic `--setting-sources ""` probed on claude 2.1.233 + containment descriptor v2; `QRP_CLI_EFFORT` [a-z]+ validation; 2MB stdout cap; six test exec bits restored — run.sh L2 reachable again; context-window field pin schema-derived, suite fully green; exit-flush race settled from recorded exit with negative-control proof; `brain_seat_identity_file` documented in the config template).
- **Effort**: S once a signal source exists.
- **Source**: v2.34.15 pre-merge review; hardening round 2026-08-17.

