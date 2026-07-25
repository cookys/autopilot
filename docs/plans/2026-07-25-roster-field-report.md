# Plan — Report the roster's unmatched policy fields, and wire the five we found

> **Status**: draft, pending review
> **Owner**: depth-0 (cookys)
> **Branch**: `feat/roster-field-report`, based on `origin/develop` @ `d90433b`
> **Measured frame**: `d90433b`. Re-verified against `feat/owner-kernel-p37-l3` @ `b496add`; both give
> the same 44-field set and the same 30 / 8 / 6 split, so the result is not an artifact of one frame.
> **Frame date**: 2026-07-25

## 0. Context / thesis

The owner-kernel P0 semantic inventory performed this audit **by hand, once**
(`docs/projects/2026-07-20-owner-kernel-governance/p0/semantic-inventory.md`). It recorded one roster
field, `spec_review`, as `unclear` — "defined and plumbed but appears to have no consuming gate" — wrote
a manual resolution path as two shell commands, and set an outcome rule: a field emitted and
schema-declared but read by nothing is dead contract surface, bound for the P3 deletion manifest.

The recipe is correct. What it lacks is a body: it runs when a human remembers, over the fields that
human examined. Running it mechanically over all 44 always-on fields surfaced five more the manual pass
did not reach, one of which carries operator-facing alert strings and lands in the no-detected-match
bucket.

**This plan ships the measurement as a report and wires the fields it found.** The report is advisory —
it always exits 0 — but it is *triggered broadly and read by someone*, which is the part an earlier
draft got wrong (§4.1 step 3, §6 R2).

**What this plan deliberately does not build.** Earlier drafts specified a blocking gate with a
per-field disposition registry, adjudication states, expiry dates, staleness and orphan checks, and a
noise threshold. Successive designs each fixed the previous flaw and introduced a new one. §8 Q1 records
what blocking would require, so the option is deferred rather than lost.

## 1. Measurement

### 1a. Classifier definition

Deterministic, so the report is reproducible rather than impressionistic:

- **executable file** — extension in exactly `{.js, .mjs, .cjs, .ts, .sh, .bash, .py}`.
- **access-shaped** — the line matches any of these **ten** patterns, numbered so test coverage is
  unambiguous (quote alternatives inside one pattern are one pattern, not two):
  1. `.<field>` — property access
  2. `["<field>"]` or `['<field>']` — bracketed key
  3. `"<field>"` or `'<field>'` — quoted string or object key
  4. `$<FIELD>` or `${<FIELD>}` — uppercase shell variable
  5. `<FIELD>=` — uppercase shell assignment
  6. `<field>=` — lowercase shell assignment
  7. `$<field>` or `${<field>}` — lowercase shell variable
  8. `--field <field>` — resolver flag
  9. `read_review_loop_field <field>` — repo accessor
  10. `<field>)` — shell `case` arm
- **comment** — in an executable file, the trimmed line starts with `//`, `#`, `*`, or `/*`. A comment
  line is never access-shaped.
- **incidental** — a literal match in an executable file that is not access-shaped, or is a comment.
- **skills-match** — any literal match under `skills/**`.

That list is the classifier's entire definition. Anything outside it is unmodelled — the source of error
mode 1 below.

Buckets excluded from the match count, each because it is not a place an agent or program is instructed
from:

| Excluded | Reason |
|---|---|
| `scripts/resolve-review-loop.sh`, `src/engine/resolve-review-loop.js` | the producers |
| `scripts/check-contract-schema.js`, `schemas/` | the producers' parity gate and the SSOT |
| `platforms/` | generated mirror of tracked sources |
| `hooks/tests/` | tests of the producers |
| `docs/`, `evals/` | plans, project records, fixtures |
| `CHANGELOG.md` | release notes |
| `CLAUDE.md` | the script-inventory table |
| `project-config-template/review-loop-config.md` | the config-options reference, which names every field by construction |

### 1b. What the numbers are and are not

**Scan roots.** The report scans exactly seven roots — `src/`, `scripts/`, `skills/`, `hooks/`,
`references/`, `bin/`, `agents/` — and nothing else. This is deliberately the same set as the ritual's
triggers (§4.1 step 3), so the scanned set and the triggered set are equal *by construction* rather than
by a claim that must be maintained. A tracked executable outside those roots is invisible to the report;
that is a stated limit, not an accident.

