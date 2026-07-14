# Autopilot for OpenCode

This directory is the repo-local OpenCode consumer layer.

- `opencode.json` loads agents and the generated extension payload.
- `plugin-package/` is generated from `platforms/opencode/plugin/`.
- `.agents/skills -> ../skills` provides shared Autopilot skills.

Do not edit `plugin-package/` directly. Canonical OpenCode extension code lives
under `platforms/opencode/`; host-neutral logic lives under `src/hooks/`.

```bash
./scripts/install-opencode.sh
opencode2
```

Verify after installation or every OpenCode2 upgrade:

```bash
bash hooks/tests/opencode-v2-plugin.test.sh
```

OpenCode V2 is beta. The exact supported nightly and capability limits are
recorded in `src/harness/capabilities/opencode.json`.
