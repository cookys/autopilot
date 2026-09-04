# Plan — Autopilot Host Conformance: build the gate before building another harness

> **Status:** R2 SHIP-AS-IS — ready to implement the conformance tool; runtime redesign remains unauthorized
> **Owner:** Board (`cookys`); depth-0 owns the final architecture decision
> **Branch:** `docs/2026-08-23-coding-harness-consolidation-decision`
> **Scope:** Autopilot coding only. CodeForge/Mnemos remain unchanged at the transcript/context boundary. Fuchikoma, Hangar, hangar-bridge, and fleet design are out of scope.
> **Authority:** this plan authorizes a deterministic conformance tool and tests only. It does not authorize a daemon, RPC service, bridge architecture, standalone Pi/DSH runtime, or host-default migration.

---

## 0. R1 decision

Four independent attack reviews converged on the same result:

> **Do not build another coding harness yet. Build an Autopilot Host Conformance tool that proves what is canonical, generated, host-specific, supported, recoverable, and fail-closed.**

The active architecture decision is limited to:

```text
Option 0 — keep canonical root core + generated host distributions, now conformance-gated
Option A — move one specifically proven manual semantic duplicate into root core and delete the duplicate
```

A local supervisor service or Pi/DSH primary runtime is not an active phase. Section 7 defines the evidence needed to reopen either idea.

Review evidence:

- `docs/projects/2026-08-23-coding-harness-consolidation/reviews/r1-architect.md`
- `.../r1-maintainer-ops.md`
- `.../r1-skeptic-product.md`
- `.../r1-eval-verifier.md`
- consolidated dispositions: `.../review-summary.md`
- closure verdict: `.../reviews/r2-closure.md`

---

## 1. Current architecture and state owners

Repository facts already show:

- `bin/autopilot.js` exposes engine, Mission, Campaign, merge, status, review, and harness commands;
- `src/engine/`, `src/mission/`, and `src/runners/` own reusable coding mechanics;
- `scripts/sync-codex-plugin-skills.sh` generates the Codex package from canonical root source;
- `scripts/sync-opencode-plugin.sh` generates the OpenCode package;
- OpenCode currently has a narrow lifecycle/intent surface, not a proven full `/l3`–`/l6` front door;
- Pi RPC already exists as a duplex leaf-worker path.

One owner per state class remains mandatory:

| State | Canonical owner | Rule |
|---|---|---|
| Interactive conversation | Host harness | Disposable; not Mission truth |
| Mission/Campaign lifecycle | Autopilot durable reducer/state | Root and packaged surfaces must agree semantically |
| Worker process/tool stream | Native runner log + existing observations | Preserve raw transcript; no second session owner |
| Git effects | Git refs + Autopilot receipts | Reconcile before retry |
| QC/acceptance | Autopilot policy + independent artifact review | Worker self-report is never authority |
| Long-term transcript export | Existing Autopilot/CodeForge boundary | Unchanged here |

---

## 2. Deliverable

### 2.1 New files

```text
scripts/host-conformance.js
schemas/host-conformance.schema.json
evals/host-conformance/surfaces.json
evals/host-conformance/fixtures/valid-report.json
hooks/tests/host-conformance.test.sh
docs/projects/2026-08-23-coding-harness-consolidation/evidence/host-conformance.json
```

### 2.2 Existing files edited

```text
scripts/sync-codex-plugin-skills.sh
scripts/sync-opencode-plugin.sh
hooks/tests/sync-opencode-plugin.test.sh
hooks/tests/codex-plugin-package.test.sh
CLAUDE.md
docs/scripts-inventory.md
scripts/sync-manifest.json          # only when registering the completed check
```

Both existing generators gain a read-only `--report-json` mode. The generator remains the authority for its own source/destination mapping; `host-conformance.js` must not parse shell source or maintain a second projection map.

`--report-json` must:

- perform no writes;
- emit source path, destination path, projection kind, and intentional transform label;
- preserve existing default and `--check` behavior byte-for-byte outside expected help text;
- fail closed when a declared source/destination is missing.

### 2.3 Initial lifecycle budget

```text
new long-lived processes: 0
new protocols/sockets: 0
new state stores: 0
new runtime dependencies: 0
new production packages: 0
```

Node built-ins only. Writes are limited to explicit output paths and temporary test directories.

---

## 3. Tool contract

### 3.1 Commands

