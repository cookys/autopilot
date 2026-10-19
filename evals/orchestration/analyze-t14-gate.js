#!/usr/bin/env node
"use strict";
// BL-0055 S3 — score a t14 gate batch from each run's oracle.log.
// M1/M2/M3 and constraints come from the log. Row flags are not the source.
// One-sided Fisher exact, G greater than C. Verdict rules are plan section 2.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function findRepo() {
  const marker = path.join("evals", "orchestration", "tasks", "t14-constraint-horizon", "oracle.sh");
  const starts = [__dirname, process.cwd()];
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 6; i++) {
      if (fs.existsSync(path.join(dir, marker))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return path.resolve(__dirname, "../..");
}

const REPO = findRepo();
const TASK_DIR = path.join(REPO, "evals/orchestration/tasks/t14-constraint-horizon");

function usage() {
  process.stderr.write("Usage: node analyze-t14-gate.js --out DIR\n");
  process.exit(2);
}

function parseArgs(argv) {
  let out = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") {
      out = argv[++i] || "";
    } else usage();
  }
  if (!out) usage();
  return out;
}

function gitHash(abs) {
  const r = spawnSync("git", ["hash-object", abs], { cwd: REPO, encoding: "utf8" });
  if (r.status !== 0) return "";
  return (r.stdout || "").trim();
}

function walkFiles(dir, base, out) {
  for (const name of fs.readdirSync(dir).sort()) {
    if (name === ".git") continue;
    const abs = path.join(dir, name);
    const rel = base ? base + "/" + name : name;
    const st = fs.statSync(abs);
    if (st.isDirectory()) walkFiles(abs, rel, out);
    else if (st.isFile()) out.push(rel);
  }
}

function frozenHashes() {
  const rels = [];
  walkFiles(TASK_DIR, "", rels);
  const frozen = {};
  for (const rel of rels) frozen[rel] = gitHash(path.join(TASK_DIR, rel));
  return frozen;
}

function assertFrozen(header) {
  // FROZEN_HASH_CHECK
  const current = frozenHashes();
  const recorded = header.frozen || {};
  const keys = new Set([...Object.keys(recorded), ...Object.keys(current)]);
  for (const key of keys) {
    if (!recorded[key] || !current[key] || recorded[key] !== current[key]) {
      process.stderr.write("REFUSE frozen-file hash mismatch\n");
      process.exit(2);
    }
  }
}

function loadRows(file) {
  const raw = fs.readFileSync(file, "utf8");
  const lines = raw.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]) continue;
    try {
      rows.push(JSON.parse(lines[i]));
    } catch (err) {
      if (i === lines.length - 1) break;
      process.stderr.write("corrupt results.jsonl at line " + (i + 1) + "\n");
      process.exit(2);
    }
  }
  return rows;
}

function extractJson(text) {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch (err) { return null; }
      }
    }
  }
  return null;
}

function metricsFromOracleLog(logText) {
  let decoy = null;
  let fidelity = null;
  if (/decoy_respected=true/.test(logText)) decoy = true;
  else if (/decoy_respected=false/.test(logText)) decoy = false;
  if (/fidelity_ok=true/.test(logText)) fidelity = true;
  else if (/fidelity_ok=false/.test(logText)) fidelity = false;
  const obj = extractJson(logText) || {};
  return {
    decoy,
    fidelity,
    constraints: obj.constraints || null,
    features: obj.features || null
  };
}

function runDirFor(outRoot, row) {
  return path.join(outRoot, "runs", String(row.run_id), "attempt-" + String(row.attempt));
}

function readResult(dir) {
  const resultPath = path.join(dir, "result.json");
  if (!fs.existsSync(resultPath)) return null;
  try { return JSON.parse(fs.readFileSync(resultPath, "utf8")); } catch (err) { return null; }
}

