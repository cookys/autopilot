# `autopilot endpoints` CLI + opt-in per-repo overlay

- **Date**: 2026-07-03
- **Target version**: v2.31.8 (PATCH — new CLI subcommand surface + loader overlay layer; no new skill/agent)
- **Branch**: `feat/v2.31.8-endpoints-cli`
- **Status**: In progress

## Origin — heterogeneous design panel (2026-07-03)

Design decided via a 3-disjoint-family engine panel (dogfooding the credential system as the topic):

| Engine | Pick | On the overlay (O2) |
|--------|------|---------------------|
| codex / gpt-5.5 (OpenAI) | O1 + **O3** | defer (YAGNI — distinct names) |
| agy / Gemini (Google) | **O2 + O3** | do it (same name, per-repo token) |
| grok / xAI | **O2 + O3** | do it — distinct-names *collides* with the selection layer + makes agent diagnosis fragile |

- **Unanimous: O3** — an `autopilot endpoints` helper CLI with `--json` state + diagnosis. All three independently flagged the current design is **too opaque** for humans and agents (the only authoritative name→token map lives in a secret `.env`).
- **Synthesis (depth-0, not majority vote)**: the O2 disagreement dissolves — build O2's overlay **into O3's data model but keep the overlay files OPT-IN**. Absent overlay ⇒ base-only ⇒ **today's behavior, zero change** (satisfies codex's YAGNI); `set --repo` writes an overlay ⇒ same committed name resolves to a per-repo token (satisfies agy/grok). O2 becomes "built-in but opt-in", not a fork.

## Design

### Data model — three layers, secrets never leave `~/.autopilot/`
```
.claude/review-loop-config.md   reviewer_endpoint/implementer_endpoint   → SELECTION (by-repo, non-secret, committable)
~/.autopilot/endpoints.d/<key>.env   (optional)                          → OVERLAY  (by-repo secret, opt-in, machine-local)
~/.autopilot/endpoints.env                                               → BASE     (by-user secret, machine-local)
```
Resolution precedence (unchanged existing-env-wins, plus overlay): **process env > overlay > base**.
Repo `<key>`: normalized `git remote get-url origin` (stable across clones) → fallback `git rev-parse --show-toplevel` hash. Overlay is **gated on `~/.autopilot/endpoints.d/` existing** — if the user never opted in, ZERO git calls, zero behavior change.

### `autopilot endpoints` subcommands (v1)
| Cmd | Does | Secret hygiene |
|-----|------|----------------|
| `init` | scaffold the base stub (delegates to `load-endpoints-env.sh --init`) | — |
| `list [--json]` | all defined endpoints across base+overlay: name, base_url, token_present, layer | never prints token |
| `which [--json]` | **for THIS repo**: the selected `reviewer_endpoint`/`implementer_endpoint` → resolved url-present / token-present / which layer / perm warnings — the agent-legibility "merged view" | redacted |
| `set <name> --url <u> [--token-stdin] [--repo]` | idempotently write URL (+ token via **stdin only, never argv**) to base or the per-repo overlay | token via stdin, file chmod 600 |
| `doctor` | diagnose: base/overlay perms (600/symlink/writable), each configured endpoint resolvable? — no network | redacted |

`test <name>` (live auth roundtrip) is **deferred** — the panel marked it optional; network + real-creds scope. BACKLOG.

### Convention note (agy's flagged risk)
The loader's line-parser deliberately is NOT a full `.env` parser (no sourcing/interpolation) — a **security choice**, documented so it's not read as brittleness. The CLI's `set` means users rarely hand-edit the format anyway.

## Phases
| Phase | Deliverable |
|-------|-------------|
| **P0** | Loader overlay layer: `load-endpoints-env.sh` + `.js` twin read the optional per-repo overlay (gated on `endpoints.d/` existing; repo-keying; overlay>base merge; zero-change when absent) + tests |
| **P1** | `src/endpoints/cli.js` + `bin/autopilot.js` router: `init`/`list`/`which`/`set`/`doctor` (+ `--json`, redacted) reusing `resolve-endpoint.sh` + the loader + tests |
| **P2** | Docs (installation.md CLI section + CLAUDE.md inventory) + CHANGELOG + v2.31.8 + INDEX + `test`/keying BACKLOG + finish-flow |

## Scope boundary
- **In**: overlay loader layer (opt-in), the 5-subcommand CLI, redacted `--json`, docs, tests.
- **Out**: `test <name>` live probe (BACKLOG); a GUI/TUI; changing resolve-endpoint's resolution precedence; encrypting the files (plaintext mode-600 is the standard).

## Review Loop History
- Design: 3-family hetero panel (codex/agy/grok) + depth-0 synthesis (this doc). Convergence = O3 unanimous; O2 resolved as opt-in.
