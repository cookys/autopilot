# R1 — Architect attack review

> Independent pass. This review did not read the other R1 reviews before reaching its verdict.
> Scope is Autopilot coding only.

## Evidence read

- `bin/autopilot.js` already exposes host-neutral entry points for review, implement-review, Mission, Campaign, status, merge, and harness reporting.
- `src/engine/`, `src/mission/`, and `src/runners/` already separate orchestration, durable work state, and external runner execution.
- `scripts/sync-codex-plugin-skills.sh` mechanically projects the canonical root implementation into the Codex distribution.
- `.opencode/plugin-package/autopilot.ts` is currently a narrow lifecycle/intent adapter, not a complete `/l3`–`/l6` front door.
- `scripts/lib/pi-rpc-run.js` and the directive-channel lineage already provide a duplex worker path in substance.

## Findings

### 🔴 Critical — P2 has no executable target contract

The plan says “exercise W1–W3 using the shared core,” but does not state what observable contract is being compared. Because the root CLI already exists, P2 can be declared successful by prose without changing or proving anything.

**Impact:** the plan can finish with another architecture memo and no reusable tool.

**Smallest fix:** make the first deliverable a **Host Conformance Harness**, not a new coding harness. It must execute the existing root CLI and generated host packages against the same deterministic fixtures and emit one typed report. No daemon, RPC service, bridge package, or substrate migration is allowed.

**Required test:**

```text
same fixture + same canonical command
  -> root surface result
  -> Codex packaged surface result
  -> supported/unsupported OpenCode capability result
  -> semantic parity or a named capability difference
```

The report must fail if a generated package silently changes an authoritative field, exit code, Mission transition, or fail-closed behavior.

### 🟠 Major — The plan conflates product surfaces with worker surfaces

Claude/Codex host packages, OpenCode lifecycle hooks, Pi RPC workers, and external CLI runners are treated as if all were interchangeable “front doors.” They are not.

**Impact:** the comparison may demand false parity or invent adapters for unsupported products.

**Smallest fix:** freeze a capability matrix before any spike:

| Surface | Interactive lifecycle | Mission commands | Leaf worker | Duplex steer/abort |
|---|---:|---:|---:|---:|
| root/Claude package | measured | measured | yes | through selected worker |
| Codex package | measured | measured | yes | runner-dependent |
| OpenCode plugin | intent/lifecycle only unless proven otherwise | unsupported until proven | no current claim | no current claim |
| Pi RPC | not a host front door in this plan | n/a | yes | yes, live-proven path |

`unsupported` is an honest conformance result, not a failed test.

### 🟠 Major — W2 lacks a crash-boundary oracle

“Crash/compact/restart recovery” is too broad. The dangerous cases are specific effect boundaries.

**Smallest fix:** require the deterministic fixture to inject termination at exactly four boundaries:

1. before implementation dispatch;
2. after implementation commit/receipt, before review starts;
3. after reviewed verdict, before merge request/receipt;
4. after merge receipt, before cleanup/closeout.

For each boundary, resume must identify the next legal action and prove that the already-settled effect is not repeated. Call counters and immutable Git SHAs are the oracle; model narration is irrelevant.

### 🟠 Major — The plan does not pin current state ownership

The intended architecture must first state the current owner of each state class:

- host conversation: host-native and disposable;
- Mission/Campaign state: Autopilot durable files/reducer;
- process/tool stream: native runner log plus normalized observations;
- Git effect: repository refs/receipts;
- long-term transcript export: existing downstream boundary, unchanged.

**Smallest fix:** put this table into the conformance report schema and reject any option that adds a second authoritative owner.

### 🟡 Minor — Option C is an active phase too early

Pi/DSH comparison is not needed to answer the current duplication question. Keeping it in the active phase list invites substrate tourism.

**Smallest fix:** remove P4 from the executable plan. Preserve Pi/DSH only as a re-entry trigger after the conformance harness records an unsatisfied required capability that Option 0/A cannot implement.

## Proposed architecture after repair

```text
host-native skills / commands / lifecycle adapters
                    |
                    v
         canonical root CLI + core
 Mission / engine / QC / Git / existing runners
                    |
                    v
      native worker integrations already present
```

The new artifact is test infrastructure:

```text
scripts/host-conformance.js
hooks/tests/host-conformance.test.sh
host-conformance.v1.json
```

It is not a new runtime owner.

## Required ending

VERDICT: FIX-THEN-SHIP

SMALLEST SUFFICIENT OPTION: 0, with a bounded Option-A extraction only when the conformance report proves manually maintained host logic duplicates canonical semantics.

MISSING EVIDENCE:

- exact current support matrix by host surface;
- crash-boundary resume results with call counters;
- root-versus-generated-package semantic parity;
- manually maintained duplication count after excluding generated projections.

DELETION ACCOUNTING:

- Proposed now: delete no production component; add one conformance tool and one test entry.
- Option A may proceed only if it names the duplicated host logic it removes.
- Options B/C currently delete nothing and therefore remain barred.
