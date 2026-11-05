# Claude accounts: aliases and automatic switching

> Part of [Autopilot](../../README.md). Settings are in [settings-reference.md](settings-reference.md#claude-accounts-g37); the rail-level behaviour (exit codes, fail closed) is in [references/hetero-dispatch.md](../../references/hetero-dispatch.md#account-layer-g37--which-claude-account-a-claude-spawn-runs-as).

If you work with more than one Claude subscription, autopilot can keep each one under a short name (an alias) and pick the account with the most headroom for every headless `claude` call. When one account hits its usage limit (HTTP 429), the call moves to the next alias and the limited one is left alone until it recovers. This page is the one-time setup, done by you, step by step. Nothing here is automatic: the registry stays absent until you create it, and with no registry every rail behaves as it did before.

**No account switch inside a task.** The dispatch rails (`dispatch-review.sh`, `dispatch-author.sh`, `dispatch-hetero.sh`) pin the default alias: the enabled alias with the lowest `priority` number (ties: the earlier row in `registry.json`) runs the whole call. If it answers a 429 the call fails with the quota exit and no other alias is tried, and while it is cooling the next call fails the same way instead of moving to another account. G41 will add the start-time pick. Other callers (probes, qualification, `qc-panel`, evals) still fail over as described below.

## Shortest use

```
scripts/accounts-onboard.sh personal team     # one profile name per Claude account + organization; it prints the plan and asks [y/N]
# per profile: switch to that account/org in another window, run `claude setup-token` there, paste the token here
scripts/accounts-onboard.sh --help            # the full explanation (also what you get with no argument)
```

A profile is what the rest of this page calls an alias: one Claude login **plus one organization**. One e-mail can belong to several organizations (a personal subscription and a Team plan, say); register each one as its own profile. The name is yours to choose: lowercase letters, digits and `-`, at most 24 characters, never an e-mail address, never `acct-` or `codex-` followed by 8 hex digits.

## One command for O1 to O9

`scripts/accounts-onboard.sh [--yes] [--org <name>=<org-label>]... <A> <B>` does O1 to O9 for you in one interactive run. It first prints a plan ("N profiles, about 2-3 minutes each, you need to: switch account/org, run `claude setup-token` in another window, paste the token") and asks `[y/N]`; the default is N and declining creates nothing. When stdin is not a terminal (a pipe, a redirect) a piped `y` does not count: it refuses, says how to fix it and creates nothing unless you pass `--yes`. Then, per profile:

1. **Org check.** It runs `claude auth status --json` (the flag is listed in the CLI's own help, recorded in `docs/plans/evidence/2026-11-03-g40-agent-lane-quota/survey-raw/claude.txt`), reads only `orgId`, `orgName` and `subscriptionType`, shows the org name and plan (never the e-mail) and asks you to confirm it is the org for this profile. If another profile already holds the same `orgId` it refuses before writing anything and names that profile (the same organization registered twice would count its quota twice). If auth status cannot be read, is not JSON, or has no `orgId`, it fails closed. If the org name itself contains an e-mail (a personal organization is usually named `<e-mail>'s Organization`), the name is neither shown nor stored, but the `orgId` is recorded and the duplicate check runs as usual: the label is then the `--org` value, or one you type when asked (same checks: no `@`, nothing e-mail-shaped, at most 64 characters; with no input available and no `--org` it stops and says how to fix it). The record is marked `org_check: verified` and the summary says "org verified (name hidden)".
2. It creates the directories, tells you (in Traditional Chinese) when to run `claude setup-token` in another window, reads the pasted token silently into the token file, and records the org in `<accounts-dir>/<profile>/token-meta.json` (schema `autopilot.token-meta/1`, mode 0600, keys `org_id` (stored lower-case, compared case-insensitively), `org_label`, `org_check` (`verified`, `unverified` or `mismatch`, see below); other keys in that file are kept; a file that cannot be read - loose mode, over 4096 bytes, broken JSON - is refused with `meta_unreadable` instead of being overwritten, back it up and move it away to re-register). The e-mail is never recorded, and `registry.json` row keys do not change.
3. It adds the registry row, runs `env-check` and the haiku OK call, and compares an organization id in the call's result envelope, if it carries one, with the recorded `org_id` (a mismatch is a failed row and turns `org_check` into `mismatch`, even if it was `verified`; whether the envelope ever carries an org id is unverified).

After all profiles it runs `status`, `pick`, both selftests and ends with a table that marks every item. `claude-account.js status` shows `org="<label>"` per profile, and the `org_check` value as follows (the exact text of `status`: nothing extra for `verified`, ` org_check=unverified`, ` org_check=mismatch`):

- **Recorded `verified` at registration**: the name was hidden, or `--org` was given, and the `orgId` was read from auth status. `status` shows no `org_check` part. The summary gets an extra org row only when the OK call's envelope carries an org id (a match, or a mismatch); with no id in the envelope it stays silent and the record stays `verified`.
- **Recorded `unverified`**: the path where you confirmed the org name yourself (or `--org` with no readable `orgId`). `status` shows `org_check=unverified` until a result envelope that carries the same org id upgrades it to `verified`; an envelope with no id leaves it `unverified` and the summary says "org not verified" (never blocking).
- **`mismatch`**: the envelope's org id differs from the recorded one. It is the third value: the summary row is a failure, `status` shows `org_check=mismatch`, and a later envelope without an org id does not erase it (the summary notes that the mismatch still stands).

**`--org <name>=<org-label>`** sets the label of a profile (1 to 64 characters, no `@` or double quote, nothing that looks like an e-mail or a credential). When `orgId` is readable it is still recorded and checked for duplicates, and only the label comes from you (the record is marked verified because the id came from auth status). When auth status gives no `orgId` at all, `--org` is your explicit confirmation: `org_id` is recorded as unknown (`null`, so duplicate-org detection cannot see it) and the summary says "org not verified". Repeat the option for several profiles.

It never runs `setup-token` itself and never prints a token. Re-running it is safe (existing tokens are kept unless you choose to overwrite, and a profile that already has an org record is not asked again). `--help`, or no argument, prints the usage and creates nothing. O5 (the first interactive start, in tmux) and O10 (rollback) stay yours; the script prints both commands. The steps below remain the manual route and the reference for what each check expects; if you register by hand, write `token-meta.json` yourself or leave it out (the profile then shows no org).

## Ground rules

- **A token lives in one place only**: a file `~/.config/autopilot/accounts/<alias>/token` with mode `0600`. Never put it in a command line (argv), a log, a chat message, a commit or an environment variable you export by hand. If it ever shows up in one of those, treat it as leaked: revoke it in the Claude account settings and redo step O3.
- **Fail closed.** With a registry present, a broken file (wrong mode, symlink, a stray `.credentials.json`) stops the call before anything is spawned; the account layer never quietly falls back to the login of the shell you are in.
- **Run every command yourself.** `claude setup-token` below is for you to run in your own terminal. Do not ask an agent to run it.
- Placeholders: `<A>` is your first alias, `<B>` the second (lowercase letters, digits and `-`, at most 24 characters; not shaped like `acct-` or `codex-` followed by 8 hex digits). Paths use `~`. Run the `node scripts/...` commands from the autopilot repository root.

## O1. Create the directories (no secret yet)

```
umask 077
mkdir -p ~/.config/autopilot/accounts/<A>/claude ~/.config/autopilot/accounts/<A>/home
mkdir -p ~/.config/autopilot/accounts/<B>/claude ~/.config/autopilot/accounts/<B>/home
chmod 700 ~/.config/autopilot ~/.config/autopilot/accounts ~/.config/autopilot/accounts/<A> ~/.config/autopilot/accounts/<B>
```

Permissions to set: every directory `0700`. Verify: `stat -c '%a %n' ~/.config/autopilot/accounts/<A>`. Expected: `700 ` followed by the path.

## O2. Write the registry (no secret)

```
cat > ~/.config/autopilot/accounts/registry.json <<'EOF'
{"schema":"autopilot.accounts/1","accounts":[{"alias":"<A>","enabled":true,"priority":10},{"alias":"<B>","enabled":true,"priority":20}]}
EOF
chmod 600 ~/.config/autopilot/accounts/registry.json
```

Permissions: `registry.json` `0600`, owned by you, not a symlink. A lower `priority` number is preferred when two aliases are otherwise equal. Unknown keys are rejected. Verify: `stat -c '%a %n' ~/.config/autopilot/accounts/registry.json`. Expected: `600 ` followed by the path.

## O3. Create each token, one account at a time

For alias `<A>`: sign in to that Claude account, check that `claude auth status` shows the account you mean, then run in your own terminal:

```
claude setup-token
```

Follow its prompts; it prints a long-lived token once. Paste it into the file without echoing it and without leaving it in shell history:

```
read -rs T; printf '%s' "$T" > ~/.config/autopilot/accounts/<A>/token; unset T
chmod 600 ~/.config/autopilot/accounts/<A>/token
stat -c '%a %U %n' ~/.config/autopilot/accounts/<A>/token
```

Permissions: `token` `0600`, one line, no spaces, at most 4096 bytes. Expected from `stat`: `600 <you> ` followed by the path. Repeat for `<B>` with the other account. Write down (without the token) what `setup-token` said about the token's lifetime.

## O4. Validate the registry

```
node scripts/claude-account.js env-check --alias <A>
node scripts/claude-account.js env-check --alias <B>
node scripts/claude-account.js status
```

Expected from each `env-check`: `ok alias=<A> mode=0600 config_dir=.../<A>/claude credentials_present=no`. Expected from `status`: a settings line (`mode=auto ...`), then one line per alias with `class=unknown` (no usage snapshot yet) and `cooldown_until=-`. No token text anywhere. Any failure prints one line naming the alias and the reason (exit 2); fix that and repeat.

## O5. First interactive start of each alias

This onboards the alias's own Claude config directory once.

```
node scripts/lane-reopen.js --alias <A> --cwd ~/projects/autopilot --dry-run
```

Expected: a command line that carries the alias only, never the token. Then, inside tmux, run it again without `--dry-run`. Expected: a new tmux window with `claude` running as account `<A>`, and the line `reopened alias=<A> window=<session>:<name>`. Answer the theme and trust prompts once, type `/status`, and note whether it asked you to log in. The old lane is not closed for you; close it yourself once the new one is up. Repeat for `<B>`.

## O6. Prove a bad token never falls back to your own login

Opt-in spike, run by hand only (no suite runs it). It builds a throwaway registry with one alias holding a `FAKE-` token and runs the real `claude` through `run` in it. It spends nothing and never reads your `~/.claude`.

```
node scripts/claude-account.js selftest --real-binary
```

Expected: exit 0 and the line `selftest: fake token -> 401, ambient login not used`. It passes only when all of these hold: the account layer returned 6 (auth stop) and there is positive evidence of an auth stop (the line `STOP_AUTH alias=probe` or a parsed `is_error:true` envelope with `api_error_status` 401; a bare exit 6, empty output or an unrelated error does not count), the output holds no normal answer (`is_error:false`), and the child's `HOME` and `CLAUDE_CONFIG_DIR` were inside the throwaway directory. The probe is a small shell script that records those two values and then `exec`s the binary, so no extra process sits between the account layer and `claude`. Any failed condition is printed and the exit code is 1; if the answer came back, your own login was used: stop and report it. `--binary <path>` picks another `claude`. Paste the transcript into the P8 note.

## O7. One real headless call per alias

```
node scripts/claude-account.js run --alias <A> --purpose operator-check --stdout /tmp/g37-a.json -- claude -p "say OK" --model haiku --output-format json --tools "" --strict-mcp-config
```

Expected: exit 0 and `"is_error":false` in `/tmp/g37-a.json`. Same for `<B>` (write to a different file). Then `node scripts/claude-account.js status`: the audit lines show one `ok` per call, with the alias and purpose and nothing else.

## O8. Check the picker

```
node scripts/claude-account.js pick --purpose operator-check
```

Expected: one line `<alias> class=<ok|unknown|tight> used=<fraction or -> source=<snapshot|none>`. With usage snapshots from the status line present (`ls "${XDG_RUNTIME_DIR}/autopilot/codeforge/usage/quota/"`) it names the alias with more headroom; with none it names the lower `priority` number and `class=unknown`. A statusline snapshot exists only for aliases that had an interactive session.

## O9. Check the limit switch

```
node scripts/claude-account.js selftest --simulate-429 <A>
```

Expected: `<A> rate_limited -> <B> ok`, then `node scripts/claude-account.js status` shows `<A>` with `cooldown_until` (UTC+8). Alias `<A>` runs with a `FAKE-` token (never its own) and is pointed at a local HTTP server inside this command that answers every request itself with a `rate_limit_error` 429 and forwards nothing; no request for `<A>` leaves the machine. `<B>` is the next alias and makes one real call (`say OK`, haiku) on its real route. `node scripts/claude-account.js cooldown --clear <A>` releases the cooldown. Plain `node scripts/claude-account.js selftest` still runs the 5 shim checks only.

## O10. Roll back

If anything looks wrong:

```
mv ~/.config/autopilot/accounts/registry.json ~/.config/autopilot/accounts/registry.json.off
```

Expected: the next rail call returns to the old seeded behaviour. For one shell only, `export AUTOPILOT_ACCOUNT_MODE=off` does the same (it is audited as `mode_off`). To go back, move the file back.

## Changing the host default

Every dispatch rail runs `claude-account.js run --pin-default`, which uses the enabled registry row with the lowest `priority` number (a tie goes to the earlier row). To make another alias the default for a while, for example for a pilot window, without editing JSON:

```
node scripts/claude-account.js set-default <alias>
```

The alias gets priority (lowest priority among the other enabled rows) minus 1, so it is strictly lowest; no other byte of `registry.json` changes. It refuses (exit 2, nothing written) an alias that is not registered or is disabled, and a registry file that is not in the one-line form the writers emit. An alias that is already the strictly lowest prints `default_unchanged` and writes nothing. Before writing, the command copies `registry.json` to `registry.json.bak.<ms>` (0600) and prints the rollback command; writes are atomic (temp file then rename, 0600). Rollback, which puts the backup back byte for byte after checking it still validates:

```
node scripts/claude-account.js set-default --restore <accounts-dir>/registry.json.bak.<ms>
```

## Day to day

- `node scripts/claude-account.js status` shows each alias, its class and used fraction, any cooldown, and the last audit lines.
- `node scripts/lane-reopen.js --pick --cwd <dir>` reopens a lane on the alias with the most headroom.
- Adding an account later: repeat O1 to O4 for the new alias and add a row to `registry.json`. Disabling one: set `"enabled": false`.
- Eight frozen evaluation runners are replay-only and keep using the logged-in credentials; see the `frozen_legacy` paragraph in the reference above.
