# Plan — Managed final panel: provable blind isolation for `kimi` and `agy` reviewer seats

> Status: DRAFT (spike-backed, not yet registered/reviewed) · Owner: depth-0 · Size: L · Base: `d979f2dc` · Branch: not yet created (main checkout frozen)
> Source: BACKLOG row the former BACKLOG row "Managed final panel: cleanroom/packet isolation profiles for kimi and agy reviewer seats" (removed when this plan was registered; git history `d979f2dc`) (peer-requested, cuda/chatgpt-tunnel). Reopens the out-of-scope line at `docs/plans/2026-09-17-blind-review-cleanroom-intake.md:219-224` ("Other cleanroom profiles").
> Spike log (raw command output): `docs/plans/evidence/2026-10-02-final-panel-kimi-agy-isolation/spike-log.md` (§0.1 is the self-contained summary reviewers rely on). Frame: the request is NOT a waiver of tier `none`; each runner earns a tier only by a host probe.

## 0. Context / thesis

Today `reviewSeatTier` (`src/engine/final-panel-qualification.js:22-28`) is a static table: packet = anthropic-compatible/cc-shim/claude-native/qoderclicn (`:10-15`), cleanroom = codex (`:16`), everything else `none`. `runCampaignIntake` refuses a `none` qc seat before any qualification check with `final_panel_seat_blind_incompatible` (`src/engine/campaign-intake.js:1921-1926`); pins/overrides cannot bypass. The same table lives in `scripts/dispatch-review.sh:303-309` (`review_seat_tier`) and `scripts/resolve-review-loop.sh:2225-2232`.

What the tiers must guarantee (read from the code):
- **packet**: prompt-only. The reviewer gets the sealed packet text; the runner CLI runs with all tools off by CLI flags (`--tools ""` at `dispatch-review.sh:1158,1428,1454`) in a scratch cwd, never the repo. Not probed before spend.
- **cleanroom**: tool-capable runner confined by bwrap. Intake runs `scripts/lib/cleanroom-launch.sh --preflight --deny-path <repo, git-common-dir, $HOME, contract dir>` once per cleanroom runner, no model (`campaign-intake.js:580-700,1928-1970`, 60 s cap); dispatch re-runs the preflight on the packet dir before launch (`dispatch-review.sh:319-341`). Preflight exits 3 if a deny path is readable inside the seat. Failure = `final_panel_seat_cleanroom_unavailable`, fail closed. Seat env is `--clearenv`, seat HOME is private, only the credential is copied in (`cleanroom-launch.sh:170-250`).
- both: no repo read, no write to the repo, verdict only from the packet; `none` stays refused.

How kimi/agy run today (tier `none`): kimi `-p "$(cat prompt)" -m <model> --output-format text` in a scratch cwd, default (fully tooled) agent (`dispatch-review.sh:1214-1260`); agy under `bwrap --ro-bind / /` + a tool-less agent + post-run transcript audit (`dispatch-review.sh:1488-1560`, `scripts/lib/agy-containment.js`).

## 0.1 Spike evidence (this host, 2026-10-02; full output in the evidence dir's `spike-log.md`)

| # | Probe | Result |
|---|-------|--------|
| K1 | kimi 2.1.1 default agent, canary in cwd, "cat canary.txt" | LEAKED `CANARY-7731-XYZ`; wire.jsonl has `tool.call` |
| K2 | same + `--agent-file` (frontmatter `tools: []`; doc: https://moonshotai.github.io/kimi-code/en/customization/agents) | `NOTOOLS`; wire.jsonl `llm.tools_snapshot` `"tools":[]`, 0 `tool.call` |
| K3 | agent file missing `description` | kimi errors rc=1 `Missing required frontmatter field "description"` — fails closed |
| K4 | kimi in bwrap seat, no repo, no real HOME, only `.kimi-code/{config.toml,credentials,oauth}` | works (PONG/NOTOOLS), session lands in the seat |
| A1 | agy 1.2.14 existing rail + tool-less agent | `NOTOOLS`; `agy-containment.js audit` rc=0 |
| A2 | agy, agent file missing `description` | LEAKED canary + hostname; audit rc=1 breach (silent fallback, exit 0) |
| A2b | `agy agents` with the agent dir bound | lists the agent only when it is valid; no model call |
| A3 | agy in a repo-less seat (no `--ro-bind /`), only oauth token + agent | works, `NOTOOLS`, audit rc=0 |

Unverified, NOT relied on: agy `--sandbox` semantics; token refresh inside a seat (discarded with the seat, same limitation as codex); behaviour on other kimi/agy versions.

**Classification.** Neither CLI has a `--no-tools` flag, but both honour a custom agent that is a tool allowlist (`tools: []`). Tools-off is provable only from the run's own transcript (post-run audit); the filesystem/process boundary is provable before spend (bwrap preflight, model-free). Therefore both runners are achievable as **cleanroom** tier (bwrap seat + tool-less agent + mandatory audit), NOT packet (packet has no probe/sandbox layer, and agy's silent fallback shows a flag-only claim is unsafe). Neither is scoped out.

