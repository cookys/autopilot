# mods account and quota: review follow-ups

Source: feat/mods-account review rounds 1–2, 2026-10-13. Deferred; none blocked the merge.

- **Only a missing file should clear the account.** `readAccountQuota` (mods/live/register.ts) drops the account
  when `$.fs.stat` of `~/.claude.json` throws for any reason, so a transient permission or I/O error blanks the
  Account section for a tick. Clearing only on ENOENT needs the shape of the error the mod runtime throws, which
  was not checked. Probe it first.
- **Colour is judged on the raw ratio, the text shows the rounded percent.** `quotaColor` (mods/live/model.ts)
  takes the unrounded value, so 79.6 % is shown as `80%` without the warning colour. Decide whether the threshold
  follows the shown number.
- **Re-parse throttle.** `~/.claude.json` is rewritten often by Claude Code itself; each size/mtime change costs a
  full read and JSON parse of a file that can reach megabytes. A minimum interval between parses would bound it.
- **`CLAUDE_CONFIG_DIR`.** The account is read from `$HOME/.claude.json` only. Whether Claude Code moves that file
  when `CLAUDE_CONFIG_DIR` is set is UNVERIFIED — check the real tool before following it.
- **Duplicate window kinds.** `readQuota` keeps every entry; two `five_hour` windows would both show. Keep the most
  used one per kind if the API ever sends that.
