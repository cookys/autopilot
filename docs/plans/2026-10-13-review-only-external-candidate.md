# Plan — review-only entry: a host-admitted final panel over an externally produced candidate range

> Status: **draft, size L** · Owner: depth-0 · Source: BACKLOG BL-0090 (peer-reported, cuda/chatgpt-tunnel, fleet 2026-10-03; owner approved 2026-10-13) · Pointer: `docs/backlog/review-only-adoption-of-external-candidate.md` · Version: stays on the 3.0.0 line (no bump) · Code read at `459dd869`.

## 1. Why

An external project wants autopilot's managed final review over a commit range it wrote itself. Today the only road to the final panel is managed `implement-review`, which always dispatches an implementer first, and intake can only resume a candidate that the same campaign wrote. The peer must either let our writer redo their change or fall back to a review rail with no host admission. The request is narrow: one host-admitted review of one external range, with no writer, no verification-author seat and no model repair.

## 2. Diagnosis

Entry surface
- D1. `engine` exposes only `review-loop` and `implement-review` (`bin/autopilot.js:30-31`, dispatch `:370-494`); `--campaign-contract` is mandatory (`:292`).
- D2. The only "review an existing tip" rail is `--legacy-unmanaged --resume` (`src/engine/autopilot-engine.js:10180`, synthesized round-1 `runner: 'resume'` at `:10796-10830`). It is deprecated, refused at l5/l6 (`:4836-4867`), never reaches `performFinalPanel` (`:6149`, wired only into the managed composition at `:8972`), and its repair rounds dispatch the implementer. Not a base to extend.
- D3. Managed `--resume` means "re-enter this campaign's durable wait"; anything else is refused `campaign_resume_phase_unsupported` (`autopilot-engine.js:10612-10650`).

What already works (this shrinks the plan)
- D4. Given a `resume` checkpoint the composition traces `resume_adopt_candidate` and never calls `mutate('initial')` (`src/engine/campaign-composition.js:1977-1983`); it then runs full-diff barrier → verify → review → adjudicate → final panel.
- D5. "No repair" is already a contract knob: `max_repair_generations` is legal at 0 (`schemas/implementation-campaign-contract.schema.json`); at the ceiling the composition stops at `vertical_verification` (`campaign-composition.js:2465`) or `repair_budget` (`:2910`) instead of repairing.
- D6. The final panel reviews the cumulative `base..candidate` diff (`full_diff_generation`); with a panel review station the in-loop panel is reused as the terminal panel without a second model call (`campaign-composition.js:3021`).
- D7. Verification is already re-derivation: a fresh detached worktree at `candidate.commit` runs the sealed `verify_cmd` (`autopilot-engine.js:8445-8510`).
- D8. The final-panel quorum handles an unknown author: `implementer_family === 'unknown'` relaxes exclusion to "at least the required number of families" (`campaign-composition.js:603`).
- D9. Read-only range probes exist: `defaultResumeInspect` / `resumeInspectBlocked` (`autopilot-engine.js:2511`, `:2551`) check tip exists, base is an ancestor, tip ≠ base, and move no ref.
- D10. Findings without authority already park: the in-loop path parks `AWAITING_DISPOSITION` and resumes disposition-only (`campaign-composition.js:1944-1976`); the active `docs/plans/2026-10-13-final-panel-park.md` extends the park to final-panel findings, which today terminalize.

What blocks a foreign candidate (exact-key discipline, not policy)
- D11. `normalizeCampaignArtifactReference` accepts a `git_candidate` only with `writer_fence` + `repair_lineage`, and the fence must be an `implementation_campaign_writer_fence` with `dispatch_exit|terminal_ledger` evidence (`src/engine/implementation-campaign.js:451-557`).
- D12. `appendCampaignEvent` rejects a fence from another campaign (`src/engine/campaign-intake.js:774-781`); `verifyResumeCandidate` requires `writer_fence.campaign_id === campaign_id`, a retained repair-lineage worktree and this campaign as lineage owner (`campaign-intake.js:986-1031`).
- D13. Engine resume setup rebuilds the scope session from `resumeCandidate.scope_implementation_sha` and re-checks `repair_lineage` (`autopilot-engine.js:5109-5120`); on a first pass the scope session is created inside the implement adapter (`:8259`).
- D14. Intake gates that presume an implementer: the context-window gate rejects `implementer_identity_missing` and measures against the implementer model (`campaign-intake.js:512-519`, `:2754-2772`); the l5/l6 roster profile requires the verification-author seat (`src/readiness/provider-bootstrap.js:298-302`). The cleanroom probe already targets QC seats only (`campaign-intake.js:2003-2060`).

