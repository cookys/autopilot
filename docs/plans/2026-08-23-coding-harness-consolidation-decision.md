# Plan — Autopilot coding-harness consolidation: prove the smallest architecture that removes host duplication

> **Status:** DRAFT R0 — architecture decision + bounded spikes; **no production migration is authorized**
> **Owner:** Board (`cookys`); depth-0 owns the final decision after review convergence
> **Branch:** `docs/2026-08-23-coding-harness-consolidation-decision`
> **Frame:** challenge the current plugin-first shape without assuming that a daemon, bridge layer, Pi-based product, or DSH distribution is the answer
> **Scope lock:** Autopilot's **coding** surface only. CodeForge/Mnemos are unchanged consumers/providers at the transcript/context boundary. Fuchikoma, Hangar, hangar-bridge, and fleet-level orchestration are out of scope.

---

## 0. Context / thesis

Autopilot currently ships through several host surfaces:

- Claude Code plugin as the original full product surface;
- a committed Codex package under `platforms/codex/plugin/`;
- an OpenCode wrapper under `.opencode/`;
- heterogeneous leaf dispatch through `dispatch-hetero.sh` and related runners;
- a host-neutral engine and durable Mission/runtime code under `src/`;
- a live-proven Pi RPC path for duplex leaf workers.

The portability pain is real, but the proposed cure can easily be worse than the disease. In particular, a design with:

```text
central Autopilot process
+ one bridge per host
+ one worker integration per host
+ a new RPC protocol
+ a new standalone UI/runtime
```

may merely duplicate responsibilities already handled by host plugins, generated packages, the root CLI, Mission state, and existing dispatch adapters.

A load-bearing current fact is that much of the apparent Codex duplication is **generated distribution payload**, not independently maintained logic. `scripts/sync-codex-plugin-skills.sh` materializes canonical `skills/`, `bin/`, `src/`, `profiles/`, `schemas/`, `references/`, `scripts/`, and other support files because the Codex package cannot consume the source tree through symlinks. Generated copies cost repository size and release work, but they are not automatically evidence that Autopilot needs a second runtime or daemon.

Likewise, `src/engine/` already claims a host-neutral DI boundary, `src/mission/` already owns durable coding-work state, and `scripts/dispatch-hetero.sh` plus Pi RPC already form worker integrations in substance. Renaming these as a new bridge/worker architecture without deleting real complexity would be architectural churn.

### Thesis

> **The default prior is the smallest change: retain host-native entry points, strengthen one canonical core, and continue generated packaging where a host requires it. A central supervisor process or standalone Pi/DSH-based harness is justified only by measured workflows that the smaller design cannot satisfy.**

This plan therefore treats “Autopilot should become its own harness” as a hypothesis, not a conclusion.

---

## 1. Problem decomposition

Four different problems have been mixed together. They must be measured independently because they may require different solutions.

| Problem | Concrete question | Does it inherently require a new runtime? |
|---|---|---:|
| **P1 — distribution duplication** | How much code is manually maintained more than once versus generated into platform packages? | No |
| **P2 — host capability differences** | Which lifecycle/tool/hook semantics truly differ between Claude Code, Codex, OpenCode, Pi, and other runners? | No |
| **P3 — controller ownership** | Must a coding Mission continue when the interactive host session dies, and must another host attach live to it? | Maybe |
| **P4 — worker control** | Which leaf workers need typed events, steer, abort, resume, usage, and reconcile? | No; existing runner adapters may suffice |

A design is invalid if it solves P1 by introducing unnecessary P3/P4 machinery, or solves one host limitation by forcing every host through a new process boundary.

---

## 2. Decision to make

Choose the **minimum architecture** that gives Autopilot one maintainable coding implementation across supported hosts while preserving:

- `/l3`–`/l6`, Mission/Campaign, review/QC, Git/worktree, repair, merge, and cleanup semantics;
- host-native user entry where it remains useful;
- exact runner/model/harness identity and qualification;
- raw harness transcripts plus run/artifact provenance for the existing CodeForge → Mnemos and transcript → eval paths;
- fail-closed recovery and independent verification;
- current install/update paths until a replacement proves lower lifecycle cost.

The decision is among the following options.

### Option 0 — Generated distribution, hardened

```text
canonical root source
  ├─ Claude Code loads root plugin
  ├─ sync script generates Codex package
  ├─ OpenCode wrapper calls root/core surfaces
  └─ leaf runners remain external process adapters
```

