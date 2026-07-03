# Endpoint Credential Unification + Declarative Invoke Infra

- **Date**: 2026-07-03
- **Target version**: v2.31.6 (PATCH — new loader script + additive config keys + docs; no new skill/agent)
- **Branch**: `feat/v2.31.6-endpoint-credential-unification`
- **Status**: In progress

## Problem

Anthropic-compatible env-token engines (MiniMax, GLM, any compatible endpoint) currently
have a **fragmented credential surface** and a **manual-only invoke path**:

1. **Placement is scattered.** Credentials live across ≥3 conventions with no single
   documented home: `AUTOPILOT_ENDPOINT_<NAME>_{URL,TOKEN}` (the designed resolver contract,
   `resolve-endpoint.sh`), plus ad-hoc `MINIMAX_API_KEY` / `ANTHROPIC_COMPATIBLE_AUTH_TOKEN`,
   plus raw `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN`. A user has no canonical "put your
   token here" location — it ends up buried in `~/.zshrc` or re-exported per shell.
2. **Invoke infra is manual.** `--endpoint <name>` is wired into `dispatch-hetero.sh` /
   `dispatch-review.sh` / `dispatch-anthropic-review.js` but must be typed by hand every run.
   `implementer_endpoint` / `reviewer_endpoint` config-surface wiring is BACKLOG'd, so `/l5`
   `/l6` cannot pick up a project's endpoint declaratively.
3. **No value-prop / no steering.** Nothing tells a user "fill these in → you get a strong
   heterogeneous engine roster", and nothing steers them to a flat-rate **subscription plan**
   over a metered **API key**.

## Design

### A. Canonical placement — `~/.autopilot/endpoints.env` + safe-load line-parser

- **Canonical home**: `${AUTOPILOT_ENDPOINTS_ENV:-$HOME/.autopilot/endpoints.env}`, mode-600.
  `~/.autopilot/` is already the machine-local runtime-state home (engine-capability,
  calibration, distill, risk-counter) and where `2026-07-01-cross-harness-engine-infrastructure`
  already placed MiniMax provider defaults — natural fit, machine-scoped (correct sharing
  granularity for creds), out of every repo (no `.claude/` gitignore hazard).
- **The env-var convention `AUTOPILOT_ENDPOINT_<NAME>_*` stays the resolution contract.**
  `endpoints.env` is only a persistence layer that *populates* those env vars; `resolve-endpoint.sh`
  is unchanged.
- **New loader `scripts/load-endpoints-env.sh`** (sourceable bash function
  `autopilot_load_endpoints_env`) + a Node twin `scripts/lib/load-endpoints-env.js` for the JS
  reviewer. Security rules (honoring the cross-harness plan's "token never in argv, env/fd/stdin
  only" contract):
  - **Line-parser, NOT `source`** — never executes file contents. Accept only
    `^(export )?<ALLOWED_NAME>=<value>` where `<ALLOWED_NAME>` matches an allowlist:
    `AUTOPILOT_ENDPOINT_*_URL`, `AUTOPILOT_ENDPOINT_*_TOKEN`, `ANTHROPIC_BASE_URL`,
    `ANTHROPIC_AUTH_TOKEN`, `MINIMAX_API_KEY`, `ANTHROPIC_COMPATIBLE_AUTH_TOKEN`. Anything else
    (arbitrary vars, command substitution, multi-line) is ignored.
  - **Perms gate**: reject if the path is a **symlink** (lstat), reject if **not owned by EUID**,
    reject if **group/other-writable** (`perms & 022`, injection vector). **Warn** (not reject)
    if group/other-**readable** (confidentiality, not injection).
  - **Existing env wins**: only set a var that is currently unset/empty, so a one-off
    `AUTOPILOT_ENDPOINT_X_TOKEN=… <cmd>` overrides the file.
  - **Value hygiene**: strip surrounding quotes; never echo a value; fail-safe (missing file →
    silent no-op, exit 0).
- **Wire the loader** at the top of `dispatch-hetero.sh`, `dispatch-review.sh`, and inside
  `dispatch-anthropic-review.js` (the JS is usually spawned by `dispatch-review.sh` which
  already loaded it, but direct invocation must also work).
- **Legacy aliases** `MINIMAX_API_KEY` / `ANTHROPIC_COMPATIBLE_AUTH_TOKEN` become *documented
  aliases* — still honored (resolve-endpoint already treats them as fallback candidates), just
  no longer the recommended surface.

### B. Declarative invoke infra (closes the BACKLOG'd item)

- Add `implementer_endpoint` / `reviewer_endpoint` keys to
  `project-config-template/review-loop-config.md` (name is `[A-Za-z0-9_]`, empty = none).
- `scripts/resolve-review-loop.sh` parses them + emits two new JSON keys
  (`implementer_endpoint`, `reviewer_endpoint`). Absent/empty → `""` (byte-identical existing
  callers otherwise).
- `/l5` `/l6` dispatch prose (`skills/ceo-agent/references/level-front-door.md`) reads the two
  keys → passes `--endpoint <name>` to `dispatch-hetero.sh` / `dispatch-review.sh` when set.

### C. Docs + value-prop

- **`docs/installation.md`** new section: *Heterogeneous engine credentials* — the one canonical
  placement (`~/.autopilot/endpoints.env`), the `AUTOPILOT_ENDPOINT_<NAME>_*` convention, a
  copy-paste stub, and the declarative `review-loop-config.md` wiring.
- **`README.md` + `README.zh-TW.md`** engine section: "fill an endpoint → strong hetero power",
  with the **recommendation ladder**: default **subscription plan** ≻ **API key**:
  1. `codex` / `agy` / `grok` via their own OAuth CLI login — flat-rate under existing subs, no
     env token.
  2. GLM / MiniMax **coding-plan subscription token** in `endpoints.env` — flat-rate.
  3. Metered **API key** — last resort (cost-unbounded).

### D. Scaffold + tests

- A `--init` path (in `resolve-endpoint.sh` or a small helper) that writes a mode-600
  `endpoints.env` **stub** (commented template, no secrets) if absent; documented in onboard.
- Tests: `load-endpoints-env` (symlink-reject / non-owner / group-writable-reject /
  group-readable-warn / line-parse allowlist / existing-env-precedence / quote-strip /
  missing-file no-op), `resolve-review-loop` new keys, `.js` twin parity.

## Phases

| Phase | Deliverable |
|-------|-------------|
| **P0** | `scripts/load-endpoints-env.sh` + `scripts/lib/load-endpoints-env.js` twin + wire into 3 dispatch scripts + tests |
| **P1** | Declarative invoke infra: config template keys + `resolve-review-loop.sh` JSON + `/l5`/`/l6` prose + tests |
| **P2** | Docs: `installation.md` section + `README.md`/`README.zh-TW.md` engine + value-prop ladder |
| **P3** | Scaffold `endpoints.env` stub (`--init`) + onboard mention |
| **P4** | CLAUDE.md inventory (new script row) + close BACKLOG note + version bump v2.31.6 + CHANGELOG + INDEX + release preflight |

## Scope boundary

- **In**: credential placement unification, safe loader, declarative endpoint config, docs,
  value-prop, scaffold stub, tests.
- **Out**: new provider onboarding (that's `engine-onboarding`); changing `resolve-endpoint.sh`'s
  resolution precedence; secret encryption / keychain integration (plaintext mode-600 file is the
  standard, same as `~/.aws/credentials`); OAuth-login runner auth (codex/agy/grok manage their
  own — out of scope by construction).

## Review Loop History

(to be filled during execution)
