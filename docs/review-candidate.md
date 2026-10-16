# Review-only candidate review (`engine review-candidate`)

> Part of [Autopilot](../README.md). Detail docs: [Skills](skills.md) · [Coexistence](coexistence.md) · [Configuration](configuration.md) · [Installation](installation.md) · [Architecture](architecture.md) · [Hooks](../hooks/README.md)

How an operator outside this repository gets autopilot's managed final review over a commit range
that someone else already wrote. Everything you need to run one campaign to a receipt is on this page,
in the order you need it. Section 4 opens with the one-time steps that must be done before the first run:
the roster and its operator authorization have to be settled **before** you run. Sealing (section 3) never
looks at the roster, but the run does.

## 1. What it is

`node bin/autopilot.js engine review-candidate` takes one externally produced `base..head` range in a
Git repository and runs the managed review rail over exactly that range:

1. **Admission.** The range is re-derived from Git (branch tip, ancestry, path scope, file cap). Nothing
   about the range is taken from the command line.
2. **Verification.** The sealed `verify_cmd` runs in a fresh detached worktree at the head commit, not in
   your checkout. A red verify ends the campaign without spending a reviewer.
3. **Review.** The sealed QC panel reviews the cumulative `base..head` diff, then the final panel judges it.
4. **A terminal receipt**: ready, not-ready, or parked on findings waiting for your disposition.

Autopilot writes no code here. There is no implementer, no verification-author and no repair model
call at any point; the adopted-range adapter refuses to dispatch a writer if anything ever reaches it
(`review_candidate_no_writer`, section 5). Findings are reported, never fixed inside this campaign. If you want autopilot's writer to fix them, the
`repair` choice (section 6) closes this campaign and hands you a separate `implement-review` campaign to run.

Two things this is not:

- It is **not** this repository's merge gate. The receipt is a campaign receipt, never a `QC-Verdict`
  trailer source.
- It is **not** `implement-review`. An adoption contract under `implement-review`, and an implementation
  contract under `review-candidate`, are each refused before any spend (`review_candidate_mode_mismatch`).

The managed rail needs the sealed contract, the seal, a spec file and a review roster. Sections 2 to 4
produce them.

## 2. The contract

The contract is a JSON file in the closed `implementation-campaign-contract` format
([`schemas/implementation-campaign-contract.schema.json`](../schemas/implementation-campaign-contract.schema.json)),
whose optional `adoption` section marks it review-only. The checker
([`scripts/implementation-campaign-check.js`](../scripts/implementation-campaign-check.js)) is the
authority on what is legal; an unknown field anywhere is rejected.

### 2.1 Review-only rules

| Rule | Value |
|---|---|
| `adoption.head_sha` | Required. A 40-hex commit id that exists in the repository and differs from `base_sha`. (The sealer also accepts a 64-hex id in a sha256 repository, but intake supports only 40-hex SHA-1 repositories and refuses such a run with `campaign_repo_precondition_failed`.) |
| `adoption.author_family` | Optional. Names the model family that wrote the range. It can only tighten the panel: that family's seats do not count toward the required family count. Use exactly one of `openai`, `anthropic`, `alibaba`, `google`, `xai`, `minimax`, `zhipu`. The match is literal against each seat's family (derived from its model name), and **a value that matches no seat is accepted silently and excludes nothing**, so check the spelling. |
| `adoption.disposition_preset` | Optional, `end`, `return` or `repair`. Applies your choice to a parked review (section 6): `end` and `repair` close it at the first park, `return` is applied by a later `--resume`. |
| `max_repair_generations` | Must be exactly `0`. |
| `mission_runtime`, `strict_dispatch`, `unit_class` | Must be absent. |
| `branch` | The branch whose tip is the head. At admission the tip must equal `adoption.head_sha`. |
| `base_sha` | Must be an ancestor of the head. The range reviewed is `base_sha..head_sha`. |

### 2.2 A minimal contract

All fields below are required except the ones in the "optional" comment. Replace the angle-bracket
values; section 3 shows a script that fills them from Git.

```json
{
  "schema_version": 1,
  "ticket": "review-2026-10-14-feature-x",
  "profile": "poc",
  "mission_grant_ref": null,
  "repo_identity": "git-common-dir:/abs/path/to/repo/.git",
  "base_sha": "<40-hex base commit>",
  "branch": "feature-x",
  "vertical_acceptance": ["the range adds sub(a, b) to src/math.js and it returns a minus b"],
  "allowed_path_prefixes": ["src/"],
  "max_changed_files": 10,
  "baseline_churn": 100,
  "max_growth_ratio": 1.5,
  "max_extra_churn": 50,
  "max_repair_generations": 0,
  "max_wall_seconds": 1500,
  "final_panel_reserve_seconds": 0,
  "verify_cmd": "node src/math.test.js",
  "rubric_ids": ["ICC-RC1"],
  "adoption": {
    "head_sha": "<40-hex head commit>",
    "author_family": "openai",
    "disposition_preset": "end"
  }
}
```

(`final_panel_reserve_seconds`, `adoption.author_family` and `adoption.disposition_preset` are optional.)

Field notes, each checked by the sealer:

- `ticket`: `[A-Za-z0-9._-]+`, up to 128 characters.
- `profile`: `spike`, `poc`, `internal-pilot` or `production`. With `max_repair_generations: 0` any
  profile is legal; the profile only sets a repair ceiling you are not using.
