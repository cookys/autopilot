'use strict';
const { requireSession } = require('./middleware');
function routes(app) {
  app.get('/me', requireSession, (req, res) => res.send(req.session.user));
}
module.exports = { routes };
