# Changelog

<!--
RELEASE TEMPLATE (paste below this comment for each new release):

## v<X.Y.Z> — <Headline>

**Headline**: <one paragraph user-facing summary>

### Added
- ...

### Changed
- ...

### Fixed
- ...

### Hook-order semantics reminder (if hooks change)
- Claude Code hooks run **in parallel / non-deterministic order across different matcher blocks** (e.g., PostToolUse `Bash` vs `Write|Edit` vs `.*` are independent). Only **intra-matcher** sequencing within a single matcher block is guaranteed. Do not claim cross-matcher ordering in release notes.

### Rollback
- Maintainer: `git revert <merge-sha>`
- User-side (post-marketplace): `/plugin update autopilot @v<previous>` + cleanup new sibling files (e.g., `rm -rf ~/.autopilot/<new-dir>/`)
-->

## v2.13.1 — standalone-fallback fix + 3 parity refinements (superpowers-gap batch)

**Fix batch** from the superpowers-parity inventory (via `research-to-ship`, right-sized: small known items built, 2 M items CEO-deferred to BACKLOG). The headline is a real **standalone-capability bug**.

### Fixed
- 🔴 **`think-tank-dialectic` no longer hard-depends on voltagent** (standalone bug): the 4 職能 roles named `voltagent-*` subagent_types with **no fallback** — so the dialectic broke when voltagent isn't installed (i.e. the default, autopilot-standalone case). Now documents graceful degradation to `general-purpose` + inlined role Focus (the mechanism the 2 adversarial roles already use), mirroring the reviewer-chain fallback. The panel runs with zero voltagent agents present.

### Changed
- `skills/research-to-ship/SKILL.md`: added an **optional Phase 0 → `autopilot:brainstorm`** (discover the design when the topic starts fuzzy; skip when it's already a clear question) — resolves the prior one-way link (brainstorm declared a research-to-ship Phase-0 that research-to-ship didn't reciprocate).
- `skills/debug/SKILL.md`: added the **3-fix architecture gate** — after 3 failed fix attempts, STOP and question the architecture/mental-model (re-collect evidence at the boundary above the suspected site) rather than attempting fix #4. (Internalized from `superpowers:systematic-debugging`.)
- `agents/reviewer.md`: the Security checklist now points to Claude Code's **native `/security-review`** for a dedicated security deep-dive (threat model / supply-chain), clarifying that autopilot's reviewer owns the *general* pre-merge security pass and delegates the specialist deep-dive rather than shipping a separate skill.

### Deferred (CEO call — no biting value for self-use; recorded with triggers in `docs/BACKLOG.md`)
- **subagent-driven-development**: the spec→quality review ORDER is already covered (reviewer's v2.12.1/v2.12.3 claim-completeness IS spec-compliance); only the BLOCKED/incomplete-return handling residue remains → backlog (trigger: a mishandled blocked dispatch).
- **writing-skills RED-phase**: overkill for self-use (it's tuned for public skill publishing); the cheap CSO description principle is already autopilot practice → backlog (trigger: publishing skills broadly).

### Rollback
- Maintainer: `git revert <merge-sha>` (doc/methodology-only).

## v2.13.0 — internalize 3 superpowers capabilities (brainstorm skill + plan template + verification)

**Headline**: surveyed all 14 `obra/superpowers` skills (cloned & read) for what's worth internalizing into autopilot (the user runs without superpowers by choice), then a dialectic right-sized the 3 HIGH candidates. Net: **one new skill, one template, one one-line discipline edit** — each capability addressed at its correct size rather than as three new skills.

### Added
- **`skills/brainstorm/`** (19th skill) — pre-code **Socratic design exploration**: discovers options *when none exist yet*, surfaces 2-3 genuinely different approaches, and **gates implementation until a design is approved**. The discriminator vs neighbours is *whether options exist yet*: `brainstorm` (no options) vs `think-tank` (decide between known options) vs `survey` (external research). Internalizes `superpowers:brainstorming`.
- **`references/plan-template.md`** — the **plan-authoring** discipline internalized from `superpowers:writing-plans` as a *template* (a plan form never triggers standalone — it's invoked by `research-to-ship` Phase 2 / `dev-flow` L-2): file-structure map, bite-sized phases with dev-flow sizes + acceptance, every-step-concrete, and a self-review checklist (scope coverage / placeholder scan / dependency map).

### Changed
- `skills/quality-pipeline/references/anti-rationalization.md`: the **Unverified completion** rule now generalizes the reviewer's soft-language ban (should/seems/probably/likely…) from *findings* to **any completion claim** — "no completion claim without fresh verification evidence this turn" (internalizes `superpowers:verification-before-completion`, which autopilot was ~80% already enforcing).
- `research-to-ship` Phase 2 now follows `references/plan-template.md` (removes its inline plan duplication). Resolved the dangling `→ writing-plans` / `→ brainstorming` "Not for" refs in `dev-flow` / `finish-flow` / `project-lifecycle` (they pointed at non-existent skills) → now point at `plan-template.md` / `brainstorm`.
- Skill count 18 → 19 (README badge + prose + table).

### Rollback
- Maintainer: `git revert <merge-sha>`
- User-side: `/plugin update autopilot @v2.12.3` (new skill/template are inert if not invoked).

## v2.12.3 — reviewer: claim-completeness via decompose + per-outcome grounding

**Headline**: sharpens the reviewer's existing "claimed but missing" stance (v2.12.1) from *eyeball* into *method*. The **goal-scoped vs artifact-scoped** miss — a change that *claims* something ("make X idempotent", "add validation") but delivers it only partially, with the gap in code the diff didn't touch — is now handled by an explicit instruction: decompose the stated claim into the outcomes it implies, treat **the claim's scope (not the diff's scope) as the unit of done**, and confirm each implied outcome against an **external signal** (a test, a measured invariant, or every named code site enumerated) or mark it **`UNVERIFIED`** — reusing the v2.12.1 live-fact convention. This is **recall** (catch partial delivery), complementary to v2.12.1's **precision** (don't confabulate) and the deferred verify-barrier's finding-level refutation.

Deliberately a **prose sharpening of the existing stance, not a new pipeline step / dispatch pass** — consistent with the review-verify-barrier dialectic's ruling (claim/spec-compliance = stance in prose, not a separate gate, `docs/plans/2026-06-04-review-verify-barrier.md` §10) and with the evidence that reflexive ungrounded self-checks backfire (each outcome must ground in an external signal, never "looks done"; Sphinx arXiv:2601.04252 + SGCR arXiv:2512.17540 for intent-decomposition, arXiv:2603.00539 + Huang ICLR 2024 for why grounding-not-introspection).

### Changed
- `agents/reviewer.md`: Review Philosophy "Don't trust the report" bullet gains a "claimed but missing: decompose, don't just eyeball" sub-point — claim-scope as unit of done, per-outcome external grounding or `UNVERIFIED`, with the "make X idempotent ⇒ every write on the re-entered path, not just the changed one" worked example.
- `agents/_bodies/reviewer.body.md`: re-synced via `scripts/sync-agent-bodies.sh`.

### Rollback
- Maintainer: `git revert <merge-sha>`

## v2.12.2 — team: cap-3 ≠ independent read-only fan-out; no parallel code-mutation

**Fix** (methodology clarification): `team`'s "cap at 3" governs **coordination cost of collaborative teams** — it was being mis-read as a cap on *independent read-only fan-out* (N agents each producing findings/reports over disjoint inputs, no inter-agent messaging, no shared-file writes — e.g. `audit` Phase 2 per-segment exploration, parallel review dimensions, multi-source research). That kind of fan-out **is not a team and is not capped at 3**; bound it by concurrency (~8) and assert *collected == dispatched* before synthesizing so a dropped unit fails loudly. Also records an explicit **non-goal**: do NOT parallelize code *mutation* via per-unit git worktrees — disjoint-file merges are clean but you can't guarantee disjointness up front, and merge-back conflict-resolution cost outweighs the wall-clock saved.

### Changed
- `skills/team/SKILL.md`: Team Size Rules note distinguishing collaborative cap-3 from uncapped independent read-only fan-out.
- `skills/team/references/team-tactics.md`: File Overlap Check gains an **output-only → overlap N/A → fan out to N** row + the parallel-code-mutation non-goal with its rationale.
- Design + research record (3 research rounds incl. an empirical git-worktree spike + a 4-way parallelizable-work inventory, and the dialectic that descoped a larger proposal to this): `docs/plans/2026-06-04-parallel-read-fanout.md`.

### Rollback
- Maintainer: `git revert <merge-sha>` (doc-only).

## v2.12.1 — reviewer live-fact rule + calibration + consumer verify-pushback

**Fix**: retires the HIGH-severity `reviewer-livefact-confabulation` defect (the reviewer "verified" a live-world claim — `fr.cookys.org` does not exist — by citing a README that never mentioned it; `verified == cites-a-repo-line` let argument-from-silence pass as fact). The fix is in the reviewer's own discipline, not a new verification layer (the BACKLOG entry's own scoping ruled the caller-side layer out — confirmed by a research-to-ship run whose dialectic descoped a proposed verify-barrier down to this). Also absorbs the genuinely useful, cheap ideas from `obra/superpowers`' reviewer (studied by cloning it) without taking its weaker ones (its 3-tier `Critical/Important/Minor` uses the `Important` vocab autopilot already retired).

### Changed
- `agents/reviewer.md`: Fact-driven Red Line now distinguishes **documented-fact from live-system-fact** — live claims (DNS/reachability/version/process/existence) must be **Bash-execution-verified or marked `UNVERIFIED`**, never "verified" by a doc/README citation; **argument-from-silence is banned** ("repo doesn't mention Y" ≠ "Y is false"). Added a **Calibration** section (not everything is Critical; acknowledge what's clean; explicit DON'Ts) + a "**don't trust the report** — verify by reading code; hunt over-engineering + solved-wrong-problem" philosophy line (absorbed from superpowers' spec-reviewer).
- `skills/quality-pipeline/references/code-review.md`: new **"Consuming a finding — verify before implementing"** step in Handoff Consumption (findings are suggestions to evaluate, not orders; verify against the codebase; push back with technical reasoning; YAGNI-grep; **no performative agreement** — no "You're absolutely right!"/thanks; one fix at a time). Operationalizes the `verify-reviewer-claims` discipline on the consumer side.
- `docs/BACKLOG.md`: retired the `reviewer-livefact-confabulation` 🔴 entry (now fixed).
- Design record + the full dialectic that descoped a larger proposal: `docs/plans/2026-06-04-review-verify-barrier.md` (verify-barrier / spec-gate / Workflow fan-out all deferred with explicit triggers).

### Rollback
- Maintainer: `git revert <merge-sha>`

## v2.12.0 — `research-to-ship` skill (pinned research→plan→dialectic→project→dev-flow pipeline)

**Headline**: a new orchestrator skill for a recurring ritual — start from a *topic*, and get best-practice research → a written plan → a **multi-round dialectic review loop** → a tracked project → step-by-step dev-flow execution, with a **human approval gate between every phase**. It's a *thin* skill: it pins the sequence and the gates, and delegates the real work to existing skills (`survey`/`deep-research`, `think-tank-dialectic`, `project-lifecycle`, `dev-flow`, `quality-pipeline`, `finish-flow`). The dialectic loop is **pinned on** (unlike `ceo-agent`, which only escalates to it conditionally). Researched against the Claude Code primitives first: the Workflow tool was rejected (it can't pause mid-run for the human gates), `/loop` is interval-polling (wrong shape), and `/goal` is offered only for Phase-5 execution where a transcript-checkable finish line exists.

### Added
- `skills/research-to-ship/SKILL.md` — 18th skill. Invoke `autopilot:research-to-ship <topic>`. Participatory (you approve each gate); coexists with `ceo-agent` (full autonomy) and `dev-flow` (starts at "we know what to build"). Multi-agent portable; only the optional Phase-5 `/goal` is Claude-Code-specific and degrades cleanly.

### Changed
- Skill count 17 → 18 across README (badge + prose + skill table) and CLAUDE.md.

### Rollback
- Maintainer: `git revert <merge-sha>`
- User-side: `/plugin update autopilot @v2.11.1` (the skill is inert if never invoked).

## v2.11.1 — fix: `distill-consolidate.sh migrate` must rewrite frontmatter `name:`

**Fix**: v2.11.0's `migrate` only `git mv`'d the skill directory to its normalized slug but left the frontmatter `name:` stale — so two machines would converge on the directory while still diverging on `name:`, which is the skill's actual identity. The engine would never truly converge. `migrate` now rewrites the first `name:` line to the normalized slug (byte-preserving the rest of the file) alongside the dir rename, idempotently fixing a stale `name:` even when the dir is already normalized. JSON output gains a `name_fixed` array. Caught by inspecting a real migration before committing. Test fixture upgraded to real frontmatter; +3 assertions (29 total).

### Rollback
- Maintainer: `git revert <merge-sha>`

## v2.11.0 — distill cross-machine consolidate (slug-normalize + proactive merge)

