# Plan — Autopilot Host Conformance: build the gate before building another harness

> **Status:** R1 REPAIRED — four attack reviews converged; one closure review remains
> **Owner:** Board (`cookys`); depth-0 owns the final architecture decision
> **Branch:** `docs/2026-08-23-coding-harness-consolidation-decision`
> **Scope lock:** Autopilot coding only. CodeForge/Mnemos remain unchanged at the transcript/context boundary. Fuchikoma, Hangar, hangar-bridge, fleet scheduling, and broader organ design are out of scope.
> **Production authority:** this plan authorizes only a deterministic conformance tool and tests. It does **not** authorize a daemon, RPC service, bridge architecture, standalone Pi/DSH runtime, or host-default migration.

---

## 0. Decision after R1 attack review

The first draft over-focused on choosing among architectures. Four independent reviews converged on a smaller and more useful product:

> **Build an Autopilot Host Conformance Harness that proves what is shared, what is generated, what is host-specific, and whether recovery remains fail-closed. Do not build another coding harness until this tool demonstrates a real missing capability.**

Current repository evidence already shows:

- `bin/autopilot.js` exposes host-neutral CLI entry points for engine, Mission, Campaign, merge, status, review, and harness reporting;
- `src/engine/`, `src/mission/`, and `src/runners/` already own most reusable coding mechanics;
- `scripts/sync-codex-plugin-skills.sh` mechanically projects canonical source into the Codex package;
- `scripts/sync-opencode-plugin.sh` owns the OpenCode package projection;
- OpenCode currently has a narrower lifecycle/intent surface and must not be advertised as a full `/l3`–`/l6` front door without proof;
- Pi RPC already exists as a duplex **worker** path in substance.

Therefore the active decision is only:

```text
Option 0 — current canonical core + generated distributions, now conformance-gated
Option A — extract a specifically proven manually duplicated semantic into root core
```

Options B/C are not active implementation phases. They survive only as explicit re-entry conditions in §9.

---

## 1. Problem to solve

The actual problem is not “Autopilot lacks enough abstraction.” It is that today there is no single executable answer to:

1. Which coding capabilities are honestly supported by each installed host package?
2. Which copied files are generated projections versus manually maintained semantic forks?
3. Does a packaged host execute the same authoritative Mission/QC/fail-closed behavior as the canonical root core?
4. Can a Mission resume after a settled worker/Git effect without repeating that effect?
5. Which workers support duplex control, and which are intentionally one-shot?

A new runtime is not justified merely by committed duplicate bytes, a nicer component diagram, or substrate features.

---

## 2. State ownership invariant

The conformance report must pin exactly one owner per state class.

| State class | Canonical owner | Conformance rule |
|---|---|---|
| Interactive conversation/context | Current host harness | Disposable; never authoritative Mission progress |
| Mission/Campaign lifecycle | Autopilot durable state/reducer | Root and packaged surfaces must agree semantically |
| Worker process/tool stream | Native runner log + existing normalized observations | Preserve raw transcript; no second session owner |
| Git effects | Repository refs plus Autopilot receipts | Resume must reconcile before repeating an effect |
| QC/acceptance | Autopilot engine/depth-0 policy + independent artifact review | Worker self-report is never acceptance authority |
| Long-term transcript export | Existing Autopilot/CodeForge boundary | Unchanged by this plan |

Any proposed implementation that introduces a competing owner fails without further review.

---

## 3. Deliverable: Autopilot Host Conformance

### 3.1 Files

```text
scripts/host-conformance.js
schemas/host-conformance.schema.json
evals/host-conformance/surfaces.json
hooks/tests/host-conformance.test.sh
docs/projects/2026-08-23-coding-harness-consolidation/evidence/host-conformance.json
```

Normal wiring updates are also required:

- `CLAUDE.md` and `docs/scripts-inventory.md` for the new script;
- `scripts/sync-manifest.json` only if a new check ritual is selected;
- generated Codex/OpenCode payloads through existing generators, never hand edits.

### 3.2 Lifecycle budget

