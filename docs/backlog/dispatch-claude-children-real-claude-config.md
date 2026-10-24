# dispatch-review.sh and dispatch-author.sh use the real ~/.claude

BL-0290. The claude-native branches (dispatch-review.sh ~1829, dispatch-author.sh ~1390) set no CLAUDE_CONFIG_DIR and do not redirect HOME, against the rule in the dispatch-review.sh header comment (~67-76): a claude child gets a dedicated 0700 dir holding only a 0600 `.credentials.json` copy. Fix after unit cnimpl merges, reusing the credentials-only config seeding helper that unit cnimpl is adding (not yet merged). Trigger-Type event. Effort S.

Status 2026-10-24: cnimpl is merged (64eedde66); the credentials-only helper `scripts/lib/seed-claude-config.js` is on develop, so this can start now.