Changes are limited to stronger generation, drift checks, host adapters, and documentation. No new daemon, RPC service, or standalone harness.

### Option A — Portable core + host-native front doors

```text
Claude / Codex / OpenCode front door
              │
              ▼
      shared Autopilot CLI/core
 Mission + engine + QC + Git + runners
```

Each host remains the interactive front door, but it calls one shared core/CLI contract. Platform packages may still contain generated payloads when installation constraints require them. Durable files, not the host conversation, are authoritative for Mission state. No permanently running supervisor process.

### Option B — Local Autopilot supervisor service

```text
host clients ── RPC ──> local Autopilot supervisor
                         Mission owner + worker control
```

A long-lived local process becomes the canonical Mission owner. Host plugins become clients only where live attach/reconnect is required. Existing worker runners remain underneath it. This option adds process lifecycle, version negotiation, authentication/local trust, reconnect, duplicate-command handling, logs, install/update, and failure recovery.

### Option C — Standalone Pi- or DSH-based Autopilot coding harness

```text
Autopilot CLI/TUI/runtime becomes primary front door
Claude/Codex/OpenCode become optional clients and/or leaf workers
```

Autopilot adopts an external harness substrate for its primary session/tool/runtime. Pi and DSH are separate candidates and must not be layered as two canonical session owners. This is the highest-migration option and is considered only if Options 0/A/B cannot meet required workflows or if measured maintenance reduction clearly exceeds the migration cost.

### Important terminology rule

“Bridge” and “worker integration” are **not goals** and do not exist by default:

- A **bridge** is justified only when a host is a client of an external canonical supervisor (Options B/C).
- A **worker integration** exists only when Autopilot launches that harness as a bounded leaf worker. The existing `dispatch-hetero.sh`, runner wrappers, and Pi RPC driver already count as worker integrations; do not rewrite them merely to rename the layer.
- Under Options 0/A, host plugins are simply platform adapters/front doors, not bridges.

---

## 3. Pre-registered decision rules

The review and spikes must apply these rules before implementation preference or substrate enthusiasm.

### R0 — Generated payload is not counted as independent architecture

Byte-identical or mechanically projected files under `platforms/codex/plugin/` are classified as generated distribution. They count toward repository/release cost, but not as a second manually maintained core.

### R1 — Stop at Option 0 when generation is the dominant pain

Choose Option 0 when all of the following hold:

1. at least 80% of duplicated non-host-specific bytes/paths are generated or mechanically projected;
2. drift is already detectable or can be made fail-closed with bounded changes;
3. the three representative workflows in §6 do not require a long-lived owner outside the current CLI/process invocation.

### R2 — Choose Option A before adding a daemon

Choose Option A when shared core invocation and durable Mission state solve cross-host reuse, even if host packages remain different. A daemon is not justified merely because multiple hosts call the same core.

### R3 — Option B requires two independently real live-ownership needs

A local supervisor service is allowed only if **at least two** representative workflows require all of:

- work continues after the front-door process/session dies;
- a later or different front door must attach while the Mission is still active;
- durable files + a resumed CLI invocation cannot satisfy the need without unsafe duplicate effects;
- the service removes more lifecycle owners or host-specific state machines than it adds.

One attractive demo is insufficient.

### R4 — Option C requires measured product superiority

A Pi- or DSH-based primary harness is allowed only when a same-task comparison shows:

- no regression in artifact correctness, independent review, Git isolation, or recovery;
- materially lower manually maintained host-specific code and release work;
- transcript/event completeness at least as good as current host-native paths;
- installation/update/debugging cost no worse for the actual operator workflow;
- at least one required capability that Options 0/A/B cannot provide cleanly.

“More elegant,” “more modern,” or “everything is a plugin” is not evidence.

### R5 — Reject any option that only moves duplication

A design fails when it replaces generated files with:

- duplicated bridge + worker adapters for the same host;
- two canonical session/event stores;
- a new RPC schema mirroring existing Mission/runner schemas;
- a daemon that shells back into the same scripts without removing a lifecycle owner;
- a standalone UI plus continued full host plugins, with both remaining first-class indefinitely.

---

## 4. Objective and key results

### Objective

Reach an evidence-backed architecture decision for Autopilot's coding harness surface, with an explicit **NO-GO / keep-current** result treated as success.