- `mission_grant_ref`: `null` under governance `off` or `shadow` (see section 3).
- `repo_identity`: must equal `git-common-dir:` followed by the real path of the repository's git
  common directory. A mismatch is rejected (`repo_identity: does not match canonical repository identity`).
- `vertical_acceptance`: 1 to 64 non-empty strings, the acceptance statements the range claims to meet.
- `allowed_path_prefixes`: 1 to 128 normalized relative prefixes (no leading `./`, no `..`, no `.git`,
  no backslashes). Every changed path in the range must sit under one of them, otherwise admission
  refuses the range (`review_candidate_out_of_scope`). There is no whole-repository prefix: `.` and the
  empty string are rejected, so list the directories you allow. A prefix may also be a single file path.
- `max_changed_files`: 1 to 4096. A range that changes more distinct files is refused
  (`review_candidate_file_cap`).
- `baseline_churn` (integer 1 or more), `max_growth_ratio` (1 to 1.5) and `max_extra_churn`: a churn
  budget. `max_extra_churn` may not exceed `floor(baseline_churn * (max_growth_ratio - 1))`. For a
  review-only range, going over the churn budget is a warning in the receipt
  (`review_candidate_churn_*`), not a refusal.
- `max_wall_seconds`: 1 to 7200. One clock for the whole campaign: every `--resume` and every `return`
  shares it. Time spent parked on `awaiting_disposition` does not count; review time after each resume
  does. Exhaustion ends the campaign (`status: "wall_expired"`).
- `verify_cmd`: space-delimited argv, optionally chained with ` && `. Only characters
  `A-Za-z0-9_./:@%+=,-` are allowed in each word. No quotes, pipes, redirects, `;` or `$()`. Put anything
  complicated in a script in the repository and call it (`bash tools/ci-check.sh`).
  The command runs in a detached worktree at the head commit, so the files it names must exist **at the
  head**. `allowed_path_prefixes` does not restrict what `verify_cmd` can run: it restricts only the paths
  the range **changes**. The examples keep them consistent: the range changes `src/math.js` and adds
  `src/math.test.js`, both under `src/`. If the range also changed a test file outside the prefixes
  (say a root-level `test.js`), admission would refuse the whole range as `review_candidate_out_of_scope`
  even though the verify command is fine: add that file's path to the prefixes (a prefix may be a single
  file) or move the test under an allowed directory. A test file that already exists at the base and is
  not changed by the range needs no prefix.
- `rubric_ids`: 1 to 128 ids matching `^[A-Za-z][A-Za-z0-9_-]*[0-9]+$` (for example `ICC-RC1`).

## 3. Seal the contract

Sealing records the contract's digest so any later edit to the contract is detected. Run it from any
directory; paths here are absolute.

```bash
node scripts/implementation-campaign-check.js seal \
  --contract /abs/review/contract.json \
  --repo /abs/path/to/repo \
  --mission-mode off \
  --out /abs/review/contract.seal.json
```

`--mission-mode` must equal the repository's owner-kernel governance mode. A repository with no
`.claude/owner-kernel-governance.json` is `off`. A mismatch is rejected. The mode must be `off` or
`shadow`: under `enforce` a review-only contract cannot be sealed and the sealer says
`review_candidate_governance_enforce`.

Output is indented multi-line JSON: `"verdict": "SEALED"` and exit 0. `"verdict": "REJECTED"` with an
`errors` array and exit 3 means a rule in section 2 failed; the array names the field. Exit 3 also covers
failures that print only one line on stderr and no `errors` array: a `--mission-mode` that does not match
the repository, a seal target that already exists, and a `check` that finds drift. Exit 2 is a usage or
I/O error. Verify a seal at any time with the same flags but `check --seal <file>` in place of `--out`
(`"verdict": "VALID"`).

**You cannot reseal in place.** `seal` refuses an existing output file (`seal target already exists`,
exit 3). The engine also writes a `qc_panel_snapshot.json` next to the contract on the first run; it is
bound to that contract's bytes and campaign, so a changed contract run against the old snapshot is refused
(`qc_panel_snapshot_identity_invalid`), and a contract whose bytes did not change maps back to the same
campaign. To seal a changed contract, use a new directory, or delete both `<contract>.seal.json` and
`qc_panel_snapshot.json` first. Either way the contract content must really change (for example a new
`ticket`), because the campaign id derives from the contract bytes.

Keep the contract, seal and spec **outside** the repository working tree; this is required, not a
preference. The review refuses a repository with uncommitted or untracked files
(`campaign_repo_precondition_failed`), and files you write inside it would trip that check. The engine looks for the seal at `<contract>.seal.json` (the
contract path with `.json` replaced by `.seal.json`) when `--campaign-seal` is not given.

### A script that builds and seals a contract

```bash
REPO=/abs/path/to/repo        # the repository that holds the range
BASE=<base commit-ish>        # e.g. the merge-base with your main branch; HEAD~1 if the range is just the last commit
BRANCH=feature-x              # the branch whose tip is the range head
OUT=/abs/review               # a directory outside $REPO
mkdir -p "$OUT"

BASE_SHA=$(git -C "$REPO" rev-parse "$BASE^{commit}")
HEAD_SHA=$(git -C "$REPO" rev-parse "refs/heads/$BRANCH^{commit}")
COMMON=$(realpath "$(git -C "$REPO" rev-parse --path-format=absolute --git-common-dir)")

cat > "$OUT/contract.json" <<EOF
{
  "schema_version": 1,
  "ticket": "review-$(date +%Y%m%d)-$BRANCH",
  "profile": "poc",
  "mission_grant_ref": null,
  "repo_identity": "git-common-dir:$COMMON",
  "base_sha": "$BASE_SHA",
  "branch": "$BRANCH",
  "vertical_acceptance": ["state what the range is supposed to do"],
  "allowed_path_prefixes": ["src/"],
  "max_changed_files": 10,
  "baseline_churn": 100,
  "max_growth_ratio": 1.5,
  "max_extra_churn": 50,
  "max_repair_generations": 0,
  "max_wall_seconds": 1500,
  "verify_cmd": "node src/math.test.js",
  "rubric_ids": ["ICC-RC1"],
  "adoption": { "head_sha": "$HEAD_SHA" }
}
EOF

node scripts/implementation-campaign-check.js seal \
  --contract "$OUT/contract.json" --repo "$REPO" --mission-mode off --out "$OUT/contract.seal.json"
```

