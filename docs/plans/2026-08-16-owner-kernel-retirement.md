# Plan — Owner Kernel retirement & quarry extraction

> Status: R2 (final, post-G2 terminal adjudication) · Owner: cookys · Branch: develop (execute on a feature branch) · Frame: retirement + knowledge extraction

## 0. Context / thesis

Architecture review (Board thread 2026-08-16, two read-only wiring scans + one logic-substance review) concluded:

- The owner-kernel trust framework solves **record integrity** (tamper-evident history, emitter authentication) while the project's actual threat is **claim veracity** (an authorized agent submitting a false claim). Category-(d) independent re-derivation exists nowhere in the kernel — every acceptance check is format/hash/policy evaluation over submitted claims (`acceptance.js:420-506`); truth enters only via caller-injected `*Verifier` adapters that were never implemented.
- The machinery's own docs concede this: sol's recorded dissent ("a system that decides nothing"), `2026-08-10-owner-kernel-promotion.md:32` ("~31,000 lines of governance machinery decide nothing"), and the P0 STOP verdict (no host has verified trust roots) that was downgraded the same day.
- The valuable 10% (real verifier adapters: independent re-run + decorrelated-engine challenge) was scheduled last and never built — and it does not need the other 90%.

**G1 review outcome (2026-08-16)**: four-seat hetero panel, CONDITIONAL, 8 accepted blockers. Decisive: grok R2 proved the supervised family is a live production caller of the kernel, so "delete the kernel, leave supervised untouched" was physically impossible. **Board resolution: the supervised family joins the delete-set.**

**G2 terminal outcome (2026-08-16)**: CONDITIONAL, 13 blocker candidates → depth-0 final adjudication: 9 accepted (repaired in this R2 text), 1 duplicate, 3 rejected as rubric-freeze technicalities (the frozen rubric predates the Board's scope expansion; the deviation is Board-authorized in response to a reviewer finding, not author goalpost-moving — GLM's non-blocking framing of the same observation is the correct one). Key G2 corrections: `.claude/owner-kernel-governance.json` is a **live mission-policy input** (five keeper surfaces read it) and stays; the owner-kernel barrel survives as a **thin keeper-only index**; the test map covers **every** barrel-requiring test, not a name-glob. Dispositions: `*.g1-disposition.json`, `*.g2-disposition.json`.

## 1. Problem

~27,000 lines of shipped code (kernel core + trust scripts + observer + witness adapter + supervised family), plus ~45 test files, CI sandbox steps, doc/schema/template surfaces, and two root-owned locations outside the repo, implement a trust chain and an isolation substrate whose threat models (history tampering by self; adversarial multi-tenant hosts) do not exist in this single-user deployment. Shipped docs claim parts of it fire when nothing calls them (`skills/quality-pipeline/SKILL.md:46`, `docs/configuration.md:57-75`, `docs/architecture.md:114+`) — the documented-but-dead failure mode `references/evidence-discipline.md` catalogues. The policy insight inside it must survive the deletion.

## 2. OKR / KRs

**O: the trust machinery and its substrate are gone, their knowledge is kept, and every gate that watched them agrees.**

- KR1: ≥26,900 LOC of shipped code removed; `scripts/validate.sh` and the full `hooks/tests/` suite green on every phase commit; CI green without the bwrap/sandbox steps.
- KR2 (enumerated grep gate): zero live-tree hits for the pattern set below, run over the **whole tree** after P3 (with `docs/projects/2026-07-20-owner-kernel-governance/` already archived in P3 before the run) and again after P6, excluding only `CHANGELOG.md`, `docs/plans/`, `docs/projects/_archive/`, `references/evidence-discipline.md`, `references/evidence-contract.md`, and `.git`:
  - directory-qualified deleted modules: `owner-kernel/kernel`, `owner-kernel/state`, `owner-kernel/events`, `owner-kernel/ledger`, `owner-kernel/witness`, `owner-kernel/acceptance`, `owner-kernel/shadow-translation`, `owner-kernel/semantic-authority`, `owner-kernel/compatibility`, `owner-kernel/terminal`
  - script/module basenames: `owner-kernel.js` (the script), `check-owner-kernel-release-gates`, `divergence-monitor`, `check-retirement-receipts`, `shadow-terminal-observer`, `witness-adapter`, `supervised-` (under `src/engine/` or `hooks/tests/`)
  - non-module surfaces: `trust-root-provisioning`, `retirement-receipts`, `owner-event.schema.json`
  - stale-behavior prose: `strict_l5_provider_roster_drift` described as a hard block
  - NOT violations: barrel requires of `owner-kernel` (the barrel survives as the keeper index), keeper-path mentions (`owner-kernel/{canonical,errors,task-authority,policy,actions}`), and `.claude/owner-kernel-governance.json` / `governance-config` (live mission-policy surface, G2 grok R2).
