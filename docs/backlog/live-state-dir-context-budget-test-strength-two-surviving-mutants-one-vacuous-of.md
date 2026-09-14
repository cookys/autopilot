# live-state-dir / context-budget test strength — two surviving mutants, one vacuous-off-Linux assertion, injection-test residue

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: the next edit to `scripts/lib/live-state-dir.js` probe error handling or to the `context-budget.js` live/transcript lag guard; or a `/tmp/injection-*` count above 50.
- **Context**: v2.36.1 round-2 pre-merge review (opus) mutation results: (a) `notFound: true` (fall back to `/proc/mounts` on any findmnt failure) survives 21/21 because every fake-findmnt rule set has a `'*'` default — add a rule set without it plus a `/proc/mounts` fixture saying tmpfs and assert `ssd-fallback`; (b) the lag guard's `Math.max` collapsed to "trust transcript" survives 35/35 because the older-row fixture uses transcript > live — add the case row older + transcript 130k + live 160k ⇒ 160k; (c) the newer-row test lacks `/\(statusline\)/` so it passes vacuously where `/dev/shm` is absent; (d) the injection test leaks `/tmp/injection-*` dirs whose names carry a `$(touch …)` payload — wrap in `finally { rmSync }`. Also: document `timeout: 2000` in the module header.
- **Effort**: S
- **Source**: v2.36.1 pre-merge review round 2 (opus), 2026-09-05

## A stale topology tuple derails a plan-review loop, and the failure is unreadable

- **Size**: M
- **Context**: `~/.autopilot/topology.json` recorded the reviewer seat `qwen3.8-max-preview@qoderclicn`. The installed build offers `Qwen3.8-Max`; the invalid name makes the CLI print an error and the wrapper exit 3 with **empty stdout and empty stderr**, so the seat looks like a dead runner rather than a bad tuple. With that seat `required: true`, generation 1 ends `terminal: true` / `policy_reason: required_seat_transport_exhausted`, and the completed seat's real findings land in `unratified_observations` where the receipt checker cannot see them. The escape — correcting the model name — is itself refused: `dispatch-plan-review: durable identity or frozen rubric/manifest drifted`. The seal then refuses the obvious repair. **Correction to this entry's first draft**: that is not a dead end — `dispatch-plan-review.js`'s own header documents the escape (clear the logical plan's sealed state: `grep -rl --include=state.json <logical_plan_id> ~/.autopilot/plan-review/`). The real cost is that nothing in the failure path points at it, and the diagnosis has to start from an exit 3 with no output at all. Observed 2026-09-08 on `fleet-comms-2026-09-08`; depth-0 adjudicated the two findings directly (plan-loop.md permits this) and re-reviewed the repaired plan under a disclosed successor id.
- **Trigger**: the next plan-review loop that ends `required_seat_transport_exhausted`, or the next topology regeneration.
- **Guardrails**:
  - Do **not** relax the seal for semantic drift. The distinction to encode is narrow: a seat that never produced a parseable reviewer artifact has no verdict to dodge, so replacing *only* its tuple is not evasion. A seat that reviewed and dissented must stay frozen.
  - Whatever the fix, the successor artifact must record the predecessor's id and the reason, so an abandoned identity is always readable as lineage rather than a silent reset.
  - Two cheaper mitigations that need no seal change: `resolve-dispatch-topology.js` should validate a recorded model against the runner's own list (`qoderclicn --list-models`) instead of trusting a baseline event, and the wrapper should surface the runner's stderr rather than discarding it — an empty/empty exit 3 cost most of the diagnosis time here.
- **Related**: `scripts/resolve-review-loop.sh` also resolved `plan_review_resolved_from: native-fallback` on a host with three qualified seats, purely because `~/.autopilot/topology.json` did not exist yet. A hetero review that silently becomes single-family is the same class of failure: the panel degraded and only the resolver field said so.