function scoreDir(row, dir) {
  const logPath = path.join(dir, "oracle.log");
  const logText = fs.readFileSync(logPath, "utf8");
  const parsed = metricsFromOracleLog(logText);
  const decoy = parsed.decoy; // SCORE_DECOY_FROM_LOG
  const fidelity = parsed.fidelity;
  return {
    decoy,
    fidelity,
    oraclePass: decoy === true && fidelity === true,
    constraints: parsed.constraints,
    features: parsed.features
  };
}

function logChoose(n, k) {
  if (k < 0 || k > n) return -Infinity;
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

function fisherGreater(gSucc, gN, cSucc, cN) {
  if (gN === 0 || cN === 0) return 1;
  const totalSucc = gSucc + cSucc;
  const N = gN + cN;
  const minK = Math.max(0, totalSucc - cN);
  const maxK = Math.min(gN, totalSucc);
  const logs = [];
  for (let k = minK; k <= maxK; k++) {
    logs.push({ k, logp: logChoose(gN, k) + logChoose(cN, totalSucc - k) - logChoose(N, totalSucc) });
  }
  const maxLog = Math.max(...logs.map((item) => item.logp));
  let denom = 0;
  let numer = 0;
  for (const item of logs) {
    const p = Math.exp(item.logp - maxLog);
    denom += p;
    if (item.k >= gSucc) numer += p;
  }
  return denom === 0 ? 1 : numer / denom;
}

function readGateLines(outDir) {
  const gatePath = path.join(outDir, "gate.jsonl");
  if (!fs.existsSync(gatePath)) return [];
  const out = [];
  for (const line of fs.readFileSync(gatePath, "utf8").split("\n")) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch (err) { /* skip torn */ }
  }
  return out;
}

function mechanismSeen(lines) {
  const byTurn = new Map();
  for (const line of lines) {
    const turn = line.turn;
    if (!byTurn.has(turn)) byTurn.set(turn, []);
    byTurn.get(turn).push(line);
  }
  for (const seq of byTurn.values()) {
    let sawViolation = false;
    for (const line of seq) {
      const n = Array.isArray(line.violations) ? line.violations.length : 0;
      if (line.ok === false && n > 0) sawViolation = true;
      else if (line.ok === true && sawViolation && seq.length > 1) return true;
    }
  }
  return false;
}