- KR3: `check-claude-md-inventory.js`, `check-hook-inventory.js`, `check-readme-parity.js`, `check-contract-schema.js`, `validate-json-schema.js`, `preflight-portability.sh` all green.
- KR4: `/l5` strict roster policy is advisory at **every** enforcement site, demonstrated by: (a) canonical roster derives silently; (b) drifted roster derives with stderr warning + a `strict_l5_policy_override`-path audit record (emitted automatically, reason `advisory_default`); (c) **if** a runtime claim-expiry enforcement site exists, expired claims behave as (b) — if none exists, a committed evidence-dir record proving non-enforcement satisfies this case (G2 sol R4); (d) every gate outside the strict-roster-identity family retains its existing failure behavior.
- KR5: `/etc/autopilot/trusted-*.json` and `/usr/local/lib/autopilot/` removed from the host **after** a verified restorable archive exists (contents + ownership/mode metadata + tested content restore + documented `chown`/`chmod` restoration commands), with the removal receipt in this plan's evidence dir.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Node ≥ 20.10; no new dependencies.
- `src/engine/owner-kernel/{canonical,errors,task-authority,policy,actions}.js` KEEP their exact paths; `src/engine/owner-kernel/index.js` is **thinned to a keeper-only re-export** (canonical/errors/task-authority/policy/actions), never deleted — six keeper tests and keeper modules resolve the barrel (G2 grok R7).
- `.claude/owner-kernel-governance.json` and its consuming-project template are LIVE mission-policy surfaces (readers: `scripts/mission-routing-admission.js:195`, `scripts/implementation-campaign-check.js:183`, `src/mission/cli.js:140`, `platforms/codex/hooks/pre-effect.js:123`, `hooks/tests/lib.sh:54`) — do not delete; strip only the retired kernel-CLI examples from the template (G2 grok R2).
- No new trust machinery of any kind. The retirement receipt for every deletion is: this plan + the CHANGELOG entry (do NOT use `check-retirement-receipts.js`; it is itself being retired).
- A test file is deleted or rewritten only per the P1 test-to-target map, which covers **every** hooks/tests file that references the barrel, a deleted submodule, or a deleted script — not a name-glob. Mixed-coverage tests get an explicit rewrite/retain/retire decision in the map; an unmapped reference is stop-and-review.
- Each phase lands as ONE atomic commit; phase SHAs are appended to `retire-manifest.md` **after** each landing (in the next phase's commit, or the P6 chore commit for P6 itself — same-commit self-reference is impossible, G2 sol R6).
- Phase 1 must be committed before any Phase 2 deletion lands; P5 must not run before P1's restore test passes.

## 2.6 Change-policy decisions

- **Compatibility impact**: `authorized-breaking` — removes shipped scripts/CLI surfaces (`scripts/owner-kernel.js` CLI, `check-owner-kernel-release-gates.js`, `divergence-monitor.js`, `check-retirement-receipts.js`), the kernel + supervised engine modules, and the `owner-event` schema. Authorization: Board decisions of 2026-08-16 (retirement; scope expansion to supervised on G1 blocker 7a814e46). Affected consumers — the real set: the supervised family (in the delete-set), `src/engine/index.js` re-exports, `src/engine/autopilot-engine.js` (`AUTOPILOT_ENGINE_CONTROL_SINKS` constant — inlined in P2), the barrel-requiring tests (P1 map), three SKILL.md surfaces, and the doc/schema surfaces enumerated in P3 — all handled in this plan; no consumer outside this repo exists (promotion sequence unreleased; `CHANGELOG.md:644`). **Versioning: PATCH — Board-resolved 2026-08-16.** Policy basis, stated precisely (G2 sol R8): no skill or agent is added, removed, or renamed, and no skill `description:`/routing surface changes; the three SKILL.md edits are body-content removals of dead invocation blocks, which are PATCH-tier under the user-facing-milestone policy; the CHANGELOG entry leads with an explicit reversal marker. **Migration notes**: the CHANGELOG entry maps every removed public surface to its outcome (`removed, no replacement` or named successor, e.g. release checking → existing `preflight-release.sh`). **Contract validation**: KR3's `check-contract-schema.js` + `validate-json-schema.js` after schema removal. Rollback: per-phase `git revert` via recorded SHAs; host files restorable from the P1 verified archive (content restore tested; ownership/modes via the documented `chown`/`chmod` commands from recorded `stat` output).
- **Dependency decision**: `none` — pure removal.

## 3. File-structure map

| File / area | Action | Responsibility |
|---|---|---|
| `src/engine/owner-kernel/{kernel,state,events,ledger,witness,acceptance,shadow-translation,semantic-authority,compatibility,terminal}.js` | delete (10,614 LOC) | trust chain core |
| `src/engine/owner-kernel/index.js` | **thin** to keeper-only re-exports (~218 → ~20 LOC) | barrel survives for keeper consumers/tests |
| `src/engine/owner-kernel/{canonical,errors,task-authority,policy,actions}.js` | keep, untouched | shared primitives with live keepers |
| `src/engine/supervised-*.js` (14 files) | delete (~12,028 LOC) | isolation substrate for a nonexistent threat model |
| `src/engine/index.js` | edit | remove ownerKernel spread (~line 422; re-export only keepers) and every `supervised-*` require/re-export block (~lines 46-199) |
| `src/engine/autopilot-engine.js` | edit | inline `AUTOPILOT_ENGINE_CONTROL_SINKS` (sole supervised import); stop-and-review if non-trivial (fallback: retain a constants-only `engine-control-sinks.js` — NOT a `supervised-*` name, so KR2 stays satisfiable) |
| `scripts/{owner-kernel,check-owner-kernel-release-gates,divergence-monitor,check-retirement-receipts}.js` | delete (3,623 LOC) | dead CLI + dead gates |
| `src/status/shadow-terminal-observer.js` | delete (116 LOC) | homogeneous second opinion |
| `src/status/cli.js` | edit | remove observer + divergence call block (lines ~415-430) |
| `src/host-adapters/witness-adapter.js` | delete (570 LOC); remove dir if empty | notary adapter |
| `hooks/tests/` | delete/rewrite/retain **per P1 map**: candidates include `owner-kernel*`, `supervised-*`, `shadow-terminal-observer`, `divergence-monitor`, `check-retirement-receipts`, `host-witness-adapter`, `status-task-shadow-wiring` (retire in the same P2 commit as the cli.js unwire), and the six keeper tests that require the barrel (`execution-profile`, `profile-context-isolation`, `mission-policy-graph`, `level-governance-translation`, `owner-action-hardening`, `owner-action-reconciliation` — retain, verify keeper symbols only, rewrite kernel-symbol assertions) | tests |
| `.github/workflows/test.yml` | edit | remove bwrap/sandbox install + probe steps (~lines 29-72) |
| `skills/l3/SKILL.md` | edit | remove the `owner-kernel.js translate-level` invocation block; the governance file itself stays |
| `skills/quality-pipeline/SKILL.md` | edit (in **P2**) | remove the release-gates row |
| `skills/ceo-agent/SKILL.md` | no change | its governance-json preamble reads a surviving live config |
| `.claude/owner-kernel-governance.json` | keep (live mission policy) | G2 grok R2 |
| `project-config-template/governance-config.md` | edit | strip retired kernel-CLI examples (~lines 32, 139); keep the mission-policy documentation |
| `docs/runbooks/trust-root-provisioning.md`, `docs/retirement-receipts/` | delete | runbooks of retired machinery |
| `docs/configuration.md`, `docs/architecture.md`, `docs/installation.md` | edit | remove owner-kernel/supervised operator instructions; configuration.md keeps the governance-json row minus the retired CLI example |
| `schemas/owner-event.schema.json` | delete | kernel event schema |
| `docs/scripts-inventory.md`, `CLAUDE.md` | edit | remove 4 script rows / group-list names |
| `src/readiness/provider-bootstrap.js` (+ readiness tests) | edit | strict /l5 → advisory at every fail site (P4) |
| `platforms/codex/plugin/**` mirrors | sync | via `scripts/sync-all.sh`; parity gates confirm |
| `references/evidence-contract.md` | create | the quarry |
| `references/evidence-discipline.md` | append | the capstone case |
| `CHANGELOG.md`, `.claude-plugin/plugin.json` | edit | reversal-marked entry + PATCH via `sync-version.js` |
| `docs/projects/2026-07-20-owner-kernel-governance/` | archive **in P3, before the KR2 run** (G2 grok R5) | project closeout |
| `/etc/autopilot/trusted-*.json`, `/usr/local/lib/autopilot/` | user-executed sudo removal (P5, archive-gated) | host residue |

## 4. Phases

### P1 — Evidence freeze, quarry anchors, and pre-deletion maps (S)

1. `mkdir -p docs/plans/evidence/2026-08-16-owner-kernel-retirement/host-residue/`
2. **Verified restorable host archive**: copy the two `/etc/autopilot/*.json` files AND the full contents of `/usr/local/lib/autopilot/` into `host-residue/`; record `stat -c '%U:%G %a %n'` for every archived path plus the exact `chown`/`chmod` restoration command sequence into `manifest.txt` alongside sha256sums; **test the content restore** (extract to temp dir, diff hashes, record proof). Ownership/mode restoration is command-documented, not exercised (root-owned targets; G2 sol R6/GLM R6 scope note).
3. `retire-manifest.md`: every delete-set file (kernel core, supervised, scripts, observer, adapter) with per-file `wc -l`, the HEAD quarry anchor, and a **policy-value disposition column** (`quarried` / `none-found` / `recoverable-via-anchor`) — supervised files included; any `quarried` entry must land in `references/evidence-contract.md` (or its supervised-isolation appendix) at P6 (G2 sol R3). A `phase-commits` section collects SHAs as later phases land.
4. **Test-to-target map**: enumerate **every** `hooks/tests/*.test.sh` that references the owner-kernel barrel, any deleted submodule, or any deleted script (mechanical grep of all requires/invocations, not first-hit only); record per test: targets, keeper symbols used, and the decision (`delete` / `retain-as-is` / `rewrite` / `retire-with-wiring`). The six keeper tests and `status-task-shadow-wiring` get explicit entries (§3). Unmapped references are stop-and-review (G2 grok R7 / sol R7).
5. Commit (atomic).

**Acceptance**: evidence dir committed; restore-test proof present; manifest covers the full delete-set with dispositions; map covers every barrel/deleted-module/deleted-script reference with zero undecided entries.

### P2 — Core + supervised retirement (L)

1. **Repo-wide closure grep** (G2 sol R2): grep the **whole tree** for (a) requires of each deleted submodule path, (b) `supervised-` requires, (c) every symbol re-exported by the ownerKernel/supervised blocks of `src/engine/index.js`. Write the hit report to the evidence dir. Any hit outside the delete-set and the §3 edit list is stop-and-review.
2. Delete: 10 kernel-core files, 14 `supervised-*.js`, 4 scripts, `shadow-terminal-observer.js`, `witness-adapter.js`. **Thin** `src/engine/owner-kernel/index.js` to the five keeper re-exports.
3. Edit `src/engine/index.js`, `src/engine/autopilot-engine.js` (inline the constant), `src/status/cli.js` (drop observer/divergence block).
4. Edit `skills/quality-pipeline/SKILL.md:46` in this phase (validate.sh link check).
5. Apply the P1 map to tests (delete/rewrite/retain/retire as decided; `status-task-shadow-wiring` retired here); remove the CI bwrap/sandbox steps.
6. Run `scripts/validate.sh` + full `hooks/tests/` suite; smoke `node bin/autopilot.js` status/task surface.

**Acceptance**: KR1 green; closure report zero unexplained hits; suite green including all retained keeper tests.

### P3 — Unwire skills, config, docs, schemas, mirrors + archive (S)

1. `skills/l3/SKILL.md`: remove the `owner-kernel.js translate-level` block (governance file stays).
2. Delete `docs/runbooks/trust-root-provisioning.md`, `docs/retirement-receipts/`, `schemas/owner-event.schema.json`. Edit `project-config-template/governance-config.md` (strip kernel-CLI examples only).
3. Edit operator docs: `docs/configuration.md` (drop the `owner-kernel.js resolve` example; keep the governance-json row), `docs/architecture.md` (~114-138), `docs/installation.md` (~281).
4. **Retirement-vocabulary sweep**: from the delete-set derive the vocabulary (exported symbols, CLI commands, error identifiers incl. `strict_l5_provider_roster_drift`-as-hard-block prose) and grep every shipped surface; unwire every current-tense hit.
5. `docs/scripts-inventory.md`: remove the 4 rows. `CLAUDE.md`: remove the 4 script names from their groups.
6. **Archive `docs/projects/2026-07-20-owner-kernel-governance/`** via project-lifecycle (into `docs/projects/_archive/`, a KR2 exclusion) — before the KR2 run (G2 grok R5).
7. `scripts/sync-all.sh`; verify mirrors dropped the deleted files.
8. Run the **full KR2 whole-tree grep** + the KR3 gate set.

**Acceptance**: KR2 zero hits; KR3 green.

### P4 — Strict /l5 downgrade to advisory (S) — *order-independent; run first if the 2026-08-17 claim expiry lands before execution*

1. In `src/readiness/provider-bootstrap.js`, convert **every** strict-roster-identity fail site to warn-and-proceed with an automatic audit record (reason `advisory_default`) through the existing `strict_l5_policy_override` logging path: `strict_l5_provider_roster_drift` at ~389, 481, 494, 546, 616, 623; `strict_l5_provider_unknown_tuple` / `strict_l5_provider_claim_set_drift` at ~193, 398-415. Gates outside this identity family untouched.
2. Locate runtime expiry enforcement (grep `expires_at`/`freshness` across `src scripts`; `platform-capability-claims.js:302-304` validates shape only). If an enforcement site exists, downgrade it identically; if none, commit the non-enforcement proof to the evidence dir — KR4 case (c) is then satisfied by that record.
3. Keep `STRICT_L5_CLAIM_IDS` + claim files as documentation; they no longer gate.
4. Update readiness tests to the KR4 cases.

**Acceptance**: KR4 (four cases, case (c) per its conditional form).

### P5 — Host cleanup (user-executed, S) — *gated on P1's restore test*

```
sudo rm /etc/autopilot/trusted-installed-witness-authority.json \
        /etc/autopilot/trusted-witness-adapter-binding.json
sudo rmdir /etc/autopilot 2>/dev/null || true
sudo rm -rf /usr/local/lib/autopilot
```

Append the removal receipt (`ls` proof + date) to `host-residue/manifest.txt`.

**Acceptance**: KR5.

### P6 — Knowledge closeout (S)

1. `references/evidence-contract.md` (the quarry): acceptance-predicate policy content (green verification evidence per leg; `clear` challenge from a roster-listed, non-self, non-same-family challenger; zero blocking findings; contract frozen at intake; evidence bound to artifact), terminal-issuer invariants (freeze-before-execute, empty-set refusal, silence-is-not-consent, no third outcome), the P1 quarry anchor, and a supervised-isolation appendix for any P1-matrix `quarried` entries.
2. `references/evidence-discipline.md` addendum — the capstone case: *tamper-evidence of a claim is not verification of the claim; ~27k lines of armor around empty verifier slots. Include the G1/G2 lesson: the author's own zero-caller and separability claims fell twice to decorrelated reviewers (missed static factories/barrel requires; missed that a "kernel-named" config file was live mission policy).*
3. CHANGELOG entry (reversal marker + §2.6 migration notes) + `sync-version.js` PATCH bump → L-5.5 release gate.
4. `docs/BACKLOG.md`: two rows — (a) four-layer redesign (contract-only policy + harness graph) consuming `references/evidence-contract.md`; (b) skill contract-card rewrites under 成績單前置 (G2 MiniMax R8).
5. Append all phase SHAs (incl. P6's own, in a trailing chore commit) to `retire-manifest.md`.
6. Re-run the KR2 whole-tree grep + `preflight-release.sh`.

**Acceptance**: deliverables committed; KR2 + `preflight-release.sh` green.

## 5. Test / validation

- Script-gated: `validate.sh`, full `hooks/tests/` suite, CI without sandbox steps, KR2 whole-tree grep (P3, P6), KR3 gate set, KR4 cases, `preflight-release.sh`.
- Human-gated: P5 sudo removal (after P1 restore test); Board sign-off on this final R2 text (G2 was the terminal review generation).
- Explicitly NOT a gate: output/telemetry counts — the retirement rationale is architectural (Board verdict), not "zero records".

## 6. Risks + inversion

- **A hidden consumer outside the closure grep** → P2 step 1 is repo-wide over specifiers and symbols; suite + smoke after; stop-and-review on any unexplained hit.
- **`AUTOPILOT_ENGINE_CONTROL_SINKS` inlining non-trivial** → stop-and-review; fallback is a constants-only `engine-control-sinks.js` (name chosen to stay KR2-clean).
- **A keeper loses its only coverage** → the P1 map now covers every barrel/deleted-module reference with per-test decisions; the six keeper tests are explicitly retained/rewritten, never glob-deleted.
- **CI breaks after removing sandbox steps** → steps exist solely for supervised probes; their tests die in the same commit; CI green is P2 acceptance.
- **Mission enforcement silently flips off** → `.claude/owner-kernel-governance.json` is constitutionally out of the delete-set (§2.5); the closure grep treats any new reader as a keeper.
- **/l5 claim expiry before execution** → P4 order-independent; run first.
- **What would guarantee failure**: deleting by directory glob (takes the keepers); deleting the governance json (flips mission enforcement to off); skipping the P1 restore test then running P5; running on `develop` directly; glob-deleting tests instead of following the map.

## 7. Out of scope

- Implementing the four-layer redesign, any new Kernel/graph code, or the verifier adapters — the research-to-ship follow-up.
- Rewriting any skill toward contract-card shape (BACKLOG row, 成績單前置 applies).
- Relocating the five keeper modules; renaming `.claude/owner-kernel-governance.json` (a rename is cosmetic churn across five readers — leave to the four-layer work if desired).
- The three A-family survivors (`run-ledger.sh`, `pin-evidence-anchors.js`, `lifecycle-residue-receipt.js`) — untouched.

## 8. Open questions

None. (G1 resolved scope and versioning; G2 adjudication resolved the governance-file, barrel, test-map, restore-scope, SHA-recording, expiry-branch, and versioning-wording items. Host-residue archives stay in the evidence dir permanently.)

## Review log

- **R0** — authored 2026-08-16 by the depth-0 session (Opus 5) from three scan/review reports. Board verdict authorizing retirement: this thread, 2026-08-16.
- Manifest: `2026-08-16-owner-kernel-retirement.plan-review-manifest.json`; frozen rubric: `2026-08-16-owner-kernel-retirement.rubric.md` (R1–R8, sha256 `bc2abba0…`). Panel: GLM-5.3 (architecture-contract, required), MiniMax-M3 (operations-skeptic, required), grok-4.6@xhigh (execution-redteam, best-effort), gpt-5.6-sol@max (adversarial-dissent, best-effort); `excluded_families: anthropic` on every seat.
- Panel re-formation note (2026-08-16): first G1 dispatch (GLM-5.2, 3 seats) aborted mid-seat before any seat returned; sealed state removed; panel re-formed per Board roster update. No review content consumed.
- **G1** (2026-08-16, transport complete): verdict CONDITIONAL (GLM C, MiniMax C, grok STOP, sol STOP); 20 findings, 8 blocker candidates — all 8 accepted at depth 0 after code-level verification. Board resolutions: full removal incl. supervised; PATCH. Dispositions: `*.g1-disposition.json` (8 accepted_blocker, 10 accepted_nonblocking, 2 duplicate). R1 text was the authorized bounded repair.
- **G2** (2026-08-16, terminal, transport complete): verdict CONDITIONAL (GLM C, MiniMax STOP, grok STOP, sol STOP); 20 findings, 13 blocker candidates. Depth-0 terminal adjudication: **accepted 9** (grok R2 governance-file liveness — verified: 5 keeper readers; grok R7/sol R7 test-map closure — verified: 6 keeper tests require the barrel; grok R5 KR2 ordering; sol R6 restore scope + SHA self-reference; sol R2 repo-wide grep; sol R4 expiry branch; sol R8 versioning wording; sol R3 supervised quarry obligation), **1 duplicate** (sol R7 → grok R7), **3 rejected** (MiniMax R2, sol R2a, sol R8a — frozen-rubric technicality: the deviation is the Board's authorized response to G1's own R2 finding; anti-goalpost purpose not implicated; GLM's non-blocking framing adopted). Dispositions: `*.g2-disposition.json`. This R2 text incorporates all accepted repairs and is final pending Board sign-off; per the bounded-review rule no further review generations run — remaining reviewer suggestions live in the G2 artifact as backlog candidates.
