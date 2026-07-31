# Retro — Multi-Agent Portability Correction (v2.7.3)

**Date**: 2026-05-29
**Project**: [README.md](README.md)
**Plan**: [`docs/plans/2026-05-22-multi-agent-portability-correction.md`](../../../plans/2026-05-22-multi-agent-portability-correction.md)

---

## Start vs end

One-line ask — "review whether the recent 4 commits are reasonable + survey how cross-agent skill architecture works" — became a 16-commit release: reverted 3 fabrication-heavy PM commits, built empirically-verified OpenCode / Codex / Antigravity skill sharing, added a canonical-mirror version manifest with a pre-commit drift gate, and reconciled the full release doc tree (CHANGELOG / project README / INDEX).

Canonical version: `2.7.2` → `2.7.3`. Merge: `5099d75`.

---

## 🟢 What worked — repeat these

### 1. Multi-round dialectic review caught the *prior round's* mistakes

The value wasn't just R1 finding 17 issues. It was each subsequent round auditing the previous round's fixes:

- **R2 caught R1**: R1 removed `agents/_bodies/` as "over-engineering," asserting `agents/<role>.md` was already a pure body. It wasn't — those files carry YAML frontmatter (`name` / `tools` / `model`) that would leak into the OpenCode agent prompt via `{file:..}`. R2 restored `_bodies/`.
- **R3 caught R1+R2**: The OpenCode `getPluginVersion()` fix bounced between `__dirname` and `context.directory` across rounds. R3 found that the *existing* code's `path.join(__dirname, "..", "..", "..")` was a latent bug — 3 levels climbs to the repo's **parent**, so the function had been silently returning `"unknown"` since `bf0c637`. The earlier rounds had frozen this as "keep existing implementation."

Takeaway: review the **deltas**, not just the original plan. The bugs that survive into late rounds are the ones introduced by earlier fixes.

### 2. Empirical Spikes overturned second-hand survey conclusions

Installing real OpenCode 1.15.10 and running 3 Spikes (`/tmp/oc-spike/`) corrected multiple WebFetch/survey claims that had made it into the plan:

| Plan/survey said | Spike found |
|---|---|
| `opencode.json` has no `skills.paths` key | It IS a valid key |
| `plugin` accepts only npm names | Also accepts local file paths |
| `__dirname` works in the TS plugin | `undefined` in Bun ESM context — use `import.meta.url + fileURLToPath` |
| `{file:../}` cross-layer unverified | Resolves correctly |
| `.agents/skills/` scanning unverified | Scanned natively, all 16 skills discovered |

Bonus: OpenCode ships a built-in `customize-opencode` skill that is the authoritative `opencode.json` schema reference — better than any external doc.

Takeaway: docs lag and survey agents hallucinate. If the tool can be installed, install it and ask it directly.

### 3. Phased, independently-shippable commits

Phase 0 / 0.5 / 1 were a runtime-hot-fix path (revert broken hooks, harden version sync, audit) that could merge first. Phases 2–5 (docs, OpenCode structure, cross-agent infra, preflight) followed as separate batches. Each commit was one logical change — bisect-friendly, and the hot-fix wasn't blocked behind the larger structural work.

---

## 🟠 Costs & watch-fors

### 1. Review fatigue is real and has a detectable signature

By R3, findings shifted from "critical runtime bug" to "Spike-verifiable detail" and "internal inconsistency." That shift is the signal that the review loop is hitting diminishing returns. The loop was stopped at that point (user call) and work proceeded to dev-flow. Knowing when to *stop* reviewing matters as much as knowing when to start.

### 2. Reviewers also assert wrong facts

Ops R2 reverse-flagged a finding, claiming the 4 dangling reference symlinks actually had valid targets. An independent `ls -la` showed they were dangling — the reviewer miscounted `../` levels (`../../../` lands at `.opencode/`, not repo root which needs `../../../../`). Had this been trusted, the cleanup would have been skipped. Reviewer findings are leads to verify, not facts to act on — especially for destructive or decision-load-bearing claims.

### 3. Release hygiene was out of plan scope and nearly slipped

The version-number collision (two separate ships both labelled "v2.7.3" while canonical `plugin.json` had never left 2.7.2) surfaced only because the user asked "did you update the docs/changelog?" The plan covered code but not release-doc reconciliation. Future plans for version-bumping work should include a release-hygiene checklist as an explicit acceptance item.

---

## 🔑 Meta-lesson

The PM's original commits failed for one reason: they asserted unverified facts (fake env vars, fake CLI subcommands). The irony is that the **correction process itself** kept reproducing that same failure — rounds R1 through R3 each introduced new unverified assumptions (`directory` semantics, `__dirname` behavior, `{file:..}` resolution, `skills.paths` validity). What finally broke the cycle was not more review — it was empirical Spikes plus a hard rule: **no URL, no fact; assert it only after you've run it or cited it.**

That rule is now codified in `AGENTS.md` (Contribution section) and `CLAUDE.md` (Don't list), and `references/multi-agent-portability.md` carries an explicit "Things explicitly NOT verified" section so future sessions inherit the discipline rather than re-learning it.

---

## Backlog items surfaced (not yet filed)

- **OpenCode plugin parity**: `.opencode/plugins/autopilot.ts` still lacks the circuit-breaker / disable-flag / stale-clear logic that `hooks/intent-capture.js` has. Deferred to a separate plan (noted in project README Out-of-scope).
- **Release-hygiene checklist**: consider a `scripts/preflight-release.sh` or a plan-template section that enforces CHANGELOG/INDEX/version-mirror reconciliation as part of "done."
- **v2.7.4 entry resolution** (done this session): the orphaned draft was merged into the v2.7.3 CHANGELOG entry; `hooks/README.md` retains "v2.7.4 disable batch" only as an event marker.
