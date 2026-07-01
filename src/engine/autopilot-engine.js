'use strict';

const { resolveReviewLoopJson } = require('./resolve-review-loop');
const { dispatchReviewJson } = require('../runners/review');

function defaultNow() {
  return new Date().toISOString();
}

function normalizeTimestamp(value) {
  if (value instanceof Date) {
    if (!Number.isNaN(value.getTime())) return value.toISOString();
    return defaultNow();
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    try {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    } catch (_error) {
      return defaultNow();
    }
  }
  return defaultNow();
}

function createClock(clock) {
  if (clock && typeof clock.now === 'function') {
    return () => normalizeTimestamp(clock.now());
  }
  if (typeof clock === 'function') {
    return () => normalizeTimestamp(clock());
  }
  return defaultNow;
}

function reviewLoopResultBlocked(result) {
  if (!result) return 'missing review-loop result';
  if (result.error) return result.error.message || String(result.error);
  if (result.signal) return `review-loop terminated by signal ${result.signal}`;
  if (result.status !== 0) return `review-loop exited with status ${result.status}`;
  if (result.parseError) return result.parseError.message || String(result.parseError);
  if (!result.result) return 'review-loop produced no parsed result';
  return null;
}

function reviewResultBlocked(result) {
  if (!result) return 'missing review dispatch result';
  if (result.error) return result.error.message || String(result.error);
  if (result.signal) return `review dispatch terminated by signal ${result.signal}`;
  if (result.status !== 0) return `review dispatch exited with status ${result.status}`;
  if (result.parseError) return result.parseError.message || String(result.parseError);
  if (!result.result) return 'review dispatch produced no parsed result';
  if (typeof result.result.status !== 'string') return 'review dispatch result missing status';
  if (result.result.status !== 'reviewed') return `review dispatch result status ${result.result.status}`;
  return null;
}

function validateExtraReviewArgs(extraReviewArgs) {
  if (!Array.isArray(extraReviewArgs)) {
    throw new TypeError('extraReviewArgs must be an array');
  }
  const reserved = new Set(['--runner', '--model', '--diff-file', '--effort']);
  for (const arg of extraReviewArgs) {
    if (typeof arg !== 'string') {
      throw new TypeError('extraReviewArgs must contain only strings');
    }
    const key = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
    if (reserved.has(key)) {
      throw new TypeError(`extraReviewArgs cannot override ${key}`);
    }
  }
}

function validateReviewRoster(roster) {
  if (!roster || typeof roster !== 'object') {
    throw new TypeError('review roster is required');
  }
  for (const field of ['reviewer_runner', 'reviewer_engine', 'reviewer_effort']) {
    if (typeof roster[field] !== 'string' || roster[field].length === 0) {
      throw new TypeError(`review roster field ${field} is required`);
    }
  }
  return roster;
}

function buildReviewArgs({ roster, diffFile, extraReviewArgs = [] }) {
  validateReviewRoster(roster);
  if (!diffFile || typeof diffFile !== 'string') {
    throw new TypeError('diffFile is required');
  }
  validateExtraReviewArgs(extraReviewArgs);

  return [
    '--runner',
    roster.reviewer_runner,
    '--model',
    roster.reviewer_engine,
    '--diff-file',
    diffFile,
    '--effort',
    roster.reviewer_effort,
    ...extraReviewArgs,
  ];
}

class AutopilotEngine {
  constructor(options = {}) {
    this.reviewLoopResolver = options.reviewLoopResolver || resolveReviewLoopJson;
    this.reviewDispatcher = options.reviewDispatcher || dispatchReviewJson;
    this.now = createClock(options.clock);
  }

  ledgerEntry(unit, status, startedAt, detail = {}) {
    return {
      unit,
      status,
      started_at: startedAt,
      ended_at: this.now(),
      ...detail,
    };
  }

  resolveRoster(input = {}) {
    const args = Object.prototype.hasOwnProperty.call(input, 'args')
      ? input.args
      : ['--check-scorecard'];
    const options = input.options || {};
    const startedAt = this.now();
    if (!Array.isArray(args)) {
      const error = new TypeError('resolveRoster args must be an array');
      return {
        status: 'blocked',
        reason: error.message,
        result: {
          error,
          status: null,
          signal: null,
          stdout: '',
          stderr: '',
          result: null,
          parseError: null,
        },
        roster: null,
        ledger: [
          this.ledgerEntry('resolve_roster', 'blocked', startedAt, {
            exit_status: null,
          }),
        ],
      };
    }
    let result;
    try {
      result = this.reviewLoopResolver(args, options);
    } catch (error) {
      result = {
        error,
        status: null,
        signal: null,
        stdout: '',
        stderr: '',
        result: null,
        parseError: null,
      };
    }
    const blockedReason = reviewLoopResultBlocked(result);
    let roster = result && result.result ? result.result : null;
    let reason = blockedReason;
    if (!reason) {
      try {
        validateReviewRoster(roster);
      } catch (error) {
        reason = error.message || String(error);
        roster = null;
      }
    }
    return {
      status: reason ? 'blocked' : 'resolved',
      reason,
      result,
      roster,
      ledger: [
        this.ledgerEntry('resolve_roster', reason ? 'blocked' : 'resolved', startedAt, {
          exit_status: result ? result.status : null,
        }),
      ],
    };
  }