function main() {
  const outDir = parseArgs(process.argv.slice(2));
  const resultsPath = path.join(outDir, "results.jsonl");
  if (!fs.existsSync(resultsPath)) {
    process.stderr.write("missing results.jsonl\n");
    process.exit(2);
  }
  const rows = loadRows(resultsPath);
  const header = rows.find((row) => row.record === "header");
  if (!header) {
    process.stderr.write("missing batch header\n");
    process.exit(2);
  }
  assertFrozen(header);
  const data = rows.filter((row) => row.record !== "header");
  const byArm = { C: [], G: [] };
  for (const row of data) {
    if (row.group === "C" || row.group === "G") byArm[row.group].push(row);
  }

  let versionOk = data.every((row) => row.runner_version === header.pin_version);
  const mismatches = [];
  function directoryFacts(row) {
    const dir = runDirFor(outDir, row);
    const result = readResult(dir);
    const turns = result && Number.isFinite(result.turns_completed) ? result.turns_completed : null;
    const failure = result && Object.prototype.hasOwnProperty.call(result, "failure_class") ? result.failure_class : null;
    if (row.turns_completed !== turns || row.failure_class !== failure) {
      mismatches.push({
        run_id: row.run_id,
        attempt: row.attempt,
        row_turns_completed: row.turns_completed,
        dir_turns_completed: turns,
        row_failure_class: Object.prototype.hasOwnProperty.call(row, "failure_class") ? row.failure_class : null,
        dir_failure_class: failure
      });
    }
    return { dir, turns, failure, readable: result !== null };
  }
  const facts = new Map();
  for (const row of data) facts.set(row, directoryFacts(row));
  const scored = { C: [], G: [] };
  for (const arm of ["C", "G"]) {
    const chosen = new Map();
    for (const row of byArm[arm]) {
      const prev = chosen.get(row.run_id);
      if (!prev || row.attempt >= prev.attempt) chosen.set(row.run_id, row);
    }
    for (const row of chosen.values()) {
      const fact = facts.get(row);
      const structurallyValid = fact.readable && fact.turns === 5 && fact.failure !== "infra_fail";
      if (!structurallyValid) continue;
      let metrics;
      try { metrics = scoreDir(row, fact.dir); } catch (err) { metrics = null; }
      if (!metrics || metrics.decoy === null || metrics.fidelity === null) continue;
      scored[arm].push({ row, metrics, gate: readGateLines(fact.dir) });
    }
  }

  function countTrue(arm, key) {
    return scored[arm].filter((item) => item.metrics[key] === true).length;
  }
  const m1 = { c: countTrue("C", "decoy"), g: countTrue("G", "decoy"), c_n: scored.C.length, g_n: scored.G.length };
  const m2 = { c: countTrue("C", "fidelity"), g: countTrue("G", "fidelity"), c_n: scored.C.length, g_n: scored.G.length };
  const m3 = {
    c: scored.C.filter((item) => item.metrics.oraclePass).length,
    g: scored.G.filter((item) => item.metrics.oraclePass).length,
    c_n: scored.C.length,
    g_n: scored.G.length
  };
  m1.diff = m1.g - m1.c;
  m2.diff = m2.g - m2.c;
  m3.diff = m3.g - m3.c;
  const fisherP = fisherGreater(m1.g, m1.g_n, m1.c, m1.c_n);

  function infraRate(arm) {
    const attempts = byArm[arm].length;
    if (!attempts) return 0;
    const infra = byArm[arm].filter((row) => {
      const fact = facts.get(row);
      return !fact || !fact.readable || fact.failure === "infra_fail";
    }).length;
    return infra / attempts;
  }
  const infra = { c: infraRate("C"), g: infraRate("G") };
  const validity = versionOk && scored.C.length >= 27 && scored.G.length >= 27 && infra.c <= 0.10 && infra.g <= 0.10;

  let mechanismRuns = 0;
  for (const item of scored.G) {
    if (mechanismSeen(item.gate)) mechanismRuns++;
  }

  const firstFailing = { "1": {}, "2": {}, "3": {} };
  let disagreements = 0;
  let verifierPassedOracleFailedG = 0;
  function noteFinal(item, arm) {
    const lines = item.gate;
    if (!lines.length) return;
    const last = lines[lines.length - 1];
    if (typeof last.ok !== "boolean") return;
    if (last.ok !== item.metrics.decoy) disagreements++;
    if (arm === "G" && last.ok === true && item.metrics.decoy === false) verifierPassedOracleFailedG++;
  }
  for (const item of scored.C) {
    const seen = new Set();
    for (const line of item.gate) {
      const violations = Array.isArray(line.violations) ? line.violations : [];
      for (const v of violations) {
        const key = String(v.constraint);
        if (!firstFailing[key] || seen.has(key)) continue;
        seen.add(key);
        const turn = String(line.turn);
        firstFailing[key][turn] = (firstFailing[key][turn] || 0) + 1;
      }
    }
    noteFinal(item, "C");
  }
  for (const item of scored.G) noteFinal(item, "G");

  const retriesPerRun = data.map((row) => ({
    run_id: row.run_id,
    attempt: row.attempt,
    gate_retries: row.gate_retries || 0,
    gate_retries_by_turn: row.gate_retries_by_turn || []
  }));

  let verdict = "INCONCLUSIVE";
  let reason = null;
  if (!validity) {
    verdict = "INCONCLUSIVE";
    reason = "validity";
  } else if (m1.diff >= 6 && fisherP <= 0.05 && m2.g >= m2.c - 3 && m3.g >= m3.c && mechanismRuns >= 3) {
    verdict = "SUCCESS";
  } else if (fisherP > 0.20 && m1.diff < 3) {
    verdict = "FAIL";
    reason = "no-effect";
  } else if (m1.diff >= 6 && m2.g < m2.c - 3) {
    verdict = "FAIL";
    reason = "FAIL-TRADE";
  }

  const report = {
    verdict,
    reason,
    m1,
    m2,
    m3,
    fisher_p: fisherP,
    mechanism_runs: mechanismRuns,
    valid_runs: { c: scored.C.length, g: scored.G.length },
    mismatches,
    infra_attempt_rate: infra,
    reported: {
      retries_per_run: retriesPerRun,
      first_failing_turn: firstFailing,
      verifier_oracle_disagreements: disagreements,
      verifier_passed_oracle_failed_G: verifierPassedOracleFailedG
    }
  };
  process.stdout.write(JSON.stringify(report) + "\n");
  process.stdout.write(snapshotSection(outDir, data));
}

