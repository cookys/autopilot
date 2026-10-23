#!/usr/bin/env python3
"""Cost table and power figures of docs/plans/2026-10-24-per-turn-gate-phase2.md.
Usage: python3 -I cost-power.py <costs.tsv of the P1 rerun>   (stdlib only)
Inputs: costs.tsv column 3 = last-result-object total_cost_usd per run.
Assumptions (estimates, not measurements): probe 0.0166 USD x 30 ids;
per-block cost 0.105 (= mean/5) or 0.15; blocks per run 0 / 1.5 / 6 / 10 (5 turns x N=2).
All outputs rounded to 2 decimals at print time only."""
import sys, statistics as st
from math import comb
v = [float(l.split('\t')[2]) for l in open(sys.argv[1]) if l.strip()]
n, mean, sd, tot = len(v), st.mean(v), st.stdev(v), sum(v)
PROBES = 30 * 0.0166
print(f"n={n} mean={mean:.4f} sample_sd={sd:.4f} sum={tot:.2f} sum_with_probes={tot+PROBES:.2f}")
c_arm = tot + PROBES
print("scenario  per_run  D1(30 ON + probes)  D2(D1 + C arm)")
for name, k, c in (("lower", 0, 0.0), ("central", 1.5, 0.105), ("plausible", 6, 0.15), ("max", 10, 0.15)):
    per = mean + k * c
    d1 = 30 * per + PROBES
    print(f"{name:9} {per:.2f}  {d1:.2f}  {d1 + c_arm:.2f}")
# power: two-sided Fisher, p = sum of all table probabilities <= observed table's probability
def fisher(a, b, m=30, side=2):
    K = a + b
    pr = lambda x: comb(m, x) * comb(m, K - x) / comb(2 * m, K)
    xs = range(max(0, K - m), min(m, K) + 1)
    if side == 1:  # ON (a) lower than C (b): P(X <= a)
        return sum(pr(x) for x in xs if x <= a)
    p0 = pr(a)
    return sum(pr(x) for x in xs if pr(x) <= p0 * (1 + 1e-12))  # tolerance for float ties
pm = lambda p, k: comb(30, k) * p ** k * (1 - p) ** (30 - k)
# "drop direction" counts only rejections where ON < C; "any direction" also counts ON > C (this
# explains 15.24 vs 15.27: both use the same two-sided p, they differ in which rejections count).
for side, label in ((2, "two-sided p"), (1, "one-sided p (ON<C)")):
    for d in (.15, .30, .40):
        p0, p1 = 13 / 30, 13 / 30 - d
        drop = sum(pm(p1, a) * pm(p0, b) for a in range(31) for b in range(31)
                   if a < b and fisher(a, b, side=side) <= 0.05)
        anyd = sum(pm(p1, a) * pm(p0, b) for a in range(31) for b in range(31)
                   if fisher(a, b, side=side) <= 0.05 and (side == 2 or a < b))
        print(f"power {label} drop={d*100:.0f}pt: drop-direction {drop*100:.2f}%  any-direction {anyd*100:.2f}%")
