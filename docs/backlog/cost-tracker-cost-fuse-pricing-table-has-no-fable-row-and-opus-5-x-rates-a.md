# cost-tracker/cost-fuse pricing table has no fable row and opus-5.x rates are hard-coded unverified

`hooks/cost-tracker-lib.js` `PRICING`/`getRate` matches only haiku/opus/sonnet substrings. A fable model
therefore has no price row, and the opus-5.x rates were typed in without a cited source. Until fixed, fable
spend is undercounted in both cost-tracker and cost-fuse (cost-tracker now says "cost unknown" for an
unpriced model, but cost-fuse still sums it as zero or a fallback rate).

Next touch: verify every rate against the official Anthropic pricing page (cite the URL in the code
comment), add the fable row, and derive `hasPriceRow` from `Object.keys(PRICING)` (v2.36.113 review 🔵).
