#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFileSync } = require('child_process');

const SCOPE_RULE = "Scope rule: judge ONLY the node whose report appears in the context — the deliverables implied by its 'node'/'question' fields and the claims the report itself makes. Project-level lifecycle steps (merging branches, release/quality gates, archiving, project status updates, and work belonging to OTHER nodes) are OUT OF SCOPE: do not list them as goals, extras, or misses.";
const Q1 = "What goals were achieved? Cite specific evidence from the report and artifacts. List each achieved goal on its own line prefixed 'ACHIEVED:'.";
const Q2 = "What was done BEYOND the stated goals (extras, scope creep, unrequested changes)? Be specific. List each on its own line prefixed 'EXTRA:'.";
const Q3 = "What goals were NOT achieved? What is still missing or incomplete? List each on its own line prefixed 'MISSED:'.";

const Q4_TEMPLATE = `Another reviewer claims the following is a MISSED goal of THIS node: __MISS__

Your job is to REFUTE this claim if you can. Using ONLY the node report and artifacts in the context above, decide whether the claim is wrong — e.g. the goal is actually satisfied by the artifacts, the claim is out of scope per the scope rule, or it misreads the node's deliverables.

Default to REFUTED when uncertain: a reviewer's miss must EARN its survival. Output exactly ONE line, one of:
  REFUTED: <one-sentence reason the claimed miss is wrong / already satisfied / out of scope>
  UNCERTAIN: <why you cannot confirm the miss is real>
  SURVIVES: <evidence the miss is genuinely real and in scope>`;

// Binary seams
const claudeBin = process.env.QC_CLAUDE_BIN || 'claude';
const agyBin = process.env.QC_AGY_BIN || 'agy';

// Model seams
const judgeAModel = process.env.QC_JUDGE_A_MODEL || 'claude-haiku-4-5';
const judgeBModel = process.env.QC_JUDGE_B_MODEL || 'Gemini 3.5 Flash (Medium)';
const synthModel = process.env.QC_SYNTH_MODEL || 'claude-haiku-4-5';

const scriptDir = __dirname;
const repoRoot = path.resolve(scriptDir, '..');

