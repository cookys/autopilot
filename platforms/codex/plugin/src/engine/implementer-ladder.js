'use strict';

// Implementer ladder: cheapest sufficient engine by unit_class, climb on red repair.
// Empty ladder ⇒ identity (the three implementer_* fields are the single rung).

const VALID_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const VALID_IMPL_RUNNERS = new Set([
  'auto',
  'codex',
  'agy',
  'grok',
  'cc-shim',
  'pi',
  'qoderclicn',
  'cursor',
]);

function isTuple(row) {
  return Boolean(
    row
    && typeof row === 'object'
    && !Array.isArray(row)
    && typeof row.engine === 'string'
    && row.engine.length > 0
    && VALID_EFFORTS.has(row.effort)
    && VALID_IMPL_RUNNERS.has(row.runner),
  );
}

function startRung(unitClass, ladderLength) {
  if (!Number.isInteger(ladderLength) || ladderLength <= 1) return 0;
  return unitClass === 'mechanical' ? 0 : 1;
}

function selectImplementerRung({ ladder, unitClass, repairRound } = {}) {
  const rungs = Array.isArray(ladder) ? ladder.filter(isTuple) : [];
  if (rungs.length === 0) {
    return { applied: false, rung: null, tuple: null };
  }
  const start = startRung(
    unitClass === 'mechanical' ? 'mechanical' : 'judgment',
    rungs.length,
  );
  const top = rungs.length - 1;
  const r = Number.isInteger(repairRound) && repairRound >= 0 ? repairRound : 0;
  const idx = Math.min(start + r, top);
  return { applied: true, rung: idx, tuple: rungs[idx] };
}

function implicitTuple(roster) {
  if (!roster || typeof roster !== 'object') return null;
  return {
    engine: roster.implementer_engine,
    effort: roster.implementer_effort,
    runner: roster.implementer_runner,
  };
}

function applyImplementerLadder(roster, { unitClass, repairRound } = {}) {
  const selected = selectImplementerRung({
    ladder: roster && roster.implementer_ladder,
    unitClass,
    repairRound,
  });
  if (!selected.applied) {
    return { roster, rung: null, tuple: implicitTuple(roster) };
  }
  return {
    roster: {
      ...roster,
      implementer_engine: selected.tuple.engine,
      implementer_effort: selected.tuple.effort,
      implementer_runner: selected.tuple.runner,
      implementer_ladder_rung: selected.rung,
    },
    rung: selected.rung,
    tuple: selected.tuple,
  };
}

function unitClassFromContract(contract) {
  if (contract && contract.unit_class === 'mechanical') return 'mechanical';
  return 'judgment';
}

function repairRoundFromImplementationRound(implementationRound) {
  if (Number.isInteger(implementationRound) && implementationRound > 0) {
    return implementationRound - 1;
  }
  return 0;
}

module.exports = {
  applyImplementerLadder,
  repairRoundFromImplementationRound,
  selectImplementerRung,
  startRung,
  unitClassFromContract,
  VALID_EFFORTS,
  VALID_IMPL_RUNNERS,
};
