// usage: node recompute-p2-4.js   (run from the repo root; reads only the two committed RESULT.md files)
// Recomputes M1/M2/M3 per arm and the one-sided Fisher exact p values from the per-id tables in RESULT.md.
// Independent of analyze-*.js: it never reads a run directory.
const fs = require("fs");
const batches = {
  "p2-3r2 (Haiku 4.5)": "docs/plans/evidence/2026-10-25-per-turn-gate-p2-3r2/RESULT.md",
  "p2-3-h55 (Haiku 5.5)": "docs/plans/evidence/2026-10-25-per-turn-gate-p2-3-h55/RESULT.md",
};
const lf = [0]; for (let i = 1; i < 80; i++) lf[i] = lf[i - 1] + Math.log(i);
const lc = (n, k) => lf[n] - lf[k] - lf[n - k];
// P(X >= a) for a 2x2 table with row totals a+b, c+d and first-column total a+c (one-sided, "arm 1 higher")
function fisherHigher(a, n1, c, n2) {
  const K = a + c, N = n1 + n2; let p = 0;
  for (let x = a; x <= Math.min(K, n1); x++) p += Math.exp(lc(n1, x) + lc(n2, K - x) - lc(N, K));
  return p;
}
for (const [name, file] of Object.entries(batches)) {
  const arms = { ON: { n: 0, m1: 0, m2: 0, m3: 0, blocks: 0 }, C: { n: 0, m1: 0, m2: 0, m3: 0, blocks: 0 } };
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const c = line.split("|").map(s => s.trim());
    const m = /^(ON|C)-(\d\d)$/.exec(c[1] || "");
    if (!m) continue;
    const a = arms[m[1]], [m1, m2, m3] = [c[2], c[3], c[4]].map(Number);
    if (m3 !== (m1 && m2 ? 1 : 0)) throw new Error("M3 != M1&&M2 at " + c[1]);
    a.n++; a.m1 += m1; a.m2 += m2; a.m3 += m3; a.blocks += Number(c[6]);
  }
  const { ON, C } = arms;
  console.log(name, JSON.stringify(arms));
  console.log("  Fisher M3 ON>C p=" + fisherHigher(ON.m3, ON.n, C.m3, C.n).toExponential(4) +
    "  Fisher M2 ON<C p=" + fisherHigher(C.m2, C.n, ON.m2, ON.n).toExponential(4));
}
