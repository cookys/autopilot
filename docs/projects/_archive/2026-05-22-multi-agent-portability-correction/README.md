# Multi-Agent Portability Correction — v2.7.3

**Status**: ✅ Shipped 2026-05-27 — merged to develop as `5099d75`
**Plan doc**: [`docs/plans/2026-05-22-multi-agent-portability-correction.md`](../../../plans/2026-05-22-multi-agent-portability-correction.md)
**Branch**: `fix/v2.7.3-multi-agent-portability-correction`
**Size**: M-L (originally scoped M; bloated to L via 4 rounds dialectic review)
**Canonical version bump**: `2.7.2` → `2.7.3`

---

## OKR / Why this shipped

Three prior commits (`bf0c637`, `b7d1adb`, `139ca49`) tried to make autopilot support OpenCode / Codex / Antigravity but landed on develop without verification. Survey showed:

- `CODEX_PLUGIN_ROOT`, `AGY_PLUGIN_ROOT`, `GEMINI_PLUGIN_ROOT` — fabricated env vars, none documented anywhere
- `agy plugin validate` — fabricated CLI subcommand
- `hooks/intent-capture.js` fallback chain combined with hardcoded `.claude-plugin/plugin.json` → throws on non-Claude hosts
- `hooks/session-start.sh` condition flipped semantics — output Claude envelope on any platform
- 4 dangling `.opencode/skills/<name>/references/model-routing.md` symlinks (`../../../` only climbs to `.opencode/`, not repo root)
- AGENTS.md mixing "any agent should follow this" with "Claude Code specific rule"
- CLAUDE.md gutted with broken absolute file:// links

**Goal**: revert the fabricated, replace with empirically-verified cross-agent support.

---

## Method: 4-round dialectic review + 3-spike empirical verification

| Round | Reviewers | Verdict | Catch highlights |
|---|---|---|---|
| R1 | Architect / Ops / Skeptic | APPROVE_WITH_CHANGES (all) | 17 findings — agent frontmatter leak, `.agents/skills/` intersection insight, sync-version harden, Windows symlink, dangling symlinks |
| R2 | Same 3 | NEEDS_R3 (all) | R1 introduced 3 self-inflicted bugs: `_bodies/` premature removal (agents have YAML frontmatter), R1's `directory` parameter misuse (cwd, not plugin dir), Phase 0 rm without condition |
| R3 | Same 3 | NEEDS_R4 (all) | Latent `__dirname` 3-level climb bug pre-existed (lands at repo *parent*, not root); awk frontmatter strip logic broke 3 edge cases; install-antigravity.ps1 missing; sync-version --check spec unclear |
| R4 | Self-review + empirical Spike | Approved | All R3 critical addressed; `__dirname` arithmetic fixed to 2-level + acknowledged Bun ESM context unknown via Spike 0 |

**Spike phase** (against OpenCode 1.15.10 empirical, not docs):
- **Spike 0**: `__dirname` is **undefined** in OpenCode Bun ESM plugin context. `import.meta.url + fileURLToPath` is the canonical replacement.
- **Spike 1**: `{file:../...}` cross-layer resolution works. Footgun: descriptions containing literal `{file:..}` trigger spurious parse attempts.
- **Spike 2**: `.agents/skills/` is scanned natively by OpenCode — no plugin or `opencode.json` key needed.
- Bonus: OpenCode ships a built-in `customize-opencode` skill that is the **authoritative `opencode.json` schema reference**. Corrected three R3 plan errors:
  - `"skills": { "paths": [...] }` IS valid (R3 said remove)
  - `"plugin": [...]` accepts local file paths, not only npm names
  - `.opencode/plugin/` AND `.opencode/plugins/` both auto-scan

---

## Phases shipped