The ticket is `review-<date>-<branch>`, so running this script again the same day for the same branch
produces the same contract bytes: `seal` then refuses the existing output, and a fresh `$OUT` with the
same bytes maps back to the same campaign. Change the ticket (add a counter or a time, for example
`$(date +%Y%m%d-%H%M%S)`) whenever you seal again (see "You cannot reseal in place" above).

(`--path-format=absolute` needs Git 2.31 or newer. On older Git, resolve the path with `realpath`
from inside `$REPO`.)

## 4. Run the review

### Before the first run (one time)

1. **Settle the roster** (the bullets under "Environment and roster" below) and check it from inside the
   repository under review: `cd /abs/path/to/repo` and run `/abs/autopilot/scripts/resolve-review-loop.sh`.
   Read `source`, `config_path` and `qc_panel_seats` in the JSON it prints.
2. **Admit every `qc_panel` seat.** A seat that is not the qualified reviewer tuple, has no scorecard row
   and is not pinned is refused at the first run (`final_panel_seat_unqualified`). The shipped template's
   seats carry no operator admission, so with the template the first run is always refused. The resolver
   warns about each such seat on stderr (`qc_panel[N] seat ... has no recorded operator admission`).
   Pin each one:

   ```bash
   node scripts/engine-capability-state.js pin-seat --role qc_panel --engine gpt-6.1-sol --runner codex \
     --effort low --endpoint @none --reason "operator-chosen review seat" --operator <your name>
   ```

   Repeat per seat, with the exact engine, runner, effort and endpoint of the seat. This writes the
   **operator's own** `~/.autopilot/engine-capability/pins.jsonl` (the default store; `--store` overrides
   it), not anything in the repository. A pin is a standing, recorded operator decision, not an earned
   qualification, and applies to every repository on that account. Check with
   `node scripts/engine-capability-state.js pins --role qc_panel`; re-run the resolver and confirm that
   `override_admitted_seats` lists every `qc_panel[N]` index. That list is the proof the authorization
   worked. The `no recorded operator admission` warning goes away, but each pinned seat then prints an
   `EVIDENCE-FREE standing operator pin` warning: that one is expected, it only says the seat is an operator
   decision and not an earned qualification. The engine reads
   the pins from the home directory of the user it runs as.
3. **Endpoint credentials**, if a seat names an `endpoint` (see "Endpoints" below), and a working CLI
   login for every OAuth-runner seat.
4. **A clean repository**, with the contract, seal and spec outside it (section 3).

Then write a spec file: a short plain-text statement of what the range claims to do. Reviewers read it as
the intended behavior.

```bash
echo "Add sub(a, b) to src/math.js; it returns a minus b." > /abs/review/spec.md

AUTOPILOT_LEVEL=l4 node bin/autopilot.js engine review-candidate \
  --campaign-contract /abs/review/contract.json \
  --campaign-seal /abs/review/contract.seal.json \
  --spec-file /abs/review/spec.md \
  --cwd /abs/path/to/repo
```

Run it from your autopilot checkout; `--cwd` points at the repository under review. Use **absolute
paths** for the contract, seal and spec: relative paths resolve against `--cwd`, not your shell
directory, and a wrong one fails with `campaign_contract_unreadable`.

### Flags

| Flag | Meaning |
|---|---|
| `--campaign-contract <file>` | Required. The sealed adoption contract. It is the only source of base, branch, head and verify command. |
| `--spec-file <file>` | Required. The reviewers' spec. |
| `--campaign-seal <file>` | The seal file. Default `<contract>.seal.json`. |
| `--cwd <repo>` | The repository under review. Default: the current directory. |
| `--resume` | Continue an interrupted or parked review (section 6). |
| `--campaign-continuation end\|return` | Close a parked review (section 6). Needs `--resume`. |
| `--campaign-disposition-authority <file>` | Advanced: a depth-0 authored file that adjudicates specific findings by id and review digest. Cannot be combined with `--campaign-disposition-policy`. |
| `--campaign-disposition-policy deny-nonempty\|acceptance-bound` | Advanced: a deterministic policy in place of an authority file. |

There are no flags for a diff, a base, a branch, a file list or a test result: the range is re-derived
from Git and the contract, so none can disagree with it. Any other flag is a usage error
(`unknown engine review-candidate option`, exit 2).

### Environment and roster

- **`AUTOPILOT_LEVEL=l4`** (or `l5`, `l6`) builds the host's provider-readiness check, which probes the
  seats this run will use before any spend. The recorded runs used `l4`.