**Headline**: when two fleet machines distil the **same** recurring procedure, `/distill` now converges them automatically instead of stopping on a raw git conflict. A deterministic **slug normalizer** (Step 4) makes independent namings of one procedure land on a single path (`fix-git-identity`, `git-identity-fix`, `ensure-git-identity` → `git-identity`), and Step 5 does a **proactive** divergence check (`compare` against the pack's `@{u}` *before* committing the push) so the human-gated LLM merge happens in the clean working tree — **never inside a held rebase/merge transaction**. Shipped after two dialectic review rounds that cut a held-rebase design (it inverted git's `:2:`/`:3:` stages and could wedge the pack) and a per-host-staging design (it regressed Claude Code skill loading and used a self-defeating content-hash key); see [`docs/plans/2026-06-04-distill-consolidate.md`](docs/plans/2026-06-04-distill-consolidate.md).

### Added
- `scripts/distill-consolidate.sh` (deterministic, no LLM): `normalize-slug <raw>` (lowercase + drop a tiny stopword set + **preserve token order** — converges naming divergence while keeping antonyms like `add-user`/`remove-user` distinct), `migrate [pack]` (one-time rename of existing dirs to normalized slugs; STOPs when two dirs collide on one slug — a real consolidation case), `compare <slug> [pack]` (proactive divergence check vs `@{u}` → JSON `identical`/`divergent`/`absent-theirs`/`absent-mine`; requires a configured upstream, never guesses `origin/<branch>`).
- `hooks/tests/distill-consolidate.test.sh` — 26 assertions: normalize convergence + antonym-safety + all-stopword fallback; migrate rename/idempotent/collision-STOP; compare all four statuses + no-upstream/non-git guards (bare+two-clone fixture).

### Changed
- `skills/distill/SKILL.md`: Step 4 normalizes the pack slug; Step 5 replaces "STOP on conflict (deferred consolidate)" with the proactive `compare` → human-gated LLM-merge → normal commit flow + a one-time `migrate` note; the "Deferred" section is un-deferred. `references/sync-setup.md`: migration steps + a **fleet-rollback runbook** (`git revert` works because the consolidation is a normal commit, not a merge commit; documents the peer-re-consolidated descendant case).
- **Correctness boundary** (stated in SKILL.md): the scripts are tested for git-plumbing; the **LLM merge quality is human-gated, not test-gated**.

### Rollback
- Maintainer: `git revert <merge-sha>`
- User-side: `/plugin update autopilot @v2.10.2` + `rm -f ~/.autopilot/distill/slug-stopwords` (the new scripts are inert if unused; no migration is auto-run).

## v2.10.2 — distill incremental cursor + batch-approval UX

**Headline**: `/distill` is now cheap to re-run and lower-friction to approve. `distill-scan.js` gained a **per-session cursor** (`--incremental` / `--new-only`) so a routine re-scan only re-reads sessions that are new or changed since last time, then reports just the candidates whose recurrence **rose this run** — "what's newly worth distilling" instead of re-proposing everything you already triaged. The skill's human review gate is unchanged in substance but collapsed in friction: present the whole candidate list once and accept a **batch multi-select** rather than one yes/no per candidate, followed by **one** "push back to the shared pack?" prompt.

