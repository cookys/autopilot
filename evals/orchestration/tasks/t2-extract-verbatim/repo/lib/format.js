function formatLog(level, msg) {
  return `[${level.toUpperCase()}] ${msg}`;
}
module.exports = { formatLog };