- **The review roster** comes from `scripts/resolve-review-loop.sh`, which is run **in the directory
  you pass as `--cwd`**, that is, in the repository under review (the engine and the host readiness
  check both spawn it with that directory as its working directory; see
  `src/readiness/provider-bootstrap.js` and `scripts/lib/resolve-config.sh`). The first readable file of
  these wins:
  1. `$REVIEW_LOOP_CONFIG_OVERRIDE`;
  2. `<--cwd repo>/.claude/review-loop-config.md`;
  3. the autopilot checkout's own `.claude/review-loop-config.md`, **only when the repository under
     review is that same autopilot checkout**. For any other repository this tier is skipped;
  4. the shipped
     [`project-config-template/review-loop-config.md`](../project-config-template/review-loop-config.md).

  So running the command from your autopilot checkout with `--cwd` pointing at another repository that
  has no `.claude/review-loop-config.md` uses the shipped template (panel `gpt-6.1-sol`/`codex`,
  `claude-opus`/`claude-native`, `gemini-4-argon-high`/`agy`), not your checkout's own config. Running
  `scripts/resolve-review-loop.sh` by hand gives a different answer depending on where you stand
  (tier 3 applies only when you stand in the autopilot checkout): to see what a run will use, `cd` into
  the repository under review first and read `source`, `config_path` and `qc_panel_seats` in its JSON.
  To choose your own panel, put a `review-loop-config.md` in `<repo>/.claude/`. **Commit it first**:
  an untracked or modified file in the repository fails the clean-tree check
  (`campaign_repo_precondition_failed`). Commit it **at the base commit or before it**, not inside the
  reviewed range: a config added between base and head is a changed path of the range, and unless
  `allowed_path_prefixes` covers `.claude/review-loop-config.md` the range is refused as
  `review_candidate_out_of_scope`. (Committing it on top of the head would move the branch tip and fail
  with `review_candidate_branch_moved`.) Alternatively keep it outside the repository and point
  `REVIEW_LOOP_CONFIG_OVERRIDE=/abs/path/review-loop-config.md` at it; that is the simplest route when you
  do not control the repository.
  Review-only reads `qc_panel` (with `qc_panel_runners`, `qc_panel_efforts`, `qc_panel_endpoints`
  aligned 1:1), `min_panel_size` and `required_review_families`. It does not require, and does not probe,
  the implementer or verification-author seats.
- **The panel must be complete.** The sealed panel needs at least `min_panel_size` seats with complete
  runner/effort/endpoint metadata, spanning at least two families when it has more than one seat. The
  declared `author_family` is excluded from that family count. A panel that cannot meet this is refused
  before spend (`review_candidate_panel_incomplete`).
- **Which runners may hold a `qc_panel` seat.** A `qc_panel` seat must be able to run a no-tools blind
  review. Allowed runners: `anthropic-compatible`, `cc-shim`, `claude-native`, `qoderclicn` (no-tools
  tier), and `codex`, `kimi`, `agy` (cleanroom tier, which is probed before spend). Any other runner,
  `grok` for example, is refused (`final_panel_seat_blind_incompatible`).
- **Each seat must also be qualified.** A seat passes only if it is the exact tuple (runner, model, effort,
  endpoint) of the current qualified `reviewer_*` seat, or its panel index is recorded in the roster's
  `override_admitted_seats` (a standing operator pin, written with
  `node scripts/engine-capability-state.js pin-seat --role qc_panel --engine <model> --runner <runner> --effort <effort> --endpoint <endpoint|@none> --reason <text> --operator <who>`),
  or the roster's `fallback_ladder` has a scorecard row with the same tuple. A custom seat that is none
  of these is refused (`final_panel_seat_unqualified`).
