# Plan — review-only entry: a host-admitted final panel over an externally produced candidate range

> Status: **ruled, size L — Q1′ ruled 2026-10-14 (caller chooses at disposition, §10); P1 (merge 8a650a95), P3 (merge 0d6fcc2a) and P2 (merge of lane/review-candidate-p2b) shipped 2026-10-14; P4 and P5 open** · Owner: depth-0 · Source: BACKLOG BL-0090 (peer-reported, cuda/chatgpt-tunnel, fleet 2026-10-03; owner approved 2026-10-13) · Pointer: `docs/backlog/review-only-adoption-of-external-candidate.md` · Version: stays on the 3.0.0 line (no bump) · Code read at `459dd869`.

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
- RO7 — A declaration cannot weaken the panel. Undeclared author → unknown family. A declared author family may only add an exclusion; the declared family's seats then do not count toward the family requirement, and if the remaining seats span fewer than the required families the panel fails (ruled 2026-10-14 after the P1 review: anthropic+anthropic+openai declared openai fails; anthropic+openai+google declared openai passes). Check: A2 on the declared-family case.
- RO8 — Honest terminal outcome. Zero findings, green verify, met quorum → ready, exit 0. Red verify, unmet quorum, or must-fix findings that the disposition does not clear (`end`, `repair`) → terminal not-ready naming the reason and the findings, exit non-zero. Findings park for disposition (RO13). No campaign waits on a state whose only exit is an autopilot repair. Check: A5 per outcome; `autopilot campaign inspect` reads each receipt.
- RO9 — No regression: `hooks/tests/autopilot-engine*.test.sh`, `hooks/tests/campaign-*.test.sh`, `hooks/tests/final-panel-park.test.sh`, `hooks/tests/autopilot-cli.test.sh` stay green; any red is classified with A7 before merge.
- RO10 — Live (A6). One real-engine run over a trivial range in a throwaway repo reaches ready with ≥ 1 reviewed seat and 0 implementer calls; one live run over a planted-defect range ends not-ready. Engine and version recorded.
- RO11 (P2) — An interrupted or parked review resumes without re-spending reviewed seats and without trusting the stored range: head, tree and ancestry are re-derived first. Check: A5 interrupt-then-resume case plus RO3's resume moment.
- RO13 (P2) — Caller-chosen continuation (Q1′ ruling). A parked review offers exactly three dispositions: `return`, `end` and `repair`. `return` re-reviews a head that moved forward from the reviewed head inside the same campaign. Seats re-review the cumulative `base..new_head` as a full-diff generation (the `focused_delta_round` that implement-review repairs use is not wired for `return`; P2 review 2026-10-14); a seat outcome is reused only when its input binding is identical (Q3 ruled (c)). `end` terminalizes not-ready with the findings listed. `repair` is P5. A head that is not a descendant of the reviewed head is a named refusal. A contract preset applies its choice with no wait. Check: A5 per choice, plus the preset path. Control: a non-descendant head and an unknown choice value are each refused before spend.
- RO12 (P3) — At l5/l6 review-only admission neither requires nor probes the implementer or verification-author seat, while `implement-review` at l5 still requires both. Check: probe-log count; A2 on the l5 implement path.

## 4. Scope boundary

In: one `engine` subcommand; an adoption section in the campaign contract; an adoption admission step; a candidate record kind for adopted ranges; adoption resume; a review-only readiness profile; a caller-chosen continuation after a park (`return`, `end`, and `repair` as a handoff); a usage doc for external operators.