The first implementation is constrained to:

```text
new long-lived processes: 0
new protocols or sockets: 0
new state stores: 0
new runtime dependencies: 0
new production packages: 0
```

Node built-ins only. The tool is read-only except for explicit output paths and temporary test fixtures.

### 3.3 CLI contract

```bash
# Classify platform paths and current capabilities.
node scripts/host-conformance.js inventory --json

# Run every credential-free fixture and write a typed report.
node scripts/host-conformance.js check \
  --output /tmp/autopilot-host-conformance.json

# Validate an existing report, its schema, and referenced local evidence.
node scripts/host-conformance.js verify \
  --report /tmp/autopilot-host-conformance.json
```

Optional focused mode:

```bash
node scripts/host-conformance.js check --fixture F2 --surface root
node scripts/host-conformance.js check --fixture F3 --surface codex-package
```

Unknown surface/fixture is usage error. A requested unsupported combination returns a typed `unsupported_by_design` result, not a fabricated pass.

### 3.4 Report contract

```json
{
  "schema": "autopilot.host-conformance.v1",
  "canonical_commit": "<full sha>",
  "generated_at": "<explicit or source-derived timestamp>",
  "surfaces": [
    {
      "id": "root|codex-package|opencode-plugin|pi-worker",
      "capabilities": {
        "interactive_lifecycle": "supported|degraded|unsupported_by_design",
        "mission_commands": "supported|degraded|unsupported_by_design",
        "leaf_worker": "supported|degraded|unsupported_by_design",
        "duplex_control": "supported|degraded|unsupported_by_design"
      },
      "evidence": []
    }
  ],
  "projection_inventory": {
    "canonical": [],
    "mechanically_generated": [],
    "intentional_projection": [],
    "host_specific": [],
    "manual_duplicate": [],
    "orphan_or_residue": []
  },
  "state_owners": {},
  "fixtures": [],
  "decision": "keep-option-0|extract-option-a|insufficient-evidence"
}
```

`generated_at` must be supplied explicitly or derived deterministically from the source commit; normal tests may not depend on wall-clock time.

---

## 4. Deterministic fixtures

Every normal fixture runs without model credentials, network access, or subscription quota. Existing dependency-injection seams and fake runners are mandatory starting points.

### F1 — Projection parity plus planted drift

**Purpose:** distinguish generated distribution from a manually maintained fork.

Procedure:

1. Run existing projection checks:

   ```bash
   bash scripts/sync-codex-plugin-skills.sh --check
   bash scripts/sync-opencode-plugin.sh --check
   ```

2. Consume `scripts/sync-manifest.json` and generator declarations to classify paths.
3. Copy one generated file to a temp projection and alter one authoritative field.
4. Run the conformance checker against that temp projection.

Oracle:

- clean repository passes;
- planted mutation fails and names exact source/destination;
- generated byte/path totals are separate from manual edit-owner totals;
- no generated projection is reported as a second architecture owner.

### F2 — Four-boundary Mission resume matrix

**Purpose:** prove crash/restart safety without a daemon.

Use a temporary Git repository plus fake implementation, review, merge, and cleanup functions with durable call counters. Inject process termination or equivalent controlled interruption at exactly:

1. before implementation dispatch;
2. after implementation commit/receipt, before review;
3. after reviewed verdict, before merge receipt;
4. after merge receipt, before cleanup/closeout.

Required resume assertions:

| Boundary | Settled effect that must not repeat | Required next action |
|---|---|---|
| 1 | none | implementation exactly once |
| 2 | implementation commit/receipt | review/verify, implementation call count stays 1 |
| 3 | reviewed verdict | merge decision/execution only, review not silently repeated unless policy explicitly requires revalidation |
| 4 | merge receipt | cleanup/closeout only, merge call count stays 1 |

Global oracle:

```text
immutable base SHA unchanged
candidate/merged SHAs have expected ancestry
no duplicate commits
no duplicate merge effect
terminal state follows receipts/Git truth, not worker narration
```

### F3 — Fail-closed semantic parity

