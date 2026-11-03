# Claude accounts: aliases and automatic switching

> Part of [Autopilot](../../README.md). Settings are in [settings-reference.md](settings-reference.md#claude-accounts-g37); the rail-level behaviour (exit codes, fail closed) is in [references/hetero-dispatch.md](../../references/hetero-dispatch.md#account-layer-g37--which-claude-account-a-claude-spawn-runs-as).

If you work with more than one Claude subscription, autopilot can keep each one under a short name (an alias) and pick the account with the most headroom for every headless `claude` call. When one account hits its usage limit (HTTP 429), the call moves to the next alias and the limited one is left alone until it recovers. This page is the one-time setup, done by you, step by step. Nothing here is automatic: the registry stays absent until you create it, and with no registry every rail behaves as it did before.

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

## Day to day

- `node scripts/claude-account.js status` shows each alias, its class and used fraction, any cooldown, and the last audit lines.
- `node scripts/lane-reopen.js --pick --cwd <dir>` reopens a lane on the alias with the most headroom.
- Adding an account later: repeat O1 to O4 for the new alias and add a row to `registry.json`. Disabling one: set `"enabled": false`.
- Eight frozen evaluation runners are replay-only and keep using the logged-in credentials; see the `frozen_legacy` paragraph in the reference above.
