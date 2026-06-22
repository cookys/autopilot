# Design Spec v2 — CEO autonomy front-door & dispatched foreman

> **Status**: ✅ **Shipped in v2.21.0 — merged as `010556a`** (2026-06-22). P1 built +
> P1.f dogfood PASS (6/6 criteria; `/l4` all-Claude + `/l5` hetero/Gemini + criterion-4
> micro-test) + 2-round L-5 dialectic (converged). Design spec v2 below preserved for the
> *why* (brainstorm output, revised after Round-1 dialectic — Architect/Ops/Skeptic).
> **Scope decision (user, 乙)**: ship the terse `/l3 /l4 /l5` interface in v1 (it IS the
> user's core pain), but with a SIMPLE machine underneath; gate the complex machinery
> (capability routing, tree-engine foreman, foreign engines) behind evidence.

## The need (one sentence, corrected premise)

Give CEO mode a terse front-door that can **offload work to a dispatched sub-orchestrator
so the orchestrator's own context stays clean and the run goes long unattended** — without
typing a long string.

**Premise correction (Round 1):** today's CEO "Level" is **Involvement** (1=every-step /
2=phase / 3=just-results — `skills/ceo-agent/SKILL.md:159-166`), a *reporting-cadence*
axis. There is NO existing autonomy/execution ladder and NO L4/L5. So this does not
"split a conflated number" — it **adds a new front-door** (`/l3 /l4 /l5`) layered over the
existing Involvement enum. The new dial presets involvement + execution posture; it does
not redefine the old term.

## v1 — what actually ships

A terse front-door + the smallest machine that delivers context-hygiene:

| Sugar | v1 behavior |
|-------|-------------|
| `/l3 <goal>` | CEO executes itself (main thread), involvement=just-results, escalate at DOA boundary. = the behavior the user invokes today as "Level 3 全權處理", now an explicit command. |
| `/l4 <goal>` | CEO dispatches **ONE sub-orchestrator "foreman"** that runs dev-flow (plan→impl→qc) on an isolated worktree and returns a verdict + run summary. CEO context stays clean. Engine = Claude (+ Gemini only where `dispatch-hetero.sh` already works). |
| `/l5 <goal>` | **Ships in v1 with a REAL payload (Round-2 correction).** The Skeptic's "no working payload / no-op stub" was wrong: agy = Gemini is an already-verified second engine (`dispatch-hetero.sh` runs `agy -p`; the v2.14.1 `_bodies` relocation was done by Gemini). So Claude(tiers) + Gemini is already ≥2 routable engines and heterogeneous routing works TODAY. v1 `/l5` = `/l4` but the **implementer may be dispatched to agy/Gemini** — which `dispatch-hetero.sh` already does (near-zero new code). What's deferred is the full `role × task-type` routing table + ADDITIONAL engines (codex/grok/gpt), each gated on a cheap per-engine smoke test, NOT a single blocking spike. |

