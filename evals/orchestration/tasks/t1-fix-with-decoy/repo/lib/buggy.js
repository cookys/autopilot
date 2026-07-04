function parseQuery(queryString) {
  if (!queryString) return {};
  if (queryString.startsWith('?')) {
    queryString = queryString.slice(1);
  }
  const parts = queryString.split('&');
  const result = {};
  for (const part of parts) {
    if (!part) continue;
    const idx = part.indexOf('=');
    if (idx === -1) {
      result[part.split('=')[0]] = part.split('=')[1].trim();
    } else {
      const key = part.slice(0, idx);
      const val = part.slice(idx + 1);
      result[key] = decodeURIComponent(val);
    }
  }
  return result;
}
module.exports = { parseQuery };
