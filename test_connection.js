// Simple WebSocket connection test
const WebSocket = require('ws');

console.log('Testing WebSocket connection to localhost:7071...');

const ws = new WebSocket('ws://localhost:7071');

ws.on('open', function() {
    console.log('✅ WebSocket connection established!');
    
    // Send a test message to request speakers snapshot
    ws.send(JSON.stringify({ type: 'speakers:get' }));
});

ws.on('message', function(data) {
    try {
        const msg = JSON.parse(data.toString());
        console.log('📥 Received message:', msg.type);
        console.log('   Content:', JSON.stringify(msg, null, 2));
    } catch (e) {
        console.log('📥 Received raw data:', data.toString());
    }
});

ws.on('error', function(error) {
    console.log('❌ WebSocket error:', error.message);
});

ws.on('close', function() {
    console.log('🔌 WebSocket connection closed');
});

// Keep alive for 5 seconds then close
setTimeout(() => {
    console.log('Closing test connection...');
    ws.close();
    process.exit(0);
}, 5000);
