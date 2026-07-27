#!/usr/bin/env node
'use strict';

const path = require('path');
const { dispatchReview } = require('../src/runners/review');
const { resolveReviewLoop } = require('../src/engine/resolve-review-loop');
const { runHarnessCli } = require('../src/harness/cli');
const { runEndpointsCli } = require('../src/endpoints/cli');
const { runStatusCli } = require('../src/status/cli');
const { runCampaignCli } = require('../src/campaign/cli');
const {
  AutopilotEngine,
  compileCampaignDispositionPolicy,
  compileCampaignDispositionProvider,
  loadCampaignDispositionAuthority,
} = require('../src/engine');

function printHelp() {
  process.stdout.write(`Usage:
  node bin/autopilot.js dispatch review [dispatch-review args...]
  node bin/autopilot.js engine review-loop [resolve-review-loop args...]
  node bin/autopilot.js engine implement-review --campaign-contract <file> [--campaign-seal <file>] [--campaign-ledger <file>] [--campaign-disposition-authority <file>|--campaign-disposition-policy deny-nonempty] [--mission-state <file>] --prompt-file <file> --branch <branch> --base <sha> [--cwd <repo>] [--max-rounds N] [--verify-cmd <shell command>] [--no-verify-first] [--require-qualified-reviewer|--allow-unqualified-reviewer] [--no-review-spec] [--resume]
  node bin/autopilot.js harness report [harness report args...]
  node bin/autopilot.js endpoints <init|list|which|set|doctor> [--json]
  node bin/autopilot.js status [quota|runs|roster|readiness] [--json] [--probe]
  node bin/autopilot.js campaign <inspect|status|resume> --campaign-id <id> [--ledger <file>]

Commands:
  dispatch review   Delegate to the read-only heterogeneous review dispatcher.
  engine review-loop
                    Delegate to the review-loop roster resolver.
  engine implement-review
                    Run implementer -> review -> repair through AutopilotEngine.
                    Reviewer qualification is fail-closed by default; use
                    --allow-unqualified-reviewer only as an explicit escape hatch.
                    --resume re-enters the verify+review phase against an existing
                    ahead branch (impl already committed) instead of re-dispatching
                    implementation; fails closed (resume_invalid) on a missing /
                    not-ahead / non-ancestor branch and never moves any ref.
                    --campaign-contract is mandatory. --legacy-unmanaged is a
                    v2.34.0-only compatibility rail, rejected for L5/L6, and
                    emits a machine-readable deprecation disclosure.
                    Non-empty review findings require a separately supplied
                    depth-0 disposition authority; reviewer output cannot
                    self-authorize.
  harness report    Emit read-only harness capability state and stale flags.
  endpoints         Manage endpoint credentials (list/which/set/doctor/init; --json;
  status            State overview: quota, runs, roster, or exact-seat readiness receipt (--json; readiness --probe may spend one bounded minimal request per stale exact tuple).
  campaign          Inspect/status durable campaign state or determine whether it is resumable.
  mission           Mission convergence control: init|grant|consume|control|check|receipt
                    over the canonical pure Mission reducer (no task DONE/closeout authority).
                    tokens never printed, never read from argv).

Exit codes:
  Delegated commands preserve the wrapped command exit code.
  2 = usage error / unknown command
`);
}

