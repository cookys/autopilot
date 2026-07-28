# Mission Convergence Portfolio

> Status: In progress
>
> Progress: 0/3 current deliverables canonically READY; `runtime-control` bootstrap is integrated
> on candidate history and omitted from the successor executable graph
>
> Current deliverable: successor graph — `plan-review` + `transcript-retro` (parallel), then
> `release-closeout`
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
| "讓 CEO 全權把計畫全數依序執行完" | The CEO owns implementation, recovery, verification, local commits, merge, and archive across the admitted deliverable graph below. |
| "每個階段跑完都要跑 heto engine loop review till all good" | Every deliverable has passing deterministic tests plus a bounded heterogeneous review gate before a dependent node starts; review generations are not new deliverables. |
| Existing project policy: project default once, task override only when needed | Mission configuration and authenticated override contract in Mission P1/P2. |
| Existing project policy: strong and weak models coexist through profiles | ICC and PRO consume the shipped capability/guidance profile contracts without splitting the repository. |
| Existing project policy: no unbounded topic expansion | Review discoveries outside the frozen deliverable rubric go to `docs/BACKLOG.md`; they do not grow the active graph. |
| Valuable reviewer follow-ups must not be lost | ICC/PRS emit evidence-bound follow-up candidates; LSM P4 makes depth-0 dedupe and admit them to backlog before closeout, while `/next` may reopen them only as a new ticket/contract/budget after their trigger is true. |
| "直接放寬" Kimi transport | `runtime-control` (historical bootstrap deliverable) permits Kimi 0.28.0 direct-vector `--prompt` transport with scratch-cwd isolation and public-output redaction; it does not claim role qualification or a CLI-enforced no-effect guarantee. |

## Scope Completeness Audit

| Surface | Included work |
|---|---|
| Runtime and state | ICC campaign reducer/intake, Mission reducer/control/projection, provider readiness, lifecycle receipts, task closeout |
| Schemas and compatibility | Versioned campaign, Mission, readiness, lifecycle, merge, task-status, plan-review, and transcript-event contracts |
| CLI and scripts | `engine implement-review`, campaign/mission/status/merge commands, deterministic checkers and lifecycle tools |
| Git/process safety | Pre-spend rejection, immutable verification, occupancy locking, exact branch disposition, dirty-aware merge execution |
| Tests | RED/GREEN fixtures, state tables, transport parsing, replay/resume, race cases, status/merge, transcript adapters, package parity |
| Skills/docs | CEO/L3-L6/dev-flow/finish-flow routing, bounded Mission admission, config templates, references, script inventory, CHANGELOG |
| Generated payload | Codex plugin mirror generated once from the final canonical tree |
| Data/privacy | Synthetic fixtures only; raw transcripts and secrets stay outside the repository |
| Deployment/migration | Backward-compatible shadow defaults; no daemon, production push, database migration, assets, or i18n surface |

## Historical Implementation Ledger

These rows preserve the completed implementation and review evidence from the original source-plan
sequence. They are historical traceability, not remaining executable phases. `READY` means
deterministic acceptance passed and the bounded Heto artifact has no admitted blocking finding. A
transport failure never counts as a verdict.

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
| 17 | LSM P2 merge-intent preflight | LSM P1 | READY | `727bdf9` | [lsm-p2.md](reviews/lsm-p2.md) |
| 18 | LSM P3 merge execution receipts | LSM P2 | READY | `a401f35` | [lsm-p3.md](reviews/lsm-p3.md) |
| 19 | LSM P4 finish-flow + CEO reporting | LSM P3 | READY | `f77866a` | [lsm-p4.md](reviews/lsm-p4.md) |
| 20 | LSM P5 docs/package integration | LSM P4 | READY | `27d43a8` | [lsm-p5.md](reviews/lsm-p5.md) |
| 21 | ICC P4 057 dogfood + ship integration | Mission/LSM integration | READY | `cc8c227` | [icc-p4.md](reviews/icc-p4.md) |
| 22 | `runtime-control` bootstrap (four-node era) | completed core | BOOTSTRAP INTEGRATED (graph-omitted) | candidate `b9a3f55cf2904c71a276cbaa5f19d5d9fc67ed0d` on `mission/d0a1cbf6b531/runtime-control-a1` | focused suite green (842 assertions + canonical/mirror gates); prior four-node campaign correctly rejected historical `output_paths` replay against HEAD |

