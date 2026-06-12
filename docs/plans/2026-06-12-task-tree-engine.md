# Plan — Task-Tree Engine v1 (delegated orchestration core)

> **Status**: Draft — pending dialectic review (R2S Phase 3)
> **Owner**: CEO mode (involvement 3), Board = user
> **Branch**: `feat/task-tree-engine` (off develop, created at R2S Phase 4)
> **Frame**: research-to-ship; Phase 0 spec `2026-06-12-task-tree-engine-design-spec.md` (approved); Phase 1 survey folded in below.

## 0. Context / thesis

The orchestrating session today consumes work products (diffs, full reviewer reports, planner bodies), so its context grows with work, not decisions — reasoning quality decays over long sessions. The approved design spec commits to: externalized task tree + delegate-everything + decision-shaped returns + capability-tiered DOA + doubly-decorrelated verification.

Phase 1 survey corrections (binding on this plan):
1. **Substrate = append-only JSONL event log + derived index**, never read-modify-write node files (Beads/Yegge postmortem; TaskMaster schema/concurrency incidents; Temporal evolvability).
2. **Report contract gains `evidence_pointers[]`, `artifact_sha256`, `confidence`** — claims must be spot-checkable without reading the work (counter to summary-overclaim: reasoning-action mismatch class).
3. **Verification = 3 layers**: deterministic artifact checks (scripts) × cross-family panel (kills self-preference bias) × question-shape diversity ({achieved/extra/missed}); sampling valve mandatory (cross-family correlated-error residue).
4. **Escalations must be decision-complete**: if the manager must fetch raw to adjudicate, the compression failed.
5. **All research-derived numbers are factory defaults pending local calibration** (published magnitudes are stale; mechanisms are not). Shadow mode IS rollout phase 1 — the design measures itself on our workload with current models before any authority shifts.

## 1. Problem

autopilot's orchestrator pays context for work it didn't need to see; verification authority is centralized in the manager's own reading; nothing measures whether delegated verdicts can be trusted. Goal: the manager holds intent + DOA adjudication only; everything else is delegated against contracts that make trust measurable.

## 2. OKR / KRs

- **KR1 (north star, measured)**: in a dogfooded project run on the tree, manager-context consumption correlates with decision count, not artifact count — concretely: manager never Reads a work product on the happy path; every work-read is an explicit logged `fetch --raw` escalation.
- **KR2**: tree substrate survives crash/concurrency torture test (parallel emitters, kill -9 mid-append, index rebuild from log) with zero event loss.
- **KR3**: shadow-mode calibration produces ≥50 verdict-agreement samples and a computed local agreement rate; no authority shift before the data exists.
- **KR4**: report contract validator rejects every malformed/unevidenced report in its test matrix.
- **KR5**: zero behavior change for users not opting in (tree is opt-in until graduation criteria met).

## 3. File-structure map

| File | Responsibility |
|------|---------------|
| `scripts/tree.sh` | The tree CLI (single entrypoint, subcommands below). Owns ALL state mutation; append-only. |
| `docs/projects/<proj>/tree/events.jsonl` | Per-project append-only event log (source of truth; git-tracked). |
| `docs/projects/<proj>/tree/index.json` | Derived node index (rebuildable; gitignored or tracked — decided in P1 spike). |
| `references/tree-contracts.md` | Canonical schemas: event types, node report contract, escalation shape, DOA config. |
| `scripts/check-node-report.sh` | Report-contract validator (schema + evidence_pointers resolvable + sha256 match). |
| `scripts/resolve-doa.sh` | Role/model-tier → DOA preset JSON (mirrors resolve-dispatch.sh pattern). |
| `project-config-template/doa-config.md` | DOA presets: cloud-tier high-trust / local-tier low-trust; four-tier action table. |
| `scripts/qc-panel.sh` | Interrogation panel dispatcher: {achieved/extra/missed} × cross-family judges → synthesized verdict JSON. |
| `scripts/calibration.sh` | Append verdict-vs-outcome samples; `report` subcommand computes agreement; thresholds live here as data. |
| `hooks/tests/tree-engine.test.sh`, `qc-panel.test.sh`, `check-node-report.test.sh`, `resolve-doa.test.sh` | Per-script integration tests (stubbed dispatchers; no network). |
| `skills/ceo-agent/SKILL.md` (+ references) | First consumer: tree-backed decision loop behind an adapter (P6). |
| `skills/quality-pipeline/SKILL.md` (+ references/code-review.md) | Shadow-mode wiring of qc-panel alongside existing reviewer (P4). |
| `references/multi-agent-portability.md`, `CLAUDE.md` | Wire-in rows; CC-native-tasks spike result. |

