# Plan — A sealed bounded campaign is its own authority under a live session marker

> Status: **R0 — DRAFT** (depth-0, 2026-09-12) · Deliverable node: `p5-bounded-campaign-marker-gate` ·
> Shared context: [`2026-09-12-integration-ledger-and-marker-gates.md`](2026-09-12-integration-ledger-and-marker-gates.md)

## 1. Problem

`check_session_mode_gate` (`scripts/dispatch-hetero.sh:891`, called at `:1917`) refuses any dispatch
while an `l5`/`l6` marker is live for the repo unless `CAMPAIGN_PROJECTION_BOUND` is 1. A bounded
campaign contract carrying no `mission_runtime` never passes `--strict-contract`, so
`run_campaign_projection_preflight` returns early (`:1191`) and the gate fires.

Reproduced here in both halves. **Bare dispatch**: invoked directly under this session's own live `l5`
marker — `precondition_failed`, `dispatcher_called:false`, exact string. **Bounded sealed campaign**:
`hooks/tests/dispatch-hetero.test.sh:966-979` builds a v1 contract, seals it with
`implementation-campaign-check.js seal --mission-mode off`, plants a live `l6` marker and asserts exit 2
plus the same string plus no runner spawned — and that file passes 232 assertions on `develop` today,
so the refusal is occurring now, on this host.

## 2. This is a supersession, not a bug fix

The refusal is **asserted as correct** by that same test, from `8d7e61c2` (2026-07-28,
`fix(dispatch): enforce sealed campaign unit projection`), under the name *"sealed v1 campaign cannot
bypass active L6 strict projection"*.

It contradicts `scripts/session-mode.js:291` `campaignCarriesMissionProjection`, which carved **the same
population** out of the admission side because the closed bounded-contract schema gives it nowhere to
put a projection, making the demand *"a deny that no fixture and no caller could ever satisfy"*. That
function's own comment states dispatch-hetero "already draws that line … and routes everything else to
the session-mode gate" — describing the routing correctly while not noticing the destination is a
permanent deny.

The discriminating fact: `node scripts/session-mode.js set --level l5 --repo-root <sbx>` returns
`ok: true` in a sandbox repo with **no Mission configuration at all**. The deadlocked state is reachable
through the shipped front door.

The reversal does **not** rest on whether a marker can be retired. It rests on the condition being
unsatisfiable by construction for this population — the identical permanent deny the admission side
already identified and corrected.

**Depth-0 ruling under CEO delegation, 2026-09-12, reversible until it ships**: the 2026-07-28 rule is
reversed for bounded sealed campaigns.

## 3. Scope

`scripts/dispatch-hetero.sh` and its codex mirror; `hooks/tests/dispatch-hetero.test.sh`.

## 4. Out of scope — and this boundary is load-bearing

`check_marker_campaign_admission_bridge` is a **second, independent** gate: a strict projected campaign
whose marker carries a different `mission_graph_digest` is refused there, by a different mechanism. This
deliverable does not clear it and must not claim to. A diff touching the bridge fails this plan.

Also out of scope: a `session-mode.js retire` verb; the `admission_release.status=released` vs durable
`live_lease` inconsistency; `check_mission_enforcement_gate`.

## 5. Phase

When `--campaign-contract`, `--campaign-contract-sha256` and `--campaign-seal` are all present **and**
the contract carries no `mission_runtime` / `campaign_projection`, skip `check_session_mode_gate`. Reuse
`campaignCarriesMissionProjection` from `scripts/session-mode.js` — do not re-implement the predicate
inline in shell, because two implementations of one predicate is how this defect arose.

Bare dispatch — no `--campaign-contract` — stays gated, unchanged string.

`hooks/tests/dispatch-hetero.test.sh:966-979` is **rewritten, not deleted**, under a name recording the
new rule. The commit message states that it reverses the rule asserted by `8d7e61c2`.

## 6. Acceptance

```
# red -> green: the case that is exit 2 today
<sandbox> dispatch-hetero.sh --campaign-contract <bounded v1> --campaign-contract-sha256 <sha> \
  --campaign-seal <seal> --agy-bin <capture stub>        # exit 0, capture stub file EXISTS
# still refused
<sandbox> dispatch-hetero.sh --branch x --prompt-file p  # exit 2, "requires a sealed campaign strict
                                                          #   projection", no capture file
# the other gate is untouched
<sandbox, strict projected campaign, marker with a DIFFERENT mission_graph_digest>
                                                         # exit 2, "marker-to-campaign admission bridge"
bash hooks/tests/dispatch-hetero.test.sh                 # 232+ assertions green
bash scripts/sync-codex-plugin-skills.sh --check
```

The third case is the one a careless fix breaks: skipping the gate too early also skips the bridge.

## 7. Acceptance IDs

- `p5-bounded-sealed-campaign-dispatches-under-live-marker`
- `p5-bare-dispatch-still-gated`
- `p5-strict-campaign-stale-marker-still-refused`