**The report counts literal matches under the §1a definition. It does not determine consumption.** It
cannot tell an executable read from a same-shaped token in a string or declaration, nor an instruction in
a `skills/**` document from an incidental mention there, nor see a consumer reached by forwarding or by
an accessor shape the classifier does not model.

Accordingly the report's own vocabulary is **"no detected modeled match"**, never "unenforced" or "dead".
Where this plan says a field is unenforced, that is **this plan's interpretation** of a zero count
combined with the per-field evidence in §1c — not a report output. The distinction is load-bearing:
§1c's dispositions rest on the per-field producer evidence, and the counts only decided which fields
were worth reading closely.

**The six are not claimed exhaustive.** An unmodelled accessor can put a live field in the zero bucket,
and an incidental token in an executable file or a passing mention in a skill document can keep a dead
field out of it.

Two error modes observed, not smoothed over:

1. **Unmodelled accessors produce false zeros.** The first run missed `read_review_loop_field <field>`
   and lowercase shell assignment, putting `implementer_family`, `verification_author_present` and
   `quota_status` in the zero bucket. Checked against `scripts/dispatch-author.sh` — where
   `implementer_family` is read and then gates a precondition — and the classifier corrected. Other
   shapes may remain unmodelled.
2. **Common tokens defeat the test.** `source` yields 55 access-shaped and 122 incidental matches here;
   the name is too common for a count to mean anything. It sits in the matched bucket **on count alone,
   and this plan makes no claim about it either way** — it is neither adjudicated nor among the six.
   An earlier draft proposed an automatic "unclassifiable" threshold at 10×; `source`'s ratio is 2.22×
   in this frame and 2.69× in the other, so that threshold would have passed the very case that
   motivated it, and is frame-dependent besides. Dropped rather than retuned — a report does not need
   the judgment.

One forwarding shape was checked because it would invalidate the result:
`src/engine/autopilot-engine.js` rebuilds the roster twice with `{ ...roster, … }`. Both are local
substitutions of reviewer fields; neither reads the fields in §1c.

### 1c. Result, and the six read closely

Of 44 always-on fields: **30** have an access-shaped match in an executable file; **8** have no such
match but do have a `skills/**` match; **6** have neither.

**All eight `skills/**` matches were read**, not sampled. Each has at least one site that instructs
rather than describes: `independent_harness` and `qc_panel_aggregation` in
`skills/quality-pipeline/references/code-review.md` (reproduce-before-blocking; `majority` forbidden as an
aggregation); `cross_family_required` / `cross_family_satisfied` in the same file's decorrelate-by-family
rule; `required_review_families` and `min_panel_size` in `skills/ceo-agent/references/level-front-door.md`
(panel composition with a resolver-unavailable fallback); `l1_required` there under high `review_risk`;
and `review_diff_scope` there defining what each round's review reads. The weakest is
`qc_panel_aggregation`, whose only substantive site names the field inside a parenthetical explaining what
the resolver rejects — instructional in effect, but by the narrowest margin of the eight.

The contrast case on the other side is the `CLAUDE.md` script-inventory row: description, not instruction.
That contrast is why file type alone cannot separate the buckets.

The six with no detected match, each read at its producer:

| Field | Producer behaviour | Would an operator act differently seeing it? |
|---|---|---|
| `capability_warnings` | three strings: implementer demoted for exhausted quota; reviewer demoted likewise; runner lacks native skill support | **Yes** — the engine that will do the work has been substituted |
| `quota_reset_at` | non-null only when an implementer or reviewer quota is `exhausted` or `limited`. The producer selects by precedence: implementer-exhausted, then reviewer-exhausted, then implementer-limited, then reviewer-limited, else the later of the two known times | **Yes, but only partially** — it says *something* is quota-constrained and when it clears, which is enough for wait-vs-switch. **It cannot say whose.** The roster's only quota fields are `quota_status` and `quota_reset_at`; no per-role quota value is emitted, so the selected role is not recoverable downstream (§8 Q6) |
| `capability_state_source` | `unknown` \| `none` \| `store`. The producer states the distinction in-line: `none` means capability-state consultation is **explicitly off** ("deliberately not consulted"); `unknown` means it **was** consulted but the store held no fresh data | **Yes for `none`** — the quota and skill-mode values are configured defaults rather than observations. An earlier draft rendered `none` as "capability state was not read" and additionally claimed a `quota_status` of `unknown` meant "never checked"; the producer's own comment separates those, and only the `none` reading is claimed here |
| `skill_mode_requested` | the requested mode against `skill_mode_effective`; a warning is emitted **only** when `requested === "native"` and native is unsupported, so the `auto` → degraded path emits nothing | **Yes** — a run that requested `auto` and got `off` has no skill transport and is told nothing. This settles a question earlier drafts left open: the divergence is **not** covered by `capability_warnings` |
| `domain_source` | `none` \| `explicit` \| `auto` — the provenance tag for `work_domain` | **Yes** — provenance is diagnostic even where the tagged value routes nothing: reading `work_domain` without knowing whether it was declared or inferred invites trusting a guess. An earlier draft adjudicated this inert on the grounds that a provenance tag cannot matter more than the value it tags; that conflates routing with diagnosis |
| `spec_review` | documented in the config template as "run the reviewer loop on the spec BEFORE dispatching impl"; resolved `on` here | **Not decided here** — handed to the P3 deletion manifest (§4 Phase 2) |

`spec_review` is independently corroborated: the semantic inventory reached the same conclusion five days
earlier — by the same method, so §1b's error modes apply to that corroboration too.

## 2. OKR / KRs

**Objective**: the roster's unmatched-field picture is produced by a command, printed where someone
sees it, and the fields found today are resolved.

| KR | Measure | Target |
|---|---|---|
| KR1 | The 44-field match table | reproducible by one command; printed unconditionally by a dedicated CI step |
| KR2 | The report is presented, not merely owned | invoked non-blockingly from `scripts/preflight-release.sh`; owner named in `CLAUDE.md` |
| KR3 | The five operator-relevant values in §1c | reach the operator on foreman-driven `/l5` `/l6` runs |
| KR4 | `spec_review` | recorded as a deletion-manifest candidate in the semantic inventory — **deferred**, that file is not on this base (§3, §6 R8) |

No KR targets a field count. Phase 2 changes the distribution by design, and a count target would be
either trivially met or self-contradicting (an earlier draft asserted both a fixed baseline and that no
count is an acceptance criterion).

No KR claims the report prevents recurrence. It makes visible those recurrences that land in the
modeled-zero bucket — which, by §1b, is not all of them. Blocking is §8 Q1.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Node ≥ 20.10, built-ins only (no new dependencies).
- The report emits JSON on stdout with `--json`, a table otherwise, and diagnostics on stderr.
  **Exit 0 means the report ran, whatever it found** — an exit code varying with findings would make it a
  gate by accident. **Exit 2 means the report could not run** (schema unreadable or unparseable, git
  failure, unreadable scan root, bad usage) and is accompanied by a `REPORT-HEALTH: FAILED <reason>` line
  on stderr. That is a broken tool, not a verdict about fields: without it a schema or git failure would
  produce no table while CI stayed green, which defeats the report's only purpose.
- The field set is read from `schemas/review-loop-contract.schema.json`, the documented SSOT. Do not
  shell the resolver and do not hand-maintain a second field list.
- Conditional fields (`reviewer_qualified`, `fallback_ladder`, `verify_first`, `capability_tier`,
  `density_scaled`, `density_source`) are outside the always-on contract per the schema's description and
  are out of scope — the report covers the schema's `required` set only.
- **No resolver behaviour changes and no field is deleted.** Resolver JSON output is byte-identical.
- The §1a exclusion list is part of the report's contract. `project-config-template/review-loop-config.md`
  must stay excluded: it names every field, so counting it would make every field look matched.
- The report prints counts and never states a verdict for a field (§1b).

## 3. File-structure map