- **Endpoints.** A seat that names an `endpoint` (for example `glm`) needs credentials in
  `~/.autopilot/endpoints.env`, never in the repository. Set them up with:

  ```bash
  node bin/autopilot.js endpoints init
  printf '%s' "$TOKEN" | node bin/autopilot.js endpoints set glm --url <https url> --token-stdin
  node bin/autopilot.js endpoints doctor
  ```

  Seats on OAuth runners (`claude-native`, `codex`, `agy`, `grok`, `qoderclicn`) use their own CLI
  login and need nothing there. Full details: [installation.md](installation.md#heterogeneous-engine-credentials-optional--unlocks-the-strong-reviewimpl-roster).

## 5. Read the receipt

The command prints one JSON object on stdout. **Exit code 0 means ready; any other exit code means it
is not ready.** The fields to read:

| What you see | Meaning |
|---|---|
| `status: "converged"`, `phase: "campaign_terminal_ready"`, exit 0 | **Ready.** Zero findings, green verify, panel quorum met. |
| `status: "awaiting_disposition"`, exit 1 | **Parked, not ready.** The review found problems. Findings are in `campaign_receipt.findings`. Choose a disposition (section 6). The campaign is durable; nothing is lost by waiting. |
| `status: "blocked"` with a `code` | **Not ready.** The `code` names why (table below). |
| `dispatcher_called: false`, `model_calls: 0` on a refusal | Nothing was spent. |

Inspect the durable campaign state at any time (the id is in the output at `campaign_control.campaign_id`):

```bash
node bin/autopilot.js campaign inspect --campaign-id <campaign-v1-...> \
  --ledger <git-common-dir>/autopilot/implementation-campaign.jsonl
```

The ledger is `<git-common-dir>/autopilot/implementation-campaign.jsonl` of the repository under review.
`campaign inspect` prints `status: "found"` plus the whole projection. The **current** phase is
`state.phase`; `initial_state.phase` is the snapshot taken at intake and always reads `PREPARED`, so do
not read the campaign's progress from it. The current phase reads `TERMINAL_READY`, `AWAITING_DISPOSITION` or `TERMINAL_STOP`, or one of the in-flight
phases `VERTICAL_VERIFICATION`, `REVIEWING` or `ADJUDICATING` while a run is active or was interrupted. A closed review's
`terminal_reason` begins with the code and lists any unresolved findings.

### Other things you will see

- **stderr** carries `strict /l5 POLICY OVERRIDE ... reason: advisory_default` on every run whose
  `qc_panel` seats are not the frozen canonical policy roster. That is expected for any custom panel, and
  for the shipped template: it only records that those seats run without a capability claim
  (`src/readiness/provider-bootstrap.js`). It is not an error and does not change the verdict. A
  `strict /l5 policy note` line is the quieter variant for a certified subset.
- **`advisory_findings` and `ratchet_reverted_rounds`** appear in the result because the result formatter is
  shared with `implement-review`. `ratchet_reverted_rounds` counts reverted writer rounds, and review-only
  has no writer, so expect `0`. `advisory_findings` is filled only by the writer-loop convergence path, so
  do not read the review's findings from it: they are in `campaign_receipt.findings`, and a ready
  campaign has none.
- **Writes under `~/.autopilot`.** The run **does** write there. Before any review spend, the host's
  readiness check live-probes every seat it will use and appends one observation per probed seat to
  `~/.autopilot/engine-capability/capability.jsonl` (`src/readiness/probe.js`, `persistLiveObservation`,
  through `engine-capability-state.js record`). Each row is a capability event for that exact
  runner/model/role/effort/endpoint tuple: `capability.quota.status`, an evidence tag
  `provider_live_probe.minimal_no_effect.<outcome>`, and a `ttl_seconds`. It is written so the readiness
  receipt can bind a fresh, recorded observation of each seat (and so later `status` reads see it). The
  probed seats are the `qc_panel` seats **and the roster's `reviewer_*` seat** (for the template that is
  `gpt-6.1-sol`), so expect one row per probed seat per probe: four rows for a three-seat panel. Every run probes
  again: two runs seven minutes apart both appended a row for the same seat. `pins.jsonl` is only read, never
  changed. The same directory is also read for the scorecard, and `~/.autopilot/endpoints.env` is read for
  seats that name an endpoint. The campaign's own state is written next to the contract
  (`qc_panel_snapshot.json`) and under `<git-common-dir>/autopilot/` (the campaign ledger and any repair
  seed). To see exactly what a run added, count the lines of `~/.autopilot/engine-capability/capability.jsonl`
  (`wc -l`) before and after; do not use a whole-`~/.autopilot` `find`, other sessions write there too.

### Refusal and outcome codes