Why `hetero-review-loop` is not the answer
- D15. `scripts/hetero-review-loop.js collect --phase-base <sha> --branch <b>` already reviews any `base..head` range (`:448`, `:459`). It is this repo's depth-0 code loop and lacks each property the peer asked for: no host admission or readiness bundle (seats come from the caller or resolver, `:330`); no sealed QC roster snapshot; no `verify_cmd` run on the candidate tree; no contract-sealed panel minimum or required families; no author-family exclusion; no scope gate on paths or churn; no campaign ledger or terminal receipt readable by `autopilot campaign inspect`; dispositions are hand-written. It stays unchanged.

## 3. Goal and success criteria

Goal: `autopilot engine review-candidate` admits one externally produced range, re-derives it from Git, runs the sealed verification and the managed review and final panel over exactly that range, and ends in a terminal campaign receipt, with no writer, verification-author or repair model call at any point.

Each criterion names its threshold, check and negative control (ids from `references/acceptance-patterns.md`).

- RO1 — No writer. Implementer, verification-author and repair dispatch counts are exactly 0 on the ready, findings and verify-red paths. Check: stub-dispatcher call log. Control (A5): the same fixture through `implement-review` records ≥ 1 implementer call, so the counter is shown to see calls.
- RO2 — The range is re-derived, never supplied. Bytes each seat receives equal an independent `git diff base..head` at the sealed head; no flag or contract field carries a diff, file list or test result from the caller. Check: A1 parity. Control: a one-byte perturbed copy fails parity.
- RO3 — The range is fixed at admission. A branch move after admission, or between interruption and resume, ends in a named refusal with 0 further review calls. Check: A5 at both moments.
- RO4 — Malformed ranges are refused before spend, each with a named code and 0 model calls: head missing; base not an ancestor; head equals base; tip ≠ sealed head; a path outside the allowed prefixes; file cap exceeded. A churn-limit breach is a named warning in the receipt, never a refusal (the reporter splits diffs itself). Check: one A5 case per code plus one happy case.
- RO5 — Verification runs on the adopted tree, not the operator checkout. Check (A2): an untracked file in the operator worktree that would make `verify_cmd` pass does not; the run is not-ready.
- RO6 — Modes cannot cross. An adoption contract under `implement-review`, an implementation contract under `review-candidate`, and an adoption contract carrying mission or strict-dispatch fields are each refused before spend. Check: A5.
- RO7 — A declaration cannot weaken the panel. Undeclared author → unknown family. A declared author family may only add an exclusion; if that leaves fewer than the required families the panel fails. Check: A2 on the declared-family case.
- RO8 — Honest terminal outcome. Zero findings, green verify, met quorum → ready, exit 0. Red verify, unmet quorum, or must-fix findings → terminal not-ready naming the reason and the findings, exit non-zero. No campaign waits on a state whose only exit is a repair. Check: A5 per outcome; `autopilot campaign inspect` reads each receipt.
- RO9 — No regression: `hooks/tests/autopilot-engine*.test.sh`, `hooks/tests/campaign-*.test.sh`, `hooks/tests/final-panel-park.test.sh`, `hooks/tests/autopilot-cli.test.sh` stay green; any red is classified with A7 before merge.
- RO10 — Live (A6). One real-engine run over a trivial range in a throwaway repo reaches ready with ≥ 1 reviewed seat and 0 implementer calls; one live run over a planted-defect range ends not-ready. Engine and version recorded.
- RO11 (P2) — An interrupted or parked review resumes without re-spending reviewed seats and without trusting the stored range: head, tree and ancestry are re-derived first. Check: A5 interrupt-then-resume case plus RO3's resume moment.
- RO12 (P3) — At l5/l6 review-only admission neither requires nor probes the implementer or verification-author seat, while `implement-review` at l5 still requires both. Check: probe-log count; A2 on the l5 implement path.

## 4. Scope boundary

In: one `engine` subcommand; an adoption section in the campaign contract; an adoption admission step; a candidate record kind for adopted ranges; adoption resume; a review-only readiness profile; a usage doc for external operators.