| File | Change | Responsibility |
|---|---|---|
| `scripts/report-roster-field-consumers.js` | **new** | The measurement, shipped. Named `report-`, not `check-`, so its advisory nature is legible at the call site |
| `hooks/tests/report-roster-field-consumers.test.sh` | **new** | Oracle: classifier behaviour, the exclusion contract, exit 0 on findings |
| ~~`scripts/sync-manifest.json`~~ | **not edited — see below** | `sync-all.sh` surfaces a ritual's output only when it FAILS (`sync-all.sh:192`). A never-failing report registered there would print nothing on every run while appearing in the checks list as passing. Registration is therefore dropped: it would be invisible *and* misleading. Consequence: there is no trigger set, so the trigger-vs-scan-root question disappears with it |
| `.github/workflows/test.yml` | edit | Run the report unconditionally and print its table into the job log |
| `scripts/preflight-release.sh` | edit | Non-blocking invocation at release prep — prints the no-detected-match bucket, never changes that script's exit code |
| `skills/l5/references/hetero-impl-loop.md` | edit | One capability-state surface rule covering the five fields |
| `skills/l6/references/full-dispatch-pipeline.md` | edit | Delta pointing at the `/l5` rule |
| `docs/projects/2026-07-20-owner-kernel-governance/p0/semantic-inventory.md` | **deferred** | That file does not exist on `origin/develop`; it lives on the unmerged owner-kernel branch. The `spec_review` handoff edit must be made there or after that branch merges (§6 R8) |
| `CLAUDE.md` | edit | Inventory row naming the script **and its owner** |
| `docs/BACKLOG.md` | edit | §8 carry-overs |

No registry file. The five dispositions live in §1c with their producer evidence and their adjudicator
(depth-0, cookys) on the record here, rather than in a data file needing its own freshness machinery.

## 4. Phases

### Phase 1 — ship the report (size: S)

1. `scripts/report-roster-field-consumers.js`, promoted from the probe that produced §1:
   - Read the `required` field list from the schema; scan tracked files; apply §1a's classifier and
     exclusions.
   - Per field print: access-shaped count, incidental count, `skills/**` count, and up to three site
     paths per non-zero category.
   - Print the three-bucket summary. Use the phrase **"no detected modeled match"** for the third
     bucket — not "unenforced", not "dead".
   - `--json` for machine output. **Exit 0 always.**
2. `hooks/tests/report-roster-field-consumers.test.sh`, **table-driven over a synthetic fixture tree**.
   Fixture injection: the test builds a temp directory containing a minimal
   `schemas/review-loop-contract.schema.json` (whose `required` array names only the fixture fields) plus
   the seven scan roots, initialises it as a git repo and commits, then runs the report with that
   directory as its repo argument. Nothing depends on the live repo's contents.

   **Positive oracle first** — without it, an implementation that classified *every* executable
   occurrence as unmatched would pass a suite made only of negatives:
   1. one case **per access shape** in §1a (eleven shapes), each a fixture field whose sole occurrence is
      that shape in a `.js` or `.sh` under a scan root ⇒ each lands in the matched bucket;
   2. one case per **executable extension** in §1a ⇒ matched bucket, proving the extension set is honoured;
   3. a field with an ordinary access-shaped match ⇒ matched bucket, and its reported site path equals the
      fixture path (proves sites are reported, not just counted).

   **Negative and boundary cases:**
   4. a field whose only executable occurrence is **not** any §1a shape (a bare word in a string) ⇒
      no-detected-match bucket, counted as incidental;
   5. a field whose only executable match is on a **comment** line ⇒ no-detected-match bucket;
   6. **one case per exclusion family** — producers, `schemas/`, `platforms/`, `hooks/tests/`, `docs/`,
      `evals/`, `CHANGELOG.md`, `CLAUDE.md`, the config template — each placing an otherwise-counting
      access-shaped match in that excluded location ⇒ no-detected-match bucket. The exclusion must be
      exercised with a path that would **otherwise count**: testing it with the config template alone
      proves nothing, since a `.md` outside `skills/**` is not a match under §1a in the first place;
   7. a field matched only under `skills/**` ⇒ prose bucket;
   8. a field with a match **outside the seven scan roots** ⇒ no-detected-match bucket (pins the scan-root
      limit stated in §1b);
   9. `--json` parses and contains exactly one entry per field in the fixture schema's `required` array;
   10. exit stays 0 when the no-detected-match count is non-zero (proves advisory, not gate);
   11. **report-health**: an unreadable or unparseable fixture schema ⇒ exit 2 and a
       `REPORT-HEALTH: FAILED` line on stderr, with no table on stdout. Without this case a silent
       failure would read as a clean run;
   12. the report runs on the real repo and exits 0.