**Purpose:** prove package projection does not weaken authoritative behavior.

Fake reviewer returns empty or malformed output. Run the same canonical command through:

- root `bin/autopilot.js`;
- generated `platforms/codex/plugin/bin/autopilot.js`.

Required semantic parity:

```text
status = blocked/no_verdict
same authoritative phase/reason class
public exit-code semantics agree
merge calls = 0
successful closeout claims = 0
```

The comparison is semantic JSON/exit parity, not raw stderr byte identity where host wrappers intentionally add context.

### F4 — Pi duplex worker boundary

**Purpose:** prove live intervention belongs at the worker integration rather than forcing every host through a central bridge.

Use a fake Pi RPC child that emits the expected typed event sequence and records input.

Oracle:

```text
steer receipt correlates to active run
abort is idempotent
a terminal event is observed after abort
usage/tool events retain their declared aggregation semantics
non-duplex runners report unsupported_by_design rather than emulating steer
```

An opt-in live Pi smoke may reuse existing capability receipts, but it is not part of the normal gate.

---

## 5. Implementation phases

The source-plan headings below are the complete deliverable DAG. Review/test/repair are gates inside these deliverables, not extra phases.

### P0 — Contract and generated inventory

Implement:

- `schemas/host-conformance.schema.json`;
- `evals/host-conformance/surfaces.json` with evidence-backed current claims;
- `host-conformance.js inventory` using `sync-manifest.json` and existing projection definitions.

Acceptance:

```bash
node scripts/validate-json-schema.js \
  schemas/host-conformance.schema.json \
  <synthetic-valid-report>
node scripts/host-conformance.js inventory --json
```

Negative: unknown category, duplicate owner, or missing evidence pointer fails.

### P1 — F1 projection gate

Implement projection classification and planted-drift fixture. Reuse existing generators; do not create another package manifest.

Acceptance:

```bash
bash scripts/sync-codex-plugin-skills.sh --check
bash scripts/sync-opencode-plugin.sh --check
bash hooks/tests/run.sh host-conformance
```

Negative: one temp-copy mutation makes F1 fail with exact path pair.

### P2 — F2 recovery matrix

Extend existing `AutopilotEngine`/Mission tests using injected fakes and a temporary Git repo. Do not add a process service.

Acceptance: all four boundaries satisfy call-count and Git ancestry assertions. At least one planted broken reconciler must produce RED before the product repair is accepted.

### P3 — F3/F4 surface behavior

Implement root/Codex semantic parity and fake Pi RPC directive tests. OpenCode is checked only for capabilities it currently claims; unsupported lifecycle commands stay typed unsupported.

Acceptance:

```bash
node scripts/host-conformance.js check \
  --output /tmp/autopilot-host-conformance.json
node scripts/host-conformance.js verify \
  --report /tmp/autopilot-host-conformance.json
```

### P4 — Decision and cleanup

Commit the reproducible report under the project evidence directory, apply §8 rules, and write `decision.md`.

The decision must name:

- selected Option 0 or A;
- any manually duplicated semantic and the exact code a later extraction removes;
- current unsupported capabilities;
- rejected larger options and re-entry evidence;
- rollback (remove the conformance addition if necessary; no production path changed yet).

If Option A is selected, production extraction requires a separate implementation plan and review.

---

## 6. Exact local validation

```bash
bash scripts/sync-codex-plugin-skills.sh --check
bash scripts/sync-opencode-plugin.sh --check
bash hooks/tests/run.sh host-conformance
node scripts/host-conformance.js check \
  --output /tmp/autopilot-host-conformance.json
node scripts/host-conformance.js verify \
  --report /tmp/autopilot-host-conformance.json
node scripts/sync-all.sh --check
```

Before final merge, run the repository's normal preflight/test gate appropriate to the changed paths. Live model calls are not required for acceptance.

---

## 7. Review and repair discipline

### R1 — completed

Independent reviews:

- `reviews/r1-architect.md`;
- `reviews/r1-maintainer-ops.md`;
- `reviews/r1-skeptic-product.md`;
- `reviews/r1-eval-verifier.md`.

