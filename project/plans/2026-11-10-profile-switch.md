# Plan — Claude login profile switching (move a lane to the subscription that has room)

> Status: r2 (g2 blockers folded; PM adjudicates at the cap) · Owner: autopilot lane · Branch: docs/profileswitch · Frame: PM dispatch 01M70B0J4C · Rubric: `2026-11-10-profile-switch.rubric.md` · Manifest: `2026-11-10-profile-switch.plan-review-manifest.json`

## 0. Context / thesis

Operator direction: "whoever has room gets the work". Normal assignment follows the OS account (team logs in to stranity, lead to cookys). When one pool nears its limit a lane moves to a login profile that still has room, and moves back after the reset. The operator logs in once per profile.

What the repo already has (reuse, do not duplicate):

- G37 aliases are **token-based** (`CLAUDE_CODE_OAUTH_TOKEN`, built in `scripts/lib/account-env.js:92-95`) for headless rails. They do not cover interactive lanes, and `docs/guide/accounts.md:7` pins one default alias per rail call. This plan is the **login-file** path for lanes and leaves G37 untouched.
- A profile convention exists: `~/.claude-profiles/<name>/` is a `CLAUDE_CONFIG_DIR` (`scripts/profile-health.js:9-10`, `docs/guide/accounts.md:171,181`).
- `scripts/lane-reopen.js` opens a new tmux window under a registry alias (`:3-9`), injectable deps, `--dry-run` (`:50-70`); it does not stop the old lane.
- `scripts/accept-dev-channel-prompt.sh` answers the dev-channel dialog, exit 1 on a folder-trust or login screen (`:3-18`).
- Alias attribution (`scripts/lib/account-alias.js:5-14`): tier 1 `AUTOPILOT_ACCOUNT`; tier 2 `acct-<sha8(orgUuid\nemail)>` from `<CLAUDE_CONFIG_DIR>/.claude.json`; tier 3 hash of the config dir realpath. Consumers: `hooks/cost-tracker.js:159`, `scripts/lib/dispatch-usage.js:51-71`.
- Quota readings: `scripts/lib/account-quota.js:8-9,23` (snapshot per alias, window `resets_at`, older than 6 h dropped, `TIGHT_THRESHOLD = 0.90`); ordering in `scripts/lib/account-pick.js:24-26`.
- The unregistered-rail fallback seeds credentials from `CLAUDE_CONFIG_DIR` (`scripts/lib/seed-claude-config.js:7-9`), so headless children of a lane follow the lane's profile with no change.

Design consequence that drives the layout (S3 answers, fleet 01M70BPCXB, codeforge 01M70BQ2XN): alias is recomputed per process from `<CLAUDE_CONFIG_DIR>/.claude.json`; codeforge's root is `sha8(canonicalize(config_dir))` (`alias.rs:33-34,277-293`) and its collector walks only real directories, skipping paths that canonicalize outside the root (`collect.rs:67,93-94,731-733`). So the profile dir, `.claude.json`, `metrics/` and `projects/` are real per-profile entries, never symlinks (a linked `metrics/` makes two profiles read one `costs.jsonl` and double-count). `.claude.json` also holds user-scope MCP (fleet) and folder trust (`docs/guide/accounts.md:187`): S2, S4.
Known gap: `hooks/cost-tracker.js:92` and `hooks/cost-fuse.js:285` hardcode `os.homedir()/.claude/metrics`, so a profile session writes 0 rows and everything lands on the home alias (fleet 01M70BRSQ3). Fixed in P1, before the S3 verdict.

## 1. Problem

Move a running lane between subscriptions without losing its session, with no operator action after the one-time logins, and without misattributing spend in the usage ledger. The PM decides every move in v1.

## 2. OKR / KRs

- KR1 (S3): written answers (received) plus one live check show attribution stays correct with several profiles on one OS account; S3 stays open until its live checks for fleet cases A and B (below) pass against fleet `feat/usage-rollup-writer` 82865643.
- KR2: `profile-link.js apply` builds a profile whose linked entries are exactly the allow-list; `rollback` restores the pre-apply state (links, manifest, created dirs) compared by content and link target; real `~/.claude` is never opened for write, `.credentials.json` is never opened, and `.claude.json` is read only by the alias resolver (tests assert all three).
- KR3: `lane-switch --lane L --profile P` on a live test lane: same fleet address (no `-2` seat), same session id, `claude auth status` shows the target profile, the alias computed for the target dir is the target's, the next cost row confirms it, and `codeforge usage --by account` shows the pre-switch part under the old account; the reverse switch (including home -> P -> home) restores the original.
- KR4: advice emitter fires on a fixture with 7-day use at 0.90 and on a burn-rate fixture, stays silent on a fixture with no usable reading, and never switches anything.
- KR5: one login checklist generated for every host × OS account × profile, each step starting with host and OS account; first batch (2 hosts) done by 11-14 so a live move is possible before the 11-15 reset.

