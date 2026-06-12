# Design Spec — Task-Tree Engine (delegated orchestration core)

> **Status**: Design spec (brainstorm output, pre-plan). Approved-by-user: pending.
> **Origin**: 2026-06-12 brainstorm session — "manager context ∝ decisions, not work".
> **Feeds**: a full plan via `references/plan-template.md` (likely through `research-to-ship`, Phase 0 = this spec).

## North star

**Manager context grows with the number of decisions made, never with the amount of work produced.**
A 50-file migration costs the manager ~5 verdicts, not 50 diffs. The manager's context is a
re-hydratable cache over an externalized task tree — droppable and rebuildable at any point, so
reasoning quality survives arbitrarily long sessions.

## Chosen architecture (layered: B-substrate + A-contracts + C-accelerators)

1. **Universal substrate (B)** — the task tree is structured data on disk
   (`docs/projects/` lineage; exact home TBD in plan), owned by deterministic scripts:
   `tree next-decision`, `tree report <node>`, `tree escalations`, `tree fetch <node> --raw`.
   The manager talks to the tree ONLY through this CLI — its context physically receives
   script output, not work products. Reading work requires the explicit `--raw` fetch:
   that friction IS the forcing function, and it works identically on every host.
2. **Organizational contracts (A)** — recursive CEO model in prose (SKILL.md / agent
   prompts): sub-orchestrators with their own DOA per subtree; uniform report contract
   (below); QC interrogation matrix; all portable as text.
3. **CC accelerators (C)** — optional, capability-gated, never load-bearing:
   TaskCreate mirror of pending decisions (system-reminder push), native Agent tool +
   nested dispatch (transcripts, completion callbacks instead of polling), `/goal` on the
   tree's completion condition, hooks for read-violation audit trails.

**Why this beat the alternatives**:
- A-first (prose contracts, harden later): enforcement degrades to self-discipline off-CC —
  the exact failure mode being designed away; portability requirement breaks it.
- C-first (harness-native): TaskList is session-scoped (kills re-hydration) and CC-only
  (kills portability).
- B-first keeps behavior identical across CC / OpenCode / agy / future hosts; CC only adds
  speed and visibility, not semantics.

## Key decisions (拍板 during brainstorm)

1. **Delegate all four phases** — understanding, planning, implementation, verification.
   Every delegate returns a decision-shaped summary, never the work product.
2. **Uniform report contract** per node/layer:
   `{ doa_log (autonomous decisions, for traceability — skim or skip),
      escalations (above-DOA forks, full detail — manager MUST read),
      verdict }`.
   Compression ratio = where the DOA threshold sits.
3. **Irreducible core = 2 items** (collapsed from 3): (a) holding top-level intent;
   (b) setting + adjudicating DOA — trust calibration and residual-fork commitment are two
   faces of the same act (set the threshold; personally absorb what overflows it).
   Commitment itself IS delegable via DOA (sub-managers commit within their grant).
4. **Layers exist only for compression, never for supervision.** No span-of-control
   mapping (LLM bottleneck is context tokens, not attention heads). Add a mid-layer only
   when a subtree's verdict volume would blow the manager's decision budget; the layer's
   sole job is absorbing sub-decisions and reporting the residue.
5. **Mid-layers are recursive sub-orchestrators** (recursive ceo-agent with own DOA).
   Note: legitimizes orchestrating non-leaf subagents — the `depth ≤ 2` policy
   (agents/README.md § Orchestration) needs a scoped revision for this case.
6. **Trust is capability-tiered, dual-track**: cloud-tier models default HIGH-trust DOA
   (broad autonomous commit, few escalations); local models run LOW-trust DOA (narrow
   grant, more forks surface). Track-record-driven threshold movement is a v2 question.
7. **QC = interrogation matrix, doubly decorrelated**: different model families × different
   question shapes — at minimum `{what goals were achieved / what was done BEYOND the
   goals / what goals were NOT achieved}`. The "beyond" question is the silent-fork
   detector (forks hidden inside work surface as unrequested extras); the "not achieved"
   question counters sycophantic completion claims. A synthesizer merges; the manager
   adjudicates only dissent and surfaced extras.
8. **Anti-distortion stays structural**: verifiers report independently of the implementer
   chain (audit-committee pattern — already in ceo-agent at one layer; now recursive).
9. **Evolve `feedback_verify-reviewer-claims`**: from "manager re-reads the work to verify
   reviewer claims" (the pollution generator) to "trust decorrelated consensus; adjudicate
   dissent; keep a periodic sampling valve" — an occasional manager self-read remains as
   calibration against shared blind spots across model families.
10. **Manager reading work is an explicit escalation** (`tree fetch --raw`), logged,
    never the default path.
11. **Portability is a design input, not an afterthought**: universal core = files + bash
    scripts + prose contracts + shell-out dispatch to headless CLIs (`claude -p` /
    `agy -p` verified; `opencode run`, grok build = spike-before-assert). Per-host thin
    adapters choose native dispatch (CC) vs shell-out (everyone). The QC matrix is
    cross-family by construction — multi-agent is the architecture's native state, not a
    porting target.

## Open questions (for the plan / dialectic rounds)

- **Tree node schema**: exact fields that prevent rubber-stamping without re-importing
  work (boundaries? dependency edges? risk tags? fork provenance?). Needs a draft schema +
  one real dogfood project before freezing.
- **DOA preset shapes**: what a high-trust grant actually enumerates (the ceo-agent DOA
  matrix is the seed; how does it parameterize per-tier?).
- **Threshold mobility**: mechanism for track-record-based DOA movement (defer to v2?).
- **Migration path**: which consumer rewires first — ceo-agent (natural fit) vs
  quality-pipeline (highest pollution today)? Staged adoption order.
- **State coexistence**: tree vs TaskList vs docs/projects/ README — avoid a second
  canonical statement of project state (CLAUDE.md "Don't" rule applies to state too).
- **Sampling valve cadence**: how often the manager self-reads for calibration.
- **`depth ≤ 2` revision scope**: how to permit recursive orchestrators without reopening
  the runaway-nesting concern the policy guards.

## Out of scope (this design)

- Rewriting all 19 skills at once — adoption is staged through orchestrator consumers.
- Runtime enforcement beyond scripts (no daemons, no harness forks).
- Abandoning prose-first for non-orchestration concerns — B's script substrate is scoped
  to the tree, not a general re-platforming.