function parseImplementReviewArgs(rawArgs) {
  const output = {
    promptFile: null,
    branch: null,
    base: null,
    cwd: null,
    maxRounds: null,
    requireQualifiedReviewer: true,
    verifyCmd: null,
    noVerifyFirst: false,
    resume: false,
    campaignContract: null,
    campaignSeal: null,
    campaignLedger: null,
    campaignDispositionAuthority: null,
    campaignDispositionPolicy: null,
    missionState: null,
    campaignManaged: true,
    legacyUnmanaged: false,
  };
  let sawRequireQualifiedReviewer = false;
  let sawAllowUnqualifiedReviewer = false;

  let i = 0;
  while (i < rawArgs.length) {
    const arg = rawArgs[i];
    if (arg === '--prompt-file') {
      const value = rawArgs[i + 1];
      if (!value) {
        return { error: '--prompt-file requires a value' };
      }
      output.promptFile = value;
      i += 2;
      continue;
    }
    if (arg === '--campaign-contract') {
      const value = rawArgs[i + 1];
      if (!value) {
        return { error: '--campaign-contract requires a value' };
      }
      output.campaignContract = value;
      i += 2;
      continue;
    }
    if (arg === '--campaign-seal') {
      const value = rawArgs[i + 1];
      if (!value) {
        return { error: '--campaign-seal requires a value' };
      }
      output.campaignSeal = value;
      i += 2;
      continue;
    }
    if (arg === '--campaign-ledger') {
      const value = rawArgs[i + 1];
      if (!value) {
        return { error: '--campaign-ledger requires a value' };
      }
      output.campaignLedger = value;
      i += 2;
      continue;
    }
    if (arg === '--mission-state') {
      const value = rawArgs[i + 1];
      if (!value) {
        return { error: '--mission-state requires a value' };
      }
      output.missionState = value;
      i += 2;
      continue;
    }
    if (arg === '--campaign-disposition-authority') {
      const value = rawArgs[i + 1];
      if (!value) {
        return { error: '--campaign-disposition-authority requires a value' };
      }
      output.campaignDispositionAuthority = value;
      i += 2;
      continue;
    }
    if (arg === '--campaign-disposition-policy') {
      const value = rawArgs[i + 1];
      if (!value) {
        return { error: '--campaign-disposition-policy requires a value' };
      }
      output.campaignDispositionPolicy = value;
      i += 2;
      continue;
    }
    if (arg === '--legacy-unmanaged') {
      output.legacyUnmanaged = true;
      output.campaignManaged = false;
      i += 1;
      continue;
    }
    if (arg === '--branch') {
      const value = rawArgs[i + 1];
      if (!value) {
        return { error: '--branch requires a value' };
      }
      output.branch = value;
      i += 2;
      continue;
    }
    if (arg === '--base') {
      const value = rawArgs[i + 1];
      if (!value) {
        return { error: '--base requires a value' };
      }
      output.base = value;
      i += 2;
      continue;
    }
    if (arg === '--cwd') {
      const value = rawArgs[i + 1];
      if (!value) {
        return { error: '--cwd requires a value' };
      }
      output.cwd = value;
      i += 2;
      continue;
    }
    if (arg === '--max-rounds') {
      const value = rawArgs[i + 1];
      if (!value) {
        return { error: '--max-rounds requires a value' };
      }
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) {
        return { error: `invalid --max-rounds value: ${value}` };
      }
      output.maxRounds = n;
      i += 2;
      continue;
    }
    if (arg === '--verify-cmd') {
      const value = rawArgs[i + 1];
      if (!value) {
        return { error: '--verify-cmd requires a value' };
      }
      output.verifyCmd = value;
      i += 2;
      continue;
    }
    if (arg === '--no-verify-first') {
      output.noVerifyFirst = true;
      i += 1;
      continue;
    }
    if (arg === '--require-qualified-reviewer') {
      sawRequireQualifiedReviewer = true;
      output.requireQualifiedReviewer = true;
      i += 1;
      continue;
    }
    if (arg === '--allow-unqualified-reviewer') {
      sawAllowUnqualifiedReviewer = true;
      output.requireQualifiedReviewer = false;
      i += 1;
      continue;
    }
    if (arg === '--no-review-spec') {
      output.noReviewSpec = true;
      i += 1;
      continue;
    }
    if (arg === '--resume') {
      output.resume = true;
      i += 1;
      continue;
    }
    return { error: `unknown engine implement-review option: ${arg}` };
  }

  if (sawRequireQualifiedReviewer && sawAllowUnqualifiedReviewer) {
    return { error: 'flags --require-qualified-reviewer and --allow-unqualified-reviewer cannot be combined' };
  }

  if (!output.promptFile || !output.branch || !output.base) {
    return { error: 'flags --prompt-file, --branch, --base are required' };
  }
  if (output.legacyUnmanaged && output.campaignContract) {
    return { error: '--legacy-unmanaged cannot be combined with --campaign-contract' };
  }
  if (!output.legacyUnmanaged && !output.campaignContract) {
    return { error: '--campaign-contract is required; use --legacy-unmanaged only for compatibility' };
  }
  if (output.campaignDispositionAuthority && output.campaignDispositionPolicy) {
    return {
      error: '--campaign-disposition-authority and --campaign-disposition-policy cannot be combined',
    };
  }
  if (output.legacyUnmanaged
      && (output.campaignDispositionAuthority || output.campaignDispositionPolicy)) {
    return { error: 'campaign disposition controls require --campaign-contract' };
  }

  return output;
}

