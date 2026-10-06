'use strict';
const session = require('../auth/session');
function requireSession(req, res, next) {
  const s = session.get(req.sessionId);
  if (!s) { res.status(401).send('unauthorized'); return; }
  req.session = s;
  next();
}
module.exports = { requireSession };
