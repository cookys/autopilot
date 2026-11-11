# accounts-onboard org check always 403 with setup-token tokens (BL-0431)

2026-11-12 06:07 TW re-verify of two registered profiles: the `orgprofile` step (`GET /api/oauth/profile`, `anthropic-beta: oauth-2025-04-20`) returned HTTP 403 for both, while the haiku OK call through the same tokens succeeded. A `claude setup-token` token appears to carry inference scope only, so the profile endpoint refuses it and every org row stays "unverified". The design in onboardorg2 assumed the profile endpoint accepts these tokens; that assumption is UNVERIFIED beyond this 403.

Fixed by reading org identity from the OK-call response headers instead: `orghdr` POSTs `/v1/messages` with the same setup-token, takes only `anthropic-organization-id` (UUID) and `anthropic-ratelimit-unified-7d-utilization` from the headers, and never reads the body. The old profile-JSON path (`org_type` / `rate_limit_tier`) is gone.
