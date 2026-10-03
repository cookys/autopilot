# mods P1a — landing evidence (v2.36.115)

P1a of `docs/plans/2026-10-03-mods-visible-dispatch.md` shipped as v2.36.115 (`97be7170`). This directory holds the briefs, every review artifact, and the suite summaries.

## Rows and landed commits

| Row | Content | Landed |
|-----|---------|--------|
| R1 | run manifests carry `repo_identity` from a shared shell function | `6f19e18f`, test fix `b27e6aa6` |
| R2 | `project_key`, session-mode marker scope fields, live pointer | `9b25c719` |
| R3 | `status runs` elapsed/rc/scope/freshness, bounded-rotation enrich | `a6ba0b8b`, repair `05be19ea` |
| R4a | project watcher, scoped `runs-live` envelopes, single flock writer | `472c2569` |
| R4b | counts, session and host cost, marker-aware idle exit | `b71decc7`, repair `4c4b721d` |
| R5 | `session-mode set` starts the watcher (autostart switch); `references/mods.md` | `2f59aa1b` |
| R6 | `lib.sh` isolates the live dir by default; `--project` accepts `repo_identity`; runs-live schema | `0284414a` |
| R7 | enrich rotation scoped to the watched project | `aca55046` |
| release | version bump and CHANGELOG | `97be7170` |

## Pipeline shape

Three parallel sonnet hands (R1, R2, R3), then R4 as two commits (R4a, R4b), then R5, then two review repairs after the combined reviews. Every row had its own review. One combined review of `origin/develop..HEAD` ran per landing round (three rounds; round 3 was SHIP-AS-IS). Briefs are in `briefs/`, per-row reviews in `reviews/`, combined reviews in `combined-reviews/`, accepted heads in `accepted-heads.txt`, unfixed items in `followups.md`.

## What each review layer caught

- Per-row: R3 emitted `elapsed_s` as 0 instead of null for a finished run with no end time; R4b's counts used a per-root bound instead of a project-wide one.
- Combined round 1 (FIX-THEN-SHIP): `--project` must accept a full `repo_identity` (spec section 2.7); the `runs-live` schema file was missing; a test leaked the enrich cursor into the real live dir.
- Combined round 2 (FIX-THEN-SHIP): the enrich rotation spans every live run on the host while the fresh bound assumed only the project's rows, so rows flapped to `unknown` with several projects live.
- Review rail: the first R7 review attempt was refused (blind-evidence K1) because the spec carried a depth-0 ruling narrative. Review specs must state requirements only.

## Real-store incidents

- R2 pointer leak: suites isolated only `AUTOPILOT_SESSION_MODE_DIR`, but the live pointer was written under `$HOME`. Fixed by making the pointer location follow the session-mode dir.
- `scripts/tests/session-mode-null-admission.test.sh` (pre-existing) had no isolation and wrote real markers; fixed in R5.
- `AUTOPILOT_LIVE_DIR` on `/tmp` or a mode 755 dir is silently rejected and resolution falls through to the real live dir (R1 manifest suite, an R4 debug run). The suite was fixed and `lib.sh` now defaults the live dir to a 0700 dir under `/dev/shm`. The resolver behaviour itself is a BACKLOG row. See `references/evidence-discipline.md` section 53.

## Pre-existing reds

The L1 unit suite (22 tests), `qualification-feed-adopt`, and `qualification-scorecard-tools` are red at origin/develop too (identical failure lists on a base worktree). Summaries: `suite-summary-full.txt`, `suite-summary-full1.txt`.
