#!/usr/bin/env node
// check-node-report.js — Node report contract validator (Node.js version).
//
// Schema-validates a node report JSON file against the contract defined in
// references/tree-contracts.md §4, then resolves every evidence_pointer and
// verifies artifact sha256 values.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const child_process = require('child_process');

function printStdout(str) {
  process.stdout.write(str + '\n');
}

function printStderr(str) {
  process.stderr.write(str + '\n');
}

function printUsage() {
  printStderr("usage: check-node-report.js <report.json> [--repo <path>]");
  printStderr("       check-node-report.js --help");
}

function printHelp() {
  const helpText = `check-node-report.js — Node report contract validator.

Schema-validates a node report JSON file against the contract defined in
references/tree-contracts.md §4, then resolves every evidence_pointer and
verifies artifact sha256 values.

Usage:
  node scripts/check-node-report.js <report.json> [--repo <path>]

Arguments:
  <report.json>   Path to the node report JSON file to validate.
  --repo <path>   Optional path to the git repository root. Used to resolve
                  file:line-range pointers that carry a commit SHA anchor
                  (via \`git show\`). If absent, falls back to the working tree
                  for path lookups with a pointer_stale warning.

Evidence pointer types (references/tree-contracts.md §5):
  file:line-range  <path>:<start>-<end>[@<commit-sha>]
                   File must exist; line range must be within file length.
                   If @sha present and --repo given, resolves via \`git show\`.
                   Moved-file resolution (two modes — §5.3):
                     Mode A (SHA anchor present): compute content hash of
                       original file at commit via \`git show <sha>:<path>\`,
                       compare against git ls-files candidates. Content-hash
                       match → pointer_stale warning (exit 0). Same-basename
                       candidate with different content → error (invalid).
                     Mode B (no SHA anchor): basename heuristic only; emits
                       pointer_degraded_basename_match warning (exit 0).
                     Not found in either mode → validation FAILURE.
  sha256:<hex>     64 lowercase hex chars after prefix. Format check only.

Output (stdout): one JSON object
  { "valid": true|false, "errors": [...], "warnings": [...] }

Exit codes:
  0   valid (warnings may be present)
  1   invalid (one or more errors)
  2   usage / precondition error

Dependencies: Node.js, git. No network.`;
  printStdout(helpText);
}

// Helper: check if file is text/markdown
function isTextFile(filePath, buffer) {
  const textExtensions = /\.(txt|md|js|ts|json|sh|py|jsonl|css|html|xml|yml|yaml|ini|csv|properties|conf|config|sql|map)$/i;
  if (textExtensions.test(filePath)) {
    return true;
  }
  const checkLen = Math.min(buffer.length, 8000);
  for (let i = 0; i < checkLen; i++) {
    if (buffer[i] === 0) {
      return false;
    }
  }
  return true;
}

// Helper: CRLF -> LF normalization
function normalizeTextContent(buffer) {
  const str = buffer.toString('utf8');
  const normalizedStr = str.replace(/\r\n/g, '\n');
  return Buffer.from(normalizedStr, 'utf8');
}

function getProcessedBuffer(filePath, rawBuffer) {
  if (isTextFile(filePath, rawBuffer)) {
    return normalizeTextContent(rawBuffer);
  }
  return rawBuffer;
}

// Helper: count occurrences of LF (\n)
function countLines(buffer) {
  let count = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 10) {
      count++;
    }
  }
  return count;
}

// Helper: sha256 checksum of buffer
function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// CLI argument parsing
const args = process.argv.slice(2);
let reportFile = null;
let repoPath = null;

if (args.length === 0) {
  printUsage();
  process.exit(2);
}

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--help' || arg === '-h') {
    printHelp();
    process.exit(0);
  } else if (arg === '--repo') {
    if (i + 1 >= args.length) {
      printStderr("check-node-report.js: --repo requires a path argument");
      process.exit(2);
    }
    repoPath = args[i + 1];
    i++;
  } else if (arg.startsWith('-')) {
    printStderr(`check-node-report.js: unknown option: ${arg}`);
    printUsage();
    process.exit(2);
  } else {
    if (reportFile !== null) {
      printStderr(`check-node-report.js: unexpected argument: ${arg}`);
      printUsage();
      process.exit(2);
    }
    reportFile = arg;
  }
}