| Phase | Commits | What |
|---|---|---|
| 0 | 3 (`8f2c8bd`, `0d6750c`, `25d9a06`) | Hot-fix: revert hook env-var fallback chain, restore CLAUDE.md from `b1ee7a6`, conditional rm 4 dangling symlinks |
| 0.5 | 3 (`b5a0dce`, `240ea05`, `8bf3d14`) | `sync-version.js` canonical-mirror refactor (canonical = `.claude-plugin/plugin.json`, mirror = root `plugin.json` + README badges); `--check` mode; `.githooks/pre-commit` activation |
| 1 | 0 | Pure verification: hooks.json audit pass (all `${CLAUDE_PLUGIN_ROOT}`-prefixed), smoke test 3 cases including symlinked install |
| 2 | 3 (`9e27da0`, `369d6a2`, `74eb9f7`) | AGENTS.md rewritten as agents.md-spec readme; CLAUDE.md updated link / hook count / new Don't; portability.md fact-version with URLs + "NOT verified" list |
| 3 | 4 (`53b259c`, `bcbbfc9`, `1d239fc`, `4d42960`) | Spike results appendix; `scripts/sync-agent-bodies.sh` + `agents/_bodies/<role>.body.md`; `.opencode/` structural fix (`import.meta.url`, cross-layer agent prompts, orphan removal); sync-agent-bodies wired to pre-commit |
| 4 | 2 (`9660672`, `3f8f85c`) | `.agents/skills/ → ../skills` symlink; `setup-symlinks.{sh,ps1}` (Dev Mode catch); `install-antigravity.{sh,ps1}`; `platforms/codex/config.toml.example`; README install section for 4 platforms |
| 5 | 1 (`97a177b`) | `scripts/preflight-portability.sh` (12 automated checks); `scripts/validate.sh` ref-form fix (handles `skill-local`, `repo-root`, `sibling-skill` reference forms) |

Plus `27746fb` (plan doc itself) and `96262f7` (independent develop hot-fix: risk-counter Py 3.12 deprecation).

---

## Acceptance

Preflight 12/12 green on develop after merge:

```
preflight-portability — autopilot v2.7.3+ acceptance gate
✓ intent-capture.js returns version with CLAUDE_PLUGIN_ROOT
✓ intent-capture.js returns 'unknown' without env var, no throw
✓ intent-capture.js works from symlinked path (no throw)
✓ session-start.sh emits hookSpecificOutput envelope when env set
✓ session-start.sh emits additional_context envelope when env unset
✓ sync-version.js --check: canonical & mirrors in sync
✓ sync-agent-bodies.sh --check: _bodies/ in sync with agents/
✓ .agents/skills symlink resolves to ../skills (target exists)
✓ scripts/validate.sh: all skills pass structural validation
✓ OpenCode plugin getPluginVersion returns real version
✓ OpenCode discovers autopilot skills via .agents/skills/
✓ OpenCode agent body resolves without frontmatter leak
```

**Manual sign-off pending**:
- Claude Code restart → SessionStart context injection visible
- Claude Code tool use → `~/.autopilot/intent/*.json` written (already verified during work)
- Antigravity install (if `agy` available) → `agy skills list | grep autopilot`

---

## Key technical decisions

1. **Canonical / mirror split** (§3.7 of plan): `.claude-plugin/plugin.json` is canonical; root `plugin.json` is mirror written by `sync-version.js`. Pre-commit gate enforces parity. Eliminates the "two files, sync manually" failure mode.

2. **`.agents/skills/` as cross-agent intersection**: OpenCode native scans this path; Codex skill discovery walks up to find it; Antigravity workspace skills use the same convention. Single `.agents/skills/ → ../skills` symlink covers three platforms.

3. **Spike-driven, not docs-driven** (§3.5 of plan): Anything not in official docs gets a Spike script before being written into reference material. `references/multi-agent-portability.md` now contains an explicit "Things explicitly NOT verified" subsection listing fabricated env vars / CLI commands that previously shipped to main.

4. **Agent body separation** (§3.1 of plan): `agents/<role>.md` stays Claude Code-shaped (YAML frontmatter + body). OpenCode references `agents/_bodies/<role>.body.md` via `{file:..}` — frontmatter-stripped to prevent prompt pollution. `scripts/sync-agent-bodies.sh` generates the body file; pre-commit gate enforces parity.

---

## Out of scope (intentional)

- OpenCode `.opencode/plugins/autopilot.ts` circuit breaker / disable flag / stale clear — porting from `hooks/intent-capture.js` (separate plan)
- Antigravity hook adapter (spec unstable; `gemini-extension.json` format not yet justified by user demand)
- Universal hook layer abstraction
- npm-package distribution (symlinks → tarball unverified)
- Windows non-Dev-Mode symlink fallback

---

## Related

- Plan: [`docs/plans/2026-05-22-multi-agent-portability-correction.md`](../../../plans/2026-05-22-multi-agent-portability-correction.md)
- Reverted commits: `bf0c637`, `b7d1adb`, `139ca49`
- Merge commit: [`5099d75`](../../../../commit/5099d75)
- Predecessor (also labelled v2.7.3 but no canonical bump): [retro-roundup](../2026-05-14-retro-roundup/README.md) → relabelled as `v2.7.2-followup` in INDEX