## 1. Problem

A managed final panel cannot seat kimi (kimi-code/k3*) or agy (Gemini) reviewers because their tier is `none`, although both can be contained with evidence. Goal: tier = cleanroom for each, earned per host by a fail-closed pre-spend probe, keeping the no-tools and isolation hard gates.

## 2. OKR / KRs

- KR1: a kimi or agy qc seat passes intake only when the host probe is green; probe red/timeout = `final_panel_seat_cleanroom_unavailable`; a pin/override never bypasses.
- KR2: under `AUTOPILOT_BLIND_DISCOVERY=1` both seats run inside the seat with no repo and no real HOME visible, and any tool call, tool-snapshot entry, missing/unparseable transcript, or agent fallback voids the verdict (`no_verdict`).
- KR3: tier tables in JS, `dispatch-review.sh` and `resolve-review-loop.sh` agree (parity test); non-blind paths unchanged.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Tier `none` is never waived: no flag, pin, override, or env var may seat a `none` runner in a managed final panel.
- A runner is tier packet or cleanroom only through a pre-spend probe that proves the isolation on THIS host and fails closed (red, timeout, missing binary, missing launcher = refuse; `unknown` only under shadow enforcement, as for codex).
- The pre-spend probe never calls a model and never receives the repo, HOME, credentials or the packet.
- Under blind discovery the kimi/agy seat runs with `--clearenv`, a private seat HOME holding only that CLI's credential/config, no repo path, no real HOME, no `--ro-bind / /`.
- The seat agent is a tool allowlist (`tools: []`); a CLI without a verifiable tool-less agent stays `none`.
- The exit code never decides containment: the post-run audit does. A missing log/transcript/wire file, an unknown record type, any `tool.call`/`tool_calls`, a non-empty tool snapshot, or an agent fallback is a breach and voids the verdict.
- The no-tools and isolation hard gates are kept; pins and overrides cannot bypass containment.
- No trust machinery (ADR-0001): verification is independent re-derivation of the seat's own transcript on this run, never a signed or hashed attestation.
- Node >= 20.10 built-ins only for new scripts; shell only for bwrap argv glue.
- Non-blind dispatch behaviour for kimi/agy is byte-identical to base.
- The `verification_author` pin / unreachable VA pin is a different backlog row and is not touched.

## 2.6 Change-policy decisions

- **Compatibility impact**: `published-compatible` — managed qc panels that listed kimi/agy were refused at intake and now pass when the probe is green; error code names unchanged; the refusal text stops listing kimi/agy as unsupported. No config schema change.
- **Dependency decision**: `none` — bwrap, node and each CLI already required on this path.

## 3. File-structure map

| File | Responsibility |
|------|----------------|
| `scripts/lib/kimi-containment.js` (new) | tool-less kimi agent writer (read-back) + `audit` of the seat's `wire.jsonl`; mirrors `agy-containment.js` |
| `scripts/lib/agy-containment.js` | reuse as is; add only an exported seat-dir audit helper if needed |
| `scripts/lib/cleanroom-launch.sh` | profiles `kimi`, `agy` (launch + model-free profile preflight); codex profile unchanged |
| `scripts/dispatch-review.sh` | `review_seat_tier` kimi/agy -> cleanroom; blind kimi/agy branches go through the launcher, then audit; non-blind unchanged |
| `src/engine/final-panel-qualification.js` | `REVIEW_SEAT_TIERS.cleanroom` += kimi, agy |
| `src/engine/campaign-intake.js` | probe is per runner: pass `--profile <runner>` to the preflight; refusal message text |
| `scripts/resolve-review-loop.sh` | mirror table (`:2225-2232`) |
| `hooks/tests/` | new containment/launcher/parity tests; existing parity test `dispatch-review.test.sh` extended |
| `references/multi-agent-portability.md`, `docs/scripts-inventory.md`, `CLAUDE.md` inventory, `CHANGELOG.md` | facts + wiring |

## 4. Phases (dev-flow size; each lists RED + negative control)

