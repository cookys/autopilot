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

1. **Org label (no `claude auth status`).** It never calls `claude auth status`, so the current window's login does not matter and need not be switched; `claude setup-token`'s browser login in the other window chooses which organization the token belongs to. The profile's display label (`org_label`) is the `--org` value if given, otherwise the profile name itself.
2. **Directories, token and metadata.** It creates the `0700` directories, tells you (in Traditional Chinese) when to run `claude setup-token` in another window, reads the pasted token silently into `<accounts-dir>/<profile>/token` (`0600`), writes the initial org record into `<accounts-dir>/<profile>/token-meta.json` (schema `autopilot.token-meta/1`, mode `0600`, keys `org_id` (stored lower-case, compared case-insensitively), `org_label`, `org_check` (`verified`, `unverified` or `mismatch`), plus `org_type` / `rate_limit_tier` when reported; other keys in that file are kept; a file that cannot be read — loose mode, over 4096 bytes, broken JSON — is refused with `meta_unreadable` instead of being overwritten, back it up and move it away to re-register), adds the `registry.json` row (`0600`, row keys unchanged), and runs `env-check`. Never is an e-mail recorded.
3. **OAuth profile org check (`orgprofile`).** After `env-check`, and before / independent of the haiku OK call, Node helper mode `orgprofile <alias>` reads the alias's `token` file into memory only and calls `GET https://api.anthropic.com/api/oauth/profile` (`Authorization: Bearer <token>`, `anthropic-beta: oauth-2025-04-20`, `Accept: application/json`, 20 s timeout; overridable in hermetic tests only via `ONBOARD_PROFILE_URL`). It reads only `organization.uuid`, `organization.name` (dropped if it fails `orgLabelProblem`, e.g. `<e-mail>'s Organization`), `organization.organization_type`, `organization.rate_limit_tier` and `organization.billing_type` — never any `account` or e-mail field:
   - With an org uuid and none recorded yet: if another profile already holds the same `org_id`, the row fails (`同一個 org 已登記在 <other>`) and the just-added `registry.json` row is taken back (the same organization registered twice would count its quota twice); otherwise `org_id` (lowercased), `org_type` / `rate_limit_tier` (if present) and `org_check: verified` are written to `token-meta.json`.
   - With an org uuid and one already recorded: matching confirms `org_check: verified`; a different uuid is a failed row and writes `org_check: mismatch`.
   - HTTP `401` is a failed row (`token 無效`) and stops at that alias; any other profile-lookup failure (`http_<n>`, `request_failed`, `not_json`, `no_org_id`) marks the org row unverified (`org 未驗證`) and never blocks.
4. **Headless OK call.** It runs one haiku `"say OK"` call through `claude-account.js run --alias`. The OK call has its own summary row; a rate-limited (`429`) OK call never erases a verified org.

After all profiles it runs `status`, `pick`, both selftests and ends with a summary table showing each profile's org label and plan type/tier (never e-mail). `claude-account.js status` shows `org="<label>"` per profile, and the `org_check` value as follows (the exact text of `status`: nothing extra for `verified`, ` org_check=unverified`, ` org_check=mismatch`):

- **`verified`**: `org_id` was verified from the token's OAuth profile (and matched any earlier recorded `org_id`). `status` shows `org="<label>"` with no `org_check` suffix; a later transient OAuth profile failure leaves `verified` intact.
- **`unverified`**: the OAuth profile lookup returned no org id or failed with a non-401 error (`org_id` stays `null`, never blocking). `status` shows `org_check=unverified`; re-running `accounts-onboard.sh` on that alias (keeping the existing token) re-queries the OAuth profile and upgrades it to `verified` once reachable.
- **`mismatch`**: a re-run's token reported a different `organization.uuid` from the recorded `org_id`. The summary row is a failure, `status` shows `org_check=mismatch`, and a later transient lookup failure does not erase it.

**`--org <name>=<org-label>`** sets the display label of a profile (1 to 64 characters, no `@` or double quote, nothing that looks like an e-mail or a credential); without `--org`, the label defaults to the profile name. Organization identity (`org_id`) and plan type/tier always come from the token's own OAuth profile. Repeat `--org` for several profiles.

It never runs `setup-token` itself and never prints a token or e-mail. Re-running it is safe (existing tokens are kept unless you choose to overwrite, and already-registered aliases with `org_id: null` are verified automatically without extra flags). `--help`, or no argument, prints the usage and creates nothing. O5 (the first interactive start, in tmux) and O10 (rollback) stay yours; the script prints both commands. The steps below remain the manual route and the reference for what each check expects; if you register by hand, write `token-meta.json` yourself or leave it out (the profile then shows no org).

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

The alias gets priority (lowest priority among the other enabled rows) minus 1, so it is strictly lowest; no other byte of `registry.json` changes. It refuses (exit 2, nothing written) an alias that is not registered or is disabled, a registry file that is not exactly the one-line form the writers emit (JSON plus a final newline), and a case where no strictly lower number exists (`priority_floor`; only one priority may change). An alias that is already the strictly lowest prints `default_unchanged` and writes nothing. Before writing, the command copies `registry.json` to `registry.json.bak.<ms>` (0600) and prints the rollback command; writes are atomic (temp file then rename, 0600). Rollback, which puts the backup back byte for byte after checking it still validates:

```
node scripts/claude-account.js set-default --restore <accounts-dir>/registry.json.bak.<ms>
```

## Day to day

- `node scripts/claude-account.js status` shows each alias, its class and used fraction, any cooldown, and the last audit lines.
- `node scripts/lane-reopen.js --pick --cwd <dir>` reopens a lane on the alias with the most headroom.
- Adding an account later: repeat O1 to O4 for the new alias and add a row to `registry.json`. Disabling one: set `"enabled": false`.
- Eight frozen evaluation runners are replay-only and keep using the logged-in credentials; see the `frozen_legacy` paragraph in the reference above.

## Login expiry check

`node scripts/profile-health.js check [--json]` lists every login profile on this host (`home` = `~/.claude`, plus each directory under `~/.claude-profiles/`) with `loginExpiresAt`, days left and a status (`ok`, `expiring` at 10 days or less, `expired`, `logged_out`, or `unsupported_name` for a directory whose name is not letters, digits and `._-` or is `home`: claude is not run for it and `notify` asks the operator to rename it). It reads only `loggedIn` and `loginExpiresAt` from `claude auth status --json`; the e-mail and organization are never printed or sent. `notify [--to <addr>]` sends the PM (default `cookys/aimax395/pm--claude`) one `[操作員決定]` message per profile that needs a login: machine, OS account, profile, expiry in Taipei time and the exact command (`claude auth login --claudeai`, prefixed with `CLAUDE_CONFIG_DIR="$HOME/.claude-profiles/<name>"` for a non-home profile). It sends once per profile, expiry value and status (state in `$XDG_STATE_HOME/autopilot/profile-health.json`, mode 0600); a failed send is retried on the next run. Example daily systemd user units: [`examples/profile-health.service`](examples/profile-health.service) and [`examples/profile-health.timer`](examples/profile-health.timer); installing them is up to you.

## Profile links

登入 profile 目錄 `~/.claude-profiles/<sub>/` 要共用 `~/.claude` 的設定時，用 `node scripts/profile-link.js apply --profile <sub>`：只替「存在的」`settings.json`、`CLAUDE.md`、`skills`、`hooks`、`plugins`、`agents`、`commands` 建立符號連結，目錄不存在就先建立。`.credentials.json`、`.claude.json`、`metrics/`、`projects/` 一律各 profile 自有，絕不連結。

- `apply` 只補缺的連結；遇到已存在的非連結項目會拒絕並印出手動處理程序（快照、影響範圍、還原指令、操作員自行確認），不取代、不重連、沒有 `--adopt`。每次 run 記在 `<profile>/.profile-links.json`（只含連結名稱、目標與連結前狀態，不含任何憑證）。
- `status --profile <sub>` 列出每個連結、目標與是否可解析。
- `rollback --profile <sub>` 回復最新一次 run（`--all` 回復全部，由新到舊）：只在該項目仍是符號連結且目標與紀錄相同時才移除，不符的略過並回報（結束碼 1）；目標不動，profile 目錄即使是空的也保留，移除目錄是操作員的手動步驟。
- 登入由操作員自己在瀏覽器完成，本工具不執行也不讀取任何登入資料。

### Login checklist

`node scripts/login-checklist.js --hosts <file> [--json]` prints, for every host, OS account and profile in the file, the numbered steps the operator types once: open a terminal, `node ~/projects/autopilot/scripts/profile-link.js apply --profile <sub>`, `CLAUDE_CONFIG_DIR="$HOME/.claude-profiles/<sub>" claude auth login --claudeai`, sign in with that subscription in the browser, `... claude auth status --text`, then `node ~/projects/autopilot/scripts/profile-health.js check`. Every step starts with "在 <host>、OS 帳號 <user>：". The file is a JSON array such as `[{"host":"cookys-aimax395","os_account":"team","profiles":["singularaion","stranity"]}]`; unknown keys, names outside the profile-name grammar, empty lists, a repeated (host, OS account) pair and one subscription twice in one OS account are refused (exit 2). `home` (the native `~/.claude`) needs no relogin and yields a note, not a step. The tool only prints: it never runs claude and never reads any credential or `~/.claude` file.


## Lane manifest

Lanes are opened by hand in tmux, so keep a short manifest (one line per lane) to reopen them the same way. There is no manifest file in the repo yet; this is the shape to record:

| column | meaning |
|--------|---------|
| tmux window | window name of the lane |
| cwd | working directory of the session |
| profile | its `CLAUDE_CONFIG_DIR`; empty = the default `~/.claude` |
| model | model the session was started with |
| launch flags | flags only, never prompt text |
| fleet seat | `<project>--claude`, stable per cwd; the `@sub` suffix changes on every restart, so it is not stored |

- On reopen, close the old session first, then start the new one and confirm the address with `fleet whoami`. An unreleased old session makes the new one get a `-2` seat.
- The fleet MCP server is registered in user scope, so a new profile has no fleet until it is started with `--mcp-config <shared file>`.

## Switching a lane between subscriptions

目前只有預演（P2a）：`node scripts/lane-switch.js --lane <lane> --profile <profile> --order <fleet 訊息 id> --dry-run` 會依序印出計畫的步驟 1 到 8 和回滾指令，並在 `~/.config/autopilot/lane-switch-journal.jsonl` 記一列，不執行任何事。不加 `--dry-run` 會拒絕（結束碼 3，「P2 execution not enabled in P2a」）。`--order` 必填：只有 PM 下令才換，工具不會自己換。

- 帳號別名只由 `scripts/lib/account-alias.js` 算出，工具不會自己開 `.claude.json`，也不碰任何 `.credentials.json`。
- 車道紀錄放 `~/.config/autopilot/lanes/<lane>.json`（權限 0600，欄位同上面的 Lane manifest 表，加 pane 與 session id；不得含提示詞）。
- 回滾：同一個指令，`--profile` 改成原本的 profile。
- 計畫與步驟：`project/plans/2026-11-10-profile-switch.md`。
