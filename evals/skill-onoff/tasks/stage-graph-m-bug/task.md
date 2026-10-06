Our invoice total is wrong for discounted items: 3 widgets at 19.99 with a 10% discount should total
53.97 but we get a different number, and customers noticed. The pricing, rounding and report code
all touch this, so I don't know which of them is at fault. Please find the cause, fix it properly,
add regression tests that would have caught it, and note the rounding rule in `docs/pricing.md`.
`bash run-tests.sh` runs the tests. Commit when done.