## 4. Phases

### P0 — Spike: CC native task persistence (S)
Claim from survey (uncited-quality source): `~/.claude/tasks/` is cross-session persistent with dependencies. Verify empirically: create tasks in a headless session, list from a fresh session. **Acceptance**: yes/no recorded in `references/multi-agent-portability.md` §7 with transcript evidence. Outcome shapes P6's adapter (if persistent, TaskCreate mirror gains value; core design unaffected — portability still rules).

### P1 — Tree substrate (L)
`scripts/tree.sh` subcommands:
- `init <proj>` — create `tree/` + empty events.jsonl + schema_version event.
- `emit <proj> <node-id> <event-json>` — validate against `references/tree-contracts.md` event schema, append one JSONL line under `flock`, `schema_version` stamped per event.
- `rebuild-index <proj>` — fold events → `index.json` (node status, parent/child edges, pending escalations); deterministic; idempotent.
- `next-decision <proj>` — print the highest-priority pending decision (escalations first, then unblocked forks) as a compact JSON: `{node, question, options[], evidence_pointers[]}`. **Never prints work content.**
- `report <proj> <node>` — print the node's report `{doa_log, escalations, verdict, confidence, evidence_pointers, artifact_paths+sha256}`.
- `escalations <proj>` — list open escalations.
- `fetch <proj> <node> --raw` — print artifact content AND emit a `manager_raw_read` event (the logged escalation valve).
**Acceptance**: torture test green — 8 parallel `emit` loops × kill -9 mid-run × `rebuild-index` reproduces identical index from log; `bash -n` + shellcheck clean; all subcommands `--help`.

### P2 — Contracts + validator (S)
Author `references/tree-contracts.md` (event types: node_created, delegated, doa_decision, escalation_opened/resolved, verdict, manager_raw_read; node report schema with the survey-mandated fields). `scripts/check-node-report.sh`: schema-validate + resolve every evidence_pointer (file exists, line range valid) + sha256 verify artifacts. **Acceptance**: validator test matrix (valid / missing-evidence / dangling-pointer / hash-mismatch / unknown-schema-version) all behave per contract.

### P3 — DOA presets (S)
`project-config-template/doa-config.md` + `scripts/resolve-doa.sh`: four-tier action table (read-only / reversible / external / irreversible), per-action granularity; presets `cloud-high-trust` (tiers 1-2 autonomous, 3 logged, 4 escalate) and `local-low-trust` (tier 1 autonomous, 2+ escalate). Factory thresholds annotated `calibrate-me`. **Acceptance**: resolve-doa returns correct preset JSON per (role, model-tier); unknown tier → escalate-by-default (fail-closed).

### P4 — Interrogation QC panel, shadow-wired (L)
`scripts/qc-panel.sh`: given `{node report, artifact paths}`, dispatch 2 judges × 3 question shapes — judge A (Claude family via `claude -p`), judge B (Gemini via `agy -p`, reuse dispatch-hetero plumbing); questions: "what goals were achieved (cite evidence)", "what was done beyond the stated goals", "what goals were NOT achieved". Synthesizer (deterministic script merge + one cheap model pass) → `{verdict, dissents[], extras[]}`. Wire into quality-pipeline as **shadow**: existing reviewer flow stays authoritative; panel runs in parallel; both verdicts logged via calibration.sh. **Acceptance**: panel runs end-to-end on a real diff with stubbed + live judges; quality-pipeline behavior unchanged (shadow only); agreement sample logged.

### P5 — Calibration harness (S)
`scripts/calibration.sh add-sample` (panel verdict, authoritative verdict, eventual outcome if known) + `report` (agreement rate, sample count, per-failure-class breakdown). Graduation criteria as DATA in the file: factory `agreement ≥ 0.80 over ≥ 50 samples AND zero false-pass on 🔴-class` — explicitly marked locally-calibratable. **Acceptance**: report computes correctly on synthetic samples; quality-pipeline shadow runs auto-append samples.

### P6 — First consumer: ceo-agent behind an adapter (L)
Branch-by-abstraction: ceo-agent's execution loop gains a tree adapter — when `docs/projects/<proj>/tree/` exists, phase state/decisions flow through `tree.sh` (next-decision / report / escalations); otherwise legacy TaskCreate-only path. Dual-run on one real dogfood project: tree records everything, manager operates from `next-decision` output; KR1 measured here. **Acceptance**: one real autopilot task shipped end-to-end with manager work-reads = 0 on happy path (all reads logged as fetch --raw events if any); discrepancies between tree view and reality recorded in review log.

