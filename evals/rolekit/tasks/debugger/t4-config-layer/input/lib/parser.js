const fs = require('fs');
function parseJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    return {};
  }
}
module.exports = { parseJsonFile };
