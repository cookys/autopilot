# Autopilot OpenCode Extension

This directory is the canonical OpenCode V2 extension package.

- `plugin/server.ts` is the thin OpenCode adapter.
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

The plugin exports both the 1.x `server()` and the 2.x `setup()` entry points and is
loaded as a directory (`server.ts`, `package.json` `main`). It is verified on opencode 2.0.32
and 1.19.3. Earlier it was pinned to the OpenCode2 nightly recorded in
`src/harness/capabilities/opencode.json`. Re-run the smoke test after upgrading
OpenCode2 and update the pin only with fresh probe evidence.

Current verified scope is plugin setup, tool-hook registration, and intent
capture. Session lifecycle and resume hints are disabled because the matching
nightly does not expose the documented session hook and subscribing to the
server event stream during setup deadlocks activation.