function triggerKind(record) {
  const violations = Array.isArray(record.violations) && record.violations.length > 0;
  const gaps = Array.isArray(record.feature_gaps) && record.feature_gaps.length > 0;
  if (violations && gaps) return "both";
  if (violations) return "violations only";
  if (gaps) return "features only";
  return null;
}

function snapshotSection(outDir, rows) {
  const totals = {
    "violations only": { persisted: 0, fixed: 0, introduced: 0 },
    "features only": { persisted: 0, fixed: 0, introduced: 0 },
    both: { persisted: 0, fixed: 0, introduced: 0 }
  };
  let verifyTurn = null;
  try {
    verifyTurn = require(path.join(TASK_DIR, "gate", "verify-turn.js")).verifyTurn;
  } catch (err) {
    verifyTurn = null;
  }
  for (const row of rows) {
    if (row.record === "header" || row.group !== "G") continue;
    const dir = row.out_dir && fs.existsSync(row.out_dir) ? row.out_dir : runDirFor(outDir, row);
    if (!fs.existsSync(dir)) continue;
    let names = [];
    try { names = fs.readdirSync(dir); } catch (err) { continue; }
    const snaps = names.filter((name) => /^snapshot_[1-5]_[0-9]+$/.test(name));
    if (!snaps.length) continue;
    const byTurn = new Map();
    for (const line of readGateLines(dir)) {
      const key = String(line.turn);
      if (!byTurn.has(key)) byTurn.set(key, []);
      byTurn.get(key).push(line);
    }
    for (const name of snaps) {
      const match = name.match(/^snapshot_([1-5])_([0-9]+)$/);
      const turn = Number(match[1]);
      const k = Number(match[2]);
      const seq = byTurn.get(String(turn)) || [];
      const pre = seq[k - 1];
      const next = seq[k];
      const kind = pre ? triggerKind(pre) : null;
      if (!kind || !next || !verifyTurn) continue;
      let before = [];
      try {
        const result = verifyTurn({ turn, repo: path.join(dir, name) });
        before = result && result.body && Array.isArray(result.body.feature_gaps) ? result.body.feature_gaps : [];
      } catch (err) {
        continue;
      }
      const after = Array.isArray(next.feature_gaps) ? next.feature_gaps : [];
      const beforeSet = new Set(before);
      const afterSet = new Set(after);
      for (const item of beforeSet) {
        if (afterSet.has(item)) totals[kind].persisted++;
        else totals[kind].fixed++;
      }
      for (const item of afterSet) {
        if (!beforeSet.has(item)) totals[kind].introduced++;
      }
    }
  }
  const lines = ["feature gaps persisted, fixed and introduced by retries"];
  for (const kind of ["violations only", "features only", "both"]) {
    const item = totals[kind];
    lines.push(kind + ": persisted=" + item.persisted + " fixed=" + item.fixed + " introduced=" + item.introduced);
  }
  return lines.join("\n") + "\n";
}

main();
