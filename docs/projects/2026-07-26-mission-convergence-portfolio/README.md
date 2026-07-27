# Mission Convergence Portfolio

> Status: In progress
>
> Progress: 17/34 phases READY
>
> Current phase: seq 17 — LSM P2 merge-intent preflight (`IN_PROGRESS`; not READY)
>
> Target: v2.34.0
>
> Branch: `feat/v2.34.0-mission-convergence-portfolio`
>
> Owner mode: `owner-led`, scope `Hold`
>
> External publication: prohibited until explicit approval

## Project Goal

Implement the reviewed 2026-07-26 convergence portfolio end to end. Autopilot must be able to run
an unattended Mission through bounded implementation campaigns, provider admission, worktree
lifecycle, authenticated controls, merge, and honest closeout without allowing a session, model,
runner, reviewer, branch, or successor to reset authority or resource ceilings.

## User Requirements Ledger

| Requirement | Bound work |
|---|---|
| "讓 CEO 全權把計畫全數依序執行完" | The CEO owns implementation, recovery, verification, local commits, merge, and archive across every phase below. |
| "每個階段跑完都要跑 heto engine loop review till all good" | Every phase must have passing deterministic tests plus a bounded heterogeneous review artifact before the next phase starts. |
| Existing project policy: project default once, task override only when needed | Mission configuration and authenticated override contract in Mission P1/P2. |
| Existing project policy: strong and weak models coexist through profiles | ICC and PRO consume the shipped capability/guidance profile contracts without splitting the repository. |
| Existing project policy: no unbounded topic expansion | Review discoveries outside the frozen phase rubric go to `docs/BACKLOG.md`; they do not grow the active phase. |
| Valuable reviewer follow-ups must not be lost | ICC/PRS emit evidence-bound follow-up candidates; LSM P4 makes depth-0 dedupe and admit them to backlog before closeout, while `/next` may reopen them only as a new ticket/contract/budget after their trigger is true. |

## Scope Completeness Audit

| Surface | Included work |
|---|---|
| Runtime and state | ICC campaign reducer/intake, Mission reducer/control/projection, provider readiness, lifecycle receipts, task closeout |
| Schemas and compatibility | Versioned campaign, Mission, readiness, lifecycle, merge, task-status, plan-review, and transcript-event contracts |
| CLI and scripts | `engine implement-review`, campaign/mission/status/merge commands, deterministic checkers and lifecycle tools |
| Git/process safety | Pre-spend rejection, immutable verification, occupancy locking, exact branch disposition, dirty-aware merge execution |
| Tests | RED/GREEN fixtures, state tables, transport parsing, replay/resume, race cases, status/merge, transcript adapters, package parity |
| Skills/docs | CEO/L3-L6/dev-flow/finish-flow routing, config templates, references, script inventory, CHANGELOG |
| Generated payload | Codex plugin mirror generated once from the final canonical tree |
| Data/privacy | Synthetic fixtures only; raw transcripts and secrets stay outside the repository |
| Deployment/migration | Backward-compatible shadow defaults; no daemon, production push, database migration, assets, or i18n surface |

## Phase Ledger

`READY` means deterministic acceptance passed and the bounded Heto phase artifact has no admitted
blocking finding. A transport failure never counts as a verdict.

