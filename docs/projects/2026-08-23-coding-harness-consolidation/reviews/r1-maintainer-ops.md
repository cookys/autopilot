# R1 — Maintainer / Ops attack review

> Independent pass. This review did not read the other R1 reviews before reaching its verdict.

## Evidence read

- `scripts/sync-manifest.json` already centralizes Codex/OpenCode generation and drift checks.
- `scripts/sync-codex-plugin-skills.sh` projects root `bin/`, `src/`, `scripts/`, schemas, profiles, references, and selected skills into the Codex package.
- `scripts/sync-opencode-plugin.sh` and existing OpenCode tests already own that distribution surface.
- Full CI is release-gated, so the plan cannot assume every docs/spike push receives the full hosted suite.

## Findings

### 🔴 Critical — The current plan creates a documentation program before a maintenance tool

P0 and P1 ask for several manually authored inventories and option matrices. They will become stale immediately and repeat work already encoded in `sync-manifest.json` and the two projection generators.

**Impact:** the architecture decision adds ongoing maintenance before proving any product simplification.

**Smallest fix:** P0 must be an executable report generated from repository truth. Add one read-only command:

```bash
node scripts/host-conformance.js inventory --json
```

It should consume existing sync/generator declarations and classify each platform path as:

```text
canonical
mechanically_generated
intentional_projection
host_specific
manual_duplicate
orphan/residue
```

A human may explain exceptions, but may not hand-maintain the inventory.

### 🟠 Major — No lifecycle budget is enforced

The plan says to compare package/process/protocol counts, but does not set an adoption ceiling.

**Smallest fix:** the first accepted implementation is constrained to:

```text
new long-lived processes: 0
new protocols/sockets: 0
new state stores: 0
new runtime dependencies: 0
new production packages: 0
```

The only initial additions are a deterministic report command, fixtures, and tests in the existing repo/test runner. Any proposal exceeding this budget must separately prove the R3/R4 entry condition.

### 🟠 Major — Install/update/rollback needs executable parity, not prose

A host distribution is useful only if a fresh or updated package resolves the same canonical behavior.

**Required tests:**

```bash
bash scripts/sync-codex-plugin-skills.sh --check
bash scripts/sync-opencode-plugin.sh --check
node bin/autopilot.js --help
node platforms/codex/plugin/bin/autopilot.js --help
```

The conformance harness must additionally execute selected deterministic commands from both root and packaged paths and compare typed outputs/exit codes. A planted mutation in a temp package copy must make the check fail.

### 🟠 Major — The plan does not identify a rollback unit

Options B/C would require service removal, host plugin migration, session/state migration, and operator retraining. “Return to Option A” is not a rollback procedure.

**Smallest fix:** do not authorize B/C in this plan. The first implementation rollback is simply removal of the conformance script/test, because it changes no production path. Any later extraction must be one compatibility-preserving commit at a time, with generated packages rebuilt from the same source.

### 🟡 Minor — The test route is not wired

A new script must be registered in the existing inventory/check rituals and an existing `hooks/tests/run.sh` suite. Do not add a new GitHub workflow merely for this project.

### 🟡 Minor — Repository byte reduction is the wrong success metric

Generated payload may remain large. Success is fewer manual edit owners and fewer host-specific semantic branches, not fewer committed bytes.

## Maintainer recommendation

Build a **cross-host conformance gate**, then stop unless it proves a real manual fork. The gate is useful even if the final architecture remains unchanged: it prevents future drift and turns host support claims into measurable facts.

## Required ending

VERDICT: FIX-THEN-SHIP

SMALLEST SUFFICIENT OPTION: 0

MISSING EVIDENCE:

- machine-generated path classification;
- root/package command parity;
- current manual edit-owner count;
- exact host-specific semantic branches;
- deterministic negative demonstrating the new gate catches drift.

DELETION ACCOUNTING:

- Initial implementation deletes no runtime owner and adds none.
- The tool should replace the plan's manually maintained P0 inventory and most of the hand-written P1 parity table.
- Daemon/bridge/standalone proposals are barred because they currently add lifecycle owners without deleting any.