### P7 — Docs, wire-in, BACKLOG hygiene (S)
CLAUDE.md inventory rows (tree.sh, qc-panel.sh, calibration.sh, check-node-report.sh, resolve-doa.sh), portability §7 (tree is files+bash = universal; CC accelerators listed as optional), hetero-dispatch.md cross-ref (panel judges ride dispatch-hetero), CHANGELOG, version bump, INDEX. Evolve `feedback_verify-reviewer-claims` memory per the new doctrine (decorrelated consensus + dissent adjudication + sampling valve) — **only after P5 shadow data exists**; until then the old rule stands.

**Dependency map**: P0 ∥ P1 → P2 → {P3 ∥ P4} → P5 → P6 → P7. (P4 needs P2's report schema; P5 needs P4's shadow stream; P6 needs P1-P5.)

## 5. Test / validation

- Script-gated: every new script ships with a hooks/tests/*.test.sh (stubbed judges via PATH-stub pattern from install-antigravity-guard.test.sh; no network in CI path). Torture test for P1 concurrency.
- Human-gated: P6 dogfood ship review; graduation decision (authority shift from shadow to active) is a **Board decision** — explicitly NOT within CEO DOA, since it changes who verifies.
- Meta-validation: the calibration report itself — the design is correct only if the shadow data says so; "78%-style" published numbers are never cited as justification.

## 6. Risks + inversion

| What would guarantee failure | Mitigation |
|---|---|
| Schema rot (bespoke schema, solo maintainer) | `schema_version` per event + `migrations/` lazy scripts (LangGraph v-field lesson); contracts doc is canonical; surface kept to ONE state-owning script |
| Shadow mode never graduates (calibration theater) | Graduation criteria are data in calibration.sh + BACKLOG trigger reviews sample count at each version bump |
| CC ships native equivalents, DIY layer competes (AutoGen precedent) | P0 spike early; adapter pattern (P6) keeps native-primitives swap-in possible; tree's unique value = portability + decision-shaped CLI, not task storage per se |
| Summary-overclaim defeats escalation valve | evidence_pointers + sha256 in contract (P2) + "extras" interrogation question (P4) + sampling valve; manager raw-reads are logged, not forbidden |
| Concurrent emit corruption | append-only + flock + torture test (P1 acceptance); index always rebuildable from log |
| Panel cost balloons | judges run flash/sonnet-tier; panel only on verdict-bearing nodes, not every event; cost visible in calibration report |
| Manager (me) regresses to reading work out of habit | `next-decision` output is the ONLY default input; raw reads emit events → visible in retro; KR1 measured not hoped |

## 7. Out of scope (v1)

- Rewriting the other 17 skills onto the tree (only ceo-agent + quality-pipeline shadow touch it).
- Track-record-driven DOA threshold mobility (v2; calibration harness collects the data for it).
- Dolt/SQL backends, daemons, cron jobs — files + bash only.
- Cross-machine tree sync (distill-style) — single-repo scope.
- Replacing TaskCreate forcing functions — they coexist; tree mirrors into TaskCreate on CC as accelerator only.

## 8. Open questions (Board)

1. None blocking — graduation authority (P5→active) reserved to Board by design; will be raised with local data in hand.

## R1 Amendments (binding overrides — dialectic 2026-06-12, HIGH consensus auto-downgrade)

These amend the phases above; where they conflict, amendments win.

1. **P1**: torture matrix MUST include truncated-tail injection (kill mid-line) with detection + tombstone of partial records (silent drop = test failure). `index.json` is **gitignored**; every read subcommand (`next-decision`, `report`, `escalations`) auto-rebuilds when `mtime(events.jsonl) > mtime(index.json)` or index absent. Note flock semantics divergence on macOS in the script header.
2. **P2**: evidence_pointer type rules made explicit — `file:line-range` pointers carry the commit SHA they were anchored at; binary artifacts use `sha256-only` pointer type (no line range); moved-file resolution falls back to content-hash search with a `pointer_stale` warning, never a silent pass. All three cases added to the validator test matrix.
3. **P0**: add spike — `agy -p` in judge mode (role-prompt + diff → structured verdict). Fallback if unusable: two Claude sessions from independent conversation roots (family-internal decorrelation, weaker but honest — recorded as such in calibration data).
4. **P4**: acceptance adds a **shadow-liveness assertion** — the shadow path must produce a verdict artifact AND a calibration sample per run; a silently-dead shadow fails the gate. Panel runs only on verdict-bearing nodes. `calibration.sh report` prints cumulative estimated token cost.
5. **P5 (recast)**: calibration corpus MUST include ground truth: (a) a synthetic known-bad set — ≥10 diffs with deliberately injected defects (controllable truth) fed to the panel; (b) historical cases where post-merge defects were later found, where available. Graduation criteria amended: `agreement ≥ 0.80 over ≥ 50 samples AND panel false-pass on known-bad 🔴-class = 0 AND the H1 replay experiment run` (replay ≥3 past sessions as decision-shaped summaries to a fresh session; compare its verdicts to actual outcomes; material divergence = H1 bounded, threshold recalibrated). Outcome-accuracy is a first-class metric, not optional.
6. **Graduation forcing function**: P5 closes by creating a HARD checkpoint (TaskCreate + BACKLOG entry): "graduation Board review at ≥50 samples OR 30 days, whichever first — Board decides graduate / extend / abort; silence is not extension." P6 adapter activation is blocked on a `board_signoff` event recorded in the tree itself.
7. **State canon resolved now**: project README owns INTENT (human-authored: OKR, scope boundary, constraints); the tree owns EXECUTION STATE (machine-emitted: phases, statuses, decisions, verdicts). Zero field overlap; the boundary table lives in `references/tree-contracts.md`; README templates lose any execution-status fields when a project opts into the tree.
8. **depth policy**: no revision in v1 — manager(0) → sub-orchestrator(1) → worker(2) already fits depth ≤ 2. If P6 dogfood demonstrates a real depth-3 need, propose a named bound (≤3) + escalation rule as a separate Board decision. The spec's "needs revision" note is superseded by this.
9. **KR1 anti-gaming**: KR1 is measured by post-hoc transcript audit (retro-style scan of the manager session for work-product reads outside `fetch --raw`), performed by the P6 reviewer — not self-reported. P4 shadow period also logs a manager-read **before-baseline** so P6 reports a delta, not an absolute claim.
10. **Dependency map updated**: P0 ∥ P1 → {P2 ∥ P3} → P4 → P5 → P6 → P7.
11. **Model-routing economy (Board directive)**: the top-tier model (Fable-class) is reserved for the **manager at depth 0 and explicit escalations only** — it is never dispatched as a delegate. Routing table ships in P3 alongside DOA presets (extends `references/model-routing.md` / `resolve-dispatch.sh`, same config-override pattern):

    | Tree role | Default tier | Rationale |
    |---|---|---|
    | Manager (depth 0) | **Fable-class** | Smallest context by design (decision-shaped only); highest per-token leverage |
    | Fable escalation triggers | — | ONLY: top-fork adjudication, panel-dissent arbitration, DOA setting/changes, Board interface. Everything else never reaches Fable |
    | Sub-orchestrator (depth 1) | opus/sonnet-class | Absorbs sub-decisions; DOA-bounded |
    | Planner / researcher | sonnet-class | Existing routing default unchanged |
    | Implementer | sonnet-class or hetero flash-class (Gemini) | Cost arbitrage proven (`references/hetero-dispatch.md`); closed-spec tasks |
    | QC panel judges | **flash/haiku-class, cross-family** | PoLL evidence: panels of small judges beat a single large judge at ~1/7 cost — cheap judges are the design, not a compromise |
    | Synthesizer | deterministic script + haiku-class pass | Merge is mechanical; judgment already happened |

    Factory defaults, locally calibratable like every other number (calibration report includes per-tier token spend so the routing itself is auditable).

## Review log

- **R0 (author, 2026-06-12)**: self-review passed — scope coverage: spec's 11 decisions + survey's 4 corrections each map to a phase (traced); placeholder scan: no TODO/TBD in load-bearing steps; dependency map explicit; risks include the author's own failure mode (KR1 measured, not promised).
- **R1 (dialectic, 2026-06-12)**: 6-role panel (4 職能 fallback to general-purpose + Falsifier + Inverter), R1 blind parallel. **Verdict: 6/6 ship-modified → Rule 3 HIGH-consensus auto-downgrade, no R2.** All findings folded into the 10 binding amendments above. Strongest single finding (Falsifier): calibration without ground-truth corpus measures correlation, not quality — graduation would be theater; recast as amendment 5. Reviewer-claim correction (per `feedback_verify-reviewer-claims`): Architect asserted `references/hetero-dispatch.md` does not exist — verified false (file shipped in v2.15.0); the agy-judge spike (amendment 3) was adopted on its own merits, not that premise.
