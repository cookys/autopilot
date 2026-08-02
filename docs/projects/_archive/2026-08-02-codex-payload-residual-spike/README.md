# Codex payload residual install-time spike

> Status: COMPLETE — NO-GO; locally merged to `develop` as `ded66265523285595e6a9498355d4c6273c37116`
> Owner: depth-0 CEO + existing worktree-isolated L4 foreman transcript
> Plan: [`docs/plans/2026-08-02-codex-payload-residual-spike.md`](../../../plans/2026-08-02-codex-payload-residual-spike.md)
> Boundary correction: [`docs/plans/2026-08-02-codex-payload-residual-spike-mirror-correction.md`](../../../plans/2026-08-02-codex-payload-residual-spike-mirror-correction.md)

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
| Lifecycle | Seven-path successor candidate, deterministic gates, one independent first-pass review, depth-0 integration, no push. |

## Fixed scope

- One admitted report-only deliverable containing all three probes and the final disposition.
- Seven outputs only: the original six documentation/evidence paths plus the canonically generated Codex portability-reference mirror.
- No production code, tests, skill payload, manifest, generator change, hand-edited mirror, version, release, or push.

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
| `codex-payload-residual-spike` | integrated | Installed payload PASS; marketplace Git-refresh prerequisite UNPROVEN; native lifecycle FAIL; conjunctive NO-GO. See [`evidence.json`](evidence.json). |

## Decision

`NO-GO`. The installed Autopilot payload works end to end, but a local marketplace does not prove
the supported Git snapshot refresh path, and no automatic fail-loud install/upgrade generation
lifecycle was found. The committed Codex skill payload mirrors and their sync/drift gates remain;
the only payload-tree change is the canonically generated portability-reference copy authorized by
the successor. The candidate was merged locally with the QC trailer above, archived, and cleaned
up without push, publication, release, or payload migration.

## Successor boundary correction

The original six-path graph omitted the deterministic Codex payload copy of
`references/multi-agent-portability.md`. The bundled `sync-all --check` gate exposed that omission
before the mirror was written and before any candidate commit. Depth-0 froze a successor admission;
the old `probe_bundle` lease was transitioned to `stale_ignored`, the same dirty worktree and branch
fast-forwarded to successor bootstrap `a78385b3df1bf68d9514af3c7f4546e330fa7ef6`, and the successor
stage retained the original probe results and NO-GO decision. The seventh path is generated only by
the canonical sync script; it is not a migration or a new semantic claim.

## Probe result

| Prerequisite | Verdict | Mechanical evidence |
|--------------|---------|---------------------|
| Installed payload e2e | PASS | Exit 0; transcript read cached audit skill + linked support reference; exact planted differences returned; scratch tree unchanged. |
| Marketplace semantics | UNPROVEN | Installed local snapshot stayed at generation A after source changed to B; loader read cached A; local `marketplace upgrade` exited 1 as non-Git. No external Git claim made. |
| Native install/upgrade generation | FAIL | Accepted `scripts`/`lifecycle` fields did not run an exit-17 generator; add succeeded; curated installed corpus contained no such fields. |
| Cleanup | PASS | Named plugin, marketplace, cache, temp repo, and owned processes all absent. |

## Execution ledger

| Date | Event | Result |
|------|-------|--------|
| 2026-08-02 | Trigger intake | Live logged-in Codex environment is available; residual C-spike trigger is met. |
| 2026-08-02 | Scope freeze | One report-only L4 deliverable; no migration or product changes authorized. |
| 2026-08-02 | Probe bundle | Three probes completed as one bundle; decision is NO-GO and zero residue was verified. |
| 2026-08-02 | Original gate boundary | Six-path evidence bundle passed all direct gates, but `sync-all --check` exposed the omitted deterministic portability mirror; no commit was made. |
| 2026-08-02 | Successor admission | Old stage superseded honestly; same lineage fast-forwarded to the frozen seven-path correction without re-running probes. |
| 2026-08-02 | Candidate handoff | Seven-path evidence bundle is ready for one post-commit first-pass review and depth-0 integration checks. |
| 2026-08-02 | Authoritative QC and integration | Deterministic gates and independent Gemini first-pass review passed; merge `ded66265523285595e6a9498355d4c6273c37116` landed on `develop` with no push. |
| 2026-08-02 | Archive and lifecycle closure | Project archived; merged feature branch and disposable worktree removed; session marker cleared after final hygiene checks. |
