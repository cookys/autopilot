# P4 — Supported reinstall & exact artifact SHA proof (v2.32.54)

**Generated at**: depth-0, feat/v2.32.54-author-transport-hardening

## Source identity
- Session base: `661ac1399b33a61bfb624fa694af192db22cd5b2`
- Branch HEAD: `8e62038d9cadc24ebec4b49c8b4b544dfc97e7a8`
- HEAD tree: `51b3a1a51a902ac5efff9181e2c8c389584d6236`

## Install command / result
- Marketplace: `autopilot-local` (ROOT `platforms/codex`, local non-git)
- `codex plugin remove autopilot@autopilot-local` → removed
- `codex plugin add autopilot@autopilot-local` → `Installed plugin root: /home/cookys/.codex/plugins/cache/autopilot-local/autopilot/2.32.54`
- `codex plugin list` → `autopilot@autopilot-local  installed, enabled  2.32.54`
- Absolute installed dispatcher path: `/home/cookys/.codex/plugins/cache/autopilot-local/autopilot/2.32.54/scripts/dispatch-author.sh`

## Three-way SHA256 equality (canonical == generated package == installed cache)

| File | SHA256 | canonical | package | installed |
|------|--------|-----------|---------|-----------|
| scripts/dispatch-author.sh | `50220d85678d8c2cd6bbb5e4b41a3ace49664b3ddca455680817fafa7837d349` | ✅ | ✅ | ✅ |
| scripts/lib/dispatch-author-codex-transport.sh | `65a3bdbd03bc34c198456d075a78b1a03969d0bf8debc0fbf6604a24be813adb` | ✅ | ✅ | ✅ |

Package path: `platforms/codex/plugin/<file>`; installed path: `/home/cookys/.codex/plugins/cache/autopilot-local/autopilot/2.32.54/<file>`.
Both files: canonical == package == installed (verified byte-identical SHA256).

## Freshness
Same-version reinstall established a fresh installed cache root at the exact
v2.32.54 path (remove → add produced a new resolved root, not a stale path);
no cachebuster needed.