Out, each with the trigger to revisit:
- Mission-routed review-only campaigns (`mission_runtime`): refused in v1. Trigger: a Mission graph needs a review-only node.
- Re-review of an amended range inside one campaign: each new head is a new campaign. Trigger: a requester shows the per-campaign cost blocks them.
- `hetero-review-loop` and `skills/hetero-review` routing: unchanged; routing text is guidance and needs eval evidence first. Trigger: a recorded dogfood run where a session picks the wrong loop.
- `--legacy-unmanaged --resume` (D2): no shim, no extension.
- Trust machinery (ADR-0001): no fence, signature or digest chain over the external author's claims. Git object ids are re-read from Git at each use; nothing the author states is recorded as true.

## 5. Design

### 5.1 Entry

`node bin/autopilot.js engine review-candidate --campaign-contract <file> [--campaign-seal <file>] --spec-file <file> [--campaign-disposition-authority <file> | --campaign-disposition-policy <p>] [--cwd <repo>] [--resume]`

- Base, branch, head and verify command come only from the sealed contract; there are no flags that could disagree with it.
- `--spec-file` states what the range claims to do; it is the reviewers' spec and the context-gate input.
- Same managed rail as `implement-review` (intake → composition → final panel): a mode, not a fork.
- P1 parses `--resume` and refuses it with a named reason; P2 makes it work.

### 5.2 Contract

A new optional contract section declares adoption: the external head commit and, optionally, the author's model family. When present, `max_repair_generations` must be 0 and `strict_dispatch`, `unit_class`, `mission_runtime` must be absent. The campaign id derives from the contract digest, so a review-only campaign is a review of exactly this range. Three places change together: the schema (property plus `x-optional-properties`), `scripts/implementation-campaign-check.js`, and the intake contract check.

### 5.3 Admission (re-derivation, ADR-0001)

Before any spend, intake re-derives the range with read-only probes (D9): the branch tip resolves to the sealed head, base is an ancestor, head ≠ base; the scope session is built from `base..head` against the contract's prefixes, file cap and churn limits (the same session D13 builds on resume). Any mismatch is a named rejection with a no-effect release.

### 5.4 Candidate record and run

- Adopted ranges get their own candidate record kind beside `git_candidate`: commit, tree, branch, base, and the fact that this campaign did not write it. No writer fence, no repair lineage, and no field that claims a campaign writer. `git_candidate` validation is not loosened.
- The engine hands the composition an adopted checkpoint so it takes the D4 branch; the scope session uses the external head as its implementation sha.
- The composition still requires an `implement` adapter (`campaign-composition.js:713`). In review-only mode it is a refusing adapter: not committed, no dispatcher call, no model call, named phase. Reaching it is a bug and fails closed; RO1's control plants exactly that.
- Author family defaults to unknown (D8); a declaration may only add an exclusion (RO7).
- Red verify with 0 repairs stops before review (D5) and is reported not-ready: a failing range spends no reviewer.

### 5.5 Outcomes and failure modes

| Situation | Outcome |
|---|---|
| Zero findings, green verify, quorum met | terminal ready, exit 0 |
| In-loop findings (with a panel station this is the panel) | per Q1: park for disposition, or terminal not-ready |
| Final-panel findings | as `final-panel-park` defines once shipped; terminal not-ready before that |
| Disposition supplied, must-fix remains | terminal not-ready at the 0-repair ceiling, findings listed |
| Red verify | terminal not-ready, no review spend |
| Quorum or family minimum unmet | terminal not-ready, named |
| Malformed range or scope breach | admission rejection, no spend |
| Branch moved after admission or before resume | named refusal, no further review call |
| Wall budget exhausted | existing wall-expiry terminalization |
| Interrupted mid-review | P2 resume re-derives the range, reuses stored seat verdicts |
| Implement adapter reached | fail closed |

### 5.6 Relationship to existing rails

- Managed `implement-review`: unchanged; shares intake, composition and final panel.
- `final-panel-park` (active): same final path; P1 rebases on it if it lands first, and RO8 tests pin whichever behavior Q1 picks.
- `hetero-review-loop`: unchanged (D15).

## 6. Phases