  reviewDiff(input = {}) {
    const ledger = [];
    const requireQualifiedReviewer = input.requireQualifiedReviewer === true;
    let roster = input.roster || null;
    let resolveResult = null;
    let reviewArgs = null;

    if (!input.diffFile || typeof input.diffFile !== 'string') {
      const startedAt = this.now();
      ledger.push(this.ledgerEntry('prepare_review', 'blocked', startedAt));
      return {
        status: 'blocked',
        phase: 'prepare_review',
        reason: 'diffFile is required',
        verdict: null,
        roster,
        resolveResult,
        reviewResult: null,
        review: null,
        reviewArgs,
        ledger,
      };
    }

    if (!roster) {
      const rosterArgs = Object.prototype.hasOwnProperty.call(input, 'rosterArgs')
        ? input.rosterArgs
        : ['--check-scorecard'];
      const resolved = this.resolveRoster({
        args: rosterArgs,
        options: input.resolverOptions || {},
      });
      ledger.push(...resolved.ledger);
      resolveResult = resolved.result;
      roster = resolved.roster;

      if (resolved.status === 'blocked') {
        return {
          status: 'blocked',
          phase: 'resolve_roster',
          reason: resolved.reason,
          verdict: null,
          roster: null,
          resolveResult,
          reviewResult: null,
          review: null,
          reviewArgs,
          ledger,
        };
      }
    }

    try {
      validateReviewRoster(roster);
    } catch (error) {
      const startedAt = this.now();
      ledger.push(this.ledgerEntry('prepare_review', 'blocked', startedAt));
      return {
        status: 'blocked',
        phase: 'prepare_review',
        reason: error.message || String(error),
        verdict: null,
        roster,
        resolveResult,
        reviewResult: null,
        review: null,
        reviewArgs,
        ledger,
      };
    }

    if (requireQualifiedReviewer && roster.reviewer_qualified !== true) {
      const startedAt = this.now();
      ledger.push(
        this.ledgerEntry('reviewer_qualification', 'blocked', startedAt, {
          reviewer_qualified: roster.reviewer_qualified === true,
        }),
      );
      return {
        status: 'blocked',
        phase: 'reviewer_qualification',
        reason: 'reviewer is not qualified or qualification is unknown',
        verdict: null,
        roster,
        resolveResult,
        reviewResult: null,
        review: null,
        reviewArgs,
        ledger,
      };
    }

    try {
      reviewArgs = buildReviewArgs({
        roster,
        diffFile: input.diffFile,
        extraReviewArgs: Object.prototype.hasOwnProperty.call(input, 'extraReviewArgs')
          ? input.extraReviewArgs
          : [],
      });
    } catch (error) {
      const startedAt = this.now();
      ledger.push(this.ledgerEntry('prepare_review', 'blocked', startedAt));
      return {
        status: 'blocked',
        phase: 'prepare_review',
        reason: error.message || String(error),
        verdict: null,
        roster,
        resolveResult,
        reviewResult: null,
        review: null,
        reviewArgs,
        ledger,
      };
    }
    const startedAt = this.now();
    let reviewResult;
    try {
      reviewResult = this.reviewDispatcher(reviewArgs, input.reviewOptions || {});
    } catch (error) {
      reviewResult = {
        error,
        status: null,
        signal: null,
        stdout: '',
        stderr: '',
        result: null,
        parseError: null,
      };
    }
    const blockedReason = reviewResultBlocked(reviewResult);
    ledger.push(
      this.ledgerEntry('dispatch_review', blockedReason ? 'blocked' : reviewResult.result.status, startedAt, {
        runner: roster.reviewer_runner,
        model: roster.reviewer_engine,
        exit_status: reviewResult ? reviewResult.status : null,
      }),
    );

    if (blockedReason) {
      return {
        status: 'blocked',
        phase: 'dispatch_review',
        reason: blockedReason,
        verdict: null,
        roster,
        resolveResult,
        reviewResult,
        review: null,
        reviewArgs,
        ledger,
      };
    }

    return {
      status: reviewResult.result.status,
      verdict: reviewResult.result.verdict,
      roster,
      resolveResult,
      reviewResult,
      review: reviewResult.result,
      reviewArgs,
      ledger,
    };
  }
}

module.exports = {
  AutopilotEngine,
  buildReviewArgs,
  reviewLoopResultBlocked,
  reviewResultBlocked,
  validateExtraReviewArgs,
  validateReviewRoster,
};