Out, each with the trigger to revisit:
- Mission-routed review-only campaigns (`mission_runtime`): refused in v1. Trigger: a Mission graph needs a review-only node.
- ~~Re-review of an amended range inside one campaign~~: **moved In on 2026-10-14.** The trigger fired: the reporter said a second campaign's spend blocks them (§12), and the owner ruled Q1′. It is the `return` choice (RO13, P2).
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
| In-loop findings (with a panel station this is the panel) | park for disposition (Q1 B), unless the contract preset names a choice |
| Parked, caller disposes `return` | wait for a new head; the head must descend from the reviewed head; re-derive it, then re-review the delta in the same campaign and reuse seat verdicts (RO13) |
| Parked, caller disposes `end` | terminal not-ready, findings listed (RO13) |
| Parked, caller disposes `repair` | P5 handoff: terminal not-ready here, plus an `implement-review` contract seeded from the reviewed head (RO13) |
| New head after `return` that does not descend from the reviewed head | named refusal, no review call |
| Final-panel findings | park for disposition, as shipped by `final-panel-park` (merge 2561e59f); same three choices |
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
- `final-panel-park`: shipped (merge 2561e59f), so P1 builds on it; RO8 and RO13 pin the park.
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
- Input: P1 candidate kind; the Q1′ ruling (§10).
- Output: resume with drift refusal and seat-verdict reuse. The `return` and `end` dispositions. An optional contract preset (adoption section) that applies a choice without waiting. The adoption-contract preset field shares its schema, checker and intake updates with P1's section.
- Acceptance: RO11, RO13 (`return`, `end`, preset), RO3 (resume moment), RO9.
- Also (from the P1 review, 2026-10-14): (a) the run-time quorum (`src/engine/campaign-composition.js:598-604`) still counts "at least one non-author family" while intake applies the RO7 subtract-then-count reading; align run time to RO7 so a mid-run seat loss cannot pass a quorum intake would refuse. (b) A seat lost at run time that leaves the panel short must reach terminal not-ready; P1 only tests the pre-campaign roster refusal, which carries no `code`. (c) RO10's planted-defect run parks at `awaiting_disposition`; record its `end` to terminal not-ready under the same evidence directory once `end` ships.
- Boundaries: same-campaign `git_candidate` resume unchanged; existing resume suites untouched.

### P3 — Review-only readiness profile (depends on P1)
- Goal: review-only admission asks only for the seats it uses.
- Scope: `src/readiness/provider-bootstrap.js` (review-only profile); `bin/autopilot.js` (pass the mode); the context gate in `src/engine/campaign-intake.js` (measure against reviewer seats); tests.
- Input: P1; Q2 ruling.
- Output: profile; re-pointed context gate.
- Acceptance: RO12; RO9 on the l4/l5 implement-review suites.
- Also (from the P1 review, 2026-10-14): under owner-kernel governance `enforce`, an adoption contract cannot be sealed. `scripts/implementation-campaign-check.js` requires `mission_grant_ref`, a v2 seal requires `mission_runtime`, and an adoption contract forbids `mission_runtime`. Give this a named refusal at seal time instead of the generic missing-field error; P4's doc states that review-only needs governance `off` or `shadow` (the modes are `off`, `shadow`, `enforce`). Repos without a governance file default to `off` and are unaffected. Control: an enforce-mode adoption seal yields the named code.
- Boundaries: `implement-review` profiles unchanged at every level.

### P4 — External operator handoff (depends on P1, plus P2/P3 when shipped)
- Goal: an external operator runs a review-only campaign from our docs alone.
- Scope: a usage doc under `docs/` (contract section, seal, endpoints, reading the receipt); BL-0090 row and pointer; fleet reply to cuda.
- Input: U1 findings; a P1 live-run log.
- Output: doc; BL-0090 closed or narrowed.
- Acceptance: a fresh session that has not seen this plan follows the doc in a scratch repo to a ready receipt (recorded).
- Boundaries: no `skills/` edits.

### P5 — `repair` handoff (depends on P2)
- Goal: a caller who disposes `repair` gets autopilot's writer without a writer on the adopted range.
- Design: `repair` terminalizes the review-only campaign not-ready, which is honest because the range did not pass. It then emits a seeded `implement-review` contract. In that contract, base is the reviewed head, the task is the accepted findings, and paths and verify come from the adoption contract. The caller seals and runs it as a normal campaign. Our writer writes on top of the external head under the existing writer fence and repair lineage. D11 and D12 are untouched, and RO1 holds for the review-only campaign.
- Cost, stated to the caller: one writer run, plus that campaign's own review. Seat verdicts are not reused across campaigns.
- Acceptance: RO13 (`repair`); RO1 still 0 writer calls in the review-only campaign; the seeded contract passes `implementation-campaign-check.js`; control: a seeded contract whose base is not the reviewed head is refused.
- Boundaries: no change to `git_candidate`, writer fence or repair-lineage code.

