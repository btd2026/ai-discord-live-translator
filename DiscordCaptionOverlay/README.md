# Discord Caption Overlay

A Windows WPF overlay application that displays real-time Discord voice captions from the backend WebSocket server.

## Configuration

### WebSocket URL Configuration

The overlay connects to the backend WebSocket server. You can configure the URL in several ways (in order of precedence):

1. **Command Line**: `--ws-url=ws://localhost:9090`
2. **Environment Variable**: `WS_URL=ws://localhost:9090`
3. **appsettings.json**: `{ "WebSocketUrl": "ws://localhost:9090" }`
4. **Default**: `ws://localhost:9090`

### Example Configuration

**appsettings.json**:
```json
{
  "WebSocketUrl": "ws://localhost:9090"
}
```

**Environment Variable**:
```cmd
set WS_URL=ws://localhost:9090
```

**Command Line**:
```cmd
DiscordCaptionOverlay.exe --ws-url=ws://localhost:9090
```

## Features

### Connection Management
- **Auto-reconnect**: Automatically reconnects with exponential backoff (500ms → 1s → 2s → 4s, capped at 5s)
- **Heartbeat**: Sends ping every 25 seconds to keep connection alive
- **Status Display**: Window title shows connection status (Connecting... / Connected / Reconnecting in Xs...)

### Caption Display
- **Live Interims**: Shows real-time transcription updates
- **Final Lines**: Displays completed captions with slightly dimmed opacity
- **Multi-speaker**: Supports multiple speakers with color-coded lanes
- **Responsive**: Scales text to fit window size

### Controls
- **Ctrl+Alt+C**: Toggle click-through mode
- **Ctrl+Alt++**: Increase opacity
- **Ctrl+Alt+-**: Decrease opacity
- **Drag**: Move window (when not in click-through mode)
- **Resize**: Window can be resized

## Development

### Self-Test Mode (Debug builds only)
- **Ctrl+Alt+F6**: Run self-test mode (connects to test server on port 7071)

### Logging
- Logs are written to `overlay.log` in the application directory
- Ring buffer keeps last 1000 log lines
- Includes connection status, message types, and errors

## Troubleshooting

### No Captions Showing
1. Check that the backend is running and WebSocket server is active
2. Verify the WebSocket URL configuration
3. Check `overlay.log` for connection errors
4. Ensure the backend is sending `caption`, `update`, and `finalize` messages

### Connection Issues
1. Verify the backend WebSocket server is running on the configured port
2. Check firewall settings
3. Review connection logs in `overlay.log`

### UI Issues
1. Try resizing the window to trigger scaling recalculation
2. Check that the window is not in click-through mode if you need to interact with it
3. Use opacity controls to adjust visibility

## Message Protocol

The overlay expects these WebSocket message types:

- **caption**: `{ "type": "caption", "eventId": "...", "userId": "...", "username": "...", "color": "...", "text": "...", "isFinal": false }`
- **update**: `{ "type": "update", "eventId": "...", "text": "..." }`
- **finalize**: `{ "type": "finalize", "eventId": "...", "userId": "...", "username": "...", "color": "...", "text": "...", "meta": {...} }`
- **prefs**: `{ "type": "prefs", ... }` (ignored by overlay)
