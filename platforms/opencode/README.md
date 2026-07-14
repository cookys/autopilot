# Autopilot OpenCode Extension

This directory is the canonical OpenCode V2 extension package.

- `plugin/autopilot.ts` is the thin OpenCode adapter.
- `plugin/core/` is generated from host-neutral handlers and normalizers under `src/hooks/`.
- `.opencode/plugin-package/` is the generated repo-local consumer payload.
- `.opencode/opencode.json` loads that payload and defines project agents.

Install for development:

```bash
./scripts/install-opencode.sh
```

The installer sets up shared skills, installs the pinned V2 plugin dependency,
and synchronizes the extension payload. Verify with:

```bash
bash hooks/tests/opencode-v2-plugin.test.sh
```

The V2 API is beta. The package is pinned to the OpenCode2 nightly recorded in
`src/harness/capabilities/opencode.json`. Re-run the smoke test after upgrading
OpenCode2 and update the pin only with fresh probe evidence.

Current verified scope is plugin setup, tool-hook registration, and intent
capture. Session lifecycle and resume hints are disabled because the matching
nightly does not expose the documented session hook and subscribing to the
server event stream during setup deadlocks activation.