## 2.5 Global Constraints (copy unchanged into every implementer and reviewer brief)

1. Never read, print, copy, write or relink real `~/.claude/settings.json`, hooks, `.credentials.json` or any `~/.claude-profiles/*/.credentials.json`; `~/.claude.json` is never written, copied or printed (only constraint 3's resolver reads it). Links are created only inside `~/.claude-profiles/<profile>/` and point at targets; targets are never opened for write.
2. Login is typed by the operator in a browser flow. No tool runs `claude auth login` or `setup-token`; no credential appears in argv, a log, a journal, a message or a test fixture.
3. `.claude.json` and `.credentials.json` are never linked, copied, snapshotted, written or exposed (content, path-to-content or hash included). `.credentials.json` is opened by no new tool. The one permitted read: the existing resolver `scripts/lib/account-alias.js` (`claudeAccount()`, which calls `identityTier()`) reads `<CLAUDE_CONFIG_DIR>/.claude.json`, or `~/.claude.json` for the native home profile, solely to derive the account hash; new tools call that function and never open the file themselves.
4. v1 tools never perform a destructive step: they refuse to replace a non-symlink, relink, or remove any profile dir (no `--adopt`; automated rollback keeps empty profile dirs, removing one is a manual step with the snapshot, blast radius, printed recovery command and operator confirmation below). The refusal and the manual dir removal print the operator's procedure: snapshot of the non-login entries only, blast radius, rollback command, and the operator's own confirmation. The only snapshot a tool writes is link metadata (`lstat` type and link target of entries apply touches, no content, no login files).
5. No automatic switching. `lane-switch` executes only with `--order <fleet message id>` from the PM and writes it to the journal. Triggers recommend, the PM orders.
6. A lane's fleet address, session id and cwd are identical before and after a switch; the tool captures them before, re-reads them after, and reverses on mismatch (P2).
10. One subscription is logged in at most once per OS account (two dirs, one subscription overwrite each other: fleet case B). Cross-OS-account totals of one subscription are summed by the reader, not by this plan.
7. Node >= 20.10, built-ins only; bash only for tmux glue. Every new check ships a negative control shown red before green.
8. ADR-0001: verification is re-derivation (run `claude auth status`, read the cost row), never an attestation file. No hosted CI. `rm` targets are literal paths. Operator-facing text is Traditional Chinese, times Taipei.
9. Read `scripts/CLAUDE.md` first; wire every new script into its name list, `docs/scripts-inventory.md` and `docs/guide/accounts.md`.

## 2.6 Change-policy decisions

- **Compatibility impact**: `published-compatible`. Additive scripts and one guide section; the `~/.claude-profiles/` convention and `profile-health.js` are unchanged; G37 registry and rails untouched.
- **Dependency decision**: `platform/stdlib`. Symlinks via `fs`, tmux via the existing injectable `spawnSync` pattern.

## 3. File-structure map

- `scripts/profile-link.js` (new): `apply|status|rollback --profile <sub>`; allow-list of shared entries; manifest `~/.claude-profiles/<sub>/.profile-links.json` is the transaction record: per run `{run_id, dir_created, links_added[name->target], metadata snapshot}`, no secrets.
- `scripts/lane-switch.js` (new): the switch; reuses `shq`/tmux injection style of `lane-reopen.js:25,50-70`, `DROP_ENV` list of `profile-health.js:32`, `accept-dev-channel-prompt.sh` as a child; never sets `CODEFORGE_DATA_DIR`.
- `scripts/lib/lane-manifest.js` (new): lane record `{lane, tmux pane, cwd, fleet seat, session id, model, launch flags (never prompt text), profile}` from the shape in `docs/guide/accounts.md:173-185`; file `~/.config/autopilot/lanes/<lane>.json`, mode 0600, no secrets.
- `scripts/lib/switch-journal.js` (new, on `lib/jsonl-store.js` `withWriteLock:139` + `appendRow:148`, exported `:240-253`): one JSONL row per step with order id, before/after profile, outcome.
- `scripts/profile-switch-advice.js` (new): readings in, recommendation text out; reads `account-quota.js` and appends each reading to `~/.config/autopilot/quota-readings.jsonl` (via `jsonl-store.js appendRow:148`, for slope); never calls `lane-switch`.
- `hooks/cost-tracker.js`, `hooks/cost-fuse.js` (edit, P1): metrics dir from `CLAUDE_CONFIG_DIR`.
- `scripts/login-checklist.js` (new): prints the operator checklist from a host list; message form follows `profile-health.js:78-92`.
- `docs/guide/accounts.md` (edit): section "Switching a lane between subscriptions" + link table + rollback; `scripts/CLAUDE.md`, `docs/scripts-inventory.md` (name list rows).
- Tests beside each script (`*.test.js`), negative controls in section 5.

## 4. Phases (execution units: P0, P1, P2, P3, P4; P5 is closeout inside P4)

### P0 — spikes (S, ~0.5 day, all parallel, no code shipped)

- **S1 resume across config dirs** (S): on a throwaway profile pair with test logins (not production sessions), does `CLAUDE_CONFIG_DIR=B claude --resume <sid>` show the same history when the transcript (and its `subagents/` dir) was copied from A's `projects/<cwd>/` to B's same project dir? Also: how to read the resumed session id and the pane cwd for the P2 after-check. Fail = the switch design returns to review.
- **S2 entries Claude reads and writes in a config dir** (S): run a real claude with a throwaway profile, list what appears (`find` on that dir only); decide the allow-list. Questions: is the login file `.credentials.json` on Linux and elsewhere on macOS (keychain?); does `auth login` write `oauthAccount` into `<dir>/.claude.json`; which entries are safe to share concurrently by two profiles.
- **S3 attribution check (S)**. Answers received in writing (fleet 01M70BPCXB, 01M70BRSQ3; codeforge 01M70BQ2XN, 01M70BSR33, 01M70BT350, 01M70BTG3Q), folded into section 0 and P2. The behaviours at fleet 32a6426d and codeforge 28d3632 stay **unverified** until the live check passes.
  - Fleet: usage-rollup keys on `<CLAUDE_CONFIG_DIR>/metrics/costs.jsonl` and `cfg-<sha8(configDir)>`; alias from `<configDir>/.claude.json oauthAccount`. Known, pending a fleet sha: case A (same dir, `/login` as another account rewrites history to the new alias) and case B (two dirs, one account overwrite each other). Cross-OS-account totals: one `usage-rollup-acct-X.json` per courier, summed by the reader (fleet U3 note).
  - Codeforge: dedup key `requestId` (`collect.rs:169-176,299-302`; `store.rs:165-169`), account belongs to the first root that saw the id (`collect.rs:396-412`); same `usage.db` required (`store.rs:14-26`).
  - Fleet basis: `feat/usage-rollup-writer` 82865643 (pushed, not merged; fleet 01M70C6CYK). Live questions, each with an assertion, all on identity-tier aliases (`identityTier()` in `scripts/lib/account-alias.js`, from `oauthAccount`; the resolver does not export the tier, so a result counts as identity-tier only when it differs from `acct-<sha8(realpath(config dir))>` of `configDirTier()`):
    - **Case A** (one dir, `/login` as another account): rows written before the change keep the old alias, rows after carry the new one; no old row is rewritten.
    - **Case B** (two dirs, one account): both dirs resolve to one alias, rows from both merge under it, neither dir's rows overwrite the other's.
    - **Two subscriptions** (two profiles, two sessions): rows with two distinct identity-tier `account` values, and `codeforge usage --by account` agrees.
  - Pass = P1 cost fix merged and the three checks above pass against 82865643. **Negative control, shown red first**: two profiles without `oauthAccount` get distinct directory-derived aliases (`configDirTier()`); the check must reject them as evidence of two subscriptions. Fail or not yet run = P2 and P3 stay blocked; plan returns to review.
- **S4 trust and channel state** (S): after `apply`, does a new profile show the folder-trust dialog or the fleet MCP absence? `accept-dev-channel-prompt.sh` exits non-zero on folder trust (`:13-16`). Decide how both are handled **without any operator typing beyond login and status**: fleet MCP via `--mcp-config <shared file>` in the manifest launch flags (`docs/guide/accounts.md:187`); trust by a tool-run first start per (profile, cwd) in P2 or a claude flag, found by the spike. If trust cannot be handled without the operator, the plan returns to review.
- **S5 readings exist** (S): do 7-day readings exist per profile for the profiles a lane could move to (statusline snapshots only appear after an interactive session used that profile, `account-quota.js:9`)? Decides whether P3 is live by 11-15.
- Results go under `docs/plans/evidence/2026-11-10-profile-switch/`; a failed spike stops the dependent phase.

### P1 — profile mechanism and cost-path fix (M, ~1.5 days, after S1/S2)

1. **Cost path (first)**: `cost-tracker.js:92` and `cost-fuse.js:285` use `$CLAUDE_CONFIG_DIR/metrics` (`~/.claude` when unset; `AUTOPILOT_COSTS_FILE` still wins). Red/green tests: with `CLAUDE_CONFIG_DIR` set, rows and cursors land under it; unset, under `~/.claude/metrics`; fuse reads the same file.
2. `profile-link.js`. Link table per profile `~/.claude-profiles/<sub>/` (a real directory): links to `~/.claude/{settings.json,CLAUDE.md,skills,hooks,plugins,agents,commands}` for entries that exist (final list from S2); **real per-profile, never links**: `.credentials.json`, `.claude.json`, `metrics/`, `projects/`, everything session-private. `apply` creates only missing links (and the profile dir if absent, recorded), refuses an existing non-link (constraint 4), appends a run to the manifest. `status` prints each link, target and whether it resolves. `rollback` undoes runs newest first: unlink exactly the run's links (lstat symlink and target equal to the record, else skip and report), never delete a profile dir (an empty one stays), drop the run; targets stay. Acceptance: tests in section 5 green; `apply` then `rollback` on a fixture home (empty, partly linked, with a prior manifest) leaves a tree equal in content and link targets.
Home (`~/.claude`) is the native profile of each OS account: no dir, no relogin (Q1).

### P2 — lane-switch (L, ~1.5 days, after P1 and S1/S3/S4)

`lane-switch --lane L --profile P --order <id> [--dry-run]`:
1. **Before** (journal each): fleet seat live; session id (from the handoff reply, confirmed by the transcript file `<current dir>/projects/<cwd>/<sid>.jsonl`) and pane cwd recorded into the manifest; `claude auth status --json` of the current profile (loggedIn and alias via `account-alias.js`, never e-mail); the latest cost-row `account` of that session; target logged in and not `expiring` (`profile-health.js:62`, `days_left <= THRESHOLD_DAYS`).
2. **Handoff**: ask the lane over fleet for `autopilot:handoff`; proceed only when a handoff file newer than the request exists and the lane is idle.
3. **Stop** the old claude (`/exit`), wait until the pane's foreground command is the shell; the old session must release its fleet seat (otherwise a `-2` seat, `docs/guide/accounts.md:186`).
4. `CLAUDE_CONFIG_DIR=<old> codeforge usage collect > /dev/null` (no `--quiet`: it waits for the lock, `cli/usage.rs:62-63,236`), then **copy, not move**, the session transcript and its `subagents/` dir into the new profile's same project dir (dedup by requestId makes copies add 0). Never set `CODEFORGE_DATA_DIR`.
5. **Start** in the same pane: env scrubbed of `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `AUTOPILOT_ACCOUNT` (tier 1 would defeat attribution), `CLAUDE_CONFIG_DIR=<P dir>` (unset for home), then `claude --resume <sid> <manifest launch flags>`.
6. `accept-dev-channel-prompt.sh --pane <pane> --timeout 90`. On exit 1 (including a folder-trust or login screen, `:13-16`) the new claude is still running in the pane: send `/exit`, then C-c, wait for the shell, then run the reverse start on the original profile.
7. **After (immediate)**: same fleet address, same pane cwd, same session id, `claude auth status` of P logged in, and the alias computed for P's dir by `account-alias.js` differs from the old one and equals the one recorded at first login. Any real mismatch = reverse switch and a failure report to the PM. The cost row does not exist yet (the Stop hook writes it after a turn, `hooks/cost-tracker.js:158`; resolved per Stop, `account-alias.js:57`), so its absence never reverses.
8. **Confirmation (later)**: poll for the first cost row of the session after the switch, bounded 30 min after the next turn; its `account` must equal P's alias, else report to the PM. Then `codeforge usage --by account` shows the pre-switch part under the old account.
Rollback is the same command with the original profile. Acceptance: KR3 on a test lane, `--dry-run` prints the exact commands.

### P3 — advice emitter (M, ~1 day, after S3 and S5; parallel with P2)

`profile-switch-advice.js`: per pool (subscription): recommend **move out** when 7-day used >= 0.90 (the existing `TIGHT_THRESHOLD`) or when a linear projection over >= 2 readings **in the current window**, at least 1 h apart (history in `quota-readings.jsonl`, since `account-quota.js` keeps one snapshot and drops one older than 6 h), with the latest reading younger than 6 h, reaches 1.0 before `resets_at`; pick the target with 7-day used < 0.70 and a reading younger than 6 h; recommend **move back** when the origin window has reset. Max one recommendation per lane per 24 h. No usable reading emits nothing (silence is not "ok", `account-quota.js:11`). Output is a fleet message to the PM, first line `[建議]`: lane, from, to, numbers and the exact `lane-switch` command; it never runs it.

### P4 — login checklist and closeout (S, ~0.5 day, after P1; parallel with P2)

`login-checklist.js --hosts <file>` prints, per host × OS account × profile, steps that each begin "在 <host>、OS 帳號 <user>：" (open a terminal; type `CLAUDE_CONFIG_DIR="$HOME/.claude-profiles/<sub>" claude auth login --claudeai`; sign in with the <sub> subscription in the browser; type `... claude auth status --text`; nothing else, no per-cwd step). Host list from the PM (Q3). Then wire docs and name lists, run `profile-health.js check` on every host. Acceptance: checklist for 2 hosts, reviewed by the PM; docs gates green.

### Schedule (dates Taipei; today 11-09)

11-10 plan review and S1-S5; 11-11 P1; 11-12 operator logs in on the first 2 hosts (needs P1); 11-12..13 P2 against a test lane, P3, P4; 11-14 first PM-ordered live move and its reverse; 11-15 reset. S3 verdict waits for the P1 cost fix and the fleet sha. If P2 is late, ship its `--dry-run` command printer first as P2a, or run the manual steps of `docs/guide/accounts.md` by hand.
Dependency order: S3 gates P2 and P3; S1/S2 gate P1; P1 gates the logins; P2 and P3 are independent.

## 5. Test / validation

Script-gated unless marked human. Each negative control is shown red before green.

- `cost-tracker`/`cost-fuse`: tests of P1 item 1; negative control: the old hardcoded path fails the `CLAUDE_CONFIG_DIR` test.
- `profile-link`: fixture home; `apply` makes the expected links; `rollback` returns an equal tree (content and link targets) for: empty home, partly linked, prior manifest, dir created by apply. **Negative controls**: a non-link `settings.json` present -> refused, untouched; `--adopt` -> usage error; a link list including `.claude.json` or `.credentials.json` -> refused; both login files seeded with sentinel content stay byte-identical and an fs spy sees no open of `.credentials.json` at all, no open of any `.claude.json` by new code (only reads made through `account-alias.js`, including for the home profile, are allowed, and none is written, copied or printed), and no `open(..., 'w')` on a target; a link retargeted after apply is skipped and reported by rollback; rollback after an apply that created the dir leaves the empty dir in place (an fs spy sees no `rmdir`/`rm` on any profile dir), and the pre-state restoration test compares link entries and manifest, with the dir allowed to remain empty.
- `lane-switch` with fake tmux, fake `claude`, fake fleet: success path; each step failing (handoff stale, pane never reaches shell, dev-channel not seen, stuck folder-trust screen, wrong alias, wrong session id, wrong cwd) triggers the reverse start. Scripted A -> B -> A and home -> P -> home restore the exact pre-state (manifest profile, pane command, env). Cost row absent after the switch does not reverse. **Negative controls**: no `--order` -> exit 2, nothing spawned; token env var or `AUTOPILOT_ACCOUNT` set in caller -> absent in child env; `CODEFORGE_DATA_DIR` never in child env; fake resume returning another session id or cwd -> reversed.
- `lane-manifest.js`: a prompt-text field or file mode other than 0600 -> rejected. `switch-journal.js`: a raw e-mail or token-shaped value -> rejected, not written.
- Advice: fixtures at 0.89 (silent), 0.90 (fires), burn-rate crossing with 2 readings 1 h apart in-window (fires), readings 30 min apart (silent), one reading (silent), stale latest reading (silent), reset passed (move back). **Negative control**: a build that calls `lane-switch` fails the "never executes" test (spawn spy).
- Attribution (human + script): after S3, two real profiles on the test host, two sessions; `codeforge usage --by account` and the `account` field of cost rows (`cost-digest.js` has no per-account view, `:10,76`) show two identity-tier aliases (the S3 checks for cases A and B included); the same lane before and after a switch shows two aliases. **Negative control**: directory-derived aliases of profiles lacking `oauthAccount` are rejected as evidence of two subscriptions.
- Checklist: every step starts with a host and OS account and contains only the login and status commands; a host missing from the input is reported, not skipped. **Negative controls**: a step carrying a cwd/trust instruction fails; a missing host is not skipped.
- Live (human, PM-ordered): one real lane out and back, fleet address unchanged, alias changed then restored. **Negative control**: a switch that leaves the old alias must fail and reverse.

## 6. Risks + inversion

What guarantees failure: a linked `.claude.json` (merged aliases); a switch that leaves the old claude holding the fleet seat; a folder-trust dialog nobody answers; moving a lane on a stale reading; relinking over a live profile.
- Two profiles of one OS account share linked `settings.json` or `plugins` concurrently: same exposure as two sessions today; S2 lists what is unsafe to share and it stays unshared.
- `--resume` may not find the copied transcript under another config dir: S1; there is no shared-`projects/` fallback (a symlinked `projects/` breaks the collector and attribution).
- Two logins of one subscription in one OS account overwrite each other (case B): constraint 10; S3 case B check against fleet 82865643.
- macOS may keep logins in the keychain, not a file (S2); the checklist is unchanged, the link allow-list may change.

## 7. Out of scope

Automatic switching; changing G37 registry, rails or tokens; subagent attribution (subagents share the parent's profile); touching the real `~/.claude` settings or hooks; creating subscriptions; any hosted service; more than the PM-ordered path.

## 8. Open questions (recommendation first)

1. Is the OS account's native login (`~/.claude`) the "home" profile with no new dir? **Recommend yes**: fewest logins (only the other subscriptions), `~/.claude` untouched; the brief's "one profile per subscription" is satisfied by the manifest mapping subscription -> dir.
2. Lane manifest location: **recommend** `~/.config/autopilot/lanes/<lane>.json` (per OS account, 0600, no secrets), created by the PM/lane at first registration.
3. Host and OS-account list for the checklist: not in the repo. **Recommend** the PM supplies it from `fleet directory` (one line per host/account) in P4.
4. Can `lane-switch` verify that `--order` came from `cookys/<host>/pm--claude`? **Recommend** v1 records the id and checks the message through the fleet tool at run time if the CLI supports it (unverified); otherwise the PM runs the command itself.
5. If S3 shows rollup keys on session id and not config dir: **recommend** stop and ask the fleet lane to add a profile key before any live move.
6. Pools beyond stranity and cookys? **Recommend** the generator takes subscription names as input; no hardcoded pool list.

## Review log

- R0 author. g1 (3 seats): 9 blocking and 4 non-blocking findings, all accepted.
- R1: g1 dispositions (snapshot and adopt policy, rollback transaction, S3/P3 gating, P2 after-check and stuck-screen exit, burn-rate history, checklist scope, citations and negative controls, S3 size tag, P2a fallback) plus S3 answers (fleet 01M70BPCXB, 01M70BRSQ3; codeforge 01M70BQ2XN, 01M70BSR33, 01M70BT350, 01M70BTG3Q): real per-profile entries, cost-path fix in P1, copy-based transcript move, `--by account` acceptance. Evidence: `evidence/2026-11-10-profile-switch/`.
- R2 (this file): g2 at the cap (sol CONDITIONAL with 3 blockers, argon READY, grok READY); blockers accepted and folded by depth-0 as their repair fields say, PM adjudicates. 9ac4076fd4: S3 live checks for fleet cases A and B on identity-tier aliases (fleet basis 82865643), negative control rewritten. 560fb6c2d0: constraints 1 and 3 allow the alias resolver's `.claude.json` read only. 170af2d44c: rollback keeps empty profile dirs. Evidence: `plan-review-g2.json`, `dispositions-g2.json`, `plan.as-reviewed-g2.md`.
