exports.makeClient = (url) => ({ push: async (b) => fetch(url, { method: 'POST', body: JSON.stringify(b) }) });
