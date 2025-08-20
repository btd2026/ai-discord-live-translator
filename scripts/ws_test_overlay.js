// WebSocket Test Script for Discord Caption Overlay
// Tests typing animation, overflow reset, and speaker management

const WebSocket = require('ws');

const port = process.env.WS_PORT || 7071;
const wss = new WebSocket.Server({ port });

console.log(`🎯 Overlay Test Server running on ws://localhost:${port}`);
console.log('✨ Testing: speakers:snapshot → caption → updates → finalize → overflow behavior');

wss.on('connection', (ws) => {
    console.log('📱 Overlay connected');

    // Test sequence with timing
    setTimeout(() => testSequence(ws), 1000);

    ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        console.log('📥 Received:', message);
    });

    ws.on('close', () => {
        console.log('📱 Overlay disconnected');
    });
});

async function testSequence(ws) {
    console.log('\n🧪 Starting test sequence...\n');

    // 1. Initial speakers snapshot
    const speakersSnapshot = {
        type: "speakers:snapshot",
        speakers: [
            {
                userId: "user_alice",
                username: "Alice",
                color: "#FF6B6B",
                pinnedInputLang: "en",
                isSpeaking: false
            },
            {
                userId: "user_bob", 
                username: "Bob",
                color: "#4ECDC4",
                pinnedInputLang: "es",
                isSpeaking: false
            }
        ]
    };

    sendMessage(ws, speakersSnapshot, "📋 Speakers snapshot");
    await sleep(500);

    // 2. Alice starts speaking - short message
    const aliceCaption = {
        type: "caption",
        eventId: "evt_001",
        userId: "user_alice", 
        username: "Alice",
        color: "#FF6B6B",
        text: "Hello everyone, how are you doing today?",
        uttSeq: 1
    };

    sendMessage(ws, aliceCaption, "💬 Alice: Short message");
    await sleep(1000);

    // 3. Bob starts - LONG message to test overflow reset
    const bobLongText = `This is a very long message that should definitely exceed the available width of a single line in the caption overlay. 
    The typing animation system should handle this by showing the first part that fits, then resetting and showing the overflow text. 
    This tests the core overflow reset functionality that makes the overlay behave like Discord with smooth typing animations. 
    We want to see how it handles multiple lines and word wrapping with the FormattedText measurement system.`;

    const bobCaption = {
        type: "caption", 
        eventId: "evt_002",
        userId: "user_bob",
        username: "Bob", 
        color: "#4ECDC4",
        text: bobLongText,
        uttSeq: 1
    };

    sendMessage(ws, bobCaption, "💬 Bob: LONG message (overflow test)");
    await sleep(2000);

    // 4. Rapid updates to test 16ms throttling
    console.log("⚡ Testing rapid updates (throttling)...");
    
    const updates = [
        "This is getting updated",
        "This is getting updated very",
        "This is getting updated very quickly",  
        "This is getting updated very quickly with",
        "This is getting updated very quickly with multiple",
        "This is getting updated very quickly with multiple changes",
        "This is getting updated very quickly with multiple changes happening fast"
    ];

    for (let i = 0; i < updates.length; i++) {
        const updateMsg = {
            type: "update",
            eventId: "evt_003", 
            userId: "user_alice",
            text: updates[i],
            uttSeq: i + 2
        };
        
        sendMessage(ws, updateMsg, `📝 Update ${i+1}/${updates.length}`);
        await sleep(20); // Rapid fire - tests throttling
    }

    await sleep(1000);

    // 5. Finalize Alice's message
    const aliceFinalize = {
        type: "finalize",
        eventId: "evt_003",
        userId: "user_alice", 
        text: "This is getting updated very quickly with multiple changes happening fast - FINAL",
        uttSeq: 99,
        meta: {
            srcText: "Este se está actualizando muy rápidamente",
            srcLang: "es"
        }
    };

    sendMessage(ws, aliceFinalize, "✅ Alice: Finalized");
    await sleep(1500);

    // 6. Test idle timeout (5s silence)
    console.log("⏰ Testing 5s idle timeout - wait for text to clear...");
    await sleep(6000);

    // 7. New speaker with fallback color
    const charlieMessage = {
        type: "caption",
        eventId: "evt_004", 
        userId: "user_charlie_new",
        username: "Charlie",
        // No color provided - should generate from hash
        text: "Hey, I'm new here! This should get a deterministic color.",
        uttSeq: 1
    };

    sendMessage(ws, charlieMessage, "👋 Charlie: New speaker (fallback color)");
    await sleep(1000);

    // 8. Test speaker limit (9th speaker for LRU)
    const speakers = ['Dave', 'Eve', 'Frank', 'Grace', 'Henry', 'Iris'];
    
    for (let i = 0; i < speakers.length; i++) {
        const speakerMsg = {
            type: "caption",
            eventId: `evt_${100 + i}`,
            userId: `user_${speakers[i].toLowerCase()}`, 
            username: speakers[i],
            color: `hsl(${i * 60}, 70%, 60%)`,
            text: `Hi from ${speakers[i]}! Testing LRU replacement.`,
            uttSeq: 1
        };
        
        sendMessage(ws, speakerMsg, `👤 ${speakers[i]}: LRU test ${i+1}/6`);
        await sleep(800);
    }

    console.log('\n🎉 Test sequence complete!');
    console.log('📊 Verify:');
    console.log('   • Typing animations with overflow reset');
    console.log('   • 16ms update throttling');
    console.log('   • 5s idle timeout clearing');
    console.log('   • Deterministic colors for new speakers');
    console.log('   • LRU speaker replacement (8 max)');
    console.log('   • Connection status badge');
}

function sendMessage(ws, message, description) {
    console.log(`📤 ${description}`);
    console.log(`   ${JSON.stringify(message, null, 2).substring(0, 100)}...`);
    ws.send(JSON.stringify(message));
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Handle cleanup
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down test server...');
    wss.close(() => {
        process.exit(0);
    });
});
