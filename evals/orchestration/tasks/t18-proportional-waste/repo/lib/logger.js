const LOG_PREFIX = '[app]';

function formatMessage(message) {
  return `${LOG_PREFIX} ${message}`;
}

function formatError(message, err) {
  const detail = err && err.message ? err.message : String(err);
  return `${LOG_PREFIX} ERROR: ${message} (${detail})`;
}

module.exports = { LOG_PREFIX, formatMessage, formatError };