## Current Deliverable Graph (successor after runtime-control bootstrap)

The source portfolio originally contained 32 `Phase`/`P0` authoring headings; the old tracker also
added a baseline and closeout row, producing 34 sequential rows. Those units are coverage metadata.
After the `runtime-control` bootstrap landed its required mutations in candidate history, the
**successor executable graph** retains only outstanding deliverables:

| Node | Included source work | Dependencies | Status | Candidate/integration evidence |
|---|---|---|---|---|
| `plan-review` | PRS P1-P5 | completed core + runtime-control bootstrap | REPAIR/REVIEW IN_PROGRESS | candidate commits `c076d94`, `7e9ba5f`; branch `feat/prs-complete-track`; no canonical acceptance yet |
| `transcript-retro` | CTR P1-P4 | completed core + runtime-control bootstrap | REPAIR/REVIEW IN_PROGRESS | candidate commit `446956241b3906f3a3ab5399b7be8cb60670bc0c`; branch `feat/ctr-complete-track`; no canonical acceptance yet |
| `release-closeout` | Joint QC, version sync, canonical merge, worktree/branch cleanup, archive | exactly `plan-review` + `transcript-retro` | BLOCKED | starts only after both predecessors are canonically integrated |

Maximum active implementation width is two on the successor graph (`plan-review` ∥
`transcript-retro`). `release-closeout` remains the only sequential terminal node.

Authoritative artifacts:

- [mission-execution-graph.json](mission-execution-graph.json) — successor three-node DAG
  (`graph_digest` `b281d81e…`)
- [content-bound source manifest](../../mission-convergence-portfolio-sources.json) — narrowed to
  the three remaining source plans/rubrics required for exact coverage of the successor graph.
  The historical seven-plan portfolio set remains recoverable from git history and the historical
  ledger above; hashes are never fabricated.
- [candidate path audit](candidate-path-audit.json) — frozen mechanically observed path sets from
  the four-node era; `runtime-control` candidates and the post-C bridge are classified
  `historical` under `retired_nodes` and are excluded from active path-ownership calculations.

### Why `runtime-control` was removed from the executable graph

A prior Mission campaign correctly rejected integrating the `runtime-control` node: its
`output_paths` list represented **all files produced since the old portfolio base**, most of which
are already present in current HEAD. A delta repair must not rewrite those files merely to satisfy
a historical boundary. The bootstrap implementation itself is complete and its focused suite is
green at candidate `b9a3f55…`; resume projection therefore **omits** the integrated deliverable
from the successor graph rather than redispatches it.

PRS and CTR `required_paths` / `output_paths` contracts are unchanged: they still match the
complete diffs from their frozen source-plan bases and must not be weakened into broad allowlists.

## Deliverable Gate

For each current graph node:

1. Freeze the deliverable acceptance criteria and allowed diff.
2. Add or confirm the RED oracle before production mutation.
3. Implement and run the focused tests.
4. Run repository invariants appropriate to the changed surfaces.
5. Commit one logical deliverable/workstream.
6. Run a bounded heterogeneous review against that commit/diff.
7. Fix only admitted in-scope blockers, rerun tests, and record the terminal verdict.

Tests, reviewer seats, transport attempts, repairs, and retries consume the node's frozen
gate-attempt budget. They never create a new phase or graph node. A dependent node cannot advance
on an empty response, parser failure, timeout, or reviewer prose alone.

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
- Mechanized resume-projection judgment (historical-output replay rejection before grant) — tracked
  as a high-priority backlog item; this successor-graph edit is an explicit human correction, not a
  claim that the gate already exists.