| Code | When | What to do |
|---|---|---|
| `review_candidate_contract_required` | No contract given | Pass `--campaign-contract`. |
| `campaign_contract_unreadable` | The contract path does not resolve | Use absolute paths. |
| `review_candidate_mode_mismatch` | The contract has no `adoption` section, or an adoption contract ran under `implement-review` | Seal an adoption contract and use `engine review-candidate`. |
| `campaign_repo_precondition_failed` | The repository under review has uncommitted or untracked files (or HEAD is not a 40-hex SHA-1 commit). The reason starts `dirty:` or `base:` | Commit or ignore the untracked files (`.gitignore`), and keep the contract, seal, spec and config outside the repository. |
| `review_candidate_head_missing` | The sealed head is not a commit in the repository | Fetch the commit, or seal a new contract with the right head (section 3, "You cannot reseal in place"). |
| `review_candidate_branch_moved` | The branch tip is no longer the reviewed head (at admission, or just before the first review) | Restore the tip, or seal a new contract with the new head (a fresh directory and a changed `ticket`; section 3). A move discovered just before review ends the campaign not-ready. |
| `review_candidate_empty_range` | The head equals the base | Nothing to review. |
| `review_candidate_base_not_ancestor` | The base is not an ancestor of the head | Seal a new contract with a base on the head's history (section 3). |
| `review_candidate_scope_unreadable` | The path scope could not be computed | Check the repository and the contract's prefixes. |
| `review_candidate_out_of_scope` | A changed path is outside `allowed_path_prefixes` | Widen the prefixes in a new sealed contract (section 3), or review a narrower range. |
| `review_candidate_file_cap` | More distinct files than `max_changed_files` | Raise the cap in a new sealed contract (section 3), or split the range. |
| `review_candidate_churn_ratio_trip`, `review_candidate_churn_absolute_trip` | Churn above budget | Warning in the receipt only; the review continues. (The exact suffix is the scope trip reason.) |
| `review_candidate_panel_incomplete` | The roster is incomplete, too small, or has too few families outside the declared author family | Fix `qc_panel` and its aligned metadata, or the declaration. |
| `review_candidate_panel_short` | A seat was lost mid-run and the panel fell below the sealed minimum | The campaign is terminal not-ready. Fix the seat and seal a new contract (section 3). |
| `final_panel_seat_blind_incompatible` | A `qc_panel` seat uses a runner that cannot run a no-tools blind review (for example `grok`) | Replace the seat with one on an allowed runner (section 4). |
| `final_panel_seat_cleanroom_unavailable` | A `codex`, `kimi` or `agy` seat failed its cleanroom probe | Fix that runner's install or login, or replace the seat. |
| `final_panel_seat_unqualified` | A seat is not the qualified reviewer tuple, not pinned, and has no scorecard row | Pin the seat or use a qualified one (section 4). |
| `review_candidate_governance_enforce` | Seal-time, governance is `enforce` | Use governance `off` or `shadow`. |
| `review_candidate_repair_reviewed_head_missing` | `repair`, but the reviewed head of the parked review could not be determined (a resume has no fallback to the sealed head) | The review stays parked. Use `end` or `return`. |
| `review_candidate_repair_head_mismatch` | `repair`, but the reviewed head is not the candidate the park itself stored | The review stays parked. Use `end` or `return`. |
| `review_candidate_repair_seed_base_mismatch` | The seeded contract's `base_sha` is not the reviewed head (a seed that is not a faithful repair of the reviewed range is refused; the other `review_candidate_repair_seed_*` codes mean the same family of failure) | The review stays parked. Use `end` or `return`. |
| `review_candidate_continuation_unknown` | `--campaign-continuation` is not `end`, `return` or `repair` | Use one of those. |
| `review_candidate_continuation_requires_resume` | `--campaign-continuation` without `--resume` | Add `--resume`. |
| `review_candidate_continuation_not_parked` | A continuation other than `end` on a campaign that is not parked | `return` and `repair` need the parked state. (`end` works on any non-terminal review-only campaign.) |
| `review_candidate_continuation_required` | Resumed a parked review with neither a flag nor a preset | Pass `--campaign-continuation end`, `return` or `repair`. |
| `review_candidate_return_no_new_head` | `return`, but the branch is still at the reviewed head | Push your fix first. |
| `review_candidate_return_not_descendant` | `return`, but the new tip does not descend from the reviewed head | Do not rewrite history; add commits on top of the reviewed head. |
| `review_candidate_resume_phase_unsupported` | A review interrupted between its verdict and the park (phase `ADJUDICATING`) cannot be resumed | Close it with `--resume --campaign-continuation end`, or seal a new contract (section 3) and run again. |
| `campaign_resume_required` | A campaign for this contract already exists and you ran without `--resume` | Add `--resume`, or seal a new contract (section 3) to start over. |
| `campaign_resume_not_found` | `--resume` but no campaign exists for this contract | Run without `--resume`. |
| `campaign_lease_live` | `--resume` (including `--campaign-continuation end`) while the previous run of this campaign still holds its lease: that process is alive | Wait for the previous process to finish, then resume. Check that it is really running before you assume it is stuck. |
| `campaign_lease_unknown` | `--resume`, and the previous lease's process cannot be verified: the pid cannot be probed (for example it belongs to another user or the process table is not visible) or its start time is unreadable | The code has no override flag. Resume as the same user and in the same environment as the original run, so the pid can be probed. If that is impossible, leave the campaign and seal a new contract (section 3). |
| `campaign_already_terminal` | `--resume` on a campaign that is already ready or stopped | It is finished. Seal a new contract (section 3) to review again. |
| `review_candidate_disposition_end` | You closed the review with `end` | Terminal not-ready; the unresolved findings are in `findings`. This is the expected result of `end`. |
| `review_candidate_end_not_terminalized` | `end` could not terminalize the campaign | Inspect with `campaign inspect`; report the reason. |
| `review_candidate_admission_missing` | A resume found no admitted adoption record | Seal a new contract (section 3) and run from the start. |
| `review_candidate_no_writer` | Internal: the writer adapter was reached | A bug; it fails closed with no spend. Report it. |

Any code not in this table, whether it starts with `review_candidate_` (for example
`review_candidate_recheck_failed`, `review_candidate_scope_session`, `review_candidate_adoption_journal`)
or comes from shared intake (for example a provider-readiness refusal when a seat is not live), is
reported with a `reason`: read `reason` first. A refusal at the `provider_readiness` phase comes in two shapes:

- The host could not even build its readiness check (for example an incomplete roster,
  `strict_l5_provider_roster_incomplete`). The object has `reason` and `rejection_code`.
- The check was built but a seat's live probe was not usable. The object has `phase: "provider_readiness"`,
  a generic `reason` and **no `rejection_code`**. Look at `provider_readiness_diagnostics`: one entry per
  probed seat with `seat_id` (`qc:1` is the first `qc_panel` entry, `qc:2` the second, and so on),
  `role`, `runner`, `model`, `required`, `status` and `reasons` (`axis`, `status`, `reason`). The broken
  seats are the ones whose `status` is not `usable`. When **every** seat shows
  `probe-needed` with `reason: transport_failure`, the probe itself could not reach any provider, so
  suspect something common to all of them (network, an expired login, a sandbox without the CLIs) before
  suspecting each seat. The machine code `strict_l5_provider_not_ready` appears only on the
  `strict_l5_provider_readiness` entry of the result's `ledger`.

Readiness runs first. The host builds and consumes the readiness receipt before campaign intake, and
`final_panel_seat_unqualified` (like the other `final_panel_seat_*` codes) is raised later, inside intake.
A roster with both a dead seat and an unpinned seat therefore reports the dead seat first; you see the
unqualified refusal only after every probed seat is usable. Without `AUTOPILOT_LEVEL` there is no readiness
check at all and intake is the first gate.

## 6. After a park: end, return, repair, preset

When the review finds problems it parks as `awaiting_disposition`. You decide what happens next, per
campaign or ahead of time with a preset. There are three choices.

### `end`: close it not-ready

```bash
AUTOPILOT_LEVEL=l4 node bin/autopilot.js engine review-candidate \
  --campaign-contract /abs/review/contract.json --campaign-seal /abs/review/contract.seal.json \
  --spec-file /abs/review/spec.md --cwd /abs/path/to/repo \
  --resume --campaign-continuation end
```

