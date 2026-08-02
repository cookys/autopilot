# Codex payload residual install-time spike

> Status: ADMITTED — residual probes pending
> Owner: depth-0 CEO + existing worktree-isolated L4 foreman transcript
> Plan: [`docs/plans/2026-08-02-codex-payload-residual-spike.md`](../../plans/2026-08-02-codex-payload-residual-spike.md)

## Goal

Close the three remaining empirical prerequisites for replacing committed Codex plugin payload
mirrors, then make one conservative GO/NO-GO decision without performing the migration.

## Success criteria

| Criterion | Threshold and proof |
|-----------|---------------------|
| Installed payload execution | One exit-zero read-only `codex exec` transcript proves an installed support-path read and the planted audit result. |
| Marketplace semantics | Local live re-read and upgrade behavior are recorded separately; Git refresh is never inferred. |
| Install lifecycle | Native automatic install-and-upgrade generation hook is positively proven, or marked absent/unproven. |
| Decision | GO only on three passes; otherwise NO-GO and committed mirrors/drift gates explicitly remain. |
| Hygiene | Zero fixture plugin, marketplace, repo, process, or named config residue. |
| Lifecycle | Six-path candidate, deterministic gates, independent reviews, local merge, no push. |

## Fixed scope

- One admitted report-only deliverable containing all three probes and the final disposition.
- Six documentation/evidence outputs only.
- No production code, tests, package payload, manifest, generator, mirror, version, release, or push.

## Scope audit

| Surface | Disposition |
|---------|-------------|
| Live installed Codex execution | In scope, disposable and read-only. |
| Local marketplace/plugin config | In scope, uniquely named and reversibly cleaned. |
| Git-hosted marketplace mutation | Out of scope; no external publication. |
| Native lifecycle/manifest surface | In scope for read-only or disposable negative probing only. |
| Payload migration | Out of scope regardless of spike verdict. |
| Docs/backlog/project evidence | In scope. |

## Deliverable

| Mission node | State | Evidence |
|--------------|-------|----------|
| `codex-payload-residual-spike` | pending | Candidate must populate `evidence.json`, disposition the backlog, and synchronize the portability/project records. |

## Execution ledger

| Date | Event | Result |
|------|-------|--------|
| 2026-08-02 | Trigger intake | Live logged-in Codex environment is available; residual C-spike trigger is met. |
| 2026-08-02 | Scope freeze | One report-only L4 deliverable; no migration or product changes authorized. |
