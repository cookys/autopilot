const { callService } = require('../lib/service');

function run() {
  const apiKey = process.env.API_KEY || 'default-key';
  const mode = process.argv[2] || 'success';

  const requestPayload = {
    url: 'https://api.example.com/v1/data',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: { query: 'hello' }
  };

  try {
    const response = callService(apiKey, mode);
    console.log(`Success: API call completed successfully. Code: ${response.status}`);
  } catch (error) {
    console.error(`Error: API call failed. Request: ${JSON.stringify(requestPayload)}. Error: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  run();
}
