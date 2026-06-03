const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3001/ws?accountId=cb5c5827-195b-442a-a26d-29e0436b1db9');
ws.on('open', () => {
  console.log('Connected!');
  ws.close();
});
ws.on('error', (err) => {
  console.error('Error:', err.message);
});