if (!reportFile) {
  printStderr("check-node-report.js: <report.json> is required");
  printUsage();
  process.exit(2);
}

if (!fs.existsSync(reportFile) || !fs.statSync(reportFile).isFile()) {
  printStderr(`check-node-report.js: report file not found: ${reportFile}`);
  process.exit(2);
}

// Main validation wrapper to fail closed on unexpected exceptions
try {
  let fileContent;
  try {
    fileContent = fs.readFileSync(reportFile, 'utf8');
  } catch (e) {
    printStderr(`check-node-report.js: error reading report file: ${e.message}`);
    process.exit(2);
  }

  let reportJson;
  try {
    reportJson = JSON.parse(fileContent);
  } catch (e) {
    const result = {
      valid: false,
      errors: ["report file is not valid JSON"],
      warnings: []
    };
    printStdout(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  const errors = [];
  const warnings = [];

  function addError(msg) {
    errors.push(msg);
  }

  function addWarning(msg) {
    warnings.push(msg);
  }

  // Schema validation
  
  // Required string fields
  if (!('node' in reportJson)) {
    addError("missing required field: node");
  } else {
    const node = reportJson.node;
    if (typeof node !== 'string' || node === '') {
      addError("field 'node' must be a non-empty string");
    }
  }

  if (!('verdict' in reportJson)) {
    addError("missing required field: verdict");
  } else {
    const verdict = reportJson.verdict;
    if (typeof verdict !== 'string' || verdict === '') {
      addError("field 'verdict' must be a non-empty string");
    }
  }

  // Required number field: confidence (0.0 – 1.0)
  if (!('confidence' in reportJson)) {
    addError("missing required field: confidence");
  } else {
    const confidence = reportJson.confidence;
    if (confidence === null) {
      addError("field 'confidence' must not be null");
    } else if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
      addError("field 'confidence' must be a number (got non-number)");
    } else if (confidence < 0.0 || confidence > 1.0) {
      addError("field 'confidence' must be in range 0.0 – 1.0");
    }
  }

  // Required array fields
  const requiredArrays = ['evidence_pointers', 'artifact_paths', 'doa_log', 'escalations'];
  for (const field of requiredArrays) {
    if (!(field in reportJson)) {
      addError(`missing required field: ${field}`);
    } else if (!Array.isArray(reportJson[field])) {
      addError(`field '${field}' must be an array`);
    }
  }

  // Unknown schema_version (only version 1 is supported)
  if ('schema_version' in reportJson) {
    const sv = reportJson.schema_version;
    if (String(sv) !== '1') {
      addError(`unknown schema_version: ${sv} (only version 1 is supported)`);
    }
  }

  const epIsArray = Array.isArray(reportJson.evidence_pointers);
  const apIsArray = Array.isArray(reportJson.artifact_paths);

  // Verdict-bearing rule: non-null verdict requires non-empty evidence_pointers
  if ('verdict' in reportJson && reportJson.verdict !== null) {
    if (epIsArray && reportJson.evidence_pointers.length === 0) {
      addError("verdict-bearing report must have at least one evidence_pointer (evidence_pointers is empty)");
    }
  }

  // artifact_paths structural check
  if (apIsArray) {
    const badIndices = [];
    reportJson.artifact_paths.forEach((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item) ||
          typeof item.path !== 'string' || typeof item.sha256 !== 'string') {
        badIndices.push(index);
      }
    });
    if (badIndices.length > 0) {
      addError(`artifact_paths elements at indices [${badIndices.join(',')}] must be {path: string, sha256: string} objects`);
    }
  }

  // Guard: skip pointer/artifact resolution if fields are not arrays
  if (epIsArray && apIsArray) {
    const hasGitRepo = repoPath && fs.existsSync(path.join(repoPath, '.git'));

    // Resolve evidence_pointers
    for (let i = 0; i < reportJson.evidence_pointers.length; i++) {
      const ptr = reportJson.evidence_pointers[i];
      if (ptr === null || ptr === undefined || ptr === '' || typeof ptr !== 'string') {
        addError(`evidence_pointer at index ${i} is null or empty`);
        continue;
      }

      if (ptr.startsWith('sha256:')) {
        const hex = ptr.slice('sha256:'.length);
        if (!/^[0-9a-f]{64}$/.test(hex)) {
          addError(`sha256 pointer must be 'sha256:' followed by exactly 64 lowercase hex characters: ${ptr}`);
        }
      } else if (ptr.startsWith('file:') || ptr.includes(':')) {
        let rest = ptr;
        if (rest.startsWith('file:')) {
          rest = rest.slice('file:'.length);
        }

        let commitSha = "";
        const atIndex = rest.lastIndexOf('@');
        if (atIndex !== -1) {
          commitSha = rest.slice(atIndex + 1);
          rest = rest.slice(0, atIndex);
        }

        const colonIndex = rest.lastIndexOf(':');
        if (colonIndex === -1 || !rest.slice(colonIndex + 1).includes('-')) {
          addError(`malformed file:line-range pointer (expected path:start-end[@sha]): ${ptr}`);
          continue;
        }
        const filePath = rest.slice(0, colonIndex);
        const lineRange = rest.slice(colonIndex + 1);

        const hyphenIndex = lineRange.indexOf('-');
        if (hyphenIndex === -1) {
          addError(`malformed file:line-range pointer (expected path:start-end[@sha]): ${ptr}`);
          continue;
        }
        const startStr = lineRange.slice(0, hyphenIndex);
        const endStr = lineRange.slice(hyphenIndex + 1);

        if (!/^\d+$/.test(startStr)) {
          addError(`line range start is not a positive integer: ${ptr}`);
          continue;
        }
        if (!/^\d+$/.test(endStr)) {
          addError(`line range end is not a positive integer: ${ptr}`);
          continue;
        }
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);

        if (start < 1) {
          addError(`line range start must be >= 1: ${ptr}`);
          continue;
        }
        if (end < start) {
          addError(`line range end (${end}) must be >= start (${start}): ${ptr}`);
          continue;
        }

        if (commitSha === 'HEAD') {
          addWarning(`pointer uses @HEAD anchor which is not stable; use a concrete SHA for reproducible validation: ${ptr}`);
        }

        let gitShowFailed = false;
        let origContentBuffer = null;
        if (commitSha && hasGitRepo) {
          try {
            origContentBuffer = child_process.execFileSync(
              'git',
              ['-C', repoPath, 'show', `${commitSha}:${filePath}`],
              { stdio: ['pipe', 'pipe', 'ignore'] }
            );
          } catch (e) {
            gitShowFailed = true;
          }
        }

        let resolved = false;

        // Case 1: Commit SHA present, resolved successfully via git show
        if (commitSha && hasGitRepo && !gitShowFailed && origContentBuffer !== null) {
          const processedOrig = getProcessedBuffer(filePath, origContentBuffer);
          const origLineCount = countLines(processedOrig);
          if (end > origLineCount) {
            addError(`line range ${start}-${end} exceeds file length (${origLineCount} lines) at commit ${commitSha}: ${ptr}`);
            continue;
          }

          const fullWTPath = path.join(repoPath, filePath);
          if (!fs.existsSync(fullWTPath) || !fs.statSync(fullWTPath).isFile()) {
            const origHash = sha256(processedOrig);
            const basenameFp = path.basename(filePath);

            let allCandidates = [];
            try {
              const stdout = child_process.execFileSync('git', ['-C', repoPath, 'ls-files'], { stdio: ['pipe', 'pipe', 'ignore'] }).toString();
              allCandidates = stdout.split('\n').map(line => line.trim()).filter(line => line.length > 0);
            } catch (e) {}

            let movedFound = null;
            let basenameDiffFound = null;

            for (const candidate of allCandidates) {
              const fullCandPath = path.join(repoPath, candidate);
              if (!fs.existsSync(fullCandPath) || !fs.statSync(fullCandPath).isFile()) continue;

              let candBuffer;
              try {
                candBuffer = fs.readFileSync(fullCandPath);
              } catch (e) {
                continue;
              }

              const processedCand = getProcessedBuffer(candidate, candBuffer);
              const candHash = sha256(processedCand);

              if (candHash === origHash) {
                movedFound = fullCandPath;
                break;
              }

              if (path.basename(candidate) === basenameFp && !basenameDiffFound) {
                basenameDiffFound = fullCandPath;
              }
            }

            if (movedFound) {
              addWarning(`pointer_stale: file has moved; found at '${movedFound}' (content-hash verified) — pointer should be updated: ${ptr}`);
            } else if (basenameDiffFound) {
              addError(`moved-file: basename match '${basenameDiffFound}' has different content than original at ${commitSha}; pointer is invalid: ${ptr}`);
            } else {
              addError(`deleted-file: file resolved at commit ${commitSha} but no longer exists in working tree and no successor found: ${ptr}`);
            }
          }
          resolved = true;
        }

        if (!resolved) {
          if (commitSha) {
            if (gitShowFailed) {
              addWarning(`commit SHA '${commitSha}' not found in repo; falling back to working tree for pointer: ${ptr}`);
            } else if (!hasGitRepo) {
              addWarning(`pointer has commit SHA anchor but no --repo provided; falling back to working tree: ${ptr}`);
            }
          }

          // Working tree resolution
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            let wtBuffer;
            try {
              wtBuffer = fs.readFileSync(filePath);
            } catch (e) {
              addError(`error reading file in working tree: ${filePath} (${e.message})`);
              continue;
            }

            const processedWT = getProcessedBuffer(filePath, wtBuffer);
            const wtLineCount = countLines(processedWT);
            if (end > wtLineCount) {
              addError(`line range ${start}-${end} exceeds file length (${wtLineCount} lines) in working tree: ${ptr}`);
            }
            resolved = true;
          }
        }

        // Moved-file Mode B (No SHA anchor)
        if (!resolved && hasGitRepo) {
          const basenameFile = path.basename(filePath);
          if (!commitSha) {
            let allCandidates = [];
            try {
              const stdout = child_process.execFileSync('git', ['-C', repoPath, 'ls-files'], { stdio: ['pipe', 'pipe', 'ignore'] }).toString();
              allCandidates = stdout.split('\n').map(line => line.trim()).filter(line => line.length > 0);
            } catch (e) {}

            let degradedFound = null;
            for (const candidate of allCandidates) {
              if (path.basename(candidate) === basenameFile) {
                const fullCandPath = path.join(repoPath, candidate);
                if (fs.existsSync(fullCandPath) && fs.statSync(fullCandPath).isFile()) {
                  degradedFound = fullCandPath;
                  break;
                }
              }
            }

            if (degradedFound) {
              addWarning(`pointer_degraded_basename_match: no commit-SHA anchor; basename heuristic matched '${degradedFound}' — pointer may be stale, content unverified: ${ptr}`);
              resolved = true;
            }
          }
        }

        if (!resolved) {
          addError(`file not found: ${filePath} (pointer: ${ptr})`);
        }
      } else {
        addError(`evidence_pointer has unknown type (expected 'file:<path>:<start>-<end>[@sha]' or 'sha256:<hex>'): ${ptr}`);
      }
    }

    // Verify artifact paths checksums
    for (let j = 0; j < reportJson.artifact_paths.length; j++) {
      const item = reportJson.artifact_paths[j];
      if (!item || typeof item !== 'object' || Array.isArray(item) ||
          typeof item.path !== 'string' || typeof item.sha256 !== 'string') {
        continue;
      }
      const artPath = item.path;
      const artSha = item.sha256;

      if (!fs.existsSync(artPath) || !fs.statSync(artPath).isFile()) {
        addError(`artifact not found at path: ${artPath} (artifact_paths[${j}])`);
        continue;
      }

      let rawArtBuffer;
      try {
        rawArtBuffer = fs.readFileSync(artPath);
      } catch (e) {
        addError(`error reading artifact path: ${artPath} (${e.message}) (artifact_paths[${j}])`);
        continue;
      }

      const processedArtBuffer = getProcessedBuffer(artPath, rawArtBuffer);
      const actualSha = sha256(processedArtBuffer);
      if (actualSha !== artSha) {
        addError(`sha256 mismatch for ${artPath}: expected ${artSha}, got ${actualSha} (artifact_paths[${j}])`);
      }
    }
  }

  // Print results
  const result = {
    valid: errors.length === 0,
    errors: errors,
    warnings: warnings
  };

  printStdout(JSON.stringify(result, null, 2));
  process.exit(errors.length === 0 ? 0 : 1);

} catch (err) {
  // Fail-closed posture
  const result = {
    valid: false,
    errors: [`unexpected execution error: ${err.message}`],
    warnings: []
  };
  printStdout(JSON.stringify(result, null, 2));
  process.exit(1);
}