## The plan-loop freeze predicate cannot be satisfied by the plan loop

- **Size**: S
- **Context**: `hetero-review`'s plan-loop protocol says the loop freezes once `node scripts/check-phase-review-receipt.js --plan-artifact <file> --dispositions <file>` exits 0. In Mode B that checker requires **every finding in the plan artifact** to carry a `disposition` string (`check-phase-review-receipt.js:408`), but `dispatch-plan-review.js` never writes dispositions back into an artifact — after both generations of a real loop on 2026-09-08, every finding in `generation-01.json` and `generation-02.json` still had `disposition: null`, including the three whose disposition file had been consumed by the generation-2 dispatch. A second, independent blocker: the checker also verifies the plan's sha256 against the artifact's seal, so any plan repaired in response to a finding fails the check for the generation that produced it — the very act the loop asks for invalidates its own receipt.
- **Consequence**: a plan loop can only ever close by the *other* documented route, depth-0 adjudication after generation 2. That is a legitimate ending, but the skill presents the receipt as the primary freeze predicate, so a session that follows the protocol literally spends its time chasing a check that cannot pass.
- **Trigger**: next plan-review loop, or next edit to either script.
- **Guardrails**: fix the docs or the tooling, not the caller — a caller that hand-writes dispositions into the artifact to make the receipt pass has forged the record the receipt exists to attest. If the intent is that Mode B applies only to code-loop receipts, say so in `plan-loop.md` and drop the receipt from the plan loop's freeze predicate.

## ~~`resolve-dispatch.sh` cannot express a namespaced model alias~~ (CLOSED 2026-09-11: `valid_token` widened to `^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)?$` — one optional slash-separated namespace, e.g. `kimi-code/k3` — `docs/plans/2026-09-11-kimi-implementer-rail.md`)

## `consult_dispatch` has no seat left once the qc panel excludes everything

- **Size**: S
- **Context**: On `cookys-openclaw`, `resolve-review-loop.sh` emits
  `consult_dispatch: auto` with `consult_resolved_from: native-fallback` and the
  warning *"no qualified consult seat on this host after qc_panel exclusion —
  falling back to sonnet/high@claude-native"*. `scripts/dispatch-consult.sh`
  then refuses outright: `consult_dispatch is off — refusing (no transport
  dispatched)`. Measured 2026-09-11 in `~/projects/fleet-comms`.
- **Why it matters**: the consult seat exists so depth-0 can ask a *different
  family* a design question. Falling back to `claude-native` resolves it to the
  same model that is asking — the one configuration that cannot answer the
  question the seat was created for — and the script is right to refuse rather
  than pretend. But the caller is then left with no supported route at all, and
  the natural workaround is to invoke a runner by hand, which is exactly the
  bypass the seat was meant to remove. On this host the qc panel is
  `gpt-5.6-sol` / `GLM-5.3` / `Qwen3.8-Max`, which excludes every hetero engine
  that has a working structured path; the only engine left over is `grok`,
  whose *review* parser is incompatible but whose **prose answers are fine** —
  and prose is all a consult needs.
- **Trigger**: next time a consult is dispatched on a host whose qc panel
  covers its whole roster, or the next edit to the consult resolution in
  `resolve-review-loop.sh`.
- **Guardrails**: do not solve it by letting a qc-panel seat double as the
  consult — the panel's independence is the thing being protected. The shape
  that fits is a **consult-only fallback list** of engines that are
  decorrelated but not panel members, with parse requirements relaxed to
  "returns text" rather than "returns a verdict". And the warning should name
  which engines were excluded and why, so the operator can see that the answer
  is "your panel ate your roster" rather than "nothing is installed".
- **Worked around on 2026-09-11 by** calling `grok --model grok-4.5 -p` directly
  with the question and the relevant files quoted into the prompt. It produced
  the argument that decided the design, so the seat's *value* is not in doubt —
  only its routing.