### Key results

| KR | Measurement |
|---|---|
| **KR1 — duplication truth** | Every duplicated path is classified as canonical, generated projection, host-specific adapter, compatibility residue, or accidental fork; bytes/LOC and update owner are reported. |
| **KR2 — ownership truth** | The three representative workflows have one diagram each showing who owns user interaction, Mission state, worker process, Git effects, QC, transcript, and recovery today. |
| **KR3 — option cost** | Options 0/A/B/C each have estimated new/removed packages, processes, protocols, state stores, install steps, and failure modes. |
| **KR4 — bounded evidence** | The smallest sufficient spike is executed first; larger spikes run only when their entry rule fires. |
| **KR5 — decision** | `decision.md` applies R0–R5 and selects one option, or records `NO-GO` with re-entry triggers. |
| **KR6 — review convergence** | Architect, Maintainer/Ops, and Skeptic reviews converge; final cross-family review returns `SHIP-AS-IS` or only Board-deferred questions. |

---

## 5. Global constraints

These constraints are copied verbatim into every implementation or review dispatch for this plan.

1. **Autopilot coding only.** No Mnemos, CodeForge, Fuchikoma, Hangar, hangar-bridge, fleet scheduler, or broader organ-map redesign.
2. **Preserve the existing memory/eval boundary.** Raw native transcript + stable Autopilot run/provenance reference must remain available; downstream systems are not redesigned here.
3. **No daemon before R3 passes.** Do not create a service, socket, RPC protocol, process manager, or bridge package in P0/P1/P2.
4. **No abstraction without two consumers.** A new interface must be exercised by at least two concrete host/runner implementations in the same phase, or remain local to the first implementation.
5. **Reuse before rewrite.** Existing `src/engine`, `src/mission`, `src/runners`, Git artifact rails, `dispatch-hetero.sh`, `dispatch-review.sh`, capability evidence, and Pi RPC code are the starting point.
6. **Generated copies are allowed.** Repository duplication is not automatically architectural duplication when one source and a deterministic drift gate exist.
7. **No production default flip.** This branch and its decision spikes do not replace the Claude, Codex, or OpenCode entry path.
8. **Pi/DSH neutrality.** Neither substrate is selected in advance; they are measured only if R4's entry conditions become reachable.
9. **One canonical owner per state class.** Conversation state, Mission state, Git effects, and long-term transcript export must not gain competing owners.
10. **Deletion must be named.** Every new package/process/protocol proposal lists the existing code or lifecycle responsibility it removes. “Future flexibility” is not a deletion.

---

## 6. Representative workflows

The decision is evaluated against exactly these workflows; do not expand the set during the first pass.

### W1 — interactive `/l5` implement-review

A user enters through a supported host, Autopilot dispatches an isolated implementer, independently reviews the artifact, repairs if needed, and returns a candidate/terminal result.

Questions:

- What host-specific logic is truly required?
- Is the current root CLI/engine already the shared core?
- Would a bridge merely forward to the same scripts?

### W2 — crash/compact/restart recovery

The depth-0/front-door context disappears after at least one worker effect. Recovery must determine whether implementation, review, merge, or cleanup is next without duplicating effects.

Questions:

- Can existing Mission state + rehydration + reconcile handle this through a resumed CLI invocation?
- Is a continuously running process actually necessary?

### W3 — user intervention in a live worker

A user asks to stop, steer, or change constraints while a supported worker is active.

Questions:

- Which workers genuinely support duplex control?
- Does the existing Pi RPC/directive channel solve the worker side?
- Must another host attach, or is intervention through the owning front door sufficient?

---

## 7. Expected execution artifacts

Implementation of this plan creates a project directory, not production architecture by default:

```text
docs/projects/2026-08-23-coding-harness-consolidation/
  p0-duplication-inventory.md
  p0-ownership-map.md
  p1-option-matrix.md
  p2-minimal-spike-evidence.md
  p3-supervisor-spike-evidence.md      # only if R3 entry fires
  p4-substrate-comparison.md           # only if R4 entry fires
  review-summary.md
  decision.md
```

A deterministic inventory helper may be added if manual counting would be error-prone:

```text
scripts/audit-platform-projections.js
```

It may only classify/count paths and compare content/projection rules; it must not alter package generation.

No production source file is changed until `decision.md` selects an option and a separate implementation plan is approved.

---

## 8. Phases and gates