### Added
- `scripts/distill-scan.js --incremental`: reuses cached per-session atoms from `~/.autopilot/distill/scan-state.json` (keyed by `{size, mtime}`); only new/grown session jsonl is re-read. **Cumulative totals stay identical to a full scan** — the ≥N× value gate is unaffected (asserted by a parity test).
- `scripts/distill-scan.js --new-only`: like `--incremental`, but filters the report to candidates whose cumulative count rose this run (the cursor's "what's new since last time" view).
- `DISTILL_SCAN_ROOT` env seam on the scanner (testability) + `hooks/tests/distill-scan-incremental.test.sh` (9 assertions incl. full-vs-incremental count parity).

### Changed
- `skills/distill/SKILL.md`: Step 1 uses the incremental cursor on routine runs; Step 3 review gate is now a **batch multi-select** (lint still runs per-candidate first and gates the batch — a lint-flagged identifier can never ride into the pack on a batch tick); Step 5 adds a single "push back to the shared pack?" yes/no that does `pull --rebase` then `push`, stopping on same-name conflict (the deferred multi-machine `consolidate` case — never auto-merge another machine's skill).

### Rollback
- Maintainer: `git revert <merge-sha>`
- User-side: `/plugin update autopilot @v2.10.1` + `rm -f ~/.autopilot/distill/scan-state.json`

## v2.10.1 — distill onboarding hardening

**Headline**: the `distill` pack-sync onboarding shipped a **silently broken** `.gitignore` fix — `.claude/` + `!.claude/skills/` does *not* track a project-scoped skill (git cannot re-include a path under a fully-excluded parent), so any teammate following it got skills that never propagated. Fixed, and replaced the hand-copied git plumbing with a deterministic, idempotent setup script plus a guided first-run flow inside the skill.

### Fixed
- `skills/distill/references/sync-setup.md` — corrected the broken negation to the working `.claude/*` + `!.claude/skills/` form, with an explanation of *why* the obvious form fails (verified empirically: `git check-ignore` on the probe path).

### Added
- **`scripts/distill-sync-setup.sh`** — onboarding plumbing: `status` (state as JSON + next-step hint), `init-remote <url>` (pack machine #1 backup remote), `enroll <url>` (clone the pack on a new machine), `fix-gitignore [repo]` (make a repo track `.claude/skills/` with the correct form — handles bare `.claude/`, `.claude/*`, and recursive `.claude/**`; verifies via `check-ignore`). Every subcommand idempotent.
- `skills/distill/SKILL.md` Step 5 — guided first-run setup: detect state via the script, `AskUserQuestion` only when a decision is genuinely needed (this machine's role / remote URL), then call the script. No more hand-copied commands.

### Changed
- CLAUDE.md scripts inventory + distill SKILL.md "Available scripts" + sync-setup.md: document the new script as the primary onboarding path.

### Rollback
- Maintainer: `git revert <merge-sha>`

**Headline**: autopilot now **deepens Claude Code** with three of its session-control primitives while staying multi-agent-portable (each is capability-gated with a documented non-CC fallback). A new `.githooks/post-merge` advisory closes the release-ritual toil loop — when a merge lands on develop/main it surfaces the merge SHA (ready to paste) plus the `preflight-release.sh` status, **without ever blocking or auto-committing**. `ceo-agent` gains `/goal` as an optional convergence engine, a shipped `loop.md` template enables unattended branch babysitting, and the quality gate can wait on CI-backed tests via `Monitor` instead of busy-polling.

### Added
- **`.githooks/post-merge`** — release-ritual advisory. Fires only on a true merge commit (2+ parents) landing on `develop`/`main`; prints the short SHA + a paste-ready `docs: record merge SHA` tip + `preflight-release.sh` summary (full report only when something drifts). Always exits 0 — an advisory must never disrupt git flow. Auto-activates via the existing `core.hooksPath=.githooks`. Deliberately does **not** block (impossible post-merge) and **not** auto-commit (a hook-authored commit is a surprising one-way door).
- **`project-config-template/loop.md`** — default prompt for a bare `/loop`: unattended babysit of the current branch (continue work → tend PR/CI → `autopilot:quality-pipeline` before "done" → stop when clean), with hard constraints against unauthorized irreversible actions and scope drift. CC-only (v2.1.72+); copy to `.claude/loop.md` or `~/.claude/loop.md`.
- **`/goal` convergence primitive** in `ceo-agent` — recommend a transcript-checkable OKR condition so the session converges autonomously; coexists with autopilot's side-effect-only Stop hooks; degrades to per-phase re-prompting where `/goal` is unavailable. Requires CC v2.1.139+.
- **`Monitor` CI-polling** — capability-gated note in `quality-pipeline` Tests (canonical) + a pointer from `finish-flow` L-5.2: wait on CI-backed/long-running test commands via `Monitor` instead of busy-looping `gh run watch`; falls back to manual polling elsewhere.
- **`references/multi-agent-portability.md` §7** — "Harness primitives are Claude-Code-only (capability-gated)": `/goal` / `/loop` / `Monitor` table with official-doc sources, autopilot integration points, and per-primitive non-CC fallbacks.

### Changed
- `CLAUDE.md` scripts inventory + `scripts/install-hooks.sh` header: document the new `post-merge` hook alongside `pre-commit`.
- `README.md` config-template table: add the `.claude/loop.md` row.

### Hook-order semantics reminder
- The new `post-merge` is a **git hook** (fires on the `git merge` / `git pull` event), not a Claude Code lifecycle hook — the CC parallel-matcher ordering caveat does not apply to it.

### Rollback
- Maintainer: `git revert <merge-sha>`

## v2.9.1 — distill durability hardening

**Headline**: `distill` now commits each approved skill **at approval time** (`commit-on-approve`) instead of leaving it as a loose uncommitted file — so an approved skill survives concurrent sessions / crashes (it's in git history immediately). Docs reframe the pack remote as **durability-required (backup, not just sync)**: a remote-less pack is a single on-disk copy, one `rm -rf` from total loss.

### Changed
- `skills/distill/SKILL.md` Step 4: write **and commit** the approved global skill atomically into the pack; project writes stay unstaged (user's repo). Step 5 sync = propagate the already-made commit.

### Fixed
- Durability gap: approved-but-uncommitted skills were vulnerable to loss under the concurrent-session races common on shared machines. Now loss-safe locally; worst concurrency case = a same-skill merge conflict (deferred `consolidate`), never lost data.

## v2.9.0 — distill (recurring procedures → your personal skills)

**Headline**: New `distill` skill — autopilot ships a *distiller* that mines your local conversation history for recurring procedures and corrections and turns the ones you approve into **your own personal skills**, routed into your skill dirs (a private `autopilot-distill-skills@skills-dir` pack for global, `<project>/.claude/skills/` for project-scoped). autopilot ships only the factory; the distilled skills are yours and never enter autopilot's repo. Sync across your fleet via the pack repo (git) or Syncthing.

### Added
- `skills/distill/` — scan → review (human gate + identifier lint + deny-list) → scope-aware write. Privacy: de-identified by construction + approval gate; raw history never leaves the machine.
- `scripts/distill-scan.js` — deterministic full-history scanner → frequency atoms in two buckets (ritual + correction candidates); `--real-only`, `--json`, `--top N`. No LLM in the count path.
- `skills/distill/references/sync-setup.md` — fleet enrollment (pack-as-private-repo / Syncthing).

### Notes
- Multi-machine `consolidate` (merging the same procedure distilled on N machines) is deliberately **deferred** until a real cross-machine conflict occurs (plan §0.3.1). Self-use-first; publish-grade de-id hardening is a later phase.

## v2.8.1 — Hook follow-ups: suggest-compact revived + dead-dispatch guidance

**Headline**: Closes the actionable hook follow-ups left after the v2.8.0 transcript pivot. `suggest-compact` is wired and working again (it never needed transcript recovery — it only counts `Write|Edit` calls; the one bug was that its `/dev/stdin` read threw ENXIO *before* the counter incremented, so it silently never fired). Adds a deterministic, docs-only way to tell when your PostToolUse dispatch has died mid-session (and how to recover), after a 5-role dialectic review found the auto-detector design non-functional and deferred it to a spike. Two stale hook docs are brought in line with v2.8.0 reality.

### Added
- **`hooks/suggest-compact-lib.js`** — pure `compactDecision(count)` threshold logic, unit-tested.
- **`hooks/suggest-compact.test.js`** — 9 tests: threshold boundaries (49 silent / 50 nudge / 51-74 silent / 75 nudge / unbounded 100,125) + a subprocess test proving the counter increments without a real stdin payload (the ENXIO regression) + the `AUTOPILOT_SUGGEST_COMPACT=false` opt-out.
- **`hooks/README.md` "Is my PostToolUse dispatch dead?"** — deterministic manual check (run a `Bash` tool → did `~/.claude/bash-commands.log` gain a line?) + recovery (full restart; `/clear` and `/reload-plugins` do not re-init dispatch). Valid on v2.8.0+.

### Fixed
- **suggest-compact re-enabled** — `/dev/stdin` read isolated in its own inner try so the counter increments under ENXIO; wired under a `Write|Edit` PostToolUse matcher block; `AUTOPILOT_SUGGEST_COMPACT=false` opt-out added.

### Changed (docs)
- **`hooks/README.md`** — reconciled the contradictory suggest-compact rows (removed it from "still disabled"; fixed the threshold drift "50/75/100" → unbounded "50, then every 25"); added a "`/compact` ≠ real PreCompact for testing" caveat (cites the 2026-05-14 method-B observation).
- **`docs/BACKLOG.md`** — "Re-enable v2.7.4 disabled hooks" rewritten to reflect that the PostToolUse log-only hooks are done (v2.8.0/v2.8.1); remaining split into PreToolUse blockers (gated on #6305) vs Stop-event hooks (separate). Dead-dispatch auto-detector marked SPIKE-GATED with the dialectic rationale. New entry logging the stale "12 default-on" hook tally (deferred, pre-existing).

### Hook-order semantics reminder
- Claude Code hooks run **in parallel / non-deterministic order across different matcher blocks** (PostToolUse `Write|Edit` vs `.*` are independent). Only **intra-matcher** sequencing is guaranteed. suggest-compact's new `Write|Edit` block carries no cross-block ordering guarantee.

### Notes
- Tier counts unchanged (suggest-compact was always counted in the 19/12 Tier A tally; this only wires it). The broader "12 default-on" tally is stale post-v2.7.4 — logged to BACKLOG, deliberately not half-fixed here.
- The dead-dispatch auto-detector (SessionStart-side) was **deferred**: a 5-role dialectic (0/5 for shipping the heuristic) found it non-functional — intent file keyed by `sha1(cwd)` not session_id, SessionStart runs before the new id is written, and dispatch dies mid-session while SessionStart only fires at the next (already-fresh) entry. Replaced by the deterministic manual check above + a spike-gated BACKLOG entry.
- Project: `docs/projects/2026-06-02-hook-followups/`.

### Rollback
- `git revert -m 1 <merge-sha>`. suggest-compact returns to unwired; docs revert. No data loss.

## v2.8.0 — Hook transcript pivot: revive tool-event hooks without stdin

**Headline**: Claude Code never pipes stdin to PreToolUse/PostToolUse hooks (ENXIO; upstream #6305, re-confirmed at 2.1.159), which silently broke every hook depending on `tool_input`/`tool_response` (disabled in v2.7.4). This release recovers tool data from the **session transcript JSONL** instead, re-enabling the PostToolUse hooks. A 4-point spike (structure / recoverability / path-discovery via `CLAUDE_CODE_SESSION_ID` / write-timing) confirmed feasibility against real transcripts before any code.

### Added
- **`hooks/transcript-reader-lib.js`** — pure `findLatestToolEvent()` + `resolveTranscriptPath()` (UUID glob, no cwd-encoding assumption) + fail-open `readLatestToolEvent()` / `getToolEvent()` (stdin-first, transcript-fallback). 9 unit tests.
- **`hooks/_transcript-timing-probe.js`** — opt-in diagnostic to confirm intra-cycle write-vs-dispatch timing in a fresh session (not wired by default).

### Fixed (re-enabled via transcript pivot)
- **intent-capture** — `last_tool` is populated again (was `<unknown>`); adds `last_tool_source`.
- **audit-log** — recovers `tool_input.command` → `~/.claude/bash-commands.log`.
- **log-error** — recovers `tool_response` + `is_error` → `~/.claude/error-log.md`.
- **failure-escalation** — recovers Bash `is_error` → escalation counter.
- Each smoke-verified producing its artifact via the transcript; +3 L2 tests (29 test files total).

### Notes
- **PreToolUse hooks stay disabled — permanently unrecoverable** by this approach (the tool hasn't run, so no transcript entry exists): large-file-warner, branch-protection, commit-secret-scan.
- **Out of scope (follow-up, BACKLOG)**: suggest-compact (PostToolUse — recoverable, deferred); cost-tracker + session-summary (Stop events, env-driven — not tool-event-stdin).
- Project: `docs/projects/2026-06-02-hook-transcript-pivot/`. Tier counts unchanged (the re-enabled hooks were always "default-on" tier, just temporarily off).

### Rollback
- `git revert -m 1 <merge-sha>`. Hooks revert to disabled (v2.7.4 state); no data loss.

## v2.7.7 — Maintenance: doc-rot fixes + skill leverage extraction

**Headline**: Two maintenance efforts driven by `/next` deep scans, shipped together. (1) A `/next --deep` link audit found shipped skills citing reference files that were **never created**; this release authors the missing canonical references, fixes the broken links, and closes the validator gap that hid them. (2) A behavior-preserving refactor trims the always-loaded tail of two over-200-line skills by relocating passive leaf content to `references/`.

### Fixed (doc-rot — level-3 batch)
- **Authored `quality-pipeline/_base/prohibited-behaviors.md`** — `test-policy.md` (×2) and `code-review.md` (×1) cited *"Full list: ../_base/prohibited-behaviors.md"*, a file that never existed. Now a real consolidated canonical list (test-failure / pre-existing-error / code-review prohibitions).
- **Authored `project-lifecycle/references/templates.md`** — `project-structure.md` (×2) cited a missing templates file via a **doubled** `references/references/` path. Now a real file (README/ADR/dev-info/phase-N skeletons + phase-merging rules); the citing path is corrected to the sibling `templates.md`.

### Added
- **`scripts/validate.sh` link-check, hardened.** It previously scanned only `SKILL.md` with a `references/`-prefix-only regex — so broken links inside reference docs, `../_base/x.md`, and doubled paths all shipped undetected. It now validates **every relative `.md` link in every skill-local doc** (SKILL.md + references/ + _base/), resolving against the file dir or repo root, while **skipping links inside fenced code blocks** (template/example placeholders). New regression test `hooks/tests/validate-link-check.test.sh`.

### Changed (skill leverage extraction)
- **dev-flow** (645 → 618 lines): Context Continuation (resume-path-only) → `references/context-continuation.md`; Post-Feature Doc Sync → `references/post-feature-doc-sync.md`. Forcing functions, gates, and cross-skill-named sections (Scope Audit L-1.5, H Workflow H-1, Session-End L-Full cited by finish-flow:64, dimensions checklist cited by ceo-agent:224) kept **inline** — review confirmed extracting them would silently regress the finish-flow forcing mechanism.
- **retro** (225 → 130 lines): Step 1 data-collection commands → `references/data-collection.md`; Step 4 output-report templates → `references/report-templates.md`. Step 1-6 sequence kept inline.

### Notes
- Scope-cut (refactor): think-tank-dialectic (342) and ceo-agent (335) evaluated and **rejected** as negative-ROI churn (mostly inline control flow). Project: `docs/projects/2026-06-02-skill-leverage-extraction/`.
- Deferred to BACKLOG with triggers: 4 orphaned 2026-05-14 plan docs; `_bodies/*.body.md` relative-link depth bug (generated artifact, low severity, not CI-failing).
- Verification: `validate.sh` 16/16 (new link-check), completeness clean, **26 test files** green, `preflight-portability.sh` 12/12, `preflight-release.sh` green.

### Rollback
- Maintainer: `git revert -m 1 <merge-sha>`, or revert individual phase commits. Skill-leverage refactor shipped earlier on develop as merge `a4c5db6` (commits 6d62ee0 / e1a9974 / 69b29ca).

## v2.7.6 — Hook-polish batch (3 backlog items, now test-covered)

**Headline**: Three small backlog fixes that the v2.7.5 test harness made cheap+safe to land — each ships with a regression test. A dialectic review round caught a Major (empty-file disable-flag parity gap) before merge.

### Fixed
- **state-checkpoint symlink-reject diag echoes `$HOME`** (Item A). The "transcript path resolves outside HOME" failure detail now reads `resolved=<path> (HOME=<homedir>)` so users with `CLAUDE_CONFIG_DIR` overrides or cross-volume symlinks can see *why* it was rejected. (Backlog: v2.7.2 L-5.2 Suggestion #1.)
- **Failure-counter mtime cleanup** (Item B). `hooks/state-checkpoint-lib.js` gains `selectFailureCounter`: `.failure_count_*` files older than 7 days are excluded from "current" selection AND unlinked as orphans, so the scan can't grow unbounded. (Backlog: v2.7.2 L-5.2 Suggestion #2.)
- **Malformed / empty disable flag self-heals** (Item C). `intent-capture` disable flag with invalid JSON — or a 0-byte partial write (the most common ENOSPC outcome) — now auto-clears (`clear_malformed` decision) instead of wedging the hook with no recovery path but manual `rm`. `null` (read-failed, transient) still leaves the flag active. OpenCode plugin (`.opencode/plugins/autopilot.ts`) given matching parity. (Backlog: v2.7.2 L-5.2 Suggestion #3.)

### Tests
- `hooks/state-checkpoint.test.js`: +6 L1 unit tests for `selectFailureCounter` (freshest-wins, stale-excluded, all-stale, override, boundary).
- `hooks/intent-capture.test.js`: malformed→clear_malformed, empty/whitespace→clear_malformed, stale-precedence.
- `hooks/tests/`: symlink-reject extended to assert `HOME=`; new `intent-capture-disable-flag-malformed.test.sh` + `intent-capture-disable-flag-empty.test.sh`.
- Full suite: 25 test files green.

### Review
- 1 dialectic review round. Major caught: `disableFlagDecision`'s `if (flagContentJson)` guard treated a present-but-empty `''` as falsy → left the Node hook wedged on a 0-byte flag while the OpenCode plugin cleared it. Fixed by distinguishing `null` (read failed → active) from `''` (present-but-empty → clear_malformed) + a 0-byte L2 fixture.

### Rollback
- Maintainer: `git revert <merge-sha>`. All changes additive; the lib helpers are pure + unit-tested, wrappers verified via the existing smoke tests.

---

## v2.7.5 — Test Suite Foundation

**Headline**: Closes the long-standing "autopilot has zero automated test infrastructure" gap (filed in backlog 2026-05-14 after the v2.7.3 sync-version Critical was only caught because a reviewer agent happened to run the script). Three-layer pyramid: L1 unit tests via `node:test` against pure-helper libs, L2 integration tests via bash + `hooks/tests/run.sh` umbrella, GitHub Actions CI. Two highest-complexity hooks (state-checkpoint, intent-capture) refactored to extract pure helpers into `*-lib.js` modules for testability; wrappers keep all fs/process IO. Smoke-test parity verified pre/post the refactor (R1 mitigation). 23 test files total (5 L1 + 18 L2 = 78+ assertions). 1 dialectic review round caught a Major (sync-version tests mutating live repo files); fixed by adding a sandbox helper that copies sync-version.js + the 5 tracked manifests into `$TEST_TMP/sandbox/`.

### Added
- **`hooks/tests/lib.sh`** — assertion helpers + per-test sandbox (`mktemp -d`, redirected `HOME` AND `TMPDIR`, auto-cleanup on EXIT). `run_hook` spawns the script under sandbox env with stdin/stdout/stderr capture. `setup_sync_version_sandbox` builds a self-contained mini-repo for sync-version tests so live manifests are never touched.
- **`hooks/tests/run.sh`** — umbrella runner. Discovers L1 (`hooks/*.test.js` → `node --test`) and L2 (`hooks/tests/*.test.sh`) tests. Per-file pass/fail + aggregate exit. Substring filter as first arg.
- **`hooks/tests/README.md`** — framework docs + "writing a new test" recipes for both layers.
- **`hooks/state-checkpoint-lib.js`** — pure helpers extracted: `truncateUtf8Safe`, `renderContentBlocks`, `extractTurn`, `parseTranscriptText`, `buildTranscriptTail`, `emitFailure` (+ constants `PER_TURN_BUDGET` / `THINKING_BLOCK_CAP` / `MAX_LINE_BYTES`). No fs/process IO.
- **`hooks/state-checkpoint.test.js`** — 27 L1 unit tests covering codepoint-boundary truncation, content-block rendering, transcript parsing edges (CRLF, malformed, oversize), tail building (newest-exempt, older-truncated, byte-cap-drop), emitFailure shape + stderr sink.
- **7 L2 integration tests** under `hooks/tests/` for state-checkpoint covering R10-A through R10-K scenarios from the original test-suite plan (empty stdin, missing transcript, malformed JSONL, thinking-only newest, newest-verbatim regression for v2.7.2 fix, CRLF transcript, symlink-rejection security guard).
- **`hooks/intent-capture-lib.js`** — `summarizeToolInput` + `disableFlagDecision` pure helpers; constants `FAILURE_THRESHOLD=10` / `STALE_DISABLE_HOURS=24` / `SUMMARY_MAX_LENGTH`.
- **`hooks/intent-capture.test.js`** — 17 L1 unit tests covering tool-input summarization (precedence, ellipsis, empty-string-as-absent) and disable-flag decision branches (no_flag/clear_stale/clear_version/active, malformed JSON → active, staleHours override).
- **6 L2 integration tests** for intent-capture: basic write path + mode 0600, env opt-out short-circuit, stale-flag auto-clear, version-mismatched flag auto-clear, active flag suppresses write, long-command summary truncation end-to-end.
- **6 L2 integration tests** for sync-version: --dry-run (no writes, all 5 mirrors byte-identical), invalid version rejected, invalid counts rejected, --check on clean tree, --check detects drift, full round-trip byte-identity. All run inside `$TEST_TMP/sandbox/` — live repo never touched.
- **`hooks/tests/all-hooks-fail-open.test.sh`** — every hook script (20 Node + 1 bash) must exit 0 on `{}` payload. The regression net for syntax errors, missing-field crashes, accidentally-required env vars across the whole hook directory.
- **`hooks/tests/reload-watch-detects-mtime-change.test.sh`** — happy path for the third active Node hook; first-run silent init, subsequent change fires "Plugin catalog signal changed" warning.
- **`.github/workflows/test.yml`** — Node 22 LTS Ubuntu CI running setup-symlinks → tests → sync-version --check → sync-agent-bodies --check → preflight-release → preflight-portability. Triggers on push to develop/main + PR + manual dispatch.
- **`docs/projects/2026-06-01-test-suite-foundation/README.md`** — project tracking doc.

### Changed
- **`hooks/state-checkpoint.js`** — wired to import from `state-checkpoint-lib.js`. `emitFailure` wrapper injects `process.stderr`; `parseTranscript` is a thin `fs.readFileSync` shim around `parseTranscriptText`; `buildTranscriptTail` shim forwards env-overridable `TRANSCRIPT_TAIL_N` / `TRANSCRIPT_BYTE_CAP` into the lib. Smoke-test parity verified.
- **`hooks/intent-capture.js`** — wired to import from `intent-capture-lib.js`. `checkDisableFlag` reduced to the fs side; decision logic goes through `disableFlagDecision`. Inline `summarizeToolInput` removed in favor of the lib export.
- **`.claude/quality-gate-config.md`** — `Test Command: N/A` → `bash hooks/tests/run.sh`. The "autopilot ships only prose" rationale is no longer true.
- **`agents/reviewer.md` Workflow §7** — adds "Run the project's test suite as a pre-merge gate" step. Non-zero exit is a 🔴 Critical finding. Falls back to the project's `.claude/quality-gate-config.md` Test Command for non-autopilot repos. `agents/_bodies/reviewer.body.md` regenerated via pre-commit gate.

### Rollback
- Maintainer: `git revert <merge-sha>`. The lib refactor is the only behavior-touching change; the wrappers were verified byte-equivalent via the smoke test (state-checkpoint-empty-stdin) before and after. If reverted, the tests under `hooks/tests/` will also disappear cleanly (no other code references them outside the workflow file).

---

## v2.7.4 — Post-portability follow-ups (OpenCode parity + release-hygiene + agy fact correction)

**Headline**: Three follow-ups from the v2.7.3 ship's out-of-scope list, executed as a CEO-triaged project ([docs/projects/2026-05-29-post-portability-followups](docs/projects/2026-05-29-post-portability-followups/README.md)). The headline is an **empirical correction**: installing real `agy` 1.0.1 overturned both the original PM claims AND v2.7.3's "fact-version" — `agy plugin validate` and the root-`plugin.json` requirement are genuine (v2.7.3 had wrongly labelled them fabricated). Spike-before-assert cuts both ways.

### Added
- **`scripts/preflight-release.sh`** — release-hygiene gate (5 checks): canonical version parseable, CHANGELOG entry present, version mirrors in sync, INDEX references the version, all INDEX project-README links resolve. Wired into `finish-flow` L-5.5. Prevents the doc-drift class that bit v2.7.3 (version bump with no CHANGELOG entry / colliding INDEX labels). Negative-tested (phantom version fails checks 2/3/4).
- **OpenCode circuit-breaker** in `.opencode/plugins/autopilot.ts` — disable-flag / failure-counter / stale-clear parity with `hooks/intent-capture.js`. 10 consecutive intent-write failures → disable flag; auto-clears on staleness (>24h) or plugin-version bump. OpenCode-specific flag filenames (`opencode-intent-capture.disabled`) so the two runtimes don't cross-contaminate state.

### Changed
- **`scripts/install-antigravity.{sh,ps1}`** — rewritten from the wrong symlink-into-`~/.gemini/antigravity/skills/` model (from a codelabs walkthrough) to the **real `agy` plugin model**: `agy plugin validate → install → list`. Verified end-to-end against `agy` 1.0.1 (install + uninstall).
- **`references/multi-agent-portability.md`** — corrected the Antigravity rows and the "NOT verified" section. `agy plugin validate` moved to a new "Corrected — previously mislabelled" subsection. Root `plugin.json` documented as having two real consumers (agy validate + npm/GitHub metadata), not "metadata only". `Last verified` bumped to 2026-05-29 (agy 1.0.1).
- **`AGENTS.md` + `CLAUDE.md`** — Spike-before-assert lesson reworded to note it "cuts both ways" (fabrication AND over-correction); skill-sharing paths corrected (Antigravity uses plugin import, not a `.agents/skills/` scan).
- **`README.md` §Antigravity** — install snippet updated to the `agy plugin validate → install → list` flow.
- **`CLAUDE.md` scripts inventory** — backfilled 6 v2.7.3 scripts that existed but were unlisted (sync-agent-bodies, preflight-portability, preflight-release, setup-symlinks, install-antigravity, install-hooks).

### Empirical findings (agy 1.0.1, 2026-05-29)
- `agy plugin {validate,install,uninstall,list,enable,disable,import,link}` — full verified subcommand set.
- `agy plugin validate <repo>` → `[ok]` (16 skills / 5 agents / 25 hooks); **requires root `plugin.json`** (removing it → `Error: missing plugin.json`).
- `agy plugin install <repo>` → imports as `source: claude-code`, registering skills + agents + hooks.
- Still **unverified**: `AGY_PLUGIN_ROOT` / `GEMINI_PLUGIN_ROOT` env vars; whether agy fires the imported hooks at runtime.

### Rollback
- Maintainer: `git revert <merge-sha>`. All changes additive (new script, OpenCode-only plugin logic, doc corrections); no Claude Code runtime behavior changed.

---

## v2.7.3 — Multi-Agent Portability Correction + disable-batch + capture-payload

**Headline**: Aggregates three batches of post-v2.7.2 work that all shipped to develop without an intervening canonical version bump:

1. **Multi-Agent Portability Correction** (this release's headline, 2026-05-22~27): reverts and replaces 3 previous commits (`bf0c637`, `b7d1adb`, `139ca49`) that shipped fabricated cross-platform support — env vars (`CODEX_PLUGIN_ROOT`, `AGY_PLUGIN_ROOT`, `GEMINI_PLUGIN_ROOT`) that don't exist, CLI subcommands (`agy plugin validate`) that don't exist, hook fallback chains that broke runtime on every non-Claude host. Replaced with **empirically verified** OpenCode integration (3 Spikes against real OpenCode 1.15.10), `.agents/skills/` cross-agent intersection symlink, and a canonical-mirror version manifest split with pre-commit drift gate. **4 rounds of dialectic review (Architect / Ops / Skeptic)** documented in the plan; each round caught self-inflicted bugs introduced by the prior round, including a latent `__dirname` 3-level arithmetic bug in the existing OpenCode plugin that had been silently returning `"unknown"` since `bf0c637`.

2. **Hook disable batch** (originally drafted as v2.7.4, 2026-05-14): fresh-claude transcript diagnostic (Claude Code 2.1.128–2.1.141) confirmed Claude Code **never** pipes stdin to PreToolUse / PostToolUse / Stop hook events on Linux + Bun-spawned-Node. All `tool_input` / `tool_response` / `usage`-dependent hooks were silent-skipping. `hooks/hooks.json` simplified from 13 entries to 4 — only `PreCompact` + `SessionStart` (stdin-pipe-working) plus `PostToolUse .*` (stdin-tolerant: intent-capture, reload-watch) survive.

3. **SESSION_ID env-var fix** (`a2cd815`): 6 hooks were reading `process.env.CLAUDE_SESSION_ID` but Claude Code actually sets `CLAUDE_CODE_SESSION_ID`. All hooks' `getSessionId()` were falling back to cwd-hash. Fixed so SessionStart / PreCompact-class hooks now join the real session UUID.

### Added
- **`.agents/skills/ → ../skills` symlink** — single path scanned natively by OpenCode and by Codex's skill discovery walk-up; reused by Antigravity install script. Replaces the per-platform skill duplication attempted in `bf0c637`.
- **`agents/_bodies/<role>.body.md`** — YAML-frontmatter-stripped copies of `agents/{reviewer,debugger,planner}.md` for OpenCode `{file:..}` reference (avoids leaking `name:` / `tools:` / `model:` into agent prompt body).
- **`scripts/sync-agent-bodies.sh`** — generates `_bodies/` from canonical `agents/<role>.md`; `--check` mode wired into `.githooks/pre-commit`.
- **`scripts/sync-version.js --check`** — read-only canonical-vs-mirror drift detector. Canonical = `.claude-plugin/plugin.json`; mirrors = root `plugin.json` + `README.md` badges + `hooks/README.md` hook count. Pre-commit gate.
- **`scripts/setup-symlinks.{sh,ps1}`** — ensures `.agents/skills/` resolves correctly post-clone. PowerShell variant detects `UnauthorizedAccessException` and points user to Developer Mode. Wired into `scripts/dev-setup.sh` line 54-56 anchor (after Validate section, before marketplace registration).
- **`scripts/install-antigravity.{sh,ps1}`** — symlinks `skills/` into `~/.gemini/antigravity/skills/autopilot`. Script header `# verified-against: codelabs walkthrough 2026-05-22` flags when target path may have drifted upstream. **⚠ Superseded in v2.7.4**: empirical `agy` 1.0.1 testing showed this symlink model is wrong; the real mechanism is `agy plugin install`. See v2.7.4 entry.
- **`scripts/install-hooks.sh`** — one-time `git config core.hooksPath .githooks` activation. Required after clone before pre-commit gates fire.
- **`scripts/preflight-portability.sh`** — 12-check acceptance bundle (intent-capture × 3, session-start × 2, sync-version, sync-agent-bodies, .agents/skills, validate.sh, OpenCode × 3). Self-skips OpenCode checks when binary not installed.
- **`.githooks/pre-commit`** — runs `sync-version.js --check` and `sync-agent-bodies.sh --check`. Activated via `scripts/install-hooks.sh`.
- **`platforms/codex/config.toml.example`** — Codex skill-discovery example. Notes that `.agents/skills/` symlink alone is sufficient for per-repo usage.
- **`.opencode/package.json` + `.opencode/package-lock.json`** — declares `@opencode-ai/plugin@1.15.10` so editors / `npm install` can resolve the `Plugin` type for the local TS plugin.
- **`docs/plans/2026-05-22-multi-agent-portability-correction.md`** — 4-round dialectic-reviewed plan with Spike-results appendix (§A).
- **`docs/projects/2026-05-22-multi-agent-portability-correction/README.md`** — project tracking doc.
- **`hooks/capture-payload.js`** (`9f56a36`) — Tier B opt-in diagnostic hook. Dumps raw stdin + CLAUDE_/AUTOPILOT_ env vars to `~/.autopilot/payloads/<ts>-<pid>-<marker>.json` when `AUTOPILOT_CAPTURE_PAYLOAD=1`. Rotation keep-50 FIFO.
- **`scripts/toggle-payload-capture.sh`** (`7e4d2a1`) — One-shot enable/disable helper for capture-payload. Wires it into 4 matchers via jq, byte-for-byte backup + restore of `hooks.json`.

### Changed
- **`AGENTS.md`** — rewritten as [agents.md](https://agents.md/)-spec readme (Project Structure / Coding Conventions / Testing / PR Guidelines + autopilot-added Build / Contribution, explicitly marked as additive). No more LLM-fabricated env vars or "25 Hooks" claims contradicting `plugin.json`.
- **`CLAUDE.md`** — header note pointing non-Claude agents to AGENTS.md and portability doc; hook count `14 → 19 (12 default-on, 7 opt-in)` per canonical; new Don't entry forbidding unverified cross-platform claims.
- **`references/multi-agent-portability.md`** — fact-version with citation URLs for every claim. Includes "Things explicitly NOT verified" subsection listing `CODEX_PLUGIN_ROOT`, `AGY_PLUGIN_ROOT`, `GEMINI_PLUGIN_ROOT`, `AGENT_PLUGIN_ROOT`, `OPENCODE_PLUGIN_ROOT`, `agy plugin validate` — these explicitly **cannot** be used in code.
- **`.opencode/opencode.json`** — schema cleanup: removed `"skills": { "paths": [...] }` (auto-scan covers it) and `"plugin": ["./.opencode/plugins"]` (directory path invalid; .ts files auto-discover regardless). Agent prompts switched to cross-layer `{file:../agents/_bodies/<role>.body.md}` references (Spike 1 verified).
- **`.opencode/plugins/autopilot.ts`** — `getPluginVersion()` rewritten: `import.meta.url + fileURLToPath` instead of `__dirname` (Spike 0 verified `__dirname` is `undefined` in Bun ESM plugin context); 2-level climb instead of 3-level (Architect R3 catch: 3-level landed at repo's *parent* dir, so version has been silently `"unknown"` since `bf0c637`).
- **`scripts/sync-version.js`** — `editPlan` extended to cover root `plugin.json` + `README.md` badges; `hooks/hooks.json` dropped from editPlan (its `v2.7.4 disable batch` reference is an event marker, not plugin version).
- **`scripts/validate.sh`** — reference-existence check handles 3 SKILL.md reference forms (skill-local / repo-root / sibling-skill). Fixes pre-existing false positives on `audit`, `quality-pipeline`, `team`.
- **`README.md`** — Install section expanded from Claude-Code-only to 4 platforms; Windows symlink prerequisites documented (`git config --global core.symlinks=true` + Developer Mode BEFORE clone).
- **`docs/projects/INDEX.md`** — relabelled the 2026-05-14 retro-roundup row from `v2.7.3` to `v2.7.2-followup` (no canonical version bump occurred in that ship).
- **`hooks/hooks.json`** (from disable-batch work, `c5e5a4c`) — simplified from 13 entries to 4. Only stdin-pipe-working (PreCompact, SessionStart) and stdin-tolerant (PostToolUse `.*` intent-capture + reload-watch) hooks remain wired.
- **`hooks/README.md`** (from disable-batch work) — added "v2.7.4 disable batch" section listing the 9 disabled hooks and their reasons (`large-file-warner`, `branch-protection`, `commit-secret-scan`, `audit-log`, `failure-escalation`, `suggest-compact`, `log-error`, `cost-tracker`, `session-summary`). Note: `hooks/README.md` retains the literal text `v2.7.4 disable batch` as an event marker referring to the disable batch event, not a plugin version label.

### Removed
- `.opencode/skills/{quality-pipeline,think-tank,survey,dev-flow}/references/model-routing.md` — 4 dangling symlinks (`../../../` only climbs to `.opencode/`, not 4 levels needed for repo root). Conditional-rm guard ensures only true dangling links are removed.
- `.opencode/agents/autopilot-{reviewer,debugger,planner}.md` — orphan duplicates now that `opencode.json` defines agents inline with cross-layer `{file:..}` body references.

### Fixed
- **Hook env-var fallback chain reverted** (`hooks/intent-capture.js`, `hooks/session-start.sh` restored to `b1ee7a6` state). The added `CODEX_PLUGIN_ROOT || AGY_PLUGIN_ROOT || GEMINI_PLUGIN_ROOT || path.dirname(__dirname)` chain was non-functional (env vars don't exist) AND combined with the hardcoded `.claude-plugin/plugin.json` lookup would throw on any non-Claude host. `session-start.sh`'s broadened OR-condition also inverted semantics — emitting Claude's `hookSpecificOutput` envelope whenever any of the fabricated env vars happened to be set.
- **OpenCode `getPluginVersion()` silent `"unknown"` regression** since `bf0c637` — the 3-level `__dirname` climb landed at the repo's parent dir, so `plugin.json` was never found. Spike 0 + Architect R3 catch.
- **CLAUDE_SESSION_ID → CLAUDE_CODE_SESSION_ID** (`a2cd815`) — 6 hooks (`intent-capture`, `batch-format`, `accumulator`, `session-summary`, `suggest-compact`, `cost-tracker`) were reading the wrong env var name. All `getSessionId()` calls were silently falling back to cwd-hash. Post-fix, SessionStart / PreCompact-class hooks correctly join the real session UUID.
- **9 silent-broken hooks disabled** (`c5e5a4c`, from disable-batch work) — `large-file-warner`, `branch-protection`, `commit-secret-scan`, `audit-log`, `failure-escalation`, `suggest-compact`, `log-error`, `cost-tracker`, `session-summary`. Script files retained in `hooks/`; re-enable when upstream Claude Code stdin-pipe fix lands. Tracking: `docs/BACKLOG.md` "Claude Code tool-event hooks get NO stdin pipe" entry.

### Hook-order semantics reminder
No hook ordering changes in this release. Existing 4 hook entries in `hooks/hooks.json` (PreCompact / SessionStart / PostToolUse × 2) all properly prefixed with `${CLAUDE_PLUGIN_ROOT}` per Phase 1 audit.

### Rollback
- Maintainer: `git revert 5099d75` (merge SHA)
- User-side: `/plugin update autopilot @v2.7.2`; the v2.7.3 changes are additive (new scripts, new docs, new `.agents/skills/` symlink) so rollback leaves no stale state apart from the symlink which can be removed manually (`rm .agents/skills`).

### Predecessor version-label note
The 2026-05-14 retro-roundup ship (`57c88ee`) and the 2026-05-14 hook-disable-batch ship (`c5e5a4c`) both previously appeared as separate "releases" (retro-roundup labelled v2.7.3 in INDEX; disable-batch drafted as v2.7.4 in CHANGELOG). Neither bumped canonical `.claude-plugin/plugin.json` (which stayed at `2.7.2`). The first actual post-v2.7.2 canonical bump is this v2.7.3 release, which therefore aggregates all three work batches:

- retro-roundup → relabelled `v2.7.2-followup` in `docs/projects/INDEX.md`
- disable-batch + capture-payload + SESSION_ID fix → merged into this v2.7.3 CHANGELOG entry (the standalone draft v2.7.4 entry has been removed)
- multi-agent portability correction → this release's headline work

The `hooks/README.md` "v2.7.4 disable batch" section header is retained as an **event marker** (referring to the 2026-05-14 disable event), not a plugin version label.

---

## v2.7.2 — Context-Handoff Hardening (L-size) + 3 post-v2.7.1 Fix cycles

**Headline**: Auto-compact 不再 silent drop important context。`hooks/state-checkpoint.sh` 從「bash + 叫 Claude 自願 Edit-append（best-effort）」改寫為 `hooks/state-checkpoint.js`（Node JSONL parser，hook 自己撈 transcript，**零 LLM compliance dependency**）。新增 `hooks/intent-capture.js`（PostToolUse 寫 per-cwd resume hint）；`hooks/session-start.sh` 加 per-cwd intent 顯示（hostname filter + 24h auto-clear circuit breaker）。Plus 3 post-v2.7.1 Fix cycles consolidated（B/A/eval-proxy）。

### Added

- **`hooks/state-checkpoint.js`** — Node 重寫 PreCompact hook（v2.7.2，replaces bash + `state-checkpoint.sh` which becomes `state-checkpoint.sh.bak`）。Hook 自己 parse transcript JSONL（newest-first、filter-first/tail-after、per-block thinking truncate 500B、global 8KB cap、UTF-8 safe）。失敗 emit visible diag in-file + stderr。Diagnostic JSONL log at `~/.autopilot/.state-checkpoint.log`（rotate 1MB）。Inspired by tanweai/pua session-restore.sh + claude-powerloop-plugin sibling-file design。
- **`hooks/intent-capture.js`** — Tier A PostToolUse hook（v2.7.2）。寫 per-cwd `~/.autopilot/intent/<sha1(realpath(cwd))>.json`：session_id, hostname, last_updated, last_tool, last_tool_input_summary, tool_count_session, cwd, git_branch。Multi-cwd race-free。Circuit breaker：10 連續 fail → `intent-capture.disabled` flag（auto-clear 24h / plugin-version-bump / manual `rm`）。Env opt-out `AUTOPILOT_INTENT_CAPTURE=false`。
- **`hooks/session-start.sh` 加 per-cwd intent hint** — 啟動時讀 per-cwd intent，hostname filter 後輸出 1-2 行 resume hint；intent-capture disabled 時印 ⚠ warning。既有 compaction-state.md recovery 邏輯保留。
- **B fix** (`99ab8a6`) — SubAgent skill-invocation rule。Seven-Element Task Prompt 加 `### SKILLS` 段，dev-flow L-1.6 紀律延伸進 ceo-agent / team SubAgent dispatch。Inspired by claude-powerloop-plugin v0.4.0+ commit `8f6af68`。
- **A fix** (`ec9027f`) — Blind re-dispatch principle。新 `references/blind-dispatch.md` + quality-pipeline Re-review Loop / audit Phase 2+4 接引用。Round 2 reviewer dispatch 必須剝離 prior verdicts 防 quality-gate self-bypass。Inspired by claude-powerloop-plugin v0.4.0+ `examples/blind-dispatch.md`。
- **Eval-proxy clarification + router-judge plan** (`01ad396`) — `scripts/run-eval-batch.sh` 加 header documentation 與 env parametrize (`RUNS_PER_QUERY` / `MODEL`)；docs/plans/2026-05-14-eval-router-judge.md 新 proposal。High-fidelity baseline at `skill-creator-workspace/results/*/2026-05-14_155325/`（opus×5 runs, 0% recall confirmed as isolation-test floor）。

### Changed

- `hooks/hooks.json` — PreCompact hook `state-checkpoint.sh` → `state-checkpoint.js`；PostToolUse `.*` 加 `intent-capture.js`（intra-matcher order：intent-capture → log-error → reload-watch；`suggest-compact` 在 separate Write|Edit matcher block，與 `.*` block 跨 block 並行 / 非確定順序）；description「9 default-on」→「10 default-on」。
- `hooks/README.md` — Tier A 9→10 hooks，加 reload-watch + state-checkpoint + intent-capture rows，加 Self-Disable Recovery subsection。Architecture diagram 同步。
- `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` — version 2.7.1→2.7.2，description「14 hooks (8 default-on)」→「16 hooks (10 default-on)」。

### Review Loop（L-size dogfood）

3 rounds plan review（Architect / QA Devil / Ops/SRE）。r0：原 3-layer 提案 (UserPromptSubmit + count_tokens / PreCompact exit 2 / TaskList rehydrate) 全票 REJECT，Architect 替代設計 adopted。r1-r3：CONDITIONAL trajectory（major redesigns → smaller refinements）。Plan v4 absorbed all r3 critical findings inline。Pre-merge review at L-5.2 將補上 implementation 風險。詳見 [project README](docs/projects/2026-05-14-context-handoff-hardening/README.md#review-background) + [plan §1.3-§2.3](docs/plans/2026-05-14-context-handoff-hardening.md)。

### Rollback

- **Maintainer**: `git revert <merge-sha>` on develop
- **User-side** (post-marketplace pull): `/plugin update autopilot` to v2.7.1 + cleanup new sibling files:
  ```bash
  rm -rf ~/.autopilot/intent/
  rm -f ~/.autopilot/intent-capture.disabled
  rm -f ~/.autopilot/.state-checkpoint.log
  ```

---

## v2.7.1 — Post-v2.7.0 Routing Polish + D-1/D-2 Dogfood Closure

**Headline**: Three post-merge Fix cycles consolidated into a release: skill-description tightening (`bae3f43`), D-1 + D-2 scenario dogfood verification (`f5c1d0a`), and chain-aware reviewer-prose alignment across six doc surfaces (`f69f4b7`). v2.7.0's coexistence design is now backed by routing evidence; v2.7.1 is the first taggable release of the post-merge train.

### Added

- **D-1 + D-2 dogfood log** (`docs/projects/_archive/2026-05-14-superpowers-coexistence/dogfood-routing-log.md`, §D-1 + §D-2) — 9-query scenario A routing observation (autopilot v2.7.0 + superpowers both installed, dispatch-config chain active) plus 2-query scenario C `disabledSkills` cutoff observation. Verifies chain delegation works as designed; documents three loud findings (session-snapshot vs disk-state gap, doc-prose fragility now closed, `/reload-plugins` agent-invokable bottleneck).
- **Follow-up plan** `docs/plans/2026-05-14-reload-plugins-agent-invokable.md` — proposes Option D (watcher hook + reminder) as short-term mitigation for the `/reload-plugins` bottleneck surfaced by D-2; Option A (Claude Code core agent-invokable reload) for long-term.

### Changed

- **Skill descriptions tightened** (`bae3f43`) — 3 routing ambiguities from v2.7.0 scenario B dogfood addressed by precise description claims:
  - `test-strategy`: explicit `Not for: TDD red-green-refactor cycle (→ superpowers:test-driven-development)` exclusion + `specific test debugging (→ debug)`
  - `profiling`: claims `'got slower after deploy' — measure before assuming the deploy diff is the cause`, defers crashes → debug, slow-tests-by-design → test-strategy
  - `debug`: claims `intermittent failures (incl. flaky tests with environment divergence), or 'works on my machine' issues`, explicitly defers perf regressions to profiling
- **Chain-aware reviewer prose alignment** (`f69f4b7`) — six doc surfaces updated to point at the `.claude/dispatch-config.md` `## Code Review` chain instead of hardcoded `autopilot:reviewer`:
  - `skills/quality-pipeline/SKILL.md:56` — pipeline directive
  - `skills/quality-pipeline/references/code-review.md:67-92` — `## Invocation` restructured
  - `.claude/finish-flow-config.md:32` — L-5.2 Pre-Merge Review wording
  - `agents/README.md:25,38` — dispatch boundary explainer
  - `README.md:452,457` + `README.zh-TW.md:445,450` — Dispatch boundary section (EN + zh-TW mirrors)

  All six surfaces use the canonical phrasing `default fallback when the chain is unset or no chain entry is dispatchable` (EN) / `chain 未設或 entry 不可 dispatch 時預設 fallback 為 autopilot:reviewer` (zh-TW). The reviewer-chain default-to-autopilot:reviewer is preserved triple-redundantly (SKILL directive + code-review.md lead + bullet list at code-review.md:92).

### Fixed

- **Documentation fragility** identified by D-1 dogfood (`f5c1d0a` loud finding #2) — `skills/quality-pipeline/SKILL.md:56` + `references/code-review.md:69` + `.claude/finish-flow-config.md:32` previously had hardcoded "primary reviewer" prose that contradicted chain logic in the same files. Now consistent. (Closed in `f69f4b7` after 3 review rounds.)

### Notes

- **Release model** — v2.7.1 is the first git-tag of the v2.7.x line. v2.7.0 (`eb70999`) was version-marked in manifests but not git-tagged; the cumulative v2.7.1 tag at this commit captures the full v2.7.0 coexistence ship + post-merge polish train.
- **Single-reviewer Fix-size waiver** applied to both `bae3f43` and `f69f4b7` (rationale: narrow follow-ups grounded in dogfood evidence; full L-loop already ran for v2.7.0). Both waivers documented in `dogfood-routing-log.md` §59-67.
- **Known limitation**: `/reload-plugins` is user-side; agent cannot fire it. D-2 scenario C verification used reasoned inference rather than live observation. See `docs/plans/2026-05-14-reload-plugins-agent-invokable.md` for the proposed remediation.

## v2.7.0 — Superpowers Coexistence + Standalone Mode

**Headline**: autopilot now works fully without the `superpowers` plugin installed, and offers first-class coexistence semantics when it is. v2.0-v2.6 implicitly assumed `superpowers` was always present; v2.7.0 makes that explicit and optional.

### Added

- **4 restored fallback skills** (originally removed in v2.0 commit `f08812c` under the「Superpowers always installed」assumption):
  - `skills/debug/` — evidence-first debugging (tool → log → code) with Three Red Lines
  - `skills/test-strategy/` — test pyramid, baseline 守則, failure investigation funnel
  - `skills/team/` — team allocation decisions (when to組隊, role selection, dependency analysis)
  - `skills/profiling/` — evidence-first performance profiling (only methodology entry point in the ecosystem)
  Each ships with a `## Coexistence with Superpowers` body section explaining the relationship to its superpowers counterpart (if any).
- **`project-config-template/dispatch-config.md`** — declarative routing chains for orchestrator skills:
  - `## Parallel Dispatch` (superpowers:dispatching-parallel-agents → native)
  - `## Code Review` (autopilot:reviewer → superpowers:code-reviewer → project-specific)
  - `## Methodology Preferences` (4 sub-chains: Debugging, Testing methodology, Performance profiling, Team allocation)
  First-available-wins; no `mode` field; per-chain ordering expresses all preferences.
- **README "Superpowers Coexistence" section** (both EN and zh-TW) — three deployment scenarios with concrete config snippets:
  - A: superpowers installed (recommended default; dispatch-config chain delegates tactically)
  - B: superpowers NOT installed (autopilot standalone)
  - C: superpowers user-level, pure-autopilot per-project (`.claude/settings.json` `disabledSkills` escape hatch)

### Changed

- **Tagline revision**: plugin.json + marketplace.json + both READMEs reframed from「Sets the rules; Superpowers executes」(v2.0-v2.6) to「Standalone-capable orchestration that coexists with Superpowers」.
- **6 orchestrator skills now auto-inject `dispatch-config.md`** via `!cat` preprocessor (matches existing config-injection pattern in dev-flow / quality-pipeline / finish-flow): `quality-pipeline`, `ceo-agent`, `finish-flow`, `think-tank`, `think-tank-dialectic`, `dev-flow`. dev-flow also gains a Session Rules table row pointing at dispatch-config.
- **`skills/quality-pipeline/references/code-review.md:80-95`** — rewrote the previous「quality-pipeline does **not** runtime-detect」paragraph to align with chain-based dispatch design. Reviewer selection now reads from dispatch-config's Code Review chain; first available wins; unavailable plugins fall through naturally.
- **`.claude/finish-flow-config.md` + `.claude/quality-gate-config.md`** — `superpowers:code-reviewer` fallback marked as conditional on the plugin being installed (rather than implicitly available).
- **README skills count badge**: 12 → 16 (4 fallback skills restored); plugin.json + marketplace.json description "12 skills" → "16 skills".
- **README "Why 12 skills?" → "Why 16 skills?"** — Design Philosophy section reframed: v2.0 removal claim updated to「v2.7.0 restores them as fallbacks with explicit coexistence design」.
- **README "Hooks (v2.5.0)" heading → "Hooks"** — version info moved inline to avoid heading-bump on every release.
- **README.zh-TW.md version badge** — catch-up from v2.5.0 to v2.7.0 (was drifting behind EN README's v2.6.0).
- **`hooks/hooks.json`** description string version (v2.6.0) → (v2.7.0).
- **`plugin.json` + `marketplace.json` version 2.5.0 → 2.7.0** — also catches up missed v2.6.0 manifest bump.

### Migration

If you upgrade from v2.6.0 and previously **removed** `debug`, `test-strategy`, `team`, or `profiling` entries from your `CLAUDE.md` skill routing tables (expecting them to remain absent post-v2.0), be aware they're back as fallback skills in v2.7.0 and may now trigger on the corresponding keywords. Two ways to suppress:

1. (Preferred) **Express your preference in `.claude/dispatch-config.md`** — list `superpowers:X` first in each methodology chain so orchestrator skills delegate to superpowers; the autopilot fallback stays in the catalog but is not preferentially dispatched.
2. (Hard cut) **Add to `.claude/settings.json`'s `disabledSkills`**:
   ```jsonc
   {
     "disabledSkills": [
       "autopilot:debug",
       "autopilot:test-strategy",
       "autopilot:team",
       "autopilot:profiling"
     ]
   }
   ```

### Note on v2.0 design intent

v2.0's rule-setter model (autopilot sets rules, Superpowers executes tactics) remains the **recommended deployment** when superpowers is installed. v2.7.0 is forward-progress, not reversal: it adds a standalone-capable mode for users without superpowers while preserving the v2.0-v2.6 coexistence semantics for users with superpowers. The brand tagline change reflects coexistence becoming first-class, not the rule-setter model being abandoned.

### Evidence

- 4 SKILL.md files at `skills/{debug,test-strategy,team,profiling}/`; each contains `## Coexistence with Superpowers` H2 + verbatim restoration of body content from `f08812c^`.
- `dispatch-config.md` has 2 H2 operational chains + 1 H2 Methodology Preferences umbrella with 4 H3 sub-chains + Fallback semantics; no `mode` field.
- 6 orchestrator SKILL.md files contain `!\`cat .claude/dispatch-config.md` preprocessor.
- `skills/quality-pipeline/references/code-review.md`: `grep -c "runtime-detect"` returns 0.
- README + zh-TW: both have `## Superpowers Coexistence` H2 section; both have skills-16 badge; both have v2.7.0 version badge.
- CHANGELOG (this entry): describes all phases; migration callout for v2.6.0 users present.

### Plan + project tracking

- Plan: [`docs/plans/2026-05-14-superpowers-coexistence.md`](docs/plans/2026-05-14-superpowers-coexistence.md)
- Project: [`docs/projects/2026-05-14-superpowers-coexistence/README.md`](docs/projects/2026-05-14-superpowers-coexistence/README.md)
- Review loop: r1 (3 parallel reviewers, approve-with-revisions) + r2 (single focused reviewer, approve-with-minor-revisions). See plan §9 for findings.

---

## v2.6.0 — Model Routing

### Added

- **Model routing for subagent dispatch** — skills now select model + mode per role
  (planner/reviewer → sonnet+plan, implementer → opus, test-runner → haiku)
- **`references/model-routing.md`** — shared default routing table, ships with plugin
- **`.claude/model-routing-config.md`** — per-project override (optional)
- **`project-config-template/model-routing-config.md`** — template for project customization

### Changed

- **`dev-flow`** — auto-injects `model-routing-config.md` via `!cat` preprocessor
- **`think-tank`** — role agents dispatch with `model: "sonnet", mode: "plan"`
- **`quality-pipeline`** — reviewer dispatch with `model: "sonnet", mode: "plan"`
- **`survey`** — researcher/skeptic dispatch with `model: "sonnet"`

### Evidence

Based on 90-run benchmark across 6 providers (Claude opus/sonnet/haiku, Gemini 2.5
Flash, GLM 5.1, MiniMax 2.7) using 10 real codebase tasks:
- All providers scored 94-98% accuracy on analysis tasks — model choice barely matters
- Runtime constraint (`mode: "plan"`) achieves 95-100% compliance vs 70-80% prompt-only
- Cost: opus $0.115 → sonnet $0.074 (-34%) → haiku $0.037 (-68%) per run

## v2.5.0 — Universal Hooks (Ship B)

### Added

- **14 universal hooks** — runtime enforcement layer complementing the methodology agent layer
  shipped in v2.4.0. Ported from [my-claude-devteam](https://github.com/NYCU-Chung/my-claude-devteam)
  v1.1.0 (MIT) with Ship A review adjustments.
  - **8 Tier A hooks (default-on)**: `large-file-warner` (>500KB warn, >2MB block),
    `suggest-compact` (tool-call counter, /compact at 50), `cost-tracker` (token cost JSONL),
    `audit-log` (bash commands + auto secret redaction), `session-summary` (git state at Stop),
    `log-error` (error keyword detection), `commit-secret-scan` (staged secret scan, hard block),
    `branch-protection` (anchored whole-ref regex, env override)
  - **6 Tier B hooks (opt-in)**: `config-protection` (linter config guard),
    `check-console` (console.log warning), `accumulator` + `batch-format` (batch Prettier + tsc),
    `test-runner` (auto sibling test), `design-quality` (generic UI warning),
    `mcp-health` (exponential backoff)
- **`hooks/_shared/secret-patterns.js`** — shared secret detection module used by `audit-log`
  and `commit-secret-scan`. Covers OpenAI, Anthropic, GitHub (PAT/OAuth/App), AWS, Google API,
  Slack, Stripe tokens + inline kv patterns. Fixes Ship A r1 mi1 (regex drift between hooks).
- **`hooks/README.md`** — comprehensive hook documentation with exit code convention, architecture,
  and source attribution
- **`settings.example.json`** — opt-in hook activation examples for Tier B hooks
- **`project-config-template/hooks.json`** — project-level hook override template

### Changed

- **`hooks/hooks.json`** — expanded from SessionStart-only to full lifecycle registration
  (PreToolUse, PostToolUse, Stop) for all 8 Tier A hooks
- **`.claude-plugin/plugin.json` and `marketplace.json`** — version 2.4.0 → 2.5.0, description
  updated to mention 14 hooks
- **README.md + README.zh-TW.md** — new Hooks section, hooks-14 badge, updated Inspired By
  devteam entry for Ship B, updated design philosophy

### Ship A Review Fixes (incorporated into design)

| Finding | Fix |
|---------|-----|
| C1: branch-protection substring match | Anchored whole-ref regex `^(main\|master)$` + env override |
| mi1: secret regex drift | Shared `_shared/secret-patterns.js` module |
| mi1: cost-tracker privacy | `AUTOPILOT_COST_TRACKER=false` opt-out |
| mi1: suggest-compact counter persistence | `/tmp/claude-tool-count-${CLAUDE_SESSION_ID}` |
| mi2: testing 3/8 too soft | 8/8 Tier A positive + negative tests |

### Source

Same as Ship A — [NYCU-Chung/my-claude-devteam](https://github.com/NYCU-Chung/my-claude-devteam)
v1.1.0 (MIT). Ship B absorbs 14 of 15 hooks with the adjustments listed above. `log-error`
rewritten from Bash to Node.js for consistency with other hooks.

### Scope Completeness (L-1.5 walkthrough)

~26 files in this release:

**~20 new**: plan doc, project dir, 14 hook JS files, `_shared/secret-patterns.js`,
`hooks/README.md`, `settings.example.json`, `project-config-template/hooks.json`

**6 modified**: `hooks/hooks.json`, `README.md`, `README.zh-TW.md`, `plugin.json`,
`marketplace.json`, `CHANGELOG.md`

---

## v2.4.0 — Methodology agents + voltagent companionship

### Added

- **3 methodology agents** (`agents/reviewer.md`, `agents/debugger.md`, `agents/planner.md`) —
  autopilot's Three Red Lines discipline (closure / fact-driven / exhaustiveness) now has an
  executable carrier. Dispatched automatically by `quality-pipeline`, `dev-flow`, `ceo-agent`,
  and other autopilot skills. All three are read-only (no `Edit` / `Write` tools) and produce
  findings/proposals/plans with a unified enum-based `### Handoff` output contract.
  - `reviewer` (opus) — pre-commit / pre-merge code review, security audit, plan critique;
    enforces file:line citations and `✅ Verified Clean` sections
  - `debugger` (opus) — evidence-first root-cause analysis with 5-phase methodology and PUA
    stress trigger (2+ failed attempts → forced 3 fresh hypotheses); produces `Proposed Fix`
    as diff, never applies patches
  - `planner` (sonnet) — six-element Task Prompt decomposition (goal / scope / input / output /
    acceptance / boundaries); cannot write code, emits plan for caller to execute
- **`agents/README.md`** — documents dispatch boundary, unified output contract, enum grammar,
  and how autopilot methodology agents coexist with voltagent role agents without conflict
- **README `Recommended Companions` section** — positions voltagent as the recommended
  companion for role-specialized work (80+ language / infra / domain agents), clarifies
  three-layer architecture (methodology / role / project), explains that autopilot does not
  runtime-detect voltagent

### Changed

- **`quality-pipeline` dispatches `autopilot:reviewer` by default** — `skills/quality-pipeline/
  references/code-review.md` updated to dispatch `autopilot:reviewer` instead of
  `superpowers:code-reviewer`. This is a static dispatch-target change in skill prose, not a
  runtime fallback mechanism. External skill API unchanged.
- **`.claude-plugin/plugin.json` and `marketplace.json`** — version 2.3.0 → 2.4.0, description
  updated to mention 3 methodology agents

### Rationale

autopilot's methodology was previously documented only in skill markdown. When `quality-pipeline`
or `ceo-agent` dispatched reviewers or debuggers, they fell back to `superpowers:code-reviewer`
or third-party agents that lacked autopilot's Three Red Lines discipline — the plugin's core
differentiation was not reaching the execution layer. The 3 methodology agents close this gap
by carrying closure / fact-driven / exhaustiveness rules into the agent's system prompt with
a fixed output contract (severity tiers, `✅ Verified Clean`, enum-based Handoff).

The layered split — autopilot owns methodology, voltagent owns role specialization, project
repos own domain-specific agents — is a deliberate divergence from
[`NYCU-Chung/my-claude-devteam`](https://github.com/NYCU-Chung/my-claude-devteam)'s all-in-one
12-agent approach. autopilot stays orthogonal to voltagent's role-agent ecosystem by deferring
role expertise and only shipping the methodology axis.

### Source

- Design source: [NYCU-Chung/my-claude-devteam](https://github.com/NYCU-Chung/my-claude-devteam)
  v1.1.0 (MIT licensed). Absorbed: Three Red Lines, P7 `[P7-COMPLETION]` output contract pattern
  (adapted to autopilot's unified `### Handoff` section), P9 six-element Task Prompt,
  evidence-first debug methodology, PUA stress trigger, physical tool-restriction for methodology
  agents. Not absorbed: P7/P9/P10 role language (overlaps with autopilot S/L/H sizing), 12 role
  agents (deferred to voltagent), 15 hooks (deferred to Ship B / v2.5.0).
- Review history: two rounds of parallel review via voltagent-qa-sec:architect-reviewer +
  feature-dev:code-reviewer + voltagent-meta:agent-organizer. Plan doc:
  `docs/plans/2026-04-12-methodology-agents-and-hooks.md`.

### Out of Scope (deferred to Ship B / v2.5.0)

- 14 universal hooks (large-file-warner, suggest-compact, cost-tracker, audit-log,
  session-summary, log-error, commit-secret-scan, branch-protection + 6 opt-in hooks) —
  separate plan / ship once v2.4.0 has dogfood exposure

## v2.3.0 — L-1.6 skill routing forcing function

### Added

- **`dev-flow` L-1.6 Skill routing TaskCreate** — new mandatory parent task at L-1 alongside
  the existing L-5 `finish-flow` parent. Applies the passive→active TaskCreate forcing
  function pattern (first proven at L-5) to skill routing:
  - Parent task "L-1.6: Skill routing — invoke required skills for all affected code areas"
    must be created at L-1 time. Missing it = failed L-1 gate.
  - Input is the module list produced by L-1.5 Scope Completeness Audit.
  - Completion criteria: every required project skill actually invoked via the Skill tool
    (reading the skill file is explicitly NOT invoking), plus a one-line "what this skill
    told me for this task" note captured in session context.
  - **Phase tasks (P0..PN) must be created with `blockedBy=[L-1.6]`** — this is the
    mechanical layer: phases literally cannot start until skill routing completes. Two
    layers of defense: system-reminder surfaces the pending parent, and the blockedBy
    dependency makes implementation unclaimable.
- **`dev-flow` Anti-patterns** — three new rows covering the failure modes L-1.6 is
  designed to block: "skip because I already read CLAUDE.md", "create phase tasks
  without blockedBy", and "mark L-1.6 completed after reading skill markdown".
- **`dev-flow` Pre-implementation Checklist** — three new L-size rows covering L-1.5
  audit, L-1.6 skill routing parent, and phase-task blockedBy dependency.
- **`dev-flow` Phase 1 Session Start gate 6** — now cross-references L-1.6 as the active
  enforcement (gate 6 alone is passive markdown, retained as documentation).
- **`dev-flow` L-1.5 Scope Audit** — now explicitly "feeds into L-1.6", so the module
  list cannot be dropped on the floor between audit and phase start.

### Background

On 2026-04-11, the `reconnect-regression-fix` session ran a full fix workflow against
`src/network/`, `src/lobby/`, and E2E tests without invoking any of the project's `twgs-*`
skills (`twgs-network`, `twgs-debug`, etc). The existing "Skill routing" bullet in the
L-size Full Gates section (Phase 1 Session Start, gate 6) is passive markdown and got
mentally compressed into "I know this area" — the exact same failure mode that L-5 closing
hit before `finish-flow` replaced inline markdown with active TaskCreate.

The `dev-flow-l5-enforcement` project (v2.2.0) proved that passive→active TaskCreate works
for closing discipline. The Residual Gaps section of its Phase 5 dogfood walkthrough
explicitly flagged skill routing as out-of-scope at the time, to be addressed if the same
incident recurred. It recurred the same day. v2.3.0 applies the proven pattern to the
second gate.

Missing skill invocations don't produce immediate bugs — they systematically waste the
knowledge base the project has invested in, and they're invisible until post-merge review
spots a pattern the relevant skill would have flagged. This release surfaces the failure
at L-1 time where it's cheap to fix.

### Dogfood trace

This release was itself developed under dev-flow S workflow (not L) because the scope is a
single file edit plus mandatory version sync. The v2.2.1 L-1.5 audit dimensions were
walked:
- Source + tests: `skills/dev-flow/SKILL.md` ✅
- User-facing docs: CHANGELOG entry (this section) ✅
- Version bump (semver): 2.2.1 → 2.3.0 (new feat, backwards-compatible) ✅
- Version sync verification (grep): `grep "2\.2\.1"` across repo returned 6 hits, all
  addressed — plugin.json, marketplace.json, README.md badge, README.zh-TW.md badge,
  CHANGELOG.md (new header), SKILL.md line 361 (historical reference, intentionally left)
- Credit / attribution: N/A (pure internal process improvement)
- Dogfood target: ✅ this file IS the target; the new forcing function applies to future
  autopilot L-size work immediately after reload

### Files changed

- `skills/dev-flow/SKILL.md` (L Workflow task tracking block, L-1.5 feeds-into line,
  Phase 1 gate 6 cross-reference, Anti-patterns +3 rows, Pre-implementation Checklist +3 rows)
- `.claude-plugin/plugin.json` (2.2.1 → 2.3.0)
- `.claude-plugin/marketplace.json` (2.2.1 → 2.3.0)
- `README.md` (version badge 2.2.1 → 2.3.0)
- `README.zh-TW.md` (version badge 2.2.1 → 2.3.0)
- `CHANGELOG.md` (this entry)

---

## v2.2.1 — L-1.5 audit: credit + version-sync dimensions

### Added

- **`dev-flow` L-1.5 dimensions checklist** — two new rows added to the Scope Completeness Audit:
  - **Version sync verification (grep)** — any version bump must `grep` the old version string across all tracked files (no pre-filter by extension — tomorrow's repo may add `.toml` / `Dockerfile`). If grep returns N hits, the edit list must touch all N. Enumerating from memory is the failure mode.
  - **Credit / attribution** — any feature absorbing external OSS, prior art, or third-party design must update README's `Inspired By` / credits / acknowledgements section as part of the same release.
- **`ceo-agent` SKILL.md anti-patterns** — two new rows mirroring the new dimensions: "bump version in one file from memory without grepping" and "absorb external OSS / prior art design without crediting source".
- **`dev-flow` L-1.5 historical rationale** — additional paragraph explaining why these two rows were added (the v2.2.0 dual near-miss).

### Background

v2.2.0 (`think-tank-dialectic`) walked the L-1.5 dimensions checklist correctly but still had two near-misses:

1. **`marketplace.json` version bump was missed** — `autopilot:quality-pipeline` caught it after the main commit had already landed. The audit's existing `Version bump (semver)` row correctly triggered, but the audit was walked from memory and the edit list forgot one of the two version files. A `grep "2.1.1"` would have surfaced both immediately.
2. **README `Inspired By` credit was missed** — the user pointed out post-merge that the two source repos (`agora`, `council-of-high-intelligence`) were not credited. The dimensions checklist had no row for attribution at all, so even a careful audit could not have caught it.

Both failures share a root cause: the audit was *enumerated* rather than *grepped*, and one whole dimension (attribution) was missing from the checklist. v2.2.1 fixes both: grep becomes the default for version bumps, and attribution joins the dimensions list as a first-class row.

This release dogfoods both new dimensions: the first action of the v2.2.1 session was `grep "2.2.0"` across the autopilot repo to enumerate all live references before editing, and the credit dimension was checked (N/A — pure internal process improvement, no external OSS absorbed).

### Scope Completeness (L-1.5 walkthrough)

7 files in this release:

**0 new** (process tightening, no new artifacts).

**7 modified**:
- `skills/dev-flow/SKILL.md` (2 new dimension rows + historical rationale paragraph)
- `skills/ceo-agent/SKILL.md` (2 new anti-pattern rows)
- `CHANGELOG.md` (this entry)
- `.claude-plugin/plugin.json` (2.2.0 → 2.2.1)
- `.claude-plugin/marketplace.json` (2.2.0 → 2.2.1)
- `README.md` (version badge 2.2.0 → 2.2.1)
- `README.zh-TW.md` (version badge 2.2.0 → 2.2.1)

Skill count unchanged at 12 (no new skill). No public skill API changes.

---

## v2.2.0 — think-tank-dialectic: Hegelian dialectic for hard decisions

### Added

- **`think-tank-dialectic` skill** — structured Hegelian dialectic (Thesis → Antithesis → Synthesis) for irreversible or high-stakes decisions where two positions have genuine merit. **NOT** a "better think-tank" — a different tool for a different situation. 6 roles: 4 職能 (architect / product / ops-sre / qa-devil via voltagent) + 2 adversarial (Falsifier Popper-style / Inverter Munger-style via general-purpose with inline prompts). Two rounds: R1 independent blind analysis + optional R2 Hegelian cross-examination with forced thesis/antithesis declaration. Outputs Advance Decision Brief with Hegelian Arc, first-class Minority Report, Epistemic Diversity Scorecard self-eval, and sharp distinction between Unresolved Questions (factual gaps — can be researched) and Questions Only You Can Answer (value/preference — human must decide).
- **`think-tank-dialectic` Grounding Protocol** — 5 hard rules preventing "dialectic-for-the-sake-of-dialectic" overuse:
  - Rule 1: Max 2 rounds (no R3)
  - Rule 2: Session-scoped re-entry guard (3rd invocation on same topic → refuse with escape hatch)
  - Rule 3: HIGH consensus auto-downgrade (≥5/6 aligned → skip R2, output Downgrade Brief, recommend `think-tank` next time)
  - Rule 4: Turn-count budget (`dispatched_count > 12` without brief → emergency interim brief)
  - Rule 5: R2 hemlock rule targeting drifting agents (adversarial roles specifically)
- **`think-tank-dialectic` adversarial drift mitigations** — 4 concrete protections against `general-purpose` subagents softening over 2 rounds: R2 full prompt re-injection, verbatim concrete example moves in role prompts, front-weighted anti-drift anchor sentence, hemlock enforcement scan

### Changed

- **`think-tank` SKILL.md** — added escalation path note in "When to Use" (LOW consensus + irreversible → recommend `think-tank-dialectic`) and added `think-tank-dialectic` to "See Also" table. Existing think-tank workflow unchanged — no breaking change
- **`think-tank` brief-template.md** — Decision Brief footer now includes an `### Escalation Recommendation` section that checks R1 consensus level and recommends escalation to dialectic only when LOW consensus meets irreversible decision
- **`ceo-agent` SKILL.md** — added `think-tank-dialectic` to CEO's autonomous skill list, renamed boundary section to "Boundary with survey, think-tank, and think-tank-dialectic" with expanded trigger table, added dedicated "Think Tank Dialectic escalation rules" subsection specifying when CEO must escalate (LOW think-tank consensus + irreversible + both positions have genuine merit + CEO is genuinely willing to commit either way) and when NOT to escalate
- **`hooks/session-start.sh`** — routing table now includes `think-tank-dialectic` row (`"Irreversible decision, genuine stalemate, Hegelian dialectic, 不可逆決策, 兩邊都有道理, 辯證一下"`) so new sessions discover the escalation target
- **README.md + README.zh-TW.md** — skill count 11 → 12, version badge 2.1.1 → 2.2.0, skill count badge 11 → 12, skill table row added, design philosophy section updated

### Background

Completed a full scan of two open-source Claude Code skills: [agora](https://github.com/geekjourneyx/agora) (6 審議室, 31 思想家, 8-step dialectic protocol) and [council-of-high-intelligence](https://github.com/0xNyk/council-of-high-intelligence) (18-member council with enforcement mechanisms). Three key design insights were extracted and absorbed into autopilot:

1. **Every thinking style must carry its own fail-safe** — 100% of the 31 reference agents have a `## Grounding Protocol` section with 3-5 hard rules constraining their own overuse (e.g., Feynman max 2 analogies, Socrates 3-level depth limit on questioning, Popper max 1 analogy). This is the meta-pattern that makes multi-agent deliberation work: single LLMs fail because they have no limits, multi-agent structures force each voice to declare its own.
2. **The core of dialectic is Hegelian (Thesis → Antithesis → Synthesis), not consensus-finding** — `think-tank` maps perspectives; `think-tank-dialectic` resolves genuine stalemates through forced transcendent synthesis (must NOT be compromise).
3. **think-tank-class tools split into two types, not two depths**: "multi-perspective map" (frequent, low cost — think-tank) vs "structured dialectic" (rare, high cost — dialectic). Merging them into `--depth full` flag would erase the friction that keeps dialectic from being reflexively invoked. Separate skill enforces cost discipline.

### Scope Completeness (L-1.5 walkthrough)

16 files in this release:

**8 new**:
- `docs/plans/2026-04-11-think-tank-dialectic.md` (plan doc)
- `skills/think-tank-dialectic/SKILL.md`
- `skills/think-tank-dialectic/references/role-prompts.md`
- `skills/think-tank-dialectic/references/brief-template.md`
- `skills/think-tank-dialectic/references/problem-restate-gate.md`
- `skills/think-tank-dialectic/references/silent-pre-check.md`
- `skills/think-tank-dialectic/references/minority-report.md`
- `skills/think-tank-dialectic/references/epistemic-diversity-scorecard.md`

**8 modified**:
- `.claude-plugin/plugin.json` (version bump)
- `CHANGELOG.md` (this entry)
- `README.md` (skill count, badges, skill table, design philosophy)
- `README.zh-TW.md` (same)
- `hooks/session-start.sh` (routing table row)
- `skills/ceo-agent/SKILL.md` (autonomous skill list, boundary section, escalation rules)
- `skills/think-tank/SKILL.md` (escalation note, See Also row)
- `skills/think-tank/references/brief-template.md` (footer Escalation Recommendation)

Survey skill's boundary comment was evaluated but intentionally not changed — `think-tank` remains the single entry for strategic questions, and dialectic is discovered via think-tank's LOW-consensus escalation to preserve cost discipline.

### Phase 2 deferred (not shipped)

Four mechanisms are explicitly deferred pending Phase 1 real-session feedback:
- Forced Synthesis (R2 禁止選邊 — currently Synthesis Proposal exists but is not enforced)
- Novelty Gate (R2 must have new arguments vs R1)
- Counterfactual Trigger at >70% agreement (currently Dissent Quota exists but no auto-steelman)
- Anti-Recursion rules (Socrates-style 3-level depth limit)

Phase 2 triggers when ≥3 real dialectic sessions reveal: dissent quota failures, synthesis degrading to compromise, or user feedback showing brief didn't change the decision. If Phase 1's 4 core mechanisms prove sufficient, Phase 2 remains unshipped.

---

## v2.1.1 — L-1.5 Scope Completeness Audit

### Added
- **`dev-flow` L-1.5 Scope Completeness Audit** — mandatory discrete TaskCreate before phase enumeration. Walks a dimensions checklist (source/tests/docs/API/templates/CHANGELOG/version/migration/consumers/dogfood) and requires each "yes" row to be either phased or explicitly marked out-of-scope in README. Prevents the failure mode where a correctly-executed phase plan ships an incomplete deliverable because the scope missed user-facing surfaces.
- **`ceo-agent` Execution step 3e** — CEO mandate to run the scope audit BEFORE phase TaskCreate (renumbered prior step 3e to 3f for the phase/L-5-parent TaskCreate). Plus anti-patterns covering "skip audit because obvious" and "enumerate phases before audit".

### Background
2026-04-11 `dev-flow-l5-enforcement` project initially shipped the `finish-flow` skill but missed the autopilot-side user-facing surface (README skill count, CHANGELOG entry, template example, plugin version bump). The source-code dimension was complete; the docs dimension was invisible. `finish-flow` enforces closing discipline — it cannot recover a phase plan that never contained the docs phase in the first place. This is a different failure mode that belongs at L-1 (scope), not L-5 (closing). The audit is the L-1 counterpart to the L-5 forcing function: both are active TaskCreate items that cannot be silently compressed.

### Note on v2.1.0
The `v2.1.1` release itself is the first dogfood of the new audit. Had the audit existed 2 hours earlier, `v2.1.0` would have shipped with docs in a single commit instead of two.

---

## v2.1.0 — finish-flow Forcing Function

### Added
- **`finish-flow` skill** — size-aware closing sequence forcing function. On invocation, immediately `TaskCreate`s size-appropriate discrete sub-tasks (L=6, H=6, Fix=5, S=3) each with explicit verification output. Solves the "passive markdown gets mentally compressed" failure mode that caused repeated L-5 skips in real projects.
  - L-size: Final Goal Review → Pre-Merge Review → Merge → Post-Merge Review → Archive → L Session End
  - H-size: Verify fix → Quality gate → Merge to main → Post-incident learn (MANDATORY) → Delete hotfix branch → Session end
  - Fix-size (5 tasks) and S-size (3 tasks) are OPTIONAL — finish-flow is only enforced for L and H to preserve lightweight-workflow constraints
- **`project-config-template/finish-flow-config.md`** — template for project-specific closing overrides (merge target branch, archive procedure, per-size quality gate, known pitfalls)

### Changed
- **`dev-flow` L-1** now MANDATORILY creates a parent closing `TaskCreate` (`"L-5: Invoke autopilot:finish-flow"`) alongside phase tasks. Parent task stays pending through all phases and is surfaced by system-reminder after every tool use — the forcing function that makes the closing sequence unskippable
- **`dev-flow` L-5** — inline 6-step closing sequence replaced with "invoke `autopilot:finish-flow`". The skill owns the closing sequence via discrete TaskCreate items
- **`dev-flow` H workflow** — step 4 now delegates to `finish-flow` (same forcing function, H-size branch). H-1 mandates parent `"H-9: Invoke autopilot:finish-flow"` TaskCreate
- **`dev-flow` anti-patterns** — +4 rows covering skipped L-1 parent TaskCreate, inlined closing, premature parent completion, batched sub-task TaskCreate
- **`ceo-agent`** — merge-to-develop clarified as within CEO DOA (tactical, locally reversible; merge-to-main still requires Board approval). Execution steps updated to mandate parent closing TaskCreate and finish-flow invocation without pausing between sub-tasks. +3 anti-patterns
- **`project-config-template/dev-flow-config.md`** — new "L-5 / H-9 Closing Forcing Function" section explaining how to reference finish-flow
- **README / README.zh-TW** — skill count 10 → 11, finish-flow row added to skill table and config table

### Background
L-5 completion was silently skipped on 2026-03-17 and 2026-04-11 across different projects. Prior fixes tried bolder markdown, expanded sub-steps, explicit anti-patterns — all passive text, all mentally compressed into "one action" under time pressure. The only mechanism in Claude Code that produces **active** reminders is `TaskCreate` (surfaced by system-reminder after every tool use). This release converts closing-sequence enforcement from passive text to active task reminders. Core insight: the forcing function turns **passive skipping** (forgetting, compressing) into **active cheating** — good-faith operators will not cross the latter line.

### Migration
No config changes required. Existing `.claude/dev-flow-config.md` keeps working. Optionally drop `.claude/finish-flow-config.md` into projects that need closing-sequence overrides — see `project-config-template/finish-flow-config.md`.

---

## v2.0.0 — Rule-Setter Architecture

**Breaking:** Autopilot no longer competes with built-in Superpowers. It sets the rules; Superpowers executes.

### Changed
- **`dev-flow` gained Session Rules** — persistent config injection directives that tell the model to read project config files when debugging, testing, profiling, or dispatching teams. These rules complement Superpowers' tactical skills with project-specific context.
- **`quality-pipeline` slimmed** — keeps pipeline orchestration (test → scan → completeness → review), delegates step methodology.
- **`project-lifecycle` slimmed** — keeps bootstrap/structure, delegates branch finishing mechanics.
- **`audit` config injection activated** — was commented out, now silent `!`cat``.
- **All config fallbacks changed to silent** — `2>/dev/null` without `|| echo`. No noise for projects without config files.

### Removed
- **`debug`** — replaced by dev-flow session rule + superpowers:systematic-debugging
- **`test-strategy`** — replaced by dev-flow session rule + superpowers:test-driven-development
- **`team`** — replaced by dev-flow session rule + superpowers:dispatching-parallel-agents
- **`profiling`** — replaced by dev-flow session rule (methodology was generic; config injection is what matters)

### Migration
Your `.claude/*-config.md` files still work unchanged. `dev-flow` now tells the model to read them via session rules instead of dedicated skills. No config file changes needed.

If you relied on `autopilot:debug`, `autopilot:test-strategy`, `autopilot:team`, or `autopilot:profiling` as explicit skill invocations: invoke them via their Superpowers equivalents (`superpowers:systematic-debugging`, `superpowers:test-driven-development`, `superpowers:dispatching-parallel-agents`) — dev-flow's session rules ensure your project config is still read.

---

## v1.4.4
- Enhanced `ceo-agent` — added cognitive layer inspired by gstack's CEO review agent:
  - **Cognitive Patterns**: 10 thinking instincts (Bezos doors, Munger inversion, Jobs subtraction, Grove paranoia, Altman leverage) that shape tactical decisions within DOA
  - **Boil the Lake**: completeness principle — AI makes marginal cost near-zero, always choose complete over shortcut
  - **Prime Directives**: 5 execution principles (zero silent failures, named errors, shadow paths, 6-month horizon, permission to scrap) complementing quality-pipeline
  - **Scope Mode**: 4 postures (Expand/Selective/Hold/Reduce) chosen at startup, governs opportunity handling throughout execution
  - Fixed startup count, clarified Scope Mode vs DOA interaction, added Scope Opportunities to CEO Report template

## v1.4.3
- Enhanced `dev-flow` — added Fix workflow for bug fixes (any module count, no plan/project needed, ongoing-maintenance audit trail); restructured Quick Decision to separate nature (Fix/H) from size (S/L); fixed H scope check; updated session start/end to cover Fix
- Added scope creep detection to `dev-flow` — auto-escalate S→L when scope grows (3+ commits, 3+ modules)
- Fixed `ceo-agent` — CEO mode now **mandates** project setup for L-size (was text suggestion, now hard gate)
- Added 4 anti-patterns to `ceo-agent` covering project tracking bypass

## v1.4.2
- Activated config injection for `debug` and `test-strategy` skills (were commented out, inconsistent with other skills)
- Rewrote `dev-setup.sh`: symlinks cache dir to local clone (Claude Code only loads from `~/.claude/plugins/cache/`); requires one-time `/plugin install` first

## v1.4.1
- Added `scripts/dev-setup.sh` — one-command dev mode setup (points plugin registry at local clone, skips cache)
- Added Development section to README / README.zh-TW

## v1.4.0
- Enhanced `dev-flow` — unified session lifecycle (absorbed session-start, session-end, goal-check, context-reduce); H-size hotfix workflow, user override protocol
- Enhanced `learn` — session learning summary for L-size tasks; merged memory-health (knowledge health audit)
- Enhanced `next` — merged improvement-queue into Phase 0
- Merged proposal concept into plans (draft/approved status) — overlap check moved to project-lifecycle bootstrap
- Added `test-strategy` — test pyramid, baseline management, feature flag levels
- Added `audit` — systematic comparison between implementations
- Added `debug` — evidence-first debugging (broader than profiling: crashes, bugs, connectivity)
- Enhanced `quality-pipeline` — pre-existing error cleanup, dispatch decision tree
- Enhanced `project-lifecycle` — archive eligibility check, stale entry sweep
- Added `scripts/validate.sh` — skill validation script

## v1.3.0
- Added `profiling` — evidence-first performance profiling methodology, tool selection, interpretation
  - Injects from `.claude/profiling-config.md`

## v1.2.0
- Added `next` — global work recommender (scan → rank → recommend)
- Added `team` — multi-agent parallelization with dependency analysis
- Added `improvement-queue` — process pending maintenance suggestions

## v1.1.0
- Added `quality-pipeline` — unified quality gate with project config injection
- Added `project-lifecycle` — plan → bootstrap → structure → archive
- Added `memory-health` — MEMORY.md audit, knowledge staleness detection

## v1.0.0
- Initial release: dev-flow, survey, think-tank, ceo-agent, learn, retro, context-reduce