function printUsage() {
  console.log(`qc-panel.js — QC interrogation panel (task-tree engine P4)

  --report     <node-report.json>    required
  --artifacts  <path>[,<path>...]    required
  --diff       <diff-file>           optional
  --out        <dir>                 required unless --proj+--node set
  --proj       <project-name>        used to derive default --out path
  --node       <node-id>             used to derive default --out path

ENV: QC_CLAUDE_BIN, QC_AGY_BIN,
     QC_JUDGE_A_MODEL, QC_JUDGE_B_MODEL, QC_SYNTH_MODEL,
     CALIBRATION_DATA_DIR

EXIT: 0=ok/skipped, 1=judge/liveness failure, 2=usage/precondition`);
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

function estimateTokensFile(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  const stats = fs.statSync(filePath);
  return Math.floor(stats.size / 4);
}

function estimateTokensStr(str) {
  return Math.floor(Buffer.byteLength(str, 'utf8') / 4);
}

function validatePathComponent(name, label) {
  if (name.includes('..')) {
    console.error(`qc-panel.js: invalid ${label}: contains ".." path traversal: ${name}`);
    process.exit(2);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    console.error(`qc-panel.js: invalid ${label}: must match ^[A-Za-z0-9][A-Za-z0-9._-]*$ (got: ${name})`);
    process.exit(2);
  }
}

let tokenTotal = 0;

async function main() {
  let reportFile = '';
  let artifactsRaw = '';
  let diffFile = '';
  let outDir = '';
  let proj = '';
  let nodeId = '';

  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--report') {
      reportFile = args[++i] || '';
    } else if (arg === '--artifacts') {
      artifactsRaw = args[++i] || '';
    } else if (arg === '--diff') {
      diffFile = args[++i] || '';
    } else if (arg === '--out') {
      outDir = args[++i] || '';
    } else if (arg === '--proj') {
      proj = args[++i] || '';
    } else if (arg === '--node') {
      nodeId = args[++i] || '';
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      console.error(`qc-panel.js: unknown argument: ${arg}`);
      process.exit(2);
    }
  }

  // Preconditions
  if (!reportFile) {
    console.error("qc-panel.js: --report is required");
    process.exit(2);
  }
  if (!fs.existsSync(reportFile) || !fs.statSync(reportFile).isFile()) {
    console.error(`qc-panel.js: report file not readable: ${reportFile}`);
    process.exit(2);
  }

  let reportJson;
  try {
    const content = fs.readFileSync(reportFile, 'utf8');
    reportJson = JSON.parse(content);
  } catch (e) {
    console.error(`qc-panel.js: report file is not valid JSON: ${reportFile}`);
    process.exit(2);
  }

  if (!artifactsRaw) {
    console.error("qc-panel.js: --artifacts is required");
    process.exit(2);
  }

  if (proj) validatePathComponent(proj, '--proj');
  if (nodeId) validatePathComponent(nodeId, '--node');

  if (!outDir) {
    if (proj && nodeId) {
      outDir = path.join(repoRoot, 'docs', 'projects', proj, 'tree', 'panel');
    } else {
      console.error("qc-panel.js: --out is required unless both --proj and --node are set");
      process.exit(2);
    }
  }

  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch (e) {
    console.error(`qc-panel.js: cannot create output dir: ${outDir}`);
    process.exit(2);
  }

  const nodeVerdict = reportJson.verdict !== undefined ? reportJson.verdict : null;

  // Calibration vocabulary bridge
  let nodeVerdictCal = '';
  if (nodeVerdict !== null && nodeVerdict !== '') {
    const lowerVerdict = String(nodeVerdict).trim().toLowerCase();
    if (['pass', 'approved', 'approve', 'lgtm'].includes(lowerVerdict)) {
      nodeVerdictCal = 'pass';
    } else if (['fail', 'rejected', 'reject'].includes(lowerVerdict)) {
      nodeVerdictCal = 'fail';
    } else {
      console.error(`qc-panel.js: liveness failure: VERDICT_UNMAPPABLE: node report verdict '${nodeVerdict}' has no pass/fail mapping for calibration (pass|approved|approve|lgtm → pass; fail|rejected|reject → fail). Fix the node report verdict or extend the map.`);
      process.exit(1);
    }
  }

  if (nodeVerdict === null || nodeVerdict === '') {
    const ts = nowIso().replace(/[^a-zA-Z0-9]/g, '-').replace(/-+$/, '');
    const nodeLabel = nodeId || 'node';
    const skipFile = path.join(outDir, `${nodeLabel}-${ts}-skipped.json`);
    const skippedJsonStr = '{"status":"skipped","verdict":null,"dissents":[],"extras":[],"judges":null,"token_estimate":0,"skipped_reason":"null-verdict"}\n';
    try {
      fs.writeFileSync(skipFile, skippedJsonStr);
    } catch (e) {}
    process.stdout.write(skippedJsonStr);
    process.exit(0);
  }

  // Work directory
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-panel-'));
  const cleanupWork = () => {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch (e) {}
  };
  process.on('exit', cleanupWork);
  process.on('SIGINT', () => { cleanupWork(); process.exit(1); });
  process.on('SIGTERM', () => { cleanupWork(); process.exit(1); });

  // Build context.txt
  let contextContent = '=== NODE REPORT ===\n';
  const reportContent = fs.readFileSync(reportFile, 'utf8').replace(/\r\n/g, '\n');
  contextContent += reportContent;
  if (!contextContent.endsWith('\n')) {
    contextContent += '\n';
  }
  contextContent += '\n=== ARTIFACTS ===\n';

  const artifactPaths = artifactsRaw.split(',').map(p => p.trim());
  for (const ap of artifactPaths) {
    if (!ap) continue;
    if (fs.existsSync(ap) && fs.statSync(ap).isFile()) {
      contextContent += `--- ${ap} ---\n`;
      const artContent = fs.readFileSync(ap, 'utf8').replace(/\r\n/g, '\n');
      contextContent += artContent;
      if (!artContent.endsWith('\n')) {
        contextContent += '\n';
      }
    } else {
      contextContent += `--- ${ap} (NOT FOUND) ---\n`;
    }
  }

  if (diffFile && fs.existsSync(diffFile) && fs.statSync(diffFile).isFile()) {
    contextContent += '\n=== DIFF ===\n';
    const diffContent = fs.readFileSync(diffFile, 'utf8').replace(/\r\n/g, '\n');
    contextContent += diffContent;
    if (!diffContent.endsWith('\n')) {
      contextContent += '\n';
    }
  }

  const contextFile = path.join(workDir, 'context.txt');
  fs.writeFileSync(contextFile, contextContent);
  const ctxTokens = estimateTokensFile(contextFile);

  const aQ1 = path.join(workDir, 'a_q1.txt');
  const aQ2 = path.join(workDir, 'a_q2.txt');
  const aQ3 = path.join(workDir, 'a_q3.txt');
  const bQ1 = path.join(workDir, 'b_q1.txt');
  const bQ2 = path.join(workDir, 'b_q2.txt');
  const bQ3 = path.join(workDir, 'b_q3.txt');

  // Runners for Judge A & B
  function runJudgeA(qnum, question, outfile) {
    return new Promise((resolve, reject) => {
      const prompt = `You are a code review judge. Review the following context and answer the question.\n\n${SCOPE_RULE}\n\nQUESTION: ${question}\n\nCONTEXT:\n`;
      const promptTokens = estimateTokensStr(prompt);
      tokenTotal += promptTokens + ctxTokens;

      const isA_Codex = (path.basename(claudeBin) === 'codex') || judgeAModel.includes('gpt-5.5');
      let childBin = claudeBin;
      let childArgs = [];
      if (isA_Codex) {
        childBin = path.basename(claudeBin) === 'codex' ? claudeBin : 'codex';
        childArgs = [
          'exec',
          '--model', judgeAModel,
          '--dangerously-bypass-approvals-and-sandbox',
          '--dangerously-bypass-hook-trust',
          '-c', 'thinking="xhigh"',
          '-c', 'shell_environment_policy.inherit=all'
        ];
      } else {
        childArgs = ['-p', '--model', judgeAModel];
      }
      const child = spawn(childBin, childArgs, {
        stdio: ['pipe', 'pipe', 'ignore']
      });

      // Buffer stdout in memory (like runJudgeB) and write it synchronously on
      // close. Piping to a createWriteStream and resolving on 'close' WITHOUT
      // awaiting the stream's 'finish' could read a truncated file — a dropped
      // trailing chunk can lose a MISSED: line and flip the gating verdict to a
      // false PASS.
      let aOut = '';
      child.stdout.on('data', (data) => { aOut += data.toString(); });

      // A judge that exits before draining stdin emits EPIPE on the write side;
      // swallow it so it never crashes the run mid-flight (Amendment 4 liveness).
      child.stdin.on('error', () => {});

      child.on('error', (err) => {
        console.error(`qc-panel.js: judge A Q${qnum} failed to start: ${err.message}`);
        fs.writeFileSync(outfile, JSON.stringify({ judge: 'a', q: qnum, error: 'judge_failed' }) + '\n');
        reject(err);
      });

      child.stdin.write(prompt, () => {
        const ctxStream = fs.createReadStream(contextFile);
        ctxStream.pipe(child.stdin);
      });

      child.on('close', (code) => {
        if (code !== 0) {
          console.error(`qc-panel.js: judge A Q${qnum} failed`);
          fs.writeFileSync(outfile, JSON.stringify({ judge: 'a', q: qnum, error: 'judge_failed' }) + '\n');
          reject(new Error(`judge A Q${qnum} exited with code ${code}`));
        } else {
          fs.writeFileSync(outfile, aOut);
          const respTokens = estimateTokensFile(outfile);
          tokenTotal += respTokens;
          resolve();
        }
      });
    });
  }

  function runJudgeB(qnum, question, outfile) {
    return new Promise((resolve, reject) => {
      let judgeDir;
      try {
        judgeDir = fs.mkdtempSync(path.join(os.tmpdir(), `qc-judge-b-q${qnum}-`));
        fs.copyFileSync(contextFile, path.join(judgeDir, 'context.txt'));
      } catch (e) {
        console.error(`qc-panel.js: failed to set up judge B Q${qnum} dir: ${e.message}`);
        fs.writeFileSync(outfile, JSON.stringify({ judge: 'b', q: qnum, error: 'judge_failed' }) + '\n');
        return reject(e);
      }

      const prompt = `You are a code review judge. Review context.txt and answer this question:\n\n${SCOPE_RULE}\n\nQUESTION: ${question}\n\nWRITE your answer to ./verdict.txt then output only the word DONE.\n`;
      const promptTokens = estimateTokensStr(prompt);
      tokenTotal += promptTokens + ctxTokens;

      const agyBaseName = path.basename(agyBin);
      const isCodex = (agyBaseName === 'codex') || judgeBModel.includes('gpt-5.5');

      let childBin = agyBin;
      let childArgs = [];

      if (isCodex) {
        childBin = agyBaseName === 'codex' ? agyBin : 'codex';
        childArgs = [
          'exec',
          '--model', judgeBModel,
          '--dangerously-bypass-approvals-and-sandbox',
          '--dangerously-bypass-hook-trust',
          '-c', 'thinking="xhigh"',
          '-c', 'shell_environment_policy.inherit=all'
        ];
      } else {
        childBin = agyBin;
        childArgs = [
          '-p', prompt,
          '--model', judgeBModel,
          '--dangerously-skip-permissions',
          '--print-timeout', '8m'
        ];
      }

      const child = spawn(childBin, childArgs, {
        cwd: judgeDir,
        stdio: ['pipe', 'pipe', 'ignore']
      });

      let agyOut = '';
      child.stdout.on('data', (data) => {
        agyOut += data.toString();
      });
      child.stdin.on('error', () => {}); // swallow EPIPE if the judge exits early

      if (isCodex) {
        child.stdin.write(prompt);
        child.stdin.end();
      } else {
        child.stdin.end();
      }

      child.on('error', (err) => {
        console.error(`qc-panel.js: judge B Q${qnum} failed to start: ${err.message}`);
        fs.writeFileSync(outfile, JSON.stringify({ judge: 'b', q: qnum, error: 'judge_failed' }) + '\n');
        try { fs.rmSync(judgeDir, { recursive: true, force: true }); } catch (_) {}
        reject(err);
      });

      child.on('close', (code) => {
        const verdictTarget = path.join(judgeDir, 'verdict.txt');
        let success = false;

        if (fs.existsSync(verdictTarget) && fs.statSync(verdictTarget).size > 0) {
          fs.copyFileSync(verdictTarget, outfile);
          success = true;
        } else {
          if (agyOut.trim().length > 0) {
            fs.writeFileSync(outfile, agyOut);
            success = true;
          }
        }

        try { fs.rmSync(judgeDir, { recursive: true, force: true }); } catch (_) {}

        if (success) {
          const respTokens = estimateTokensFile(outfile);
          tokenTotal += respTokens;
          resolve();
        } else {
          console.error(`qc-panel.js: judge B Q${qnum} produced no output`);
          fs.writeFileSync(outfile, JSON.stringify({ judge: 'b', q: qnum, error: 'judge_failed' }) + '\n');
          reject(new Error(`judge B Q${qnum} produced no output`));
        }
      });
    });
  }

  // Refute runners
  function refuteWithJudgeA(miss) {
    return new Promise((resolve) => {
      const question = Q4_TEMPLATE.replace(/__MISS__/g, miss);
      const prompt = `You are a code review judge. Review the following context and answer the question.\n\n${SCOPE_RULE}\n\nQUESTION: ${question}\n\nCONTEXT:\n`;

      const promptTokens = estimateTokensStr(prompt);
      tokenTotal += promptTokens + ctxTokens;

      const isRefute_Codex = (path.basename(claudeBin) === 'codex') || judgeAModel.includes('gpt-5.5');
      let childBin = claudeBin;
      let childArgs = [];
      if (isRefute_Codex) {
        childBin = path.basename(claudeBin) === 'codex' ? claudeBin : 'codex';
        childArgs = [
          'exec',
          '--model', judgeAModel,
          '--dangerously-bypass-approvals-and-sandbox',
          '--dangerously-bypass-hook-trust',
          '-c', 'thinking="xhigh"',
          '-c', 'shell_environment_policy.inherit=all'
        ];
      } else {
        childArgs = ['-p', '--model', judgeAModel];
      }
      const child = spawn(childBin, childArgs, {
        stdio: ['pipe', 'pipe', 'ignore']
      });

      let out = '';
      child.stdout.on('data', (data) => {
        out += data.toString();
      });
      child.stdin.on('error', () => {}); // swallow EPIPE if the judge exits early

      child.on('error', () => {
        resolve('');
      });

      child.stdin.write(prompt, () => {
        const ctxStream = fs.createReadStream(contextFile);
        ctxStream.pipe(child.stdin);
      });

      child.on('close', (code) => {
        if (code !== 0) {
          resolve('');
        } else {
          const respTokens = estimateTokensStr(out);
          tokenTotal += respTokens;
          resolve(out);
        }
      });
    });
  }

  function refuteWithJudgeB(miss) {
    return new Promise((resolve) => {
      const question = Q4_TEMPLATE.replace(/__MISS__/g, miss);

      let judgeDir;
      try {
        judgeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-refute-b-'));
        fs.copyFileSync(contextFile, path.join(judgeDir, 'context.txt'));
      } catch (e) {
        return resolve('');
      }

      const prompt = `You are a code review judge. Review context.txt and answer this question:\n\n${SCOPE_RULE}\n\nQUESTION: ${question}\n\nWRITE your answer to ./verdict.txt then output only the word DONE.\n`;
      const promptTokens = estimateTokensStr(prompt);
      tokenTotal += promptTokens + ctxTokens;

      const agyBaseName = path.basename(agyBin);
      const isCodex = (agyBaseName === 'codex') || judgeBModel.includes('gpt-5.5');

      let childBin = agyBin;
      let childArgs = [];

      if (isCodex) {
        childBin = agyBaseName === 'codex' ? agyBin : 'codex';
        childArgs = [
          'exec',
          '--model', judgeBModel,
          '--dangerously-bypass-approvals-and-sandbox',
          '--dangerously-bypass-hook-trust',
          '-c', 'thinking="xhigh"',
          '-c', 'shell_environment_policy.inherit=all'
        ];
      } else {
        childBin = agyBin;
        childArgs = [
          '-p', prompt,
          '--model', judgeBModel,
          '--dangerously-skip-permissions',
          '--print-timeout', '8m'
        ];
      }

      const child = spawn(childBin, childArgs, {
        cwd: judgeDir,
        stdio: ['pipe', 'pipe', 'ignore']
      });

      let agyOut = '';
      child.stdout.on('data', (data) => {
        agyOut += data.toString();
      });
      child.stdin.on('error', () => {}); // swallow EPIPE if the judge exits early

      if (isCodex) {
        child.stdin.write(prompt);
        child.stdin.end();
      } else {
        child.stdin.end();
      }

      child.on('error', () => {
        try { fs.rmSync(judgeDir, { recursive: true, force: true }); } catch (_) {}
        resolve('');
      });

      child.on('close', (code) => {
        const verdictTarget = path.join(judgeDir, 'verdict.txt');
        let out = '';

        if (fs.existsSync(verdictTarget) && fs.statSync(verdictTarget).size > 0) {
          out = fs.readFileSync(verdictTarget, 'utf8');
        } else {
          out = agyOut;
        }

        try { fs.rmSync(judgeDir, { recursive: true, force: true }); } catch (_) {}

        const respTokens = estimateTokensStr(out);
        tokenTotal += respTokens;
        resolve(out);
      });
    });
  }

  // 6 Judge calls parallel execution
  let judgeFailures = 0;
  const wrapJudge = (promise) => promise.catch((err) => {
    judgeFailures++;
  });

  await Promise.all([
    wrapJudge(runJudgeA(1, Q1, aQ1)),
    wrapJudge(runJudgeA(2, Q2, aQ2)),
    wrapJudge(runJudgeA(3, Q3, aQ3)),
    wrapJudge(runJudgeB(1, Q1, bQ1)),
    wrapJudge(runJudgeB(2, Q2, bQ2)),
    wrapJudge(runJudgeB(3, Q3, bQ3))
  ]);

  if (judgeFailures > 0) {
    console.error(`qc-panel.js: liveness failure: ${judgeFailures} judge call(s) failed`);
    process.exit(1);
  }

  // Deterministic merge
  function collectLines(prefix, filePaths) {
    const collected = [];
    for (const fp of filePaths) {
      if (!fs.existsSync(fp)) continue;
      const content = fs.readFileSync(fp, 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        if (line.startsWith(`${prefix}:`)) {
          const clean = line.substring(prefix.length + 1).trim();
          if (clean !== '') {
            collected.push(clean);
          }
        }
      }
    }
    return collected;
  }

  const achievedLines = collectLines('ACHIEVED', [aQ1, bQ1]);
  const extrasLines = collectLines('EXTRA', [aQ2, bQ2]);
  const missedLines = collectLines('MISSED', [aQ3, bQ3]);

  const aMissedLines = collectLines('MISSED', [aQ3]);
  const bMissedLines = collectLines('MISSED', [bQ3]);

  const missedCount = missedLines.length;
  const deterministicVerdict = missedCount > 0 ? 'fail' : 'pass';

  // Synthesizer pass
  const synthPrompt = `You are a synthesis judge. ${SCOPE_RULE}

Based on the following interrogation results:

ACHIEVED GOALS:
${achievedLines.join('\n') || '(none)'}

ITEMS BEYOND STATED GOALS (EXTRAS):
${extrasLines.join('\n') || '(none)'}

UNACHIEVED GOALS:
${missedLines.join('\n') || '(none)'}

Output ONLY a JSON object with these fields:
- verdict: "pass" or "fail" (pass = all the NODE's stated goals achieved with no critical misses, applying the scope rule above)
- dissents: array of strings describing disagreements between judges (can be empty)
- extras: array of strings listing items done beyond stated goals (can be empty)

Example: {"verdict":"pass","dissents":[],"extras":["Added error handling beyond spec"]}`;

  function runSynthesizer() {
    return new Promise((resolve) => {
      const prompt = synthPrompt;
      const promptTokens = estimateTokensStr(prompt);
      tokenTotal += promptTokens;

      const isSynth_Codex = (path.basename(claudeBin) === 'codex') || synthModel.includes('gpt-5.5');
      let childBin = claudeBin;
      let childArgs = [];
      if (isSynth_Codex) {
        childBin = path.basename(claudeBin) === 'codex' ? claudeBin : 'codex';
        childArgs = [
          'exec',
          '--model', synthModel,
          '--dangerously-bypass-approvals-and-sandbox',
          '--dangerously-bypass-hook-trust',
          '-c', 'thinking="xhigh"',
          '-c', 'shell_environment_policy.inherit=all'
        ];
      } else {
        childArgs = ['-p', '--model', synthModel];
      }
      const child = spawn(childBin, childArgs, {
        stdio: ['pipe', 'pipe', 'ignore']
      });

      let out = '';
      child.stdout.on('data', (data) => {
        out += data.toString();
      });
      child.stdin.on('error', () => {}); // swallow EPIPE if the judge exits early

      child.on('error', (err) => {
        console.error(`qc-panel.js: synthesizer model call failed; using deterministic majority verdict (${deterministicVerdict})`);
        resolve(null);
      });

      child.stdin.write(prompt);
      child.stdin.end();

      child.on('close', (code) => {
        if (code !== 0) {
          console.error(`qc-panel.js: synthesizer model call failed; using deterministic majority verdict (${deterministicVerdict})`);
          resolve(null);
        } else {
          const respTokens = estimateTokensStr(out);
          tokenTotal += respTokens;
          resolve(out);
        }
      });
    });
  }

  function extractLastJson(text) {
    let best = null;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '{') {
        let depth = 0;
        let inString = false;
        let escape = false;
        let j = i;
        for (; j < text.length; j++) {
          const char = text[j];
          if (inString) {
            if (escape) {
              escape = false;
            } else if (char === '\\') {
              escape = true;
            } else if (char === '"') {
              inString = false;
            }
          } else {
            if (char === '"') {
              inString = true;
            } else if (char === '{') {
              depth++;
            } else if (char === '}') {
              depth--;
              if (depth === 0) {
                break;
              }
            }
          }
        }
        if (depth === 0) {
          const candidate = text.substring(i, j + 1);
          try {
            const parsed = JSON.parse(candidate);
            best = parsed;
          } catch (e) {
            // ignore
          }
        }
      }
    }
    return best;
  }

  function extractLastJsonFallback(text) {
    const best = extractLastJson(text);
    if (best) return best;

    console.error("qc-panel: extract_last_json found no parseable JSON; deterministic fallback will be used");

    const lines = text.split('\n').map(l => l.trim()).filter(l => l.startsWith('{'));
    if (lines.length > 0) {
      try {
        return JSON.parse(lines[lines.length - 1]);
      } catch (e) {
        // ignore
      }
    }
    return null;
  }

  let synthVerdict = deterministicVerdict;
  let synthDissents = [];
  let synthExtras = extrasLines;

  const synthOutText = await runSynthesizer();
  if (synthOutText) {
    const synthJson = extractLastJsonFallback(synthOutText);
    if (synthJson) {
      if (synthJson.verdict === 'pass' || synthJson.verdict === 'fail') {
        synthVerdict = synthJson.verdict;
      }
      // Match shell `.get("dissents"/"extras", [])`: once the synthesizer's JSON
      // parses, its absent dissents/extras mean "none" ([]), NOT a fall-back to
      // the deterministic Q2 list. The deterministic list only stands when synth
      // JSON fails to parse (synthJson === null, handled by the initializers).
      synthDissents = Array.isArray(synthJson.dissents) ? synthJson.dissents : [];
      synthExtras = Array.isArray(synthJson.extras) ? synthJson.extras : [];
    }
  }

  // Refute Shadow Pass
  function classifyRefutation(resp) {
    const match = resp.match(/REFUTED|UNCERTAIN|SURVIVES/i);
    if (match) {
      const first = match[0].toUpperCase();
      if (first === 'SURVIVES') {
        return 'survived';
      }
    }
    return 'refuted';
  }

  const refutedMisses = [];
  const survivedMisses = [];

  const refutePromises = [];

  for (const miss of aMissedLines) {
    refutePromises.push(
      refuteWithJudgeB(miss).then((resp) => {
        const classification = classifyRefutation(resp);
        if (classification === 'survived') {
          survivedMisses.push(miss);
        } else {
          refutedMisses.push(miss);
        }
      })
    );
  }

  for (const miss of bMissedLines) {
    refutePromises.push(
      refuteWithJudgeA(miss).then((resp) => {
        const classification = classifyRefutation(resp);
        if (classification === 'survived') {
          survivedMisses.push(miss);
        } else {
          refutedMisses.push(miss);
        }
      })
    );
  }

  await Promise.all(refutePromises);

  // Write outputs
  const ts = nowIso();
  const tsSafe = ts.replace(/:/g, '-');
  const nodeLabel = nodeId || 'node';
  const verdictFile = path.join(outDir, `${nodeLabel}-${tsSafe}.json`);

  const copyFileSafe = (src, dest) => {
    try {
      fs.copyFileSync(src, dest);
    } catch (e) {}
  };

  copyFileSafe(aQ1, path.join(outDir, `${nodeLabel}-${tsSafe}-a_q1.txt`));
  copyFileSafe(aQ2, path.join(outDir, `${nodeLabel}-${tsSafe}-a_q2.txt`));
  copyFileSafe(aQ3, path.join(outDir, `${nodeLabel}-${tsSafe}-a_q3.txt`));
  copyFileSafe(bQ1, path.join(outDir, `${nodeLabel}-${tsSafe}-b_q1.txt`));
  copyFileSafe(bQ2, path.join(outDir, `${nodeLabel}-${tsSafe}-b_q2.txt`));
  copyFileSafe(bQ3, path.join(outDir, `${nodeLabel}-${tsSafe}-b_q3.txt`));

  const judgesJson = {
    a_q1: `${nodeLabel}-${tsSafe}-a_q1.txt`,
    a_q2: `${nodeLabel}-${tsSafe}-a_q2.txt`,
    a_q3: `${nodeLabel}-${tsSafe}-a_q3.txt`,
    b_q1: `${nodeLabel}-${tsSafe}-b_q1.txt`,
    b_q2: `${nodeLabel}-${tsSafe}-b_q2.txt`,
    b_q3: `${nodeLabel}-${tsSafe}-b_q3.txt`
  };

  const refuteShadowJson = {
    refuted_misses: refutedMisses,
    survived_misses: survivedMisses
  };

  const verdictJsonObj = {
    status: 'ok',
    verdict: synthVerdict,
    dissents: synthDissents,
    extras: synthExtras,
    judges: judgesJson,
    refute_shadow: refuteShadowJson,
    token_estimate: tokenTotal,
    skipped_reason: null
  };

  const verdictJsonStr = JSON.stringify(verdictJsonObj) + '\n';

  try {
    fs.writeFileSync(verdictFile, verdictJsonStr);
  } catch (e) {
    console.error(`qc-panel.js: liveness failure: failed to write verdict artifact: ${verdictFile}`);
    process.exit(1);
  }

  // Calibration sample
  const refuteSrcTag = `refute=refuted:${refutedMisses.length},survived:${survivedMisses.length},gating_misses:${missedCount}`;
  const sourceTag = nodeId ? `node:${nodeId} ${refuteSrcTag}` : refuteSrcTag;

  const calibrationSh = path.join(scriptDir, 'calibration.sh');
  const calibrationArgs = [
    'add-sample',
    '--panel-verdict', synthVerdict,
    '--authoritative-verdict', nodeVerdictCal,
    '--baseline', 'self-report',
    '--tokens', String(tokenTotal),
    '--source', sourceTag
  ];

  try {
    execFileSync(calibrationSh, calibrationArgs, {
      stdio: 'inherit',
      env: process.env
    });
  } catch (e) {
    console.error(`qc-panel.js: liveness failure: calibration.sh add-sample failed (liveness assertion: panel run must produce a sample)`);
    process.exit(1);
  }

  process.stdout.write(verdictJsonStr);
  process.exit(0);
}

main().catch((err) => {
  console.error(`qc-panel.js: liveness failure: unexpected error: ${err.message}`);
  process.exit(1);
});