Terminal not-ready, no spend. The output is `status: "blocked"`, `code: "review_candidate_disposition_end"`,
and `findings` lists everything left unresolved. The range is not re-derived, so `end` works whatever the
branch looks like now.

### `return`: you fixed it, review again

Your own writer fixes the findings and adds commits to the same branch. The new tip must be a strict
descendant of the reviewed head. Then:

```bash
AUTOPILOT_LEVEL=l4 node bin/autopilot.js engine review-candidate \
  --campaign-contract /abs/review/contract.json --campaign-seal /abs/review/contract.seal.json \
  --spec-file /abs/review/spec.md --cwd /abs/path/to/repo \
  --resume --campaign-continuation return
```

The new head is re-derived from the branch and re-admitted (scope, file cap, ancestry). The campaign then
re-reviews the **cumulative** `base..new_head` diff in the same campaign: seats review the whole
range again, not just your fix. A reviewer's earlier pass is reused only when its input is byte-identical,
and a new head changes every input, so expect a full review spend per `return`. There is no stale pass:
nothing reviewed an older head counts for the new one. A cheaper delta re-review is a tracked follow-up
(BL-0146). The wall budget (`max_wall_seconds`) is shared by every `return` of the campaign.

**Known limitation: a fix that shrinks the range can be refused.** The campaign records the cumulative
count of changed files, and that count may not decrease. If your fix reverts a whole file to its `base`
content, so that `base..new_head` touches fewer files than before, the `return` is refused with
`BUDGET_RESET` (`event.usage.changed_files cannot decrease`). A `return` is therefore not guaranteed to
succeed. Workaround: keep every file that differs in the reviewed range still differing from `base`
(change it rather than revert it), or `end` this campaign and seal a new contract for the fixed head
(section 3). This is a known defect in the engine, not in your branch.

A head that is not a descendant (for example after a force-push) is refused
(`review_candidate_return_not_descendant`) before any review call. The campaign stays parked, so you can
fix the branch and try again.

The contract's `adoption.head_sha` stays at the originally sealed head; the campaign records each adopted
head in its ledger. `--resume` also continues an interrupted review that never parked (the range is
re-derived first, and seats that already reviewed are not asked again).

### Presets

`adoption.disposition_preset` in the sealed contract applies a choice when you give no flag:

- `end`: a review that parks on findings closes itself in the same invocation. One command, terminal
  not-ready, findings listed. Use it when no human is available to choose.
- `repair`: like `end`, the review closes itself at the first park, and the result carries the
  `repair_handoff` described below. Use it for an unattended caller that wants a writer round.
- `return`: the review still parks. A later `--resume` with no `--campaign-continuation` applies `return`.
  On a review that is parked and not yet closed, a `--campaign-continuation` flag wins over the preset.
  (A preset of `end` or `repair` closes at the first park, so there is nothing left for a flag to
  override; to choose another exit after all, seal without a preset, or one set to `return`.)

### `repair`: hand the findings to a writer

A review-only campaign never writes. Choosing `repair` (`--campaign-continuation repair`, or a sealed
`adoption.disposition_preset: "repair"` for an unattended caller) authorizes **a repair campaign**. It does
not mean you accept every finding: the findings stay the reviewers' claims.

```bash
AUTOPILOT_LEVEL=l4 node bin/autopilot.js engine review-candidate \
  --campaign-contract /abs/review/contract.json --campaign-seal /abs/review/contract.seal.json \
  --spec-file /abs/review/spec.md --cwd /abs/path/to/repo \
  --resume --campaign-continuation repair
```

What happens:

1. The review-only campaign closes **not-ready**, which is honest because the range did not pass, and the
   findings are listed. No model call is made while closing, and the range is not re-derived. The output
   is `status: "blocked"`, `phase: "review_candidate_repair"`,
   `code: "review_candidate_disposition_repair"`.
2. The result carries `repair_handoff`, and the same files are written under
   `<git-common-dir>/autopilot/review-candidate-repair/<campaign-id>/`: `contract.json` and `task.md`
   (if the write fails, `repair_handoff.write_error` says why and the inline copy in the result is the
   only one). The seed is built and checked **before** the campaign closes: its base must be the head
   that was reviewed, cross-checked against the candidate stored when the review parked. If that cannot
   be established, `repair` is refused (`review_candidate_repair_reviewed_head_missing` or
   `review_candidate_repair_head_mismatch`) and the review stays parked, so you can still `end` or
   `return`.
3. `contract.json` is a normal, unsealed `implement-review` contract with no `adoption` section.
   `base_sha` is the reviewed head (the latest head if you used `return` earlier), `branch` is
   `repair/<ticket>-repair`, and paths, verify command, acceptance and caps are copied from your adoption
   contract. `max_repair_generations` is `min(2, profile ceiling)`. Edit the draft first if you want
   different bounds.
4. `task.md` lists the findings as reviewer claims. The writer must verify each one against the code, fix
   only those that hold, and list every finding it judges not to hold, with the reason, in its delivery.
   Seal the contract with `scripts/implementation-campaign-check.js seal` (section 3), then run
   `implement-review` (below) with `task.md` as the prompt.

