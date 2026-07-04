function callService(apiKey, mode) {
  if (mode === 'conn-refused') {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:443');
    err.code = 'ECONNREFUSED';
    throw err;
  } else if (mode === 'malformed') {
    throw new Error('Malformed JSON response from server');
  } else if (mode === 'exception') {
    throw new TypeError('Cannot read properties of undefined (reading "data")');
  }
  return { status: 200, data: 'Success' };
}

module.exports = { callService };