1. **Containment libs (S)** — `kimi-containment.js write|audit|name`; the kimi audit reads `<seat-home>/.kimi-code/sessions/**/wire.jsonl`: breach on any `tool.call`, a non-empty `llm.tools_snapshot.tools`, no wire file, unparseable line. Done when fixtures from K1/K2 (captured wire files) give audit rc=1 / rc=0. RED: the lib does not exist. Negative control: append one `tool.call` line to the clean fixture -> rc=1; delete `tools_snapshot` -> rc=1 (fail closed).
2. **Launcher profiles (L)** — `cleanroom-launch.sh --profile kimi|agy`: argv shapes proven in K4/A3 (`--unshare-all --share-net --die-with-parent --new-session --hostname review`, ro `/usr`, node dir ro for kimi, private HOME with credential+config copy, agent bind, `--clearenv`). `--preflight --profile <p>` adds model-free checks: CLI resolvable and (kimi) the node dir/entry exists; the agent file reads back intact; (agy) `agy agents` inside the seat lists the agent. Done when: preflight exit 0 green / 2 runtime / 3 deny path readable, as today. RED: `--profile kimi` -> "unsupported cleanroom profile" at base. Negative control: a deny path bound into the seat (or an agent file without `description`) -> non-zero; probe with the fake launcher seam `AUTOPILOT_CLEANROOM_LAUNCHER` returning 3 -> refused.
3. **Dispatch rail (L)** — under blind discovery, kimi/agy run via the launcher with the packet as prompt (argv ceilings unchanged: kimi 120000 B `:1247`, agy `agy_argv_ceiling_assert`), then the audit on the seat dir before it is deleted; breach/rc!=0/timeout -> `no_verdict`. Done when: stubbed-CLI tests prove the verdict is dropped on a tool call, a missing transcript and an agent fallback. RED: blind kimi/agy -> `die_precondition "blind review requires an enforceable no-tools runner profile"` at base. Negative control: stub emits a `tool.call` -> `no_verdict` (not `reviewed`); an invalid `--runner` still precondition_failed.
4. **Tier tables + intake (S)** — JS table, shell table, resolver table, intake per-runner probe with profile, message text. Done when: parity test (shell vs JS vs resolver) green; intake with probe `ready` passes a kimi seat, `rejected` -> `final_panel_seat_cleanroom_unavailable`, `none` runner (grok) still `final_panel_seat_blind_incompatible`. RED: kimi seat refused as blind-incompatible at base. Negative control: pins/overrides on a rejected kimi seat still refused; flip one table to drift -> parity test fails.
5. **Docs + live-fire + closeout (S)** — portability reference, inventory, CHANGELOG, backlog row closed; ONE operator-approved real-host run per runner (tiny prompt, canary in the repo dir must not appear, audit clean). Done when: receipts show canary absent. RED: at base blind kimi/agy dies `blind review requires an enforceable no-tools runner profile`. Negative control: the same live-fire with the agent file sabotaged (no `description`) must be refused by preflight or breach by audit.

Order: 1 -> 2 -> 3 -> 4 -> 5 (4 may run after 2 in parallel with 3 only if tables stay unreachable until 3 lands; keep it serial to avoid a window where intake admits a seat the rail cannot run).

## 5. Test / validation

Script-gated: phase tests above, existing `hooks/tests/dispatch-review.test.sh` parity, `scripts/check-claude-md-inventory.js`, `check-hook-inventory`. Human-gated: phase 5 live-fire (spends model tokens); operator confirms seat qualification evidence for kimi-code/k3 and Gemini seats is a separate admission (`finalPanelSeatQualified`, unchanged). Tests must write fixtures only under a temp dir, never the real `~/.kimi-code` / `~/.gemini` stores; the seat HOME is the only place a session may land.

## 6. Risks + inversion (what guarantees failure)

- Silent fallback to a tooled agent (agy A2): mitigated by audit-decides and preflight `agy agents` check; kimi errors closed (K3).
- Audit surface moves between CLI versions (wire.jsonl layout, transcript path): an unknown record type or missing file is a breach, and the preflight records the CLI version; a version outside the probed one is operator-visible, never silently trusted (advisory, not a trust root).
- Credential in the seat survives SIGKILL: same orphan limitation as codex (`cleanroom-launch.sh` header); sweep documented.
- Token refresh inside the seat is discarded: an expired token fails the review closed, not open.
- Intake admits a seat the rail cannot run (table drift): phase 4 after 3 + parity test.
- Fixtures captured from a real run embed paths/ids: scrub before commit.

## 7. Out of scope

- The `verification_author` pin / unreachable VA pin (separate backlog row).
- `grok`, `cursor`, `opencode`: stay `none` (not spiked here).
- Seat qualification/scorecard evidence for these models; configurable deny-list; proxy/CA pass-through; agy `--sandbox` (unverified).
- Packet tier for kimi/agy (rejected in §0.1).

## 8. Operator decisions (2026-10-02; defaults proposed by depth-0, not overridden)

1. Tools-off is proven post-run (the audit voids the verdict); only the filesystem/process boundary is proven pre-spend. No model canary at intake — the probe stays model-free.
2. Phase 5 may spend real kimi/agy tokens: one live-fire per runner, on the existing accounts.
3. Intake records the probed kimi/agy version; a different version at dispatch time WARNS only (advisory, never blocks).

## Review log

- R0 author: Sonnet draft from spike, depth-0 edits, 2026-10-02. Rubric: `2026-10-02-final-panel-kimi-agy-isolation.rubric.md`. Manifest and controller generations: not yet run.
