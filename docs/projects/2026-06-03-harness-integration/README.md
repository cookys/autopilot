# harness-integration + release-ritual (v2.10.0)

> CEO-mode L-ship. Picks up all open **Next candidates** from
> [2026-06-03-distill-handoff.md](../../plans/2026-06-03-distill-handoff.md).
> Direction grounded in the verified memo [[project-harness-integration-direction]]
> (2026-06-02), which already resolved the `/goal`×Stop-hook spike.

## OKR — verifiable success criteria

| # | Criterion | Verify |
|---|-----------|--------|
| 1 | `.githooks/post-merge`: on a merge commit landing on `develop`/`main`, prints the merge SHA + runs `preflight-release.sh` as **advisory** (non-blocking, no auto-commit). No-op on FF pulls / non-merge / other branches. | Simulate a `--no-ff` merge → hook prints SHA + preflight summary; FF pull → silent. |
| 2 | `ceo-agent` SKILL.md + `multi-agent-portability.md` document `/goal` as a **CC-only convergence primitive** behind capability prose, graceful-degrade elsewhere. | grep both files; portability table has a `/goal` row. |
| 3 | `project-config-template/loop.md` shipped — unattended babysit template (next / debug / quality-pipeline), CC-only, degrades cleanly. | File exists; references real `/loop` semantics; documented as consumed. |
| 4 | `finish-flow` + `quality-pipeline` reference **Monitor** as the CI-polling primitive, capability-gated. | grep both SKILL.md. |
| 5 | Open#2: `~/projects/llm-playground/.gitignore` lets `.claude/skills/` propagate (`.claude/*` + `!.claude/skills/`); skill staged. | `git -C ~/projects/llm-playground check-ignore .claude/skills/commit-eval-tasks-to-repo/SKILL.md` → not ignored. |
| 6 | Release hygiene: 2.9.1→**2.10.0**, CHANGELOG entry, mirrors synced, INDEX row, `preflight-release.sh` green. | `scripts/preflight-release.sh` exit 0. |

## Scope mode: **Hold**

User fixed the candidate list ("全做完"). Bulletproof exactly these; no scope additions.

## L-1.5 Scope Completeness Audit

| Dimension | In scope? | Coverage |
|-----------|-----------|----------|
| source | yes | post-merge hook (P0), loop.md template (P2) |
| tests | yes | post-merge hook tested by simulated merge (P0); bash hook, no unit-test harness needed |
| docs | yes | CLAUDE.md inventory, ceo-agent/finish-flow/quality-pipeline SKILL.md, multi-agent-portability.md (P1–P3) |
| API | n/a | no code API surface |
| templates | yes | loop.md is a new `project-config-template/` entry; consumption documented (P2) |
| CHANGELOG | yes | P5 |
| version | yes | minor bump 2.10.0 (P5) |
| migration | no | additive only |
| consumers | yes | post-merge auto-activates via existing `core.hooksPath=.githooks`; loop.md consumption documented |
| dogfood | yes | the post-merge hook dogfoods itself when **this** project merges to develop |
| credit/attribution | n/a | harness primitives are CC-native; cite `/goal` & `/loop` docs, no external OSS absorbed |

## Out of scope (explicit — Hold mode + ocean-flagging)

- **Runtime harness-capability detector** — docs-gating prose only; a real "does this agent support /goal?" probe is an ocean → separate project if ever needed.
- **pre-push blocking preflight gate** — the memo's richer "enforce don't remind" idea. Surfaced as a recommendation in the final report; Hold mode keeps it out of this ship.
- **PushNotification at finish-flow end** — memo's lower-priority target; follow-up.
- **Workflow / EnterWorktree integration** — not requested.
- **distill follow-ups** (consolidate, publish-grade de-id, scheduled scan) — trigger-only per user.

## Phases

- **P0** — post-merge release-ritual hook (+ simulated-merge test + CLAUDE.md inventory row)
- **P1** — `/goal` integration docs (ceo-agent + multi-agent-portability)
- **P2** — `loop.md` unattended-babysit template + consumption docs
- **P3** — Monitor CI-polling docs (finish-flow + quality-pipeline)
- **P4** — Open#2: llm-playground `.gitignore` fix
- **P5** — release hygiene (version, CHANGELOG, INDEX, preflight)
- **L-5** — invoke `autopilot:finish-flow`

## Progress

_In progress — see TaskList._
