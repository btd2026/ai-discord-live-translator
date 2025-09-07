// Test script to verify frontend-backend WebSocket connection
const WebSocket = require('ws');

console.log('🧪 Testing WebSocket connection to overlay frontend...');

// Connect to the WebSocket server (same as frontend)
const ws = new WebSocket('ws://localhost:7071');

ws.on('open', () => {
    console.log('✅ Connected to WebSocket server on port 7071');
    
    // Send a test caption message (simulating what the Discord bot would send)
    const testCaption = {
        type: 'caption',
        eventId: 'test_' + Date.now(),
        userId: 'test-user-123',
        username: 'TestUser',
        color: '#FF6B6B',
        text: 'This is a test caption from the backend!',
        isFinal: false
    };
    
    console.log('📤 Sending test caption:', testCaption);
    ws.send(JSON.stringify(testCaption));
    
    // Send an update after 2 seconds
    setTimeout(() => {
        const updateMessage = {
            type: 'update',
            eventId: testCaption.eventId,
            text: 'This is an updated interim caption with more text to test the typing effect!'
        };
        console.log('📤 Sending update:', updateMessage);
        ws.send(JSON.stringify(updateMessage));
    }, 2000);
    
    // Send final message after 4 seconds
    setTimeout(() => {
        const finalMessage = {
            type: 'finalize',
            eventId: testCaption.eventId,
            userId: 'test-user-123',
            username: 'TestUser',
            color: '#FF6B6B',
            text: 'This is the final transcribed text that should appear on the top line!',
            meta: {
                srcText: 'This is the final transcribed text that should appear on the top line!',
                srcLang: 'en'
            }
        };
        console.log('📤 Sending finalize:', finalMessage);
        ws.send(JSON.stringify(finalMessage));
    }, 4000);
    
    // Send speakers snapshot
    const speakersSnapshot = {
        type: 'speakers:snapshot',
        speakers: [
            {
                userId: 'test-user-123',
                username: 'TestUser',
                color: '#FF6B6B',
                isSpeaking: true,
                lastHeardAt: Date.now()
            },
            {
                userId: 'test-user-456',
                username: 'AnotherUser',
                color: '#4ECDC4',
                isSpeaking: false,
                lastHeardAt: Date.now() - 10000
            }
        ]
    };
    console.log('📤 Sending speakers snapshot');
    ws.send(JSON.stringify(speakersSnapshot));
});

ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    console.log('📥 Received from server:', message);
});

ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
});

ws.on('close', () => {
    console.log('🔌 WebSocket connection closed');
    process.exit(0);
});

// Keep the test running for 10 seconds
setTimeout(() => {
    console.log('⏰ Test completed, closing connection');
    ws.close();
}, 10000);