3. **Register so it actually runs when it matters.** In `scripts/sync-manifest.json`:
   `id: roster-field-report`, `generator: null`,
   `check: node scripts/report-roster-field-consumers.js`, `tier: both`, and `trigger` covering the
   schema, the script itself, **and every scanned tree** — `src/`, `scripts/`, `skills/`, `hooks/`,
   `references/`, `bin/`, `agents/`. Removing a consumer must at minimum *print* the report; an earlier
   draft triggered only on the schema and the script, so the one event the report exists to reveal would
   not have printed it. Additionally, run it unconditionally in CI (`.github/workflows/test.yml`) so the
   table lands in every job log regardless of what changed.
   Because the ritual cannot fail, broad triggering costs only output — which is why this does not need
   the scan-set/trigger-set equality a blocking design would.
4. **Present it, do not merely assign it.** Add a non-blocking invocation to
   `scripts/preflight-release.sh`: it runs the report and prints the no-detected-match bucket into the
   release-prep output, never affecting that script's exit code. Naming an owner in a CLAUDE.md row was an
   earlier draft's answer and was not enough — it left the outcome resting on the same human memory the
   plan set out to replace. The inventory row still names the owner, but the mechanism is the invocation.

**Acceptance**: every case in the table-driven suite passes, including all eleven access-shape positives;
the report prints a 44-row table on the real repo and `--json` parses; the manifest row's triggers are
exactly the seven scan roots; the CI job log contains the table; `preflight-release.sh` prints the bucket
without altering its own exit code. No count is an acceptance criterion (§2).

### Phase 2 — resolve the six (size: S, same commit)

**One surface rule** in `skills/l5/references/hetero-impl-loop.md`, mirrored as a delta in the `/l6`
reference. Before the first implementation dispatch, the foreman surfaces to the operator, when present:

- every string in `capability_warnings`;
- `quota_reset_at` when non-null, rendered **without attributing a role** — "a configured engine's quota
  is constrained; clears at <t>" — because the roster emits no per-role quota value and the selected role
  is therefore not recoverable (§1c, §8 Q6). An earlier draft required rendering the role and status, which
  is not implementable from the roster and would have invited a fabricated attribution;
- `capability_state_source` when it is `none`, stated as "capability-state consultation is off for this
  project — these values were not read from the capability store" — **only `none`**, since the producer
  distinguishes it from `unknown` (consulted, no fresh data). The message deliberately stops at "not read
  from the store": the cited evidence establishes that consultation was off, not where each downstream
  value did originate;
- `skill_mode_requested` **only when it is `auto` and `skill_mode_effective` is `off`**, stated as "skill
  transport requested automatically but resolved to none". The producer passes `off`/`prompt`/`native`
  through unchanged, so `auto` is the only mode that can diverge, and `off` is its degraded terminus;
  `auto → prompt` is ordinary resolution, not degradation. An earlier draft surfaced any inequality, which
  is not established as actionable and would have contradicted R4's "a healthy run surfaces nothing";
- `domain_source` whenever `work_domain` is reported, so a reader knows whether the domain was declared
  or inferred.

These five are one rule because they are one situation: the capability picture the run is about to
proceed under. Splitting them invites four of the five being skipped. The countervailing risk — a single
rule skipped wholesale — is R5.

**`spec_review` — handed off, not decided here.** The semantic inventory already classified it and set
the outcome rule (dead contract surface → P3 deletion manifest); `surface-baseline.md` requires P3 to
name a deletion manifest of executed surfaces. Phase 2 edits the inventory's "one unresolved site"
section to record that the mechanized report now covers this field and to name it a deletion-manifest
candidate (KR4). It stays in the report's no-detected-match bucket until P3 acts — which is the intended
behaviour: an advisory report may keep showing an open item, where a blocking gate would have needed an
expiry mechanism to avoid becoming a permanent exemption.

