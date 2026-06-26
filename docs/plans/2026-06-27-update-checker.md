# Plan (DRAFT — for /l5 spec_review) — update-checker: surface "what's new" on version change

> **Status**: DRAFT for spec_review. **Owner**: cookys (Board) · **Branch**: `feat/update-checker` (off `develop`)
> **Frame**: small, additive, PATCH-sized. A **default-on** SessionStart behavior that announces new versions/features ONCE per version bump, so users who update never silently miss new (opt-in) capabilities.

## 0. Problem
Autopilot ships **opt-in** hooks/features (13 opt-in hooks today). A user's `settings.json` is THEIR file — when the plugin updates and adds a new opt-in feature, their settings don't change, so the new feature has **~0 discovery on update** (CHANGELOG is pull-only; nobody re-reads it). We need a **push** signal at update time.

## 1. Key design insight (non-negotiable)
The discovery mechanism itself **MUST be default-on**. An opt-in "discovery tool" has the exact problem it's trying to solve (users wouldn't enable it). It therefore folds into the existing **default-on** Tier-A `session-start.js` (SessionStart) — NOT a new opt-in hook.

## 2. OKR / KRs
- **O**: a user who updates autopilot is told, ONCE, what changed and where to enable new opt-in features — with zero action required to receive the notice.
- **KR1**: on a version change (current `plugin.json` version ≠ `~/.autopilot/last-seen-version`), `session-start.js` injects a concise, one-shot "what's new" block, then records the new version. No repeat on subsequent sessions at the same version.
- **KR2**: the "what's new" content is **CHANGELOG-driven** (no separately-maintained manifest): parse the `## vX.Y.Z — <headline>` lines from `CHANGELOG.md` strictly between `last-seen` and `current`, list those headlines.
- **KR3**: first run (no `last-seen` file) records the current version **silently** — never dump the whole history at a fresh install.
- **KR4**: fail-open (any error → session-start's existing output is unaffected); opt-out via env (`AUTOPILOT_UPDATE_CHECK=0`) and/or `~/.autopilot/config.json`.

## 3. Design
- **Where**: `hooks/session-start.js` (already default-on SessionStart; reads `CLAUDE_PLUGIN_ROOT`). Add a self-contained block; never break the existing skill-table / compaction-state / intent-hint / handoff-inject output (fail-open, same posture).
- **Version source**: `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` `version` (the canonical version). If unreadable → skip silently.
- **State**: `~/.autopilot/last-seen-version` (plain text). chmod 600. Compare with semver-aware ordering (or exact-string inequality — see Q1).
- **CHANGELOG diff**: read `${CLAUDE_PLUGIN_ROOT}/CHANGELOG.md`; collect `## v<semver> — <headline>` headers whose version is `> last-seen` and `<= current`; cap to the most recent N (e.g. 8) with a "+M older" note; byte-cap the read.
- **Injected block** (DATA, not instructions; <~1.5k chars): e.g.
  `[Autopilot updated: vY → vX]` + the headline list + `New opt-in features (if any) are enabled via settings.example.json / hooks/README.md — tell the user; enabling requires they edit settings (this hook does not change settings).`
- **One-shot**: after building the block (or deciding there's nothing to show), write `current` to `last-seen-version`. A crash before the write just re-shows next session (idempotent-safe; never double-harms).
- **Opt-out**: `AUTOPILOT_UPDATE_CHECK=0` env OR `~/.autopilot/config.json` `update_check:false` → skip entirely (still records last-seen so re-enabling doesn't dump history).

## 4. Non-goals / explicit NON-scope (lessons from this session)
- **NO settings-introspection.** Do NOT try to compute "which opt-in hooks the user has NOT enabled" by reading their merged `settings.json` (user/project/.local precedence is fragile). v1 ANNOUNCES what's new (which is exactly what they can't already have) and points to where to enable. Precise per-user gap analysis is a **spike candidate** (can a hook reliably enumerate active hooks? unverified — spike-before-assert).
- **No repo writes** (state lives in `~/.autopilot`, like compaction-state / handoff).
- **No auto-enabling** anything. Inform only.
- **No network.**

## 5. Tests
| Gate | Asserts |
|------|---------|
| version change → inject once | last-seen=2.25.13, current=2.25.15 → block injected with the 2.25.14 + 2.25.15 headlines; last-seen updated to 2.25.15 |
| same version → no inject | last-seen==current → no "what's new" block |
| first run → silent record | no last-seen file → records current, injects nothing |
| opt-out | env `AUTOPILOT_UPDATE_CHECK=0` (and config flag) → no block; last-seen still recorded |
| CHANGELOG cap | many intervening versions → caps to N headlines + "+M older" |
| fail-open | unreadable plugin.json / CHANGELOG → session-start's existing output intact, no throw |
| downgrade / equal | current < last-seen (downgrade) → no spam; records current |

## 6. Open questions (for spec_review)
1. Version comparison: strict semver ordering, or is "string inequality + record" enough (covers the only real case — version moved)? Downgrade handling?
2. Should the block fire on `startup` only, or also `clear`/`resume`? (It's per-version one-shot regardless, so source-gating is mostly cosmetic — but interaction with the handoff-inject precedence and the existing intent-hint should be defined.)
3. Where exactly in `session-start.js`'s additionalContext ordering should the update block sit (before/after compaction-state, handoff, intent-hint), and does it count toward any total context cap?
4. Is reading the SHIPPED `CHANGELOG.md` at `CLAUDE_PLUGIN_ROOT` reliable across install modes (marketplace install vs dev symlink vs OpenCode/agy)? Fallback if absent?
5. Is `plugin.json` `version` the right source vs the marketplace mirror? (Canonical is `.claude-plugin/plugin.json`.)
