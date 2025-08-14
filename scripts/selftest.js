// scripts/selftest.js
const { startWs } = require('../ws');

console.log('🧪 Running Discord Voice Translator self-test...');

// Test configuration
const TEST_PORT = 7072; // Use different port to avoid conflicts
const TEST_EVENT_ID = 'test_123';
const TEST_USER_ID = 'test_user';
const TEST_USERNAME = 'Test User';
const TEST_COLOR = '#FF6A6A';

// Track received messages
const receivedMessages = [];
let testPassed = false;

// Start WebSocket server
const ws = startWs(TEST_PORT);

// Create a simple WebSocket client for testing
const WebSocket = require('ws');
const client = new WebSocket(`ws://localhost:${TEST_PORT}`);

client.on('open', () => {
  console.log('✅ WebSocket client connected');
  
  // Test sequence: caption → update → finalize
  setTimeout(() => {
    console.log('📝 1. Sending caption...');
    ws.sendCaption({
      eventId: TEST_EVENT_ID,
      userId: TEST_USER_ID,
      username: TEST_USERNAME,
      color: TEST_COLOR,
      text: 'Hello, this is a test!',
      isFinal: false
    });
  }, 100);
  
  setTimeout(() => {
    console.log('🔄 2. Sending update...');
    ws.sendUpdate(TEST_EVENT_ID, 'Hello, this is a test update!');
  }, 200);
  
  setTimeout(() => {
    console.log('✅ 3. Sending finalize...');
    ws.sendFinalizeRaw({
      eventId: TEST_EVENT_ID,
      userId: TEST_USER_ID,
      username: TEST_USERNAME,
      color: TEST_COLOR,
      srcText: 'Hello, this is a test final message!',
      srcLang: 'en-US'
    });
  }, 300);
  
  setTimeout(() => {
    console.log('🔍 4. Analyzing results...');
    analyzeResults();
  }, 500);
});

client.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());
    receivedMessages.push(msg);
    console.log(`📨 Received: ${msg.type}`);
  } catch (e) {
    console.error('❌ Failed to parse message:', e);
  }
});

client.on('error', (err) => {
  console.error('❌ WebSocket client error:', err);
  process.exit(1);
});

function analyzeResults() {
  console.log('\n📊 Test Results:');
  console.log(`Total messages received: ${receivedMessages.length}`);
  
  // Check message sequence
  const messageTypes = receivedMessages.map(m => m.type);
  console.log('Message sequence:', messageTypes.join(' → '));
  
  // Validate expected sequence (ignore prefs message)
  const expectedSequence = ['caption', 'update', 'finalize'];
  const actualSequence = messageTypes.filter(t => expectedSequence.includes(t));
  
  if (JSON.stringify(actualSequence) === JSON.stringify(expectedSequence)) {
    console.log('✅ Message sequence is correct');
    testPassed = true;
  } else {
    console.log('❌ Message sequence is incorrect');
    console.log('Expected:', expectedSequence);
    console.log('Actual:', actualSequence);
  }
  
  // Validate message content
  const captionMsg = receivedMessages.find(m => m.type === 'caption');
  const updateMsg = receivedMessages.find(m => m.type === 'update');
  const finalizeMsg = receivedMessages.find(m => m.type === 'finalize');
  
  if (captionMsg && updateMsg && finalizeMsg) {
    console.log('✅ All message types received');
    
    // Check eventId consistency
    if (captionMsg.eventId === updateMsg.eventId && updateMsg.eventId === finalizeMsg.eventId) {
      console.log('✅ EventId consistency maintained');
    } else {
      console.log('❌ EventId inconsistency detected');
      testPassed = false;
    }
    
    // Check user info consistency
    if (captionMsg.userId === finalizeMsg.userId && captionMsg.username === finalizeMsg.username) {
      console.log('✅ User info consistency maintained');
    } else {
      console.log('❌ User info inconsistency detected');
      testPassed = false;
    }
  } else {
    console.log('❌ Missing message types');
    testPassed = false;
  }
  
  // Cleanup and exit
  setTimeout(() => {
    client.close();
    process.exit(testPassed ? 0 : 1);
  }, 100);
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n🛑 Test interrupted');
  client.close();
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Test terminated');
  client.close();
  process.exit(1);
});
