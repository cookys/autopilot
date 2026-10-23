# dispatch-review.sh and dispatch-author.sh use the real ~/.claude

BL-0290. The claude-native branches (dispatch-review.sh ~1829, dispatch-author.sh ~1390) set no CLAUDE_CONFIG_DIR and do not redirect HOME, against the rule in the dispatch-review.sh header comment (~67-76): a claude child gets a dedicated 0700 dir holding only a 0600 `.credentials.json` copy. Fix after unit cnimpl merges, reusing its `scripts/lib/seed-claude-config.js`. Trigger-Type event. Effort S.
