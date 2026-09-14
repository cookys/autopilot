# Dev mode layer ③ (marketplace clone) as a symlink — spike before changing dev-setup

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14


- **Trigger**: **NOT FIRED — operator question 2026-09-13** after `/reload-plugins` loaded v2.34.5 skills because `~/.claude/plugins/marketplaces/autopilot` had not been pulled since 2026-08-07 (the same shape as the 2026-07-17 incident in `docs/installation.md` § Dev-mode update).
- **Question**: could ③ be a symlink to the dev clone like ① is, removing the pull step? Unverified either way: whether Claude Code runs git operations inside ③ on `/plugin marketplace update` (it would then operate on the working tree), and whether `/reload-plugins` accepts a symlinked marketplace dir. The registry's `lastUpdated` for the autopilot marketplace has not moved since 2026-06-04, which suggests Claude Code does not touch it on its own.
- **Spike**: symlink ③ on this host, run `/reload-plugins` and `/plugin marketplace update autopilot`, record what each does to the dev repo (`git status`, reflog). If clean, `dev-setup.sh` creates the symlink and `dev-update.sh` drops the pull.
- **Effort**: S.