Consolidation: `review-summary.md`.

### R2 — closure only

One closure reviewer receives this repaired plan plus the finding-disposition table. It may only:

1. verify each R1 finding is closed;
2. identify a regression introduced by the repair;
3. return `SHIP-AS-IS` or `BLOCKED/BOARD`.

It may not open unrelated enhancements, rename components for style, or expand scope.

**Hard cap:** R1 + one repair + R2. No third review generation. R2 failure ends the plan at Board rather than spawning another repair loop.

---

## 8. Decision rules

### Select Option 0 and stop when

- F1–F4 pass;
- canonical semantics have no manually maintained duplicate, or every remaining host-specific path is genuinely required by the host API;
- durable Mission resume handles all four boundaries without repeated effects;
- supported/degraded/unsupported claims are honest and evidence-backed.

Option 0 still ships the conformance tool and report; it is not a null result.

### Select bounded Option A when

- the report identifies a specific manually maintained host path that reimplements canonical semantics;
- moving that semantic into root core lets the later implementation delete the named host copy/branch;
- generated packages can project the new root source without another protocol or state owner.

Option A extraction is a separate approved change.

### Insufficient evidence

Return `insufficient-evidence` when a required fixture cannot run deterministically or current host claims are not provable. Do not infer a larger architecture from missing evidence.

---

## 9. Re-entry conditions for larger architectures

### Local supervisor service (former Option B)

A separate service proposal may reopen only after **two recorded real incidents** demonstrate all of:

- front-door death occurred after an external effect;
- resumed CLI plus durable state could not reconcile safely;
- another active front door had to attach before work could continue;
- a service would remove more lifecycle/state owners than it adds.

Each incident must include run ID, receipts/Git evidence, and failed recovery path.

### Pi- or DSH-based primary runtime (former Option C)

A substrate comparison may reopen only when the conformance report names a required capability that Option 0/A cannot implement cleanly. A later fixed-footing comparison must prove correctness, recovery, transcript completeness, maintenance reduction, install/update cost, and which existing component is deleted.

Pi and DSH remain separate candidates; they may not both own the same canonical session.

---

## 10. Acceptance criteria

The plan is implementation-ready only when R2 confirms:

1. the first deliverable is a working conformance tool, not another runtime;
2. normal tests require no live model, network, or credentials;
3. F1 contains a planted drift negative;
4. F2 contains four precise recovery boundaries and effect call counters;
5. F3 compares root and generated Codex semantics fail-closed;
6. F4 tests Pi duplex behavior at the worker boundary;
7. OpenCode unsupported features are not falsely advertised;
8. initial lifecycle budget remains zero processes/protocols/stores/dependencies/packages;
9. Option 0 produces a useful operational artifact;
10. Options B/C are evidence-gated re-entry paths only;
11. the review loop ends after R2.

---

## 11. Risks and guards

| Risk | Guard |
|---|---|
| Generated bytes mistaken for a second core | Inventory derives from existing generator truth |
| Conformance script becomes another policy owner | It observes/tests only; existing core remains authority |
| False universal parity | Typed supported/degraded/unsupported results |
| Recovery test passes vacuously | Durable call counters, Git ancestry, and planted broken reconciler |
| New abstraction grows before need | Zero-lifecycle budget and no new generic protocol |
| Option 0 becomes “do nothing” | Typed report and regression gate are mandatory output |
| Substrate enthusiasm reopens scope | Explicit incident/capability re-entry gates |
| Review never converges | One repair and one closure review only |

---

## 12. Out of scope

- New daemon, socket, service manager, RPC or bridge protocol.
- Standalone Autopilot CLI/TUI product migration.
- Pi/DSH primary-runtime implementation or benchmark in this plan.
- Mnemos, CodeForge, Fuchikoma, Hangar, hangar-bridge, or model-dyno redesign.
- New routing/qualification policy.
- Rewriting skills into code for stylistic reasons.
- Removing existing host support.
- New repository/package split.