Sugar pre-fills the 4 CEO startup questions (OKR from goal; involvement from level; scope=Hold; no-go=none). Rare overrides: `-x payments,auth`, `--expand`, `--solo` (L4 autonomy but no offload — also the **degradation fallback** when the foreman can't start).

## The v1 machine (simple, evidence-backed) — v3 with Round-2 fixes

- **Foreman = `sub-orchestrator` (depth 1), NOT `manager`.** `manager` is non-dispatchable
  by tool-enforced invariant (`resolve-dispatch.sh` exit 3, Amendment 11); the dispatchable
  coordinator is `sub-orchestrator` (`model-routing.md:88`).
- **Foreman runs dev-flow's phases INLINE at depth 1 (contract, not open).** Round-2
  Architect fix: the foreman does NOT *dispatch* plan/qc as further subagents — it executes
  the planning + gating itself at depth 1, and only **leaf-dispatches the implementer and
  the first-pass reviewer to depth-2 workers**. Topology: **CEO(0) → foreman(1) →
  impl/review worker(2)** — stays within the v1 depth-2 ceiling (`model-routing.md:96`).
  A worker that would need to decompose further (depth 3) **escalates, never nests**.
- **Control loop is enforced at DEPTH 0, not by the foreman (Round-2 Ops 🔴 fix — no
  fox-guarding-henhouse).** The CEO (depth 0) wraps the foreman dispatch in a deterministic
  guard it owns:
  - **Wall-clock + round cap** the foreman *cannot skip* (the child can't be trusted to
    police its own budget). On timeout / cap-hit → CEO **kills the foreman + escalates**.
    This is also the foreman-tier **stall detector** (a hung foreman trips the depth-0
    clock). Budget = **rounds + wall-clock only in v1**; token-estimate is deferred (needs
    a counting source — Open Q3).
  - **Merge-back is owned by depth 0.** `dispatch-hetero.sh` deliberately never merges
    (`:114` branches off a pinned `$BASE_SHA`, `:149` only removes the worktree on success).
    So after the **authoritative qc verdict passes at depth 0**, the CEO merges the
    foreman's branch into live `develop`. On conflict (base moved during a long run):
    **rebase-retry once, else escalate** — never auto-resolve unattended.
  - **Worktree GC.** Every non-success outcome (`dirty`/`no_op`/`question_suspected`/
    `failure`) keeps its worktree by design (caller's cleanup, `hetero-dispatch.md:54`).
    The CEO reaps kept worktrees + branches after handling the outcome via `git worktree
    remove --force <path>` then `git worktree prune` (Round-3 fix: `prune` alone is a no-op
    on an on-disk worktree). For the agy path the worktree path is in the outcome JSON
    (`worktree` field); for a killed Claude foreman the CEO discovers it via `git worktree
    list` diff (Round-3 note — worktree base ≠ HEAD, see worktree-dispatch-gotchas).
- **Outcome → action table (Round-2 Ops fix).** The foreman maps each dispatch-hetero
  outcome to a defined action (committed→continue; no_op→verify-scope-then-done-or-retry-
  once; dirty/failure→escalate; question_suspected→escalate; precondition_failed→`--solo`
  fallback). No outcome is treated as a silent no-op.
- **qc verdict at depth 0 is THE gate; the foreman's own finish-flow qc is first-pass
  (Round-2 double-gate resolution).** The foreman runs dev-flow→finish-flow which has its
  own L-5 qc — that is explicitly **first-pass, non-authoritative**. The single
  authoritative gate is the depth-0 re-dispatch reading artifacts (blind-dispatch clause 1,
  `blind-dispatch.md:212`). Not two real gates — one gate (depth 0) + one self-check.
- **Engine provenance**: add a `runner`/`model` field to `dispatch-hetero.sh` outcome JSON
  (`:75`, one field from `$MODEL` `:58`) + the run summary ledger (step→runner→verdict→
  artifact). Also a Phase-1 doc-sync touch (`references/hetero-dispatch.md` + CLAUDE.md
  inventory).
- **No tree-engine in v1** — plain sub-orchestrator; tree-engine deferred until graduation.

## Deferred — north star (gated on evidence, NOT in v1)

| Deferred piece | Gate before building |
|----------------|----------------------|
| Full capability **routing table** (`role × task-type → engine`, auto task-type detection) | Incremental. The *minimal* hetero (impl→Gemini) ships in v1 via the already-built `dispatch-hetero.sh`. The full table (auto-route frontend→Gemini, review→X) grows as real usage shows which routings matter. |
| ADDITIONAL engines beyond Claude+Gemini (codex / grok / gpt …) | **Per-engine smoke test** (cheap, ~10 min each): does its CLI run headless, auth unattended, and commit in a worktree? NOT a single blocking spike — each verified engine becomes one row in the routing table. UNVERIFIED until smoke-tested (spike-before-assert: agy itself needed real verification). |
| **tree-engine as foreman coordinator** | tree-engine graduation (Board: 50 samples / 2026-07-12; currently 3/50). Until then v1's plain sub-orchestrator stands. |
| Multi-node parallel fleet + autonomous poll/wake | after single-foreman `/l4` proves the pattern recurs (distill discipline). |

## Round-1 findings → resolution

| Finding (verified) | Resolution in v2 |
|--------------------|------------------|
| 🔴 foreman=manager impossible (exit 3) | → foreman = **sub-orchestrator** (depth 1) |
| 🔴 "= today's Level 3" / split-conflation premise is fabricated | → premise corrected: new front-door layered over Involvement enum, not a redefinition |
| 🔴 routing table over-built on unverified GPT runner | → routing table **cut from v1**, gated behind Phase-0 spike |
| 🔴 unattended has no control loop / no cost cap / no provenance | → v1 adds budget kill-switch + provenance + run summary; full poll/wake deferred with fleet |
| 🟠 depth-2 ceiling | → topology drawn CEO(0)→foreman(1)→worker(2); depth-3 escalates, not nests |
| 🟠 false orthogonality (WHICH gated by HOW-MUCH) | → in v1 hetero is deferred, so no cross-axis claim; honestly stated as "2 axes + 1 gated extension", not 3 orthogonal |
| 🟠 tree-engine ungraduated dependency | → tree-engine **removed from v1**, deferred until graduation |
| 🟡 sugar/SAE = speculative wrapper (distill) | → user decision 乙: keep the cheap *interface* (`/lN`), defer the expensive *machine*; `/l5` shipped as a gated stub |
| 🟡 renaming vs overloading "Level" | → `/lN` is a distinct slash-command namespace; spec states the mapping to Involvement explicitly to avoid term collision |

## Open questions (for the plan)

0. ~~SPIKE — depth-0 kill of a native-`Agent` Claude foreman~~ — **DONE 2026-06-22: PASS.**
   Empirically verified (spike dispatched a real background sub-orchestrator and force-killed
   it mid-run):
   - `Agent(run_in_background: true, isolation: "worktree")` returns an `agentId` usable as a
     `TaskStop` task_id.
   - `TaskStop <agentId>` **force-kills a mid-run agent** (verified: target was on its 2nd
     work item; status returned `killed`).
   - The foreman's worktree is at a **deterministic, discoverable path**:
     `.claude/worktrees/agent-<agentId>` (created `locked` — so reap needs `--force`).
   - On kill, an **unchanged** worktree **auto-cleans** (no leak). A **changed** worktree is
     kept (Agent contract "auto-cleaned if unchanged") → reap via `git worktree remove
     --force .claude/worktrees/agent-<id>` + `git branch -D worktree-agent-<id>` + `prune`.
   ⇒ The depth-0 control loop is mechanically buildable: dispatch background + isolation →
   note wall-clock → at cap `TaskStop` → worktree auto-cleans or `remove --force`. **`/l4`
   ships unattended; the `--solo` degradation is the fallback, not the default.** The
   wall-clock itself is depth-0 timing logic (no new primitive); `Monitor` can arm the
   deadline. Provenance/budget/merge-back proceed as specified in Phase 1.


1. ~~Phase 0 blocking spike~~ — **REFRAMED (Round-2 correction)**: hetero is NOT blocked
   (Claude + Gemini-via-agy already = ≥2 engines; `/l5` ships with impl→Gemini). The spike
   shrinks to a **per-engine smoke test** run only when adding a NEW engine (codex/grok/gpt):
   headless? auth unattended? commits in a worktree? Each pass = one routing-table row.
2. **Sugar mechanism**: `/l3 /l4 /l5` as 3 thin slash-command skills vs one `/auto` + level
   arg vs a natural-language `L<n>` prefix the ceo-agent recognizes. (Cross-platform: these
   are Claude-Code-deep; degrade gracefully elsewhere.)
3. **Budget primitive shape**: rounds + wall-clock (cheap, certain) vs token estimate
   (needs a counting source). Start with the certain ones.
4. ~~`/l4` foreman ↔ finish-flow double-gating~~ — **RESOLVED (Round 2)**: foreman runs
   dev-flow phases inline at depth 1; its finish-flow qc is first-pass/non-authoritative;
   the single authoritative gate is the depth-0 re-dispatch. See the v1 machine section.

## Phasing

- **Phase 1 (v1 ships)**: `/l3` + `/l4` + `/l5`. Single sub-orchestrator foreman, dev-flow
  inline at depth 1, impl/review leaf-dispatch to depth 2, depth-0 control loop (wall-clock
  + round cap + kill/escalate + merge-back-with-conflict→escalate + worktree GC),
  artifact-verify, qc@depth-0, outcome→action table, provenance, run summary. `/l5` =
  `/l4` with impl→agy/Gemini (already built). Engines: Claude tiers + Gemini.
- **Phase 2+ (incremental, each gated on its own evidence)**: per-engine smoke test →
  add codex/grok/gpt as routing-table rows; full `role × task-type` auto-routing table;
  tree-engine coordinator (post-graduation, 50 samples); multi-node parallel fleet +
  autonomous poll/wake.

Phase 1 is self-contained and shippable; Phase 2 items are independent incremental adds,
each behind its own cheap gate (a smoke test or tree graduation), not one big blocking spike.
