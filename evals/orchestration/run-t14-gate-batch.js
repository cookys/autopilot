#!/usr/bin/env node
"use strict";
// BL-0055 S3 — resumable interleaved C/G batch for the t14 per-turn gate.
// Arms differ only in --gate: C observe, G enforce. Both use --arm off,
// model claude-haiku-4-5, 5 turns. Scoring flags are copied from oracle.log;
// the analyzer recomputes them and does not trust this row.

const fs = require("fs");
const os = require("os");
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
const TASK_REL = "evals/orchestration/tasks/t14-constraint-horizon";
const TASK_DIR = path.join(REPO, TASK_REL);
const DEFAULT_HARNESS = path.join(REPO, "evals/orchestration/run-orchestration-eval.sh");
const PLAN_REL = "docs/plans/2026-10-19-t14-per-turn-gate-experiment.md";
const MODEL = "claude-haiku-4-5";

function usage(msg) {
  if (msg) process.stderr.write(msg + "\n");
  process.stderr.write(
    "Usage: node run-t14-gate-batch.js --out DIR --pairs N --pin-version VER [--workers 1]\n" +
    "       [--harness PATH] [--claude-bin PATH] [--runner cc|stub] [--stub-bin PATH]\n"
  );
  process.exit(2);
}

function parseArgs(argv) {
  const opt = {
    out: "",
    pairs: 0,
    pin: "",
    workers: 1,
    harness: DEFAULT_HARNESS,
    claudeBin: "claude",
    runner: "cc",
    stubBin: process.env.ORCH_STUB_BIN || ""
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) usage("missing value for " + a);
      return argv[++i];
    };
    if (a === "--out") opt.out = next();
    else if (a === "--pairs") opt.pairs = Number(next());
    else if (a === "--pin-version") opt.pin = next();
    else if (a === "--workers") opt.workers = Number(next());
    else if (a === "--harness") opt.harness = next();
    else if (a === "--claude-bin") opt.claudeBin = next();
    else if (a === "--runner") opt.runner = next();
    else if (a === "--stub-bin") opt.stubBin = next();
    else usage("unknown argument: " + a);
  }
  if (!opt.out || !opt.pin) usage("missing --out or --pin-version");
  if (!Number.isInteger(opt.pairs) || opt.pairs < 1) usage("--pairs must be a positive integer");
  if (!Number.isInteger(opt.workers) || opt.workers < 1) usage("--workers must be a positive integer");
  if (opt.runner !== "cc" && opt.runner !== "stub") usage("--runner must be cc or stub");
  if (opt.runner === "stub" && !opt.stubBin) usage("--stub-bin (or ORCH_STUB_BIN) is required for --runner stub");
  return opt;
}

function git(args) {
  const r = spawnSync("git", args, { cwd: REPO, encoding: "utf8" });
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
  for (const rel of rels) {
    const hash = git(["hash-object", path.join(TASK_DIR, rel)]);
    if (!hash) {
      process.stderr.write("git hash-object failed for " + rel + "\n");
      process.exit(2);
    }
    frozen[rel] = hash;
  }
  return frozen;
}

function hashesMatch(recorded) {
  const current = frozenHashes();
  const keys = new Set([...Object.keys(recorded || {}), ...Object.keys(current)]);
  for (const key of keys) {
    if (recorded[key] !== current[key]) return false;
  }
  return true;
}

function shellQuote(s) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(s)) return s;
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

function loadJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf8");
  const lines = raw.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === "") continue;
    try {
      rows.push(JSON.parse(lines[i]));
    } catch (err) {
      if (i === lines.length - 1) {
        const kept = lines.slice(0, i).filter((line) => line !== "");
        fs.writeFileSync(file, kept.length ? kept.join("\n") + "\n" : "");
        break;
      }
      process.stderr.write("corrupt results.jsonl at line " + (i + 1) + "\n");
      process.exit(2);
    }
  }
  return rows;
}

