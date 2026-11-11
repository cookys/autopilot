# accounts-onboard org check always 403 with setup-token tokens (BL-0431)

2026-11-12 06:07 TW re-verify of two registered profiles: the `orgprofile` step (`GET /api/oauth/profile`, `anthropic-beta: oauth-2025-04-20`) returned HTTP 403 for both, while the haiku OK call through the same tokens succeeded. A `claude setup-token` token appears to carry inference scope only, so the profile endpoint refuses it and every org row stays "unverified". The design in onboardorg2 assumed the profile endpoint accepts these tokens; that assumption is UNVERIFIED beyond this 403.

Options to look at: a different endpoint the inference scope can read that names the org (not yet found); recording the org at token creation from operator input only; or dropping the org-id check and relying on the duplicate-token check. Needs a probe before any build.