### P0 — Current-state and duplication audit

1. Inventory root surfaces and all platform packages/wrappers.
2. For each duplicate path, record:
   - source path;
   - destination path;
   - generated/projection mechanism;
   - byte identity or intentional transform;
   - human edit owner;
   - drift gate;
   - current consumers.
3. Trace W1–W3 and identify current lifecycle/state owners.
4. Identify concrete incidents or recurring work caused by cross-host divergence; do not infer pain from file count alone.

**Gate P0:** If no manually maintained architectural fork or unsatisfied workflow is found, stop with Option 0 / `NO-GO` for further redesign.

### P1 — Option matrix and deletion accounting

For Options 0/A/B/C, produce:

- component diagram;
- state-owner table;
- package/process/protocol count;
- install/update path;
- failure/recovery path;
- code/lifecycle responsibilities added;
- code/lifecycle responsibilities deleted;
- migration and rollback path;
- unresolved host limitations.

**Gate P1:** Select the smallest option that could satisfy all observed requirements. Only that option advances to a spike. A more complex option cannot spike “for completeness” unless its entry rule is already met.

### P2 — Minimal shared-core spike

Default candidate: Option A, unless P0 selected Option 0.

Exercise W1–W3 using existing root CLI/core, durable Mission state, generated packaging, and current runners. The spike should prefer adapters or generated launchers over new protocols.

Measure:

- manually maintained duplicated code before/after;
- number of state/lifecycle owners;
- restart/reconcile behavior;
- host-specific code required;
- transcript/provenance completeness;
- install/update/debug steps.

**Gate P2:** If Option A meets the workflows, stop. Do not proceed to a service or standalone substrate.

### P3 — Supervisor-service spike, conditionally executed

Run only if R3 passes after P2 evidence.

The spike is deliberately narrow:

- one local supervisor process wrapping existing Mission/runtime behavior;
- two front-door clients from different hosts;
- one existing leaf worker provider;
- attach/reconnect, duplicate-command, process-death, and ambiguous-effect tests;
- no new Git/QC/routing implementation.

**Gate P3:** Adopt Option B only if it removes more concrete lifecycle duplication than it adds and both required live-ownership workflows pass. Otherwise record `NO-GO` and return to Option A.

### P4 — Pi/DSH primary-runtime comparison, conditionally executed

Run only if R4's prerequisite is satisfied by an unresolved required capability after P3.

Compare one candidate at a time against the selected smaller option with fixed task/model/tool/acceptance footing. Do not stack Pi and DSH as nested canonical session owners.

**Gate P4:** Option C wins only under R4. A technically successful demo that fails maintenance or migration criteria is rejected.

### P5 — Decision and follow-up boundary

Write `decision.md` with:

- selected option or `NO-GO`;
- exact evidence and R0–R5 application;
- rejected alternatives and re-entry triggers;
- what code/process/protocol will be deleted;
- migration/rollback outline;
- a separate follow-up implementation plan if any production change is selected.

This plan never silently turns its spike into production architecture.

---

## 9. Review loop

### Round 1 — three independent perspectives

Reviewers receive this plan only, plus links to current architecture and projection scripts. They do not receive one another's reviews before submitting.

#### Architect

Focus:

- state ownership and dependency direction;
- whether Options B/C create a second control/session plane;
- whether existing engine/Mission/runner boundaries already solve the proposed problem;
- whether “bridge” and “worker integration” are redundant wrappers.

Mandatory answer: **What is the smallest defensible architecture, and what specific requirement prevents the next-smaller option?**

#### Maintainer / Ops

Focus:

- install, update, packaging, generated payloads, version drift, process supervision;
- crash/restart/debug behavior;
- cross-platform support and dependency churn;
- what becomes harder for a single operator maintaining the repo.

Mandatory answer: **Does the proposal reduce total lifecycle complexity, not merely source-tree duplication?**

#### Skeptic / Product

Focus:

- whether the problem is proven;
- whether a central runtime provides user-visible value;
- migration tax and indefinite dual-path risk;
- simplest alternatives and stop conditions.

Mandatory answer: **Is this redesign architectural leverage or “脫褲子放屁”? Name the first phase that should be deleted if it is the latter.**

### Verdict/output contract

Each review must end with:

```text
VERDICT: SHIP-AS-IS | FIX-THEN-SHIP | NO-GO
FINDINGS:
- 🔴 Critical / 🟠 Major / 🟡 Minor / 🔵 Suggestion
SMALLEST SUFFICIENT OPTION: 0 | A | B | C
MISSING EVIDENCE:
DELETION ACCOUNTING:
```

### Consolidation

Depth-0 unions verified findings, rejects unsupported preferences, revises the plan, and records a mapping from each finding to its disposition.

### Round 2 — decorrelated final review

A cross-family reviewer receives the revised plan and the finding-disposition table, not raw prior deliberation. It must verify:

- no unresolved 🔴/🟠 finding;
- decision rules remain pre-registered and non-circular;
- smaller options cannot be skipped;
- no scope leak into Mnemos/CodeForge/Fuchikoma/fleet architecture;
- `NO-GO` remains an acceptable terminal result.

Loop cap: three repair rounds. Hitting the cap without convergence escalates to Board; it does not authorize implementation.

---

## 10. Acceptance criteria

This plan is review-ready when:

1. it does not assume Autopilot needs a standalone harness or daemon;
2. generated Codex/package projections are distinguished from manually maintained forks;
3. Options 0/A/B/C have explicit entry/stop rules;
4. bridge/worker vocabulary is conditional rather than mandatory architecture;
5. W1–W3 are sufficient to test the claimed need;
6. existing engine/Mission/runner/Pi RPC code is the mandated starting point;
7. downstream transcript → CodeForge → Mnemos behavior is preserved without modifying those projects;
8. the review loop can return `NO-GO` without being treated as failure;
9. every more-complex option names what it deletes;
10. final implementation, if any, requires a separate approved plan.

---

## 11. Risks and inversion

| Risk | Guard |
|---|---|
| **Generated copies misread as multiple cores** | R0 + P0 classification by source/projection/drift owner |
| **Architecture-by-vocabulary** — invent bridge/provider/protocol types before a second consumer exists | Constraint 4; terminology rule in §2 |
| **Daemon cargo cult** — service wraps the same shell scripts and adds lifecycle without deleting one | R3/R5 deletion accounting |
| **Substrate fashion** — Pi or DSH chosen because its design is attractive | R4 fixed-footing evidence gate |
| **Dual-path forever** — standalone runtime ships while full host plugins remain equal first-class products | R4 migration/deletion requirement |
| **Two session owners** | Constraint 9; one canonical owner per state class |
| **Repository-size optimization mistaken for maintainability** | Measure manual edit owners and release work, not only LOC |
| **Spike becomes production by inertia** | P5 separate implementation-plan boundary |
| **Scope explosion into the ecosystem** | Constraint 1 + Round-2 scope audit |
| **False simplicity** — Option 0/A hides a real cross-session recovery failure | W2 effect ambiguity and reconcile test |

### Inversion question

What design would guarantee failure?

> Add a local daemon, three host bridges, three worker adapters, a new event protocol, and a standalone UI while retaining the existing full plugins, generated packages, shell dispatchers, and Mission stores. That maximizes owners and migration surface without proving a new user workflow. Any option trending toward this shape must stop under R5.

---

## 12. Out of scope

- Mnemos storage, retrieval, memory governance, or API changes.
- CodeForge ingest/dream/ship/cite changes.
- Fuchikoma authority, portfolio, or autonomy design.
- Hangar/hangar-bridge fleet transport or scheduler design.
- llm-playground/model-dyno architecture changes; they may be used later as measurement infrastructure.
- New model-routing policy or qualification semantics.
- Rewriting skills into code merely for stylistic purity.
- A new public repository or package split.
- Production CLI/TUI/daemon implementation.
- Removing existing host support before a selected replacement passes parity and rollback gates.

---

## 13. Open questions for review

1. Which concrete recurring maintenance incidents are caused by manually maintained host forks, rather than generated payload size?
2. Does any current coding Mission truly need to outlive its front-door process while continuing autonomous effects?
3. Is cross-host live attach a real operator workflow or a hypothetical convenience?
4. Can existing durable Mission state plus a resumed root CLI satisfy W2 without a daemon?
5. Which current host-specific logic should be deleted under Option A, and which must remain by nature?
6. Does the existing Pi RPC/directive path already satisfy W3 for the only worker that needs duplex control?
7. What exact component would DSH or Pi replace, rather than sit beside?

Until these questions have evidence-backed answers, the architecture prior remains **Option 0/A**.