function appendJson(file, obj) {
  const fd = fs.openSync(file, "a");
  fs.writeSync(fd, JSON.stringify(obj) + "\n");
  fs.fsyncSync(fd);
  fs.closeSync(fd);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function buildSchedule(pairs) {
  const order = [];
  for (let pair = 1; pair <= pairs; pair++) {
    const c = "C-" + pad2(pair);
    const g = "G-" + pad2(pair);
    order.push({ pair, run_ids: pair % 2 === 1 ? [c, g] : [g, c] });
  }
  return { pairs, order, workers: null };
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

function readOracle(outDir) {
  const logPath = path.join(outDir, "oracle.log");
  if (!fs.existsSync(logPath)) return {};
  const text = fs.readFileSync(logPath, "utf8");
  const obj = extractJson(text) || {};
  const decoy = /decoy_respected=true/.test(text) ? true : (/decoy_respected=false/.test(text) ? false : null);
  const fidelity = /fidelity_ok=true/.test(text) ? true : (/fidelity_ok=false/.test(text) ? false : null);
  return {
    decoy_respected: decoy,
    fidelity_ok: fidelity,
    oracle_pass: decoy === true && fidelity === true,
    constraints: obj.constraints || null,
    features: obj.features || null
  };
}

function readGate(outDir) {
  const gatePath = path.join(outDir, "gate.jsonl");
  if (!fs.existsSync(gatePath)) return null;
  const lines = fs.readFileSync(gatePath, "utf8").split("\n").filter(Boolean);
  if (!lines.length) return null;
  try { return JSON.parse(lines[lines.length - 1]); } catch (err) { return null; }
}

function readCost(outDir) {
  const logPath = path.join(outDir, "run.log");
  if (!fs.existsSync(logPath)) return null;
  const text = fs.readFileSync(logPath, "utf8");
  const m = text.match(/"total_cost_usd"\s*:\s*([0-9.]+)/);
  return m ? Number(m[1]) : null;
}

function authProbe() {
  // AUTH_PROBE_BODY
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "orch-eval-scratch-home-"));
  try {
    const cred = path.join(process.env.HOME || "", ".claude", ".credentials.json");
    if (process.env.HOME && fs.existsSync(cred)) {
      fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
      const dest = path.join(home, ".claude", ".credentials.json");
      fs.copyFileSync(cred, dest);
      fs.chmodSync(dest, 0o600);
    }
    fs.writeFileSync(path.join(home, ".claude.json"), '{"hasCompletedOnboarding":true}\n');
    const r = spawnSync(OPT.claudeBin, [
      "-p", "--model", MODEL,
      "--setting-sources", "project",
      "--strict-mcp-config",
      "--dangerously-skip-permissions"
    ], {
      input: "Reply with exactly AUTH_OK\n",
      encoding: "utf8",
      env: { ...process.env, HOME: home },
      timeout: 60000
    });
    if (r.status !== 0) return false;
    return String(r.stdout || "").includes("AUTH_OK");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function versionProbe() {
  const r = spawnSync(OPT.claudeBin, ["--version"], { encoding: "utf8", timeout: 15000 });
  return ((r.stdout || "").split("\n")[0] || "").trim();
}

function stopBatch(reason) {
  const resume = process.argv.map(shellQuote).join(" ");
  process.stdout.write("STOP reason=" + reason + " resume=" + resume + "\n");
  process.exit(75);
}

function isValidRow(row) {
  return row.turns_completed === 5 && row.failure_class !== "infra_fail";
}

function runOne(item) {
  const seen = versionProbe();
  if (seen !== OPT.pin) stopBatch("version");
  if (!authProbe()) stopBatch("auth");
  const group = item.runId[0];
  const gate = group === "G" ? "enforce" : "observe";
  const outDir = path.join(OPT.out, "runs", item.runId, "attempt-" + item.attempt);
  fs.mkdirSync(outDir, { recursive: true });
  const args = [
    "--task", "t14-constraint-horizon",
    "--arm", "off",
    "--runner", OPT.runner,
    "--model", MODEL,
    "--out", outDir,
    "--gate", gate
  ];
  const env = { ...process.env };
  if (OPT.stubBin) env.ORCH_STUB_BIN = OPT.stubBin;
  const started = new Date().toISOString();
  process.stderr.write("run " + item.runId + " attempt " + item.attempt + "\n");
  spawnSync("bash", [OPT.harness, ...args], { env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  let result = {};
  const resultPath = path.join(outDir, "result.json");
  if (fs.existsSync(resultPath)) {
    try { result = JSON.parse(fs.readFileSync(resultPath, "utf8")); } catch (err) { result = {}; }
  }
  const oracle = readOracle(outDir);
  const gateLast = readGate(outDir);
  let runnerVersion = result.runner_version;
  if (runnerVersion == null || runnerVersion === "null" || runnerVersion === "unknown" || runnerVersion === "") {
    runnerVersion = seen;
  }
  const turns = Number.isFinite(result.turns_completed) ? result.turns_completed : 0;
  let failureClass = Object.prototype.hasOwnProperty.call(result, "failure_class") ? result.failure_class : "infra_fail";
  let failureCause = Object.prototype.hasOwnProperty.call(result, "failure_cause") ? result.failure_cause : "runner_error";
  if (!fs.existsSync(resultPath)) {
    failureClass = "infra_fail";
    failureCause = "runner_error";
  }
  const row = {
    batch_id: item.batchId,
    run_id: item.runId,
    pair: item.pair,
    group,
    attempt: item.attempt,
    started_at: started,
    git_sha: item.gitSha,
    runner_version: runnerVersion,
    model: result.model || MODEL,
    duration: Number.isFinite(result.duration) ? result.duration : null,
    turns_completed: turns,
    valid: turns === 5 && failureClass !== "infra_fail",
    failure_class: failureClass,
    failure_cause: failureCause,
    oracle_pass: oracle.oracle_pass === undefined ? null : oracle.oracle_pass,
    decoy_respected: oracle.decoy_respected === undefined ? null : oracle.decoy_respected,
    fidelity_ok: oracle.fidelity_ok === undefined ? null : oracle.fidelity_ok,
    constraints: oracle.constraints || null,
    features: oracle.features || null,
    gate_mode: result.gate || gate,
    gate_retries: Number.isFinite(result.gate_retries) ? result.gate_retries : 0,
    gate_retries_by_turn: Array.isArray(result.gate_retries_by_turn) ? result.gate_retries_by_turn : [],
    gate_violations_by_turn: Array.isArray(result.gate_violations_by_turn) ? result.gate_violations_by_turn : [],
    gate_exhausted: result.gate_exhausted === true,
    verifier_final_ok: gateLast && typeof gateLast.ok === "boolean" ? gateLast.ok : null,
    cost_usd: readCost(outDir),
    out_dir: outDir
  };
  appendJson(path.join(OPT.out, "results.jsonl"), row);
  return row;
}

const OPT = parseArgs(process.argv.slice(2));

function main() {
  fs.mkdirSync(OPT.out, { recursive: true });
  const resultsPath = path.join(OPT.out, "results.jsonl");
  const schedulePath = path.join(OPT.out, "schedule.json");
  let schedule;
  if (fs.existsSync(schedulePath)) {
    schedule = JSON.parse(fs.readFileSync(schedulePath, "utf8"));
    if (schedule.pairs !== OPT.pairs) {
      process.stderr.write(
        "REFUSE --pairs " + OPT.pairs + " does not match schedule.json pairs " + schedule.pairs +
        "; the schedule is never regenerated\n"
      );
      process.exit(2);
    }
  } else {
    schedule = buildSchedule(OPT.pairs);
    schedule.workers = OPT.workers;
    fs.writeFileSync(schedulePath, JSON.stringify(schedule, null, 2) + "\n");
  }
  let rows = loadJsonl(resultsPath);
  let header = rows.find((row) => row.record === "header");
  if (!header) {
    if (rows.length) {
      process.stderr.write("results.jsonl has rows but no header\n");
      process.exit(2);
    }
    header = {
      record: "header",
      batch_id: git(["rev-parse", "--short", "HEAD"]) + "-" + Date.now().toString(36),
      plan_commit: git(["log", "-1", "--format=%H", "--", PLAN_REL]),
      harness_commit: git(["log", "-1", "--format=%H", "--", "evals/orchestration/run-orchestration-eval.sh"]),
      git_sha: git(["rev-parse", "HEAD"]),
      pin_version: OPT.pin,
      frozen: frozenHashes(),
      pairs: schedule.pairs
    };
    appendJson(resultsPath, header);
    rows.push(header);
  } else if (!hashesMatch(header.frozen)) {
    process.stderr.write("REFUSE frozen-file hash mismatch\n");
    process.exit(2);
  }
  if (header.pairs !== OPT.pairs) {
    process.stderr.write(
      "REFUSE --pairs " + OPT.pairs + " does not match results.jsonl header pairs " + header.pairs +
      "; the schedule is never regenerated\n"
    );
    process.exit(2);
  }
  if (header.pin_version !== OPT.pin) stopBatch("version");

  // Consecutive stop rules are defined on schedule order, so workers are serialized.
  let zeroStreak = 0;
  let infraStreak = 0;
  for (const pair of schedule.order) {
    for (const runId of pair.run_ids) {
      const prior = rows.filter((row) => row.run_id === runId);
      if (prior.some(isValidRow)) continue;
      if (prior.length >= 3) continue;
      const row = runOne({
        runId,
        pair: pair.pair,
        attempt: prior.length + 1,
        batchId: header.batch_id,
        gitSha: header.git_sha
      });
      rows.push(row);
      if (row.turns_completed === 0) zeroStreak++;
      else zeroStreak = 0;
      if (row.failure_class === "infra_fail") infraStreak++;
      else infraStreak = 0;
      if (zeroStreak >= 2) stopBatch("quota");
      if (infraStreak >= 3) stopBatch("infra");
    }
  }
  process.stdout.write("DONE pairs=" + schedule.pairs + "\n");
}

main();
