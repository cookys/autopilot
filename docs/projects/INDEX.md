# autopilot — Projects Index

> autopilot's project tracking index. Established 2026-04-12 during the v2.4.0 methodology-agents ship, replacing the previous plan-only convention.
>
> **Why this exists**: dev-flow L-1 mandates creating a project dir for every L-size work. autopilot's earlier L-ships accumulated skips against this mandate because `docs/projects/` did not exist. 2026-04-12 formalizes this layer: every L-ship from v2.4.0 onwards gets a project dir under `docs/projects/YYYY-MM-DD-<name>/` with a `README.md` tracking OKR / phases / progress.

## 進行中 (In Progress)

_None — v2.4.0 just shipped; Ship B (v2.5.0) is drafted as a plan but not yet started._

## 已完成 (Completed)

| Date | Project | Version | Merge | Plan |
|------|---------|---------|-------|------|
| 2026-04-12 | [methodology-agents-ship-a](2026-04-12-methodology-agents-ship-a/README.md) | v2.4.0 | [`14276bb`](../../../../commit/14276bb) | [plan](../plans/2026-04-12-methodology-agents-and-hooks.md) |

## 歷史債 (Historical Debt — pre-2026-04-12, not retrofitted)

These L-size ships predate the `docs/projects/` convention. They are intentionally **not** retrofitted — creating retrospective project READMEs for already-merged work has theatrical value only. Source of truth for these ships: the plan doc + CHANGELOG entry.

| Version | Ship | Plan | Notes |
|---------|------|------|-------|
| v2.3.0 | L-1.6 skill routing forcing function | no plan doc | CHANGELOG entry only |
| v2.2.0 | [think-tank-dialectic](../plans/2026-04-11-think-tank-dialectic.md) | plan exists | plan has full design + review loop history |
| (earlier) | [skill-description-optimization](../plans/2026-03-26-skill-description-optimization.md) | plan exists | plan-only record |

**Retrofit policy**: do not retrofit these. If a historical ship needs reference, read its plan doc directly. The `docs/projects/` convention is forward-looking from v2.4.0 onwards.

## 規劃中 (Drafted — plan only, not yet started)

| Target Version | Plan | Trigger to start |
|----------------|------|------------------|
| v2.5.0 | [universal-hooks](../plans/2026-04-12-universal-hooks.md) | After Ship A (v2.4.0) has 1-2 sessions of runtime dogfood exposure; Ship A's memory lessons should inform Ship B's OKR |

## 歸檔 (Archived)

_None yet — Ship A was just completed and has not been moved to `_archive/` because it is the most recent ship. Future L-5.5 steps may move completed projects here once they are several versions old._