**Acceptance**: the report shows five fields moved out of the no-detected-match bucket and `spec_review`
remaining. Resolver output byte-identical. `bash scripts/validate.sh`,
`bash scripts/preflight-portability.sh`, `node scripts/doc-drift-gate.js` pass. A zero-context read of
the `/l5` reference tells a foreman what to surface, when, and in what wording.

## 5. Test / validation

| What | How | Gated by |
|---|---|---|
| Positive classifier oracle | one case per §1a access shape (11) + per executable extension — without these a report that matches nothing passes | script |
| Exclusion contract | one case per exclusion family, each with an otherwise-counting match | script |
| Comment + non-shape rules | dedicated cases | script |
| Scan-root limit | a match outside the seven roots must not count | script |
| Advisory-not-gate | exit 0 with non-zero findings | script |
| Report-health signal | unreadable schema ⇒ exit 2 + `REPORT-HEALTH: FAILED`, no table | script |
| Trigger/scan-root equality | assert the manifest row's triggers equal the seven scan roots | script |
| Release-prep presentation | `preflight-release.sh` prints the bucket and its exit code is unchanged | script |
| No behavioural drift | `bash scripts/sync-all.sh --check`; resolver JSON byte-compared before/after | script |
| CLAUDE.md inventory | `node scripts/check-claude-md-inventory.js` | script |
| Doc integrity | `bash scripts/preflight-portability.sh`; `node scripts/doc-drift-gate.js` | script |
| KR3 semantic adequacy | zero-context read of the edited `/l5` `/l6` references | **human** |
| Full suite | `bash hooks/tests/run.sh --parallel 16` | script |

## 6. Risks + inversion

- **R1 — the frame moves.** The field set and the split are frame-dependent. Measured on `d90433b` and
  re-verified on `b496add` with identical results, but concurrent branches touch
  `scripts/resolve-review-loop.sh` and the schema. *Mitigation*: re-run the report immediately before
  Phase 2 and reconcile §1c against its output; the six may not be the same six. Observed live: during
  this plan's drafting a concurrent commit removed a `spec_review` mention from `CLAUDE.md`, changing a
  citation this plan had made.
- **R2 — an advisory report can still be ignored.** Nothing fails when the count is non-zero. Triggering
  on the scan roots and printing unconditionally in CI make it *available*, the release-prep invocation
  puts it in front of someone, and the owner makes it someone's; none of that makes it enforced, and none
  of it covers a recurrence the classifier does not model (§1b). This is the accepted cost of not building
  §8 Q1's machinery.
- **R3 — interpretation can drift back into the report's voice.** The report prints counts; the
  "unenforced" language is this plan's (§1b). If the script's output ever states a verdict it inherits a
  soundness burden its method cannot carry. The §4.1 wording requirement is the guard.
- **R4 — the five surfaced values may be noise.** All five are conditional (present, non-null, exactly
  `none`, divergent, or accompanying a reported `work_domain`), so a healthy run surfaces nothing. If
  they prove noisy, narrow the rule rather than delete it.
- **R5 — one bundled rule can be skipped wholesale.** The bundle protects against four-of-five being
  dropped but concentrates the failure. Judged the better trade because the five describe one situation;
  named here so the trade is visible rather than assumed.
- **R6 — prose enforcement is only as strong as an agent reading it**, which is why KR3 is scoped to
  foreman-driven runs. Engine-CLI paths that resolve the roster with no agent reading `/l5` `/l6` are
  not covered (§8 Q2).
- **R7 — the `skills/**` bucket rests on a manual read, not on a mechanism.** All eight fields were read
  at their sites — which fall in just two documents, `code-review.md` and `level-front-door.md`, so the
  breadth is eight fields, not eight independent documents — and each has an instructing site (§1c). But
  `qc_panel_aggregation`'s is a parenthetical, and a future edit could reduce any of them to a bare
  mention without changing the count. The report cannot
  see that difference (§1b); only a re-read would.
- **R8 — two Phase-1 items could not be done on this base.** The semantic-inventory handoff (KR4) needs a
  file that exists only on the unmerged owner-kernel branch. And the `sync-manifest` registration was
  dropped on discovering the harness hides a passing ritual's output — a design fact that only surfaced by
  reading `sync-all.sh`, not by reviewing this plan. Both are recorded rather than quietly skipped.
