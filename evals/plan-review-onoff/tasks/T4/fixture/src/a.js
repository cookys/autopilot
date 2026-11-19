const cfg = require('../config/default.json'); exports.wait = () => new Promise((r) => setTimeout(r, cfg.timeout));
