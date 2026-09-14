# `autopilot endpoints test` hardcodes `claude-3-haiku-20240307` — a local server that validates model ids returns 404 and the probe reads as broken auth

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: the first time someone runs `autopilot endpoints test <name>` against a named local-model endpoint (SGLang/vLLM validate the model id) and gets a non-200 that is not an auth failure.
- **Context**: the probe's model id is a compatibility choice for GLM/MiniMax gateways (they map claude-* ids). Local servers reject unknown ids. Fix shape: `--model <id>` on `endpoints test`, defaulting to the current id; the note in `src/endpoints/cli.js` says modernizing the default needs a live spike per gateway, so the default stays.
- **Effort**: S
- **Source**: v2.35.11 (`docs/plans/2026-09-03-endpoint-transport-optin.md` § Out of scope)