### P1 — Vertical slice at l4 (critical path)
- Goal: an l4 review-only campaign runs end to end with no writer and ends in an honest receipt.
- Scope: `bin/autopilot.js` (subcommand, help, parser); `schemas/implementation-campaign-contract.schema.json`; `scripts/implementation-campaign-check.js`; `src/engine/campaign-intake.js` (adoption admission, contract check); `src/engine/implementation-campaign.js` (adopted kind in normalizer and reducer); `src/engine/autopilot-engine.js` (adopted checkpoint, refusing adapter, scope session, family default, outcome mapping); new `hooks/tests/review-candidate.test.sh`.
- Input: D1-D14. The existing l4 strict bootstrap runs unchanged (the implementer seat is probed, never dispatched).
- Output: subcommand; contract section; named admission refusals; receipts readable by `campaign inspect`; suite; CHANGELOG entry on the 3.0.0 line.
- Acceptance: RO1-RO10, each control shown failing once; RO10 only in a throwaway repo, evidence under `docs/plans/evidence/`.
- Boundaries: no change to `git_candidate` validation, the same-campaign path of `verifyResumeCandidate`, `hetero-review-loop.js`, any `skills/` file, `provider-bootstrap.js`, or the legacy rail.

### P2 — Resume from Git (depends on P1)
- Goal: `review-candidate --resume` continues an interrupted or parked review-only campaign.
- Scope: `src/engine/campaign-intake.js` (adoption branch beside `verifyResumeCandidate`); `src/engine/autopilot-engine.js` resume setup (`:5109-5120`); `src/engine/final-panel-seat-store.js` only if U4 says so; `hooks/tests/review-candidate-resume.test.sh`.
- Input: P1 candidate kind; Q1 ruling.
- Output: resume with drift refusal and seat-verdict reuse.
- Acceptance: RO11, RO3 (resume moment), RO9.
- Boundaries: same-campaign `git_candidate` resume unchanged; existing resume suites untouched.

### P3 — Review-only readiness profile (depends on P1)
- Goal: review-only admission asks only for the seats it uses.
- Scope: `src/readiness/provider-bootstrap.js` (review-only profile); `bin/autopilot.js` (pass the mode); the context gate in `src/engine/campaign-intake.js` (measure against reviewer seats); tests.
- Input: P1; Q2 ruling.
- Output: profile; re-pointed context gate.
- Acceptance: RO12; RO9 on the l4/l5 implement-review suites.
- Boundaries: `implement-review` profiles unchanged at every level.

### P4 — External operator handoff (depends on P1, plus P2/P3 when shipped)
- Goal: an external operator runs a review-only campaign from our docs alone.
- Scope: a usage doc under `docs/` (contract section, seal, endpoints, reading the receipt); BL-0090 row and pointer; fleet reply to cuda.
- Input: U1 findings; a P1 live-run log.
- Output: doc; BL-0090 closed or narrowed.
- Acceptance: a fresh session that has not seen this plan follows the doc in a scratch repo to a ready receipt (recorded).
- Boundaries: no `skills/` edits.

Order: P1 → {P2 ∥ P3} → P4. If Q1 picks the park, findings ranges are only usable after P2, so the critical path becomes P1 → P2 → P4. Each phase ships on its own branch (`lane/review-candidate-p<N>`) with one merge commit, which is its rollback point.

## 7. Test strategy

- New suites reuse the stub-dispatcher seams of `hooks/tests/autopilot-engine*.test.sh` inside temp repos; no fixture writes into a real common-dir ledger.
- Deliberately broken controls, each run once and recorded: implement adapter forced reachable (RO1); perturbed packet copy (RO2); moved branch (RO3); each malformed range (RO4); planted untracked "make tests pass" file (RO5); crossed modes (RO6); declared family equal to every seat's family (RO7); planted-defect live range (RO10).
- Gate mutation: removing the admission re-derivation must turn RO3/RO4 red; if either stays green the suite is vacuous and the phase does not ship.
- Long suites run one at a time.

## 8. Risks

| Risk | L | I | Mitigation |
|---|---|---|---|
| The reducer requires implementation events before verification (U2) | M | H | First P1 task reads `reduceCampaignState`; if adoption needs an event it is a new named event, never a replayed implementation event |
| Adopted record reaches writer-only paths (repair, lineage cleanup, reaping) | M | H | Refusing adapter + RO1 control; P1 lists a verdict for every `git_candidate` consumer in its PR |
| A review-only receipt is read as this repo's merge gate | L | M | It is a campaign receipt, not a `QC-Verdict` source; the usage doc says so |
| Peer needs differ from the D15 list | M | M | Ask cuda before P1 (U7); drop properties they do not need |
| `final-panel-park` lands mid-P1 and changes the findings path | M | M | Q1 first; rebase P1 on it; RO8 pins the chosen behavior |
| P1 probes an unused implementer seat at l4 (spend, possible false block) | H | L | Accepted for P1 with this rationale; P3 removes it |
| Live run leaves ledger rows or worktrees in a real repo | M | M | RO10 only in a throwaway repo; checked with `scripts/repo-residue-sweep.js` |