The next step, to copy. Take `<base_sha>` and `<branch>` from `repair_handoff.base_sha` and
`repair_handoff.branch` (they equal `contract.json`'s `base_sha` and `branch`), and the paths from
`repair_handoff.contract_path` and `repair_handoff.task_path`. Seal first, outside the repository
(`--out` is the seal file; `<mode>` is the project's mission mode, as in section 3), then run:

```bash
node scripts/implementation-campaign-check.js seal --contract /abs/repair/contract.json \
  --repo /abs/path/to/repo --mission-mode <mode> --out /abs/repair/contract.seal.json

AUTOPILOT_LEVEL=l4 node bin/autopilot.js engine implement-review \
  --campaign-contract /abs/repair/contract.json --campaign-seal /abs/repair/contract.seal.json \
  --prompt-file /abs/repair/task.md --branch <branch> --base <base_sha> --cwd /abs/path/to/repo
```

`--prompt-file`, `--branch` and `--base` are all required (a missing one is a usage error), and
`--branch` and `--base` must equal the sealed contract's `branch` and `base_sha`, otherwise the run is
refused as `campaign_binding_mismatch`. The roster for this step must have an implementer seat:
`implementer_runner`, `implementer_engine` and `implementer_effort` must all be set. The review-only roster
of section 4 is not enough.

Cost: one writer run plus that campaign's own review. Seat verdicts are not reused across campaigns: the
new campaign's panel reviews `reviewed_head..new_head` from scratch.

Refusals: `repair` on a review that is not parked is refused (`review_candidate_continuation_not_parked`),
and so is `repair` without `--resume` (`review_candidate_continuation_requires_resume`).

**A second repair of the same ticket gets a new branch name.** The first seeded branch is
`repair/<ticket>-repair`. If that branch already exists in the repository, the next seed uses
`repair/<ticket>-repair-r2`, then `-r3`, and so on (the smallest unused number), so an earlier repair's branch
is never overwritten. Only branches that exist are counted: a seed whose branch you never created keeps its name.

### Findings you want to adjudicate

`--campaign-disposition-authority <file>` supplies per-finding decisions authored by depth-0 (exact keys:
`schema_version`, `artifact_type: "campaign_disposition_authority"`, `authority: "depth-0"`, `actor_id`,
`campaign_id`, `contract_digest`, `reviews[{review_digest, decisions[]}]`). It is bound to one campaign,
contract and review digest, so a file for another run or another review is refused as stale. If must-fix
findings remain after it, the campaign ends not-ready at the zero-repair ceiling with the findings listed.
Most operators never need this; `end`, `return` and `repair` are the normal exits.

## 7. Common problems

| Symptom | Likely cause and fix |
|---|---|
| `campaign_contract_unreadable` right away | Relative paths. They resolve against `--cwd`. Use absolute paths. |
| Seal says `repo_identity: does not match canonical repository identity` | The identity must be `git-common-dir:` plus the real path of the git common directory (not the worktree path, not a symlink). Use the script in section 3. |
| Seal says `--mission-mode X does not match authoritative project mode Y` | Pass the repository's actual governance mode; with no governance file it is `off`. |
| Seal says `adoption: max_repair_generations must be 0` or `... must be absent` | Remove `strict_dispatch`, `unit_class`, `mission_runtime`; set `max_repair_generations` to 0. |
| Seal says `verify_cmd: expected bounded space-delimited argv ...` | No quotes, pipes, redirects or `;` in `verify_cmd`. Move logic into a repository script. |
| `review_candidate_branch_moved` on a rerun | You added commits after sealing. Either seal a new contract with the new head (new directory, changed `ticket`), or (on a parked review) use `return`. |
| Sealing again fails with `seal target already exists`, or the rerun fails with `qc_panel_snapshot_identity_invalid` | A seal and a `qc_panel_snapshot.json` already sit in that directory. Use a new directory, or delete both files, and change the contract (for example the `ticket`). See section 3. |
| `campaign_repo_precondition_failed` with `dirty:` | The repository has uncommitted or untracked files. Commit or ignore them, and keep the contract, seal, spec and any review-loop config outside the repository (or committed). |
| `final_panel_seat_*` refusals | A `qc_panel` seat is on a runner that cannot do a blind review, or is not qualified. See section 4. |
| `return` refused with `BUDGET_RESET` | Your fix shrank the changed-file count. See the known limitation in section 6. |
| `blocked`, `phase: "provider_readiness"` | A seat in your roster is not live or not logged in. Read `provider_readiness_diagnostics` (section 5): the seats whose `status` is not `usable` are the broken ones. Then `node bin/autopilot.js endpoints doctor`, check the seat's CLI login, or change the panel. |
| `final_panel_seat_unqualified` on the first run | Template or custom seats have no operator admission yet. Pin them (section 4, "Before the first run"). |
| Roster refused as incomplete | `qc_panel`, `qc_panel_runners`, `qc_panel_efforts`, `qc_panel_endpoints` must have the same length. |
| Verify is red but passes on your machine | Verification runs in a detached worktree at the head commit. Files that are untracked or uncommitted in your checkout are not there. Commit what the command needs. |
| `--resume` refused | `campaign_resume_not_found` (nothing to resume), `campaign_already_terminal` (finished; seal a new contract), or `review_candidate_resume_phase_unsupported` (close it with `--campaign-continuation end`). See the code table in section 5. |
| Nothing printed on stdout | Check stderr and the exit code; usage errors print to stderr with exit 2. |

Residue: a review creates no branch of its own and removes its temporary worktrees at the terminal
state. A parked review keeps its panel working files until it is resumed or closed. The engine also
leaves `qc_panel_snapshot.json` in the contract's directory (it is how a rerun detects a changed
contract); delete it together with the seal when you start over.