function failUsage(message = '') {
  if (message) {
    process.stderr.write(`ERROR: ${message}\n`);
  }
  printHelp();
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '-h' || args[0] === '--help' || args[0] === 'help') {
  printHelp();
  process.exit(0);
}

if (args[0] === 'status') {
  process.exit(runStatusCli(args.slice(1), { cwd: process.cwd() }));
}

if (args[0] === 'campaign') {
  process.exit(runCampaignCli(args.slice(1), { cwd: process.cwd() }));
}

if (args[0] === 'mission') {
  // Deferred import: the Mission CLI module loads only when this subcommand is
  // invoked (plan P2 single root route to src/mission/cli.js).
  const { runMissionCli } = require('../src/mission/cli');
  process.exit(runMissionCli(args.slice(1), { cwd: process.cwd() }));
}

if (args[0] === 'dispatch') {
  if (args[1] !== 'review') {
    failUsage(`unknown dispatch subcommand: ${args.slice(1).join(' ') || '<missing>'}`);
  }
  const result = dispatchReview(args.slice(2), {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    process.stderr.write(`ERROR: ${result.error.message}\n`);
    process.exit(2);
  }
  if (result.signal) {
    process.stderr.write(`ERROR: dispatch review terminated by signal ${result.signal}\n`);
    process.exit(1);
  }
  process.exit(result.status === null ? 1 : result.status);
}

if (args[0] === 'engine') {
  if (args[1] !== 'review-loop') {
    if (args[1] === 'implement-review') {
      const parsed = parseImplementReviewArgs(args.slice(2));
      if (parsed.error) {
        failUsage(parsed.error);
      }
      const level = String(process.env.AUTOPILOT_LEVEL || '').toLowerCase();
      if (parsed.legacyUnmanaged && (level === 'l5' || level === 'l6')) {
        process.stdout.write(`${JSON.stringify({
          status: 'blocked',
          phase: 'campaign_contract',
          reason: '--legacy-unmanaged is prohibited for L5/L6',
          campaign_control: {
            status: 'legacy_unmanaged_rejected',
            deprecated: true,
            removal_release: 'v2.35.0',
          },
        })}\n`);
        process.exit(1);
      }
      let campaignDispositionProvider = null;
      try {
        if (parsed.campaignDispositionAuthority) {
          campaignDispositionProvider = compileCampaignDispositionProvider(
            loadCampaignDispositionAuthority(path.resolve(
              parsed.cwd || process.cwd(),
              parsed.campaignDispositionAuthority,
            )),
          );
        } else if (parsed.campaignDispositionPolicy) {
          campaignDispositionProvider = compileCampaignDispositionPolicy(
            parsed.campaignDispositionPolicy,
          );
        }
      } catch (error) {
        process.stdout.write(`${JSON.stringify({
          status: 'blocked',
          phase: 'campaign_disposition_authority',
          reason: error.message || String(error),
        })}\n`);
        process.exit(1);
      }
      // Trusted host constructs the file-backed Mission CAS store from
      // --mission-state; free-form load/save callbacks are never accepted
      // from CLI input. The engine reads mission_grant_ref from the sealed
      // campaign contract and builds canonical adapters itself.
      const engineOptions = {
        cwd: parsed.cwd || process.cwd(),
        campaignDispositionProvider,
      };
      if (parsed.missionState) {
        engineOptions.missionStatePath = path.resolve(
          parsed.cwd || process.cwd(),
          parsed.missionState,
        );
      }
      const result = new AutopilotEngine(engineOptions)
        .runImplementationReviewLoop(parsed);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exit(result.status === 'converged' ? 0 : 1);
    }

    failUsage(`unknown engine subcommand: ${args.slice(1).join(' ') || '<missing>'}`);
  }
  const result = resolveReviewLoop(args.slice(2), {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    process.stderr.write(`ERROR: ${result.error.message}\n`);
    process.exit(2);
  }
  if (result.signal) {
    process.stderr.write(`ERROR: engine review-loop terminated by signal ${result.signal}\n`);
    process.exit(1);
  }
  process.exit(result.status === null ? 1 : result.status);
}

if (args[0] === 'harness') {
  const result = runHarnessCli(args.slice(1), {
    stdout: process.stdout,
    stderr: process.stderr,
  });
  process.exit(result.status);
}

if (args[0] === 'endpoints') {
  const result = runEndpointsCli(args.slice(1), {
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    cwd: process.cwd(),
  });
  process.exit(result.status);
}

failUsage(`unknown command: ${args.join(' ')}`);