```bash
# Machine-derived projection/capability inventory.
node scripts/host-conformance.js inventory --json

# Run all credential-free fixtures and write the report.
node scripts/host-conformance.js check \
  --generated-at 2026-08-23T00:00:00Z \
  --output /tmp/autopilot-host-conformance.json

# Validate schema, evidence pointers, and internal consistency.
node scripts/host-conformance.js verify \
  --report /tmp/autopilot-host-conformance.json

# Focused test seam.
node scripts/host-conformance.js check --fixture F2 --surface root \
  --generated-at 2026-08-23T00:00:00Z \
  --output /tmp/autopilot-F2.json
```

Unknown command, surface, or fixture exits `2`. A requested unsupported combination produces a typed `unsupported_by_design` row, not a fabricated pass.

### 3.2 Stable report

The schema is `autopilot.host-conformance.v1` and includes:

```text
canonical_commit
generated_at
surfaces[] with supported|degraded|unsupported_by_design capabilities
projection_inventory grouped as:
  canonical
  mechanically_generated
  intentional_projection
  host_specific
  manual_duplicate
  orphan_or_residue
state_owners
fixtures[] with status and local evidence pointers
decision = keep-option-0|extract-option-a|insufficient-evidence
```

Normal tests use an explicit fixed `--generated-at`; no wall-clock-dependent output is allowed.

Capability claims live in `evals/host-conformance/surfaces.json` and require executable evidence pointers. `unsupported_by_design` is an acceptable result.

---

## 4. Credential-free fixtures

### F1 — Projection parity and planted drift

1. Run existing generator checks.
2. Run each generator's new `--report-json` mode.
3. Classify generated versus manual paths from those reports.
4. Alter one authoritative field in a temporary generated copy.

Oracle:

```text
clean tree passes
planted temp-copy mutation fails
failure names exact source and destination
manual edit owners are reported separately from generated bytes/paths
```

### F2 — Four-boundary Mission resume matrix

Use a temporary Git repo and injected fake implementation, review, merge, and cleanup functions with durable call counters. Interrupt at:

1. before implementation dispatch;
2. after implementation commit/receipt, before review;
3. after reviewed verdict, before merge receipt;
4. after merge receipt, before cleanup/closeout.

Resume oracle:

| Boundary | Effect that must not repeat | Next legal action |
|---|---|---|
| 1 | none | implementation exactly once |
| 2 | implementation commit | review/verify; implementation count remains 1 |
| 3 | accepted review receipt | merge path; review count follows explicitly pinned fixture policy |
| 4 | merge receipt | cleanup/closeout; merge count remains 1 |

Every case also asserts immutable base SHA, expected ancestry, no duplicate commit, and no success derived from worker narration alone. A planted broken reconciler must turn at least one case RED before the product repair is accepted.

### F3 — Root/Codex fail-closed semantic parity

A fake reviewer returns empty or malformed output. Execute the same canonical command through:

```text
bin/autopilot.js
platforms/codex/plugin/bin/autopilot.js
```

Oracle:

```text
same semantic blocked/no_verdict status
same authoritative phase/reason class
compatible public exit-code semantics
merge calls = 0
successful closeout claims = 0
```

Compare semantic JSON and exit behavior, not host-specific diagnostic prose.

### F4 — Pi duplex worker boundary

Use a fake Pi RPC child. No live model is required.

Oracle:

```text
steer receipt correlates to active run
abort is idempotent
terminal event observed after abort
usage/tool aggregation follows the declared pi-rpc format
non-duplex runners are reported unsupported_by_design, never emulated
```

An opt-in live Pi smoke may reuse existing capability receipts but is not a normal acceptance gate.

---

## 5. Four bounded deliverables

Review/test/repair are gates within these deliverables, not extra phases.

### D1 — Generator-owned inventory and schema

Implement generator `--report-json`, report schema, valid fixture, surfaces file, and `inventory`.

Acceptance:

```bash
bash scripts/sync-codex-plugin-skills.sh --report-json > /tmp/codex-projection.json
bash scripts/sync-opencode-plugin.sh --report-json > /tmp/opencode-projection.json
node scripts/validate-json-schema.js \
  --schema schemas/host-conformance.schema.json \
  --document evals/host-conformance/fixtures/valid-report.json
node scripts/host-conformance.js inventory --json
```

Negative: missing evidence pointer, duplicate state owner, unknown category, or missing declared projection fails.

### D2 — F1 projection gate

Implement clean and planted-drift paths without altering production generator output.

Acceptance:

```bash
bash scripts/sync-codex-plugin-skills.sh --check
bash scripts/sync-opencode-plugin.sh --check
bash hooks/tests/run.sh host-conformance
```

The planted mutation must fail with the exact path pair.

### D3 — F2 recovery matrix

Extend existing engine/Mission tests with injected fakes, temporary Git history, durable call counters, and the four interruption points. Do not add a service.

Acceptance: four GREEN cases plus a behaviorally RED planted broken reconciler.

### D4 — F3/F4, final report, and decision

Implement root/Codex semantic parity, fake Pi RPC control, full report generation, and verification.

Acceptance:

```bash
node scripts/host-conformance.js check \
  --generated-at 2026-08-23T00:00:00Z \
  --output /tmp/autopilot-host-conformance.json
node scripts/host-conformance.js verify \
  --report /tmp/autopilot-host-conformance.json
```

Commit the reproducible report under the project evidence directory and write `decision.md` applying Section 6. A later Option-A extraction requires a separate approved implementation plan.

---

## 6. Decision rules

### Keep Option 0 and stop when

- F1–F4 pass;
- no manual host path reimplements canonical semantics, or every host-specific path is required by its host API;
- all four resume boundaries avoid repeated settled effects;
- capability claims are executable and honest.

Option 0 still ships the conformance tool/report; it is not a null result.

### Select bounded Option A when

- the report names a specific manually maintained host semantic duplicate;
- moving it to root core allows deletion of the named duplicate/branch;
- generated packages can project the root implementation without a new protocol or state owner.

The extraction is not performed by this plan.

### Return insufficient evidence when

A required fixture or capability claim cannot be proven deterministically. Missing evidence never authorizes a larger design.

---

## 7. Re-entry conditions for larger designs

### Local supervisor service

A new plan may reopen only after two real incidents each prove:

- front-door death after an external effect;
- resumed CLI plus durable state could not reconcile safely;
- another live front door had to attach before progress could continue;
- the service would remove more lifecycle/state owners than it adds.

Each incident needs run ID, receipts/Git evidence, and failed recovery path.

### Pi- or DSH-based primary runtime

A comparison may reopen only when the conformance report names a required capability that Option 0/A cannot implement cleanly. A later fixed-footing test must prove correctness, recovery, transcript completeness, maintenance reduction, install/update cost, and the exact existing component removed.

Pi and DSH remain separate candidates and may not both own one canonical session.

---

## 8. Exact local validation

```bash
bash scripts/sync-codex-plugin-skills.sh --check
bash scripts/sync-opencode-plugin.sh --check
bash hooks/tests/run.sh host-conformance
node scripts/host-conformance.js check \
  --generated-at 2026-08-23T00:00:00Z \
  --output /tmp/autopilot-host-conformance.json
node scripts/host-conformance.js verify \
  --report /tmp/autopilot-host-conformance.json
bash scripts/sync-all.sh --check
```

Before merge, run the normal repository preflight/test gate required by the changed paths. Live model calls, network, and credentials are not normal acceptance requirements.

---

## 9. Bounded review loop

### R1 — complete

Four independent attack reviews plus `review-summary.md` produced this repaired plan.

### R2 — complete

`reviews/r2-closure.md` returned `SHIP-AS-IS` with zero unresolved Critical/Major findings. It verified all R1 dispositions and the corrected executable command shapes.

**Hard cap enforced:** R1 + one repair + R2. No third review generation is permitted.

---

## 10. Acceptance

R2 confirmed:

1. the deliverable is a useful conformance tool, not another runtime;
2. generator-owned reports prevent a second projection truth source;
3. all normal tests are credential/network/model independent;
4. F1 has a planted drift negative;
5. F2 has four exact interruption boundaries and effect counters;
6. F3 preserves fail-closed semantics through the generated Codex package;
7. F4 keeps duplex control at the Pi worker boundary;
8. OpenCode unsupported features are not falsely advertised;
9. initial lifecycle budget stays at zero processes/protocols/stores/dependencies/packages;
10. Option 0 delivers an operational artifact;
11. larger designs are re-entry-only;
12. the loop ends after R2.

---

## 11. Out of scope

- daemon, socket, service manager, RPC, or bridge protocol;
- standalone Autopilot CLI/TUI migration;
- Pi/DSH primary-runtime implementation or comparison;
- Mnemos, CodeForge, Fuchikoma, Hangar, hangar-bridge, or model-dyno redesign;
- new routing/qualification policy;
- rewriting skills into code for style;
- removing current host support;
- new repository/package split.