## 9. Rollback

- P1: revert the `lane/review-candidate-p1` merge commit. No migration: no existing contract carries the section; test ledgers live in temp dirs. Delete the throwaway live repo.
- P2: revert its merge; review-only still works, and an interrupted run is re-run as a new campaign.
- P3: revert its merge; review-only falls back to the level's implement profile (P1 behavior).
- P4: docs-only revert; reopen BL-0090's row.

## 10. Open questions for the owner

- Q1 — What happens to findings when no repair can follow. (A) Terminal not-ready, findings listed as unadjudicated; the external depth-0 adjudicates on its side. This needs new code to suppress the existing in-loop park (D10) in review-only mode; whether `--campaign-disposition-policy deny-nonempty` already yields that outcome is unverified (U8). (B) Keep the existing park: the campaign waits for the external depth-0's disposition authority, then `--resume` ends it ready (all findings rejected) or not-ready (must-fix at the 0-repair ceiling). B matches current behavior and ADR-0001 (a reviewer verdict stays a claim until depth-0 adjudicates), but puts P2 on the critical path. Recommendation: B.
- Q2 — Panel strength at l4. (A) Follow l4 `implement-review` (QC panel optional; a single reviewer may stand as the panel). (B) Require a complete QC panel at every level, since a final panel is what was asked for. Recommendation: B.

## 11. Unverified

| # | Not yet checked | Checked in |
|---|---|---|
| U1 | How an external repo produces contract, seal and endpoints/roster (seal tooling not read) | P4 |
| U2 | `reduceCampaignState` accepts a run with no implementation events before verification | P1, first task |
| U3 | Whether managed `implement-review` dispatches the verification-author seat or only requires its readiness | P3 |
| U4 | Whether `final-panel-seat-store.js` keys seat reuse on writer-fence or lineage fields | P2 |
| U5 | Whether `campaign inspect` and `status task` read fields that assume an implementation chain | P1 |
| U6 | Whether `stageVerifyOnConverge` should write a stage unit for a review-only run (fail-open today) | P1 |
| U7 | Answered 2026-10-13, see §12 | — |
| U8 | What `deny-nonempty` does in the composition when findings are non-empty (the policy throws, `src/engine/campaign-disposition-authority.js:182-187`) | before Q1 is ruled |

## 12. Reporter answers (cuda chatgpt-tunnel, fleet 2026-10-13)

Their case: candidates are written outside autopilot by grok, agy or codex; the in-engine reviewer often returns no verdict on large diffs, so their depth-0 runs three `dispatch-review.sh` seats by hand as the final review. They want that inside a managed flow with a receipt.

| D15 property | Needed | Their reason and what it changes here |
|---|---|---|
| Host admission | yes | Seats that cannot start were found only after spend (cc-shim without `--endpoint`, codex launched outside the repo, a seat timing out at ~35 KB of diff). Admission must refuse before spend. |
| Sealed QC roster | yes | They swapped a seat mid-stream; the record must show who reviewed. |
| Host re-runs `verify_cmd` in a clean worktree | yes, most important | An implementer's green is a claim (they saw green on one Node major, red on another). The receipt also records the verify runtime and its version. Adds to RO5/RO8. |
| Sealed panel minimum and required families | yes | A unanimous pass once missed a real defect. |
| Author-family exclusion | yes | Declared by them (e.g. xai, google, openai); add-only, as RO7 states. |
| Path and churn scope | paths yes; churn warn-only | An external writer edited runner and manifest files it should not have. Churn is warn-only (RO4 updated). |
| Terminal receipt | yes | Per ADR-0001 depth-0 must reach each seat's JSON artifact path, the exact `base..head` and the verify result from the receipt, to re-derive each finding. Adds to RO8. |

On findings (Q1) they ask for B: park for depth-0 disposition, matching `final-panel-park`, because findings often hold false positives and a terminal end means a new campaign and a second review spend. They also ask that the disposition can deliberately end the campaign not-ready with the findings listed. Q1 and Q2 remain the owner's rulings.