| Seq | Phase | Dependency | Status | Commit | Heto artifact |
|---:|---|---|---|---|---|
| 0 | Reviewed portfolio baseline | none | READY | this baseline commit | `task-convergence-contract.review.md` |
| 1 | ICC P0 contract + RED replay | baseline | READY | `0e2e4e2..b6fc192` | [icc-p0.md](reviews/icc-p0.md) |
| 2 | ICC P1 state + pre-spend gate | ICC P0 | READY | `ef68372..3444daf` | [icc-p1.md](reviews/icc-p1.md) |
| 3 | ICC P2 review/repair composition | ICC P1 | READY | `a83cae4..77213a8` | [icc-p2.md](reviews/icc-p2.md) |
| 4 | ICC P3 routing + transport envelope + status | ICC P2 | READY | `dba2668..d2020dc` | [icc-p3.md](reviews/icc-p3.md) |
| 5 | PRO P1 pure readiness identity | ICC transport boundary | READY | `71f1594..e99b912` | [pro-p1.md](reviews/pro-p1.md) |
| 6 | PRO P2 bounded probe coordinator | PRO P1 | READY | `55ec3f0..1edd145` | [pro-p2.md](reviews/pro-p2.md) |
| 7 | PRO P4 readiness receipt + CLI | PRO P2 | READY | `38da972..8f1daa3` | [pro-p4.md](reviews/pro-p4.md) |
| 8 | WLB P0 RED lifecycle oracle | baseline | READY | `32e10d0..7bc9cad` | [wlb-p0.md](reviews/wlb-p0.md) |
| 9 | WLB P1 marker + occupancy budget | WLB P0 | READY | `7bc9cad..7484031` | [wlb-p1.md](reviews/wlb-p1.md) |
| 10 | WLB P2 lifecycle controller | WLB P1 | READY | `0e9c21c..6f61f54` | [wlb-p2.md](reviews/wlb-p2.md) |
| 11 | WLB P3 exact branch + residue receipt | WLB P2 | READY | `788f72e..07295f4` | [wlb-p3.md](reviews/wlb-p3.md) |
| 12 | WLB P4 compatibility dogfood | WLB P3 | READY | `cf6d84e..79bc881` | [wlb-p4.md](reviews/wlb-p4.md) |
| 13 | Mission P0 integration oracle + enforcement probe | ICC P3 + PRO/WLB cores | READY | `21ba802..bacdf7b` | [mission-p0.md](reviews/mission-p0.md) |
| 14 | Mission P1 reducer + shadow ledger | Mission P0 | READY | `066d190..7fe0a50` | [mission-p1.md](reviews/mission-p1.md) |
| 15 | Mission P2 ICC binding + Codex enforcement | Mission P1 | READY | `6569345..bd9bc25` | [mission-p2.md](reviews/mission-p2.md) |
| 16 | LSM P1 task-status aggregation | Mission P2 + ICC/WLB receipts | READY | `e79d0da..70b50f9` | [lsm-p1.md](reviews/lsm-p1.md) |
| 17 | LSM P2 merge-intent preflight | LSM P1 | Pending | pending | pending |
| 18 | LSM P3 merge execution receipts | LSM P2 | Pending | pending | pending |
| 19 | LSM P4 finish-flow + CEO reporting | LSM P3 | Pending | pending | pending |
| 20 | LSM P5 docs/package integration | LSM P4 | Pending | pending | pending |
| 21 | ICC P4 057 dogfood + ship integration | Mission/LSM integration | Pending | pending | pending |
| 22 | PRO P3 native Kimi transport | PRO core; independent | Pending | pending | pending |
| 23 | PRO P5 docs/package integration | PRO P3 | Pending | pending | pending |
| 24 | PRS P1 manifest + artifact contracts | ICC transport boundary | Pending | pending | pending |
| 25 | PRS P2 normalization + bounded retry | PRS P1 | Pending | pending | pending |
| 26 | PRS P3 finding ledger + adjudication | PRS P2 | Pending | pending | pending |
| 27 | PRS P4 N-seat terminal policy | PRS P3 | Pending | pending | pending |
| 28 | PRS P5 skill/docs/package integration | PRS P4 | Pending | pending | pending |
| 29 | CTR P1 normalized adapters | baseline | Pending | pending | pending |
| 30 | CTR P2 attribution + provenance | CTR P1 | Pending | pending | pending |
| 31 | CTR P3 loop/control metrics | CTR P2 | Pending | pending | pending |
| 32 | CTR P4 reports/package integration | CTR P3 | Pending | pending | pending |
| 33 | Full portfolio QC, version, merge, archive | all phases | Pending | pending | pending |

## Phase Gate

For each row:

1. Freeze the phase acceptance criteria and allowed diff.
2. Add or confirm the RED oracle before production mutation.
3. Implement and run the focused tests.
4. Run repository invariants appropriate to the changed surfaces.
5. Commit one logical phase.
6. Run a bounded heterogeneous review against that commit/diff.
7. Fix only admitted in-scope blockers, rerun tests, and record the terminal verdict.

The phase cannot advance on an empty response, parser failure, timeout, or reviewer prose alone.

The temporary ICC `--legacy-unmanaged` rail is scheduled for removal in v2.35.0 no later than
2026-08-31. ICC P4 must retain the dated removal item in its ship artifact; L5/L6 reject the rail
immediately in v2.34.0.

## Plans

- [Implementation Campaign Convergence Control](../../plans/2026-07-26-implementation-campaign-convergence-control.md)
- [Mission Convergence Supervisor](../../plans/2026-07-26-task-convergence-contract.md)
- [Provider Readiness Orchestrator](../../plans/2026-07-26-provider-readiness-orchestrator.md)
- [Dispatch Worktree Lifecycle Budget](../../plans/2026-07-26-dispatch-worktree-lifecycle-budget.md)
- [L6 Status and Merge Contract](../../plans/2026-07-26-l6-status-merge-contract.md)
- [Plan Review Session Controller](../../plans/2026-07-26-plan-review-session-controller.md)
- [Cross-Harness Transcript Retro](../../plans/2026-07-26-cross-harness-transcript-retro.md)

## Out Of Scope

- A second Autopilot repository for strong models.
- Long-running host daemon, scheduler, web dashboard, or remote-control service.
- Native Kimi implementation dispatch; this project adds only the reviewed author/reviewer transport.
- Universal enforcement claims for harnesses without executable blocking evidence.
- Repairing unrelated repository debt discovered by deterministic gates.
