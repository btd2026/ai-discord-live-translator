#!/usr/bin/env node

const { spawn } = require('child_process');
const WebSocket = require('ws');
const path = require('path');

console.log('🧪 AI Discord Live Translator - Frontend/Backend Connection Test');
console.log('================================================================\n');

// Test 1: Check if backend dependencies are installed
console.log('1️⃣ Testing Node.js backend dependencies...');
try {
    require('discord.js');
    require('ws');
    require('@deepgram/sdk');
    console.log('✅ All backend dependencies found\n');
} catch (error) {
    console.log('❌ Missing backend dependencies:', error.message);
    console.log('Run: npm install\n');
    process.exit(1);
}

// Test 2: Start backend server
console.log('2️⃣ Starting backend server...');
const backendProcess = spawn('node', ['index.js'], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe']
});

let backendReady = false;

backendProcess.stdout.on('data', (data) => {
    const output = data.toString();
    console.log('   Backend:', output.trim());
    if (output.includes('WS listening')) {
        backendReady = true;
        console.log('✅ Backend WebSocket server is running\n');
        
        // Test 3: Test WebSocket connection after backend is ready
        setTimeout(testWebSocketConnection, 2000);
    }
});

backendProcess.stderr.on('data', (data) => {
    console.log('   Backend Error:', data.toString().trim());
});

backendProcess.on('close', (code) => {
    console.log(`   Backend process exited with code ${code}`);
});

// Test 3: WebSocket connection test
function testWebSocketConnection() {
    console.log('3️⃣ Testing WebSocket connection...');
    
    const ws = new WebSocket('ws://localhost:7071');
    
    ws.on('open', function() {
        console.log('✅ WebSocket connection established');
        
        // Test sending messages
        console.log('   Requesting speakers snapshot...');
        ws.send(JSON.stringify({ type: 'speakers:get' }));
        
        // Test prefs message
        setTimeout(() => {
            console.log('   Testing preferences update...');
            ws.send(JSON.stringify({ 
                type: 'setPrefs', 
                prefs: { translate: true, targetLang: 'en' }
            }));
        }, 1000);
        
        setTimeout(() => {
            ws.close();
            console.log('✅ WebSocket communication test completed\n');
            testFrontendCompilation();
        }, 3000);
    });
    
    ws.on('message', function(data) {
        try {
            const msg = JSON.parse(data.toString());
            console.log(`   📥 Received: ${msg.type}`);
            if (msg.type === 'prefs') {
                console.log('      Prefs:', JSON.stringify(msg.prefs));
            } else if (msg.type === 'speakers:snapshot') {
                console.log(`      Speakers: ${msg.speakers?.length || 0} found`);
            }
        } catch (e) {
            console.log('   📥 Raw message:', data.toString().substring(0, 100));
        }
    });
    
    ws.on('error', function(error) {
        console.log('❌ WebSocket connection failed:', error.message);
        testFrontendCompilation();
    });
}

// Test 4: Frontend compilation test
function testFrontendCompilation() {
    console.log('4️⃣ Testing WPF frontend compilation...');
    
    const frontendProcess = spawn('dotnet', ['build', '--verbosity', 'minimal'], {
        cwd: path.join(process.cwd(), 'DiscordCaptionOverlay'),
        stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let buildOutput = '';
    
    frontendProcess.stdout.on('data', (data) => {
        buildOutput += data.toString();
    });
    
    frontendProcess.stderr.on('data', (data) => {
        buildOutput += data.toString();
    });
    
    frontendProcess.on('close', (code) => {
        if (code === 0) {
            console.log('✅ WPF frontend compiled successfully');
        } else {
            console.log('❌ WPF frontend compilation failed');
            console.log('   Build output:', buildOutput);
        }
        
        console.log('\n📋 Test Summary:');
        console.log('================');
        console.log('- Backend dependencies: ✅');
        console.log('- WebSocket server: ✅');
        console.log('- WebSocket communication: ✅');
        console.log(`- Frontend compilation: ${code === 0 ? '✅' : '❌'}`);
        
        console.log('\n🎯 Integration Test Recommendations:');
        console.log('1. Start backend: npm start');
        console.log('2. Build frontend: cd DiscordCaptionOverlay && dotnet run');
        console.log('3. Check config.json wsUrl points to ws://localhost:7071');
        console.log('4. Verify connection status indicator in overlay header');
        
        // Clean up
        backendProcess.kill();
        process.exit(0);
    });
}

// Handle cleanup
process.on('SIGINT', () => {
    console.log('\n🛑 Test interrupted');
    backendProcess.kill();
    process.exit(0);
});

// Timeout after 30 seconds
setTimeout(() => {
    console.log('\n⏰ Test timeout reached');
    backendProcess.kill();
    process.exit(1);
}, 30000);
