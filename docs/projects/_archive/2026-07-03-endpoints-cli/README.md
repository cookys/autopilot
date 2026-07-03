# `autopilot endpoints` CLI + opt-in per-repo overlay

- **Plan**: [`docs/plans/2026-07-03-endpoints-cli.md`](../../plans/2026-07-03-endpoints-cli.md)
- **Branch**: `feat/v2.31.8-endpoints-cli`
- **Target version**: v2.31.8

## Project Goal

> **Final goal**: Give the endpoint-credential system an agent-legible + human-friendly control
> surface — an `autopilot endpoints` CLI (`init`/`list`/`which`/`set`/`doctor`, `--json`,
> token-redacted) — and make same-name-per-repo tokens possible via an OPT-IN overlay layer that
> keeps secrets under `~/.autopilot/` (never in a repo). Decided by a 3-family hetero design panel.
>
> **Success criteria**:
> 1. `node bin/autopilot.js endpoints which --json` (in a repo with a `review-loop-config.md`
>    selection) emits valid JSON showing, per selected endpoint: name, url_present, token_present,
>    layer (base/overlay/env), perm warnings — and **never a token value** (grep the output). Verified by test.
> 2. `endpoints list --json`, `doctor`, `init`, `set` behave per the plan; `set --token-stdin`
>    reads the token from STDIN (never argv — no token in process listing). Verified by tests.
> 3. Loader overlay: with `~/.autopilot/endpoints.d/<key>.env` present, a value there overrides the
>    base for that repo (env > overlay > base); with the dir ABSENT, behavior + git-call count is
>    **byte-identical to today** (zero-change gate). Verified by tests.
> 4. `bash hooks/tests/run.sh` green except the 3 known host-dependent pre-existing failures.
> 5. Node built-ins only for `src/endpoints/`; no new runtime dependency.
>
> **Scope boundary**: IN — overlay loader layer (opt-in), 5-subcommand CLI, redacted `--json`,
> docs, tests. OUT — `test <name>` live probe (BACKLOG), encryption/keychain, resolve-endpoint
> precedence changes.

## Scope Completeness Audit (L-1.5)
| Dimension | In? | Coverage |
|-----------|-----|----------|
| Source + tests | Yes | P0 (loader overlay), P1 (CLI) |
| User-facing docs | Yes | P2 (installation.md CLI section) |
| CLI/interface reference | Yes | P1 (bin help) + P2 (docs) |
| Config templates | No | overlay files are user-created, not templated (secret) |
| CHANGELOG + version bump | Yes | P2 (v2.31.8 PATCH) |
| Version sync grep | Yes | P2 |
| CLAUDE.md scripts/CLI inventory | Yes | P2 |
| Codex payload | Yes | P0/P1 touch scripts/ + src/ → sync |
| Credit/attribution | No | own work; design via own hetero panel |
| Deferred (`test`, keying refinements) | Yes | P2 → BACKLOG |

## Phases
| Phase | Deliverable | Status |
|-------|-------------|--------|
| P0 | Loader overlay layer (opt-in) + tests | ⬜ |
| P1 | `endpoints` CLI (`init`/`list`/`which`/`set`/`doctor`) + tests | ⬜ |
| P2 | Docs + CLAUDE.md + CHANGELOG + v2.31.8 + BACKLOG + finish-flow | ⬜ |

## Progress
| Date | Phase | Commit | Note |
|------|-------|--------|------|
| 2026-07-03 | Setup | — | 3-family panel decided A; branch + plan + project created |
