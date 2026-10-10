'use strict';

// Versioned Mission receipt/projection interface for later LSM import.
// This module re-exports the canonical engine implementations only — it does
// not re-implement reducer, hashing, or terminal receipt logic. LSM remains
// the sole human DONE / can_merge / can_close authority; nothing here claims
// task closeout.

const mission = require('../engine/mission-convergence');

const MISSION_INTERFACE_VERSION = 1;

module.exports = Object.freeze({
  MISSION_INTERFACE_VERSION,
  MISSION_SCHEMA_VERSION: mission.MISSION_SCHEMA_VERSION,
  MISSION_RECEIPT_SCHEMA_VERSION: mission.MISSION_RECEIPT_SCHEMA_VERSION,
  SUPPORTED_AXES: mission.SUPPORTED_AXES,
  TERMINAL_STATES: mission.TERMINAL_STATES,
  // Projection / restore (content-bound, no closeout authority)
  buildProjection: mission.buildProjection,
  restoreProjection: mission.restoreProjection,
  stateHash: mission.stateHash,
  // Terminal + campaign receipts
  buildMissionTerminalReceipt: mission.buildMissionTerminalReceipt,
  applyMissionCampaignReceipt: mission.applyMissionCampaignReceipt,
  // Canonical hashing helpers shared with engine
  sha256: mission.sha256,
  canonicalJson: mission.canonicalJson,
  // State validation for importers that need to fail closed on stale inputs
  validateMissionState: mission.validateMissionState,
  MissionReducerError: mission.MissionReducerError,
});
