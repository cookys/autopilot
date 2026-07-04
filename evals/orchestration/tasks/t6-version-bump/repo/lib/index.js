const pkg = require('../package.json');
function getVersion() {
  return pkg.version;
}
module.exports = { getVersion };