- **Inversion**: the surest way to fail is to let the report grow gate semantics — a varying exit code, a
  threshold, a registry. Each reintroduces the soundness burden the descope removed. §2.5 states exit 0
  as a constraint for exactly this reason.

## 7. Out of scope

- Blocking on unmatched fields (§8 Q1).
- Deleting any field, including `spec_review` — the P3 deletion manifest's call.
- Any change to resolver behaviour, field semantics, or emitted JSON.
- The 8 `skills/**`-matched fields — read and found instructional (§1c); whether prose enforcement is
  strong enough in general is §8 Q3.
- `source` — matched on count alone, no claim made either way (§1b).
- Reachability checking of dispatch-contract allowlists (§8 Q4).
- Auditing the other resolvers (§8 Q5).
- Any claim about dispatch rounds, cost, or review quality.

## 8. Open questions

**Q1 — should the report become a gate?** What blocking would require, learned from designing it: a
per-field declared disposition (so a *new* field cannot pass merely by having any match, and a
code-matched field cannot silently degrade to a prose token), an adjudication record with expiry for
deferred fields, a staleness check for records whose field later gains a consumer, rejection of orphan
records for deleted fields, a defensible answer for common tokens like `source`, and equality between the
scanned set and the trigger set. Revisit if the report shows the count climbing.

**Q2 — should the capability surface reach non-foreman paths?** KR3 is scoped to `/l5` `/l6`. Widening
means a code-level surface (e.g. resolver stderr), which changes resolver behaviour and is excluded by
§2.5.

**Q3 — how strong is prose enforcement?** All eight `skills/**`-matched fields were read and each
instructs (§1c), so the bucket is not inflated today. The open question is the general one: an
instruction only binds an agent that reads it, and nothing detects an instruction decaying into a mention.

**Q6 — should the roster emit per-role quota state?** `quota_reset_at` is selected from one of four
role/status combinations but the chosen role is not emitted, so no consumer can attribute it. Fixing that
means adding fields to the resolver, which §2.5 excludes here. Until then the surface rule deliberately
does not name a role.

**Q4 (withdrawn, retained) — should a dispatch contract's allowlist be checked against its oracle?** An
earlier draft built a phase on the premise that an `/l6` round was lost to an unreachable scope: the
contract denied `src/engine/owner-kernel/state.js`, whose guard requires `acceptance_version === 2`
before delegation. Verification did not support it: `acceptance_version` is set from
`header.acceptance_authority`, the header is built by `kernel.js` from an `acceptanceAuthority` argument,
and both `kernel.js` and the new semantic-witness module were inside the allowlist. The artifacts show
the implementer edited `state.js` (a denied path, caught by the existing trespass gate) and that depth-0's
correction independently moved the same file into `allow_paths` — evidence about which correction was
preferred, not proof of necessity.

**Q5 — does this generalise?** `resolve-doa.sh`, `resolve-qc-gate.sh`, and `resolve-worktree-teardown.sh`
share the resolver-emits-policy shape and were not audited.

## Review log

| Round | Reviewer | Verdict | Disposition |
|---|---|---|---|
| — | depth-0 | — | This plan descoped from a blocking gate to an advisory report after successive gate designs each fixed the prior flaw and introduced a new one: one draft's disposition registry, living in a scanned tree and naming every field, would have satisfied its own gate; its replacement dropped the registry and thereby broke the guarantee that a new field cannot pass unadjudicated; a proposed noise threshold of 10× would have passed the single case (`source`) that motivated it, and proved frame-dependent besides. The descope dissolves those rather than patching them. A later round found the descope had not delivered even its reduced claim — the report's triggers omitted the consumer trees, so removing a consumer would not have printed it — which §4.1 step 3 now fixes with broad triggering, unconditional CI printing, and a named owner. Also corrected in that round: an arithmetic error (five fields move, not four, and the adjudication that produced it), an `inert` disposition for `domain_source` that conflated routing with diagnosis, a test case that did not discriminate, and surface-rule wording that asserted meanings the producer evidence did not establish. Withdrawn across drafts: a spec-review ordering mechanism and a scope-reachability gate (§8 Q1, Q4). The measurement itself required two iterations after false negatives on the repo's shell accessor; that and the `source` false-positive explosion are recorded as §1b error modes. |