Order: P1 → P2 → P4 is the critical path, because the park only becomes usable once P2 ships. P3 runs in parallel with P2 after P1, and P5 runs after P2. P4 ships the `return`/`end` doc and the cuda reply. P5 adds a doc section when it lands. Each phase ships on its own branch (`lane/review-candidate-p<N>`) with one merge commit, which is its rollback point.

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
- Q2 — Panel strength at l4. (A) Follow l4 `implement-review` (QC panel optional; a single reviewer may stand as the panel). (B) Require a complete QC panel at every level, since a final panel is what was asked for. Recommendation: B. **Ruled 2026-10-13: B.** P1 must require the sealed panel minimum and family count at l4 as well.
- Q1′ — Owner reframe (2026-10-13), superseding Q1 once confirmed. The owner asked whether, since the review already found the problems, the findings should go back to a depth-0 that dispatches the fix, instead of a review that can only end. Two readings:
  - (R1) autopilot's own implementer repairs the adopted range (`max_repair_generations` > 0 on an adopted candidate). This contradicts §12: the reporter's writer is outside autopilot on purpose. It also needs a repair lineage on a range this campaign did not write (D11, D12).
  - (R2) Findings go to the requester's depth-0. After disposition, their own writer fixes and pushes a new head; the same campaign re-derives the new head (RO3 checks become "moved forward from the reviewed head") and re-reviews, reusing seat verdicts per RO11. This keeps "no autopilot writer" and fires the §4 Out trigger for in-campaign re-review (the reporter said a second campaign's spend blocks them).
  - Recommendation: R2, with B's park as the place the findings wait. Pending the owner's confirmation; the reporter is told only after it.
  - **Ruled 2026-10-14: the caller chooses, at disposition time.** Q1 resolves to B: findings park. The disposition then picks one of three choices:
    - `return`: R2. The caller's writer fixes, and the same campaign re-reviews the delta.
    - `end`: terminal not-ready, the reporter's own ask in §12.
    - `repair`: R1 as a handoff, not as an in-place repair. It seeds a normal `implement-review` campaign from the reviewed head (P5), so D11 and D12 stay untouched.

    An optional contract preset lets a caller with no human present pick ahead of time. RO13 pins all of this. `return` and `end` ship in P2; `repair` ships in P5. U8 is moot, because `end` is an explicit choice and not `deny-nonempty`.

- Q3 — ruled 2026-10-14 (see below); the reporter asked on 2026-10-14. On `return`, what does "re-review only the delta" cover when the fix touches files or behavior an earlier seat already passed? There are two candidates:
  - (a) Seats review `reviewed_head..new_head` with the cumulative `base..new_head` as read-only context. The final panel judges the cumulative range, and a seat verdict is reused only for a seat whose reviewed files the delta does not touch.
  - (b) Seats review only `reviewed_head..new_head`.

  **Ruled 2026-10-14 (P2 evidence): (c), neither (a) nor (b).** A seat outcome is reused only when its whole input binding is identical (`deriveReusableOutcome`), and seats have no read-only context channel, so (a) would need a new reuse key, re-check and packet shape: a design change, not P2. (c) keeps the existing mechanism: on `return`, seats re-review the cumulative `base..new_head` as a full-diff generation. (Corrected after the P2 review: the earlier text said the existing `focused_delta_round` is added; the engine never wires `focusedReview` for `return`.) No stale pass is possible, because a changed head changes every binding. The cost is a full re-review per `return`; a cheaper delta re-review is BL-0146. The reporter is told in the P4 doc.

## 11. Unverified

| # | Not yet checked | Checked in |
|---|---|---|
| U1 | How an external repo produces contract, seal and endpoints/roster (seal tooling not read) | P4 |
| U2 | `reduceCampaignState` accepts a run with no implementation events before verification | P1, first task |
| U3 | Whether managed `implement-review` dispatches the verification-author seat or only requires its readiness | P3 — answered 2026-10-14: readiness only. No caller in `src/engine` dispatches it; it appears only as a readiness requirement and probe (P3 review confirmed by grep). |
| U4 | Whether `final-panel-seat-store.js` keys seat reuse on writer-fence or lineage fields | P2 |
| U5 | Whether `campaign inspect` and `status task` read fields that assume an implementation chain | P1 |
| U6 | Whether `stageVerifyOnConverge` should write a stage unit for a review-only run (fail-open today) | P1 |
| U7 | Answered 2026-10-13, see §12 | — |
| U8 | Moot after the Q1′ ruling (2026-10-14): `end` is an explicit disposition choice | — |

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
