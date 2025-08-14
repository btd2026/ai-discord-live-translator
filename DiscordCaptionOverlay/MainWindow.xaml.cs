using System;
using System.Buffers;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Linq;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shell;
using System.Windows.Threading;

namespace DiscordCaptionOverlay
{
    public partial class MainWindow : Window
    {
        // -------- Message tracking classes --------
        public class InFlightMessage
        {
            public string EventId { get; set; } = "";
            public string UserId { get; set; } = "";
            public string Username { get; set; } = "";
            public string Color { get; set; } = "#6A9EFF";
            public string Text { get; set; } = "";
            public DateTime LastUpdate { get; set; } = DateTime.UtcNow;
        }

        public class FinalizedMessage
        {
            public string EventId { get; set; } = "";
            public string UserId { get; set; } = "";
            public string Username { get; set; } = "";
            public string Color { get; set; } = "#6A9EFF";
            public string Text { get; set; } = "";
            public string SrcText { get; set; } = "";
            public string SrcLang { get; set; } = "";
            public DateTime FinalizedAt { get; set; } = DateTime.UtcNow;
        }

        // -------- Lane view-model (one visible speaker per lane) --------
        public class LaneVM : INotifyPropertyChanged
        {
            private string? _userId;                 // null => lane is free
            public string? UserId
            {
                get => _userId;
                set { _userId = value; OnChanged(nameof(UserId)); }
            }

            private string _username = "";
            public string Username
            {
                get => _username;
                set { _username = value; OnChanged(nameof(Username)); OnChanged(nameof(Initials)); }
            }

            private string _color = "#6A9EFF";
            public string Color
            {
                get => _color;
                set { _color = value; OnChanged(nameof(Color)); OnChanged(nameof(ColorBrush)); }
            }

            public Brush ColorBrush => (Brush)new BrushConverter().ConvertFromString(Color)!;

            public string Initials
            {
                get
                {
                    var u = (Username ?? "").Trim();
                    if (u.Length == 0) return "•";
                    var parts = u.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length >= 2) return (parts[0][0].ToString() + parts[1][0]).ToUpperInvariant();
                    return u.Substring(0, Math.Min(2, u.Length)).ToUpperInvariant();
                }
            }

            private string _text = "";
            public string Text
            {
                get => _text;
                set { _text = value; OnChanged(nameof(Text)); }
            }

            private double _textOpacity = 1.0;
            public double TextOpacity
            {
                get => _textOpacity;
                set { _textOpacity = value; OnChanged(nameof(TextOpacity)); }
            }

            // recomputed on resize
            public int CharBudget { get; set; } = 80;

            // for LRU lane replacement + idle clearing
            public DateTime LastActiveUtc { get; set; } = DateTime.MinValue;

            public event PropertyChangedEventHandler? PropertyChanged;
            void OnChanged(string name) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
        }

        // ---------------- config ----------------
        const int    MAX_LANES         = 8;     // total lanes to manage/display
        const int    MIN_CHAR_BUDGET   = 24;

        // Font size used by the caption TextBlock (pre-scale). Must match XAML base.
        const double FONT_SIZE         = 18.0;

    const double IDLE_TIMEOUT_SEC  = 4.0;   // clear lane after silence (spec)

        // Baseline window size for scaling (should match initial Width/Height in XAML)
        const double BASE_WIDTH        = 820.0;
        const double BASE_HEIGHT       = 520.0;
        const double TITLE_ROW_HEIGHT  = 28.0;  // matches the row used in XAML
        const double OUTER_MARGIN      = 12.0;  // margin around the shell in XAML

        // ---------------- state ----------------
        readonly ObservableCollection<LaneVM> _lanes = new();
        readonly Dictionary<string, LaneVM>  _byUser = new();  // userId -> lane
        readonly Dictionary<string, LaneVM>  _byEvent = new(); // eventId -> lane
        
        // In-flight and finalized message tracking
        readonly Dictionary<string, InFlightMessage> _inFlight = new(); // eventId -> message
        readonly Dictionary<string, FinalizedMessage> _finalized = new(); // eventId -> message
        
        // Prefs state
        bool _translate = false;
        string _targetLang = "en";
        string _langHint = "en";
        
        ClientWebSocket? _ws;
        CancellationTokenSource? _cts;
        DispatcherTimer? _idleTimer;

        string _wsUrl = "ws://localhost:7071"; // Default, will be overridden by config
        bool _clickThrough = false;
        string _status = "Connecting...";

        // Current uniform scale applied to content (ScaleRoot.LayoutTransform)
        double _scale = 1.0;

        public MainWindow()
        {
            InitializeComponent();
            DataContext = _lanes;

            // Load WebSocket URL configuration
            LoadWebSocketConfig();

            // pre-create N free lanes so UI can show/hide as users speak
            for (int i = 0; i < MAX_LANES; i++)
                _lanes.Add(new LaneVM { UserId = null, Username = "", Text = "", Color = "#333333", TextOpacity = 0.85 });

            this.Opacity = 0.92;

            // Set initial scale (in case the window is created at a non-baseline size)
            UpdateScale();
            RecomputeCharBudgets();
        }

        // ---------------- configuration ----------------
        string ResolveWsUrl()
        {
            // Precedence: CLI > env > appsettings > default
            var cliArgs = Environment.GetCommandLineArgs();
            
            // Check for --ws-url= or --ws-port=
            var wsUrlArg = cliArgs.FirstOrDefault(arg => arg.StartsWith("--ws-url="));
            if (!string.IsNullOrEmpty(wsUrlArg))
            {
                var url = wsUrlArg.Substring("--ws-url=".Length);
                LogMessage($"[WS/Overlay] URL chosen: CLI --ws-url={url}");
                return url;
            }
            
            var wsPortArg = cliArgs.FirstOrDefault(arg => arg.StartsWith("--ws-port="));
            if (!string.IsNullOrEmpty(wsPortArg))
            {
                var port = wsPortArg.Substring("--ws-port=".Length);
                var url = $"ws://localhost:{port}";
                LogMessage($"[WS/Overlay] URL chosen: CLI --ws-port={port} -> {url}");
                return url;
            }

            // Check environment variables
            var envUrl = Environment.GetEnvironmentVariable("WS_URL");
            if (!string.IsNullOrEmpty(envUrl))
            {
                LogMessage($"[WS/Overlay] URL chosen: ENV WS_URL={envUrl}");
                return envUrl;
            }
            
            var envPort = Environment.GetEnvironmentVariable("WS_PORT");
            if (!string.IsNullOrEmpty(envPort))
            {
                var url = $"ws://localhost:{envPort}";
                LogMessage($"[WS/Overlay] URL chosen: ENV WS_PORT={envPort} -> {url}");
                return url;
            }

            // Try to load from appsettings.json
            try
            {
                var configPath = System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "appsettings.json");
                if (System.IO.File.Exists(configPath))
                {
                    var json = System.IO.File.ReadAllText(configPath);
                    using var doc = JsonDocument.Parse(json);
                    
                    if (doc.RootElement.TryGetProperty("WebSocketUrl", out var urlProp))
                    {
                        var url = urlProp.GetString();
                        if (!string.IsNullOrEmpty(url))
                        {
                            LogMessage($"[WS/Overlay] URL chosen: appsettings.json WebSocketUrl={url}");
                            return url;
                        }
                    }
                    
                    if (doc.RootElement.TryGetProperty("WS_PORT", out var portProp))
                    {
                        var port = portProp.GetString();
                        if (!string.IsNullOrEmpty(port))
                        {
                            var url = $"ws://localhost:{port}";
                            LogMessage($"[WS/Overlay] URL chosen: appsettings.json WS_PORT={port} -> {url}");
                            return url;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                LogMessage($"[WS/Overlay] Error reading appsettings.json: {ex.Message}");
            }

            // Default fallback
            var defaultUrl = "ws://localhost:7071";
            LogMessage($"[WS/Overlay] URL chosen: default {defaultUrl}");
            return defaultUrl;
        }

        void LoadWebSocketConfig()
        {
            _wsUrl = ResolveWsUrl();
        }

        // ---------------- lifecycle ----------------
        private async void Window_Loaded(object sender, RoutedEventArgs e)
        {
            EnableLayeredAndResizable();
            RegisterHotkeys();
            UpdateScale();
            RecomputeCharBudgets();

            _cts = new CancellationTokenSource();
            await RunWebSocketLoop(_cts.Token); // Actually await the async method
            StartIdleMonitor();
        }

        private void Window_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            UpdateScale();           // recompute RootScale.ScaleX/ScaleY
            RecomputeCharBudgets();  // keep one-line budget in sync with new scale/width
        }

        private void Window_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            if (!_clickThrough)
            {
                try { DragMove(); } catch { }
            }
        }

        // ---------------- scaling ----------------
        void UpdateScale()
        {
            // Guard against early calls before XAML names exist
            if (RootScale == null || ScaleRoot == null) return;

            // Compute the available content height (minus title row + outer margins)
            double contentHeightPx = Math.Max(
                1.0,
                this.ActualHeight - TITLE_ROW_HEIGHT - (OUTER_MARGIN * 2.0)
            );

            // Ratio vs. baseline (width and content-height). Choose limiting factor for uniform scale.
            double sx = this.ActualWidth  / BASE_WIDTH;
            double sy = contentHeightPx   / (BASE_HEIGHT - TITLE_ROW_HEIGHT);

            double s = Math.Min(sx, sy);

            // Clamp to sensible range so we never collapse or explode
            s = Math.Max(0.30, Math.Min(s, 3.00));

            RootScale.ScaleX = s;
            RootScale.ScaleY = s;
            _scale = s;
        }

        // ---------------- idle monitor (clears silent lanes) ----------------
        void StartIdleMonitor()
        {
            if (_idleTimer != null) return;

            _idleTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };
            _idleTimer.Tick += (s, e) =>
            {
                var now = DateTime.UtcNow;

                foreach (var lane in _lanes)
                {
                    if (lane.UserId == null) continue;              // already free
                    if (string.IsNullOrEmpty(lane.Text)) continue;  // nothing to clear

                    if ((now - lane.LastActiveUtc).TotalSeconds >= IDLE_TIMEOUT_SEC)
                    {
                        var oldId = lane.UserId;      // capture before nulling

                        lane.Text = "";
                        lane.TextOpacity = 0.85;      // optionally dim
                        lane.UserId = null;           // make lane free

                        if (!string.IsNullOrEmpty(oldId))
                            _byUser.Remove(oldId);    // drop mapping
                    }
                }
            };
            _idleTimer.Start();
        }

        // ---------------- lane allocation / update ----------------
        LaneVM GetOrAssignLane(string userId, string username, string color)
        {
            if (_byUser.TryGetValue(userId, out var lane))
            {
                if (!string.IsNullOrWhiteSpace(username) && lane.Username != username) lane.Username = username;
                if (!string.IsNullOrWhiteSpace(color)    && lane.Color    != color)    lane.Color    = color;
                lane.LastActiveUtc = DateTime.UtcNow;
                return lane;
            }

            // find a free lane first
            lane = _lanes.FirstOrDefault(l => l.UserId == null);
            if (lane == null)
            {
                // replace least-recently-active
                lane = _lanes.OrderBy(l => l.LastActiveUtc).First();
                if (lane.UserId is string oldId) _byUser.Remove(oldId);
            }

            lane.UserId = userId;
            lane.Username = string.IsNullOrWhiteSpace(username) ? userId : username;
            lane.Color = string.IsNullOrWhiteSpace(color) ? "#6A9EFF" : color;
            lane.Text = "";                   // new cycle
            lane.TextOpacity = 1.0;
            lane.LastActiveUtc = DateTime.UtcNow;

            _byUser[userId] = lane;
            return lane;
        }

        void AppendToLane(LaneVM lane, string fragment, bool isFinal)
        {
            fragment = (fragment ?? "").Replace("\r", " ").Replace("\n", " ").Trim();
            if (string.IsNullOrEmpty(fragment)) return;

            // add space if text exists
            string candidate = lane.Text.Length == 0 ? fragment : (lane.Text + " " + fragment);

            // one-line budget: if exceeded, start a fresh cycle for this lane
            if (candidate.Length > lane.CharBudget)
                lane.Text = fragment;
            else
                lane.Text = candidate;

            lane.TextOpacity = isFinal ? 0.95 : 1.0;
            lane.LastActiveUtc = DateTime.UtcNow;
        }

        // Streaming-friendly updater: handles prefix growth, corrections, and overflow reset
        void UpdateLaneStreaming(LaneVM lane, string incomingText, bool isFinal)
        {
            incomingText = (incomingText ?? "").Replace("\r", " ").Replace("\n", " ").Trim();
            if (string.IsNullOrEmpty(incomingText)) return;

            // No change
            if (string.Equals(incomingText, lane.Text, StringComparison.Ordinal))
            {
                lane.LastActiveUtc = DateTime.UtcNow;
                lane.TextOpacity = isFinal ? 0.95 : 1.0;
                return;
            }

            // Typical ASR streaming: new text has old as prefix -> append only the delta
            if (!string.IsNullOrEmpty(lane.Text) && incomingText.StartsWith(lane.Text, StringComparison.Ordinal))
            {
                var delta = incomingText.Substring(lane.Text.Length).TrimStart();
                if (delta.Length == 0)
                {
                    lane.LastActiveUtc = DateTime.UtcNow;
                    lane.TextOpacity = isFinal ? 0.95 : 1.0;
                    return;
                }
                AppendToLane(lane, delta, isFinal);
                return;
            }

            // Correction/regression: replace content (ensure we don't overflow the box)
            if (!string.IsNullOrEmpty(lane.Text) && lane.Text.StartsWith(incomingText, StringComparison.Ordinal))
            {
                lane.Text = incomingText.Length <= lane.CharBudget
                    ? incomingText
                    : incomingText.Substring(incomingText.Length - lane.CharBudget);
                lane.TextOpacity = isFinal ? 0.95 : 1.0;
                lane.LastActiveUtc = DateTime.UtcNow;
                return;
            }

            // Different stream or fresh start: treat as a fragment to append/reset if needed
            AppendToLane(lane, incomingText, isFinal);
        }

        // Replace-on-update: always show the newest full string, trimming to the most recent
        // portion when it exceeds the lane's character budget.
        void ReplaceLaneText(LaneVM lane, string newText, bool isFinal)
        {
            newText = (newText ?? "").Replace("\r", " ").Replace("\n", " ").Trim();
            if (string.IsNullOrEmpty(newText)) return;

            if (lane.CharBudget > 0 && newText.Length > lane.CharBudget)
            {
                lane.Text = newText.Substring(newText.Length - lane.CharBudget);
            }
            else
            {
                lane.Text = newText;
            }

            lane.TextOpacity = isFinal ? 0.95 : 1.0;
            lane.LastActiveUtc = DateTime.UtcNow;
        }

        // Helper: detect a temporary userId we create to reserve a lane for an event
        static bool IsTempUserId(string? uid) => !string.IsNullOrEmpty(uid) && uid!.StartsWith("evt:");

        // Ensure there is a lane reserved for this event, even if user info is unknown
        LaneVM GetOrCreateEventLane(string eventId)
        {
            if (_byEvent.TryGetValue(eventId, out var lane) && lane != null) return lane;

            lane = _lanes.FirstOrDefault(l => l.UserId == null) ?? _lanes.OrderBy(l => l.LastActiveUtc).First();
            if (lane.UserId is string oldId && !IsTempUserId(oldId)) _byUser.Remove(oldId);

            lane.UserId = $"evt:{eventId}";
            lane.Username = lane.Username ?? "";
            lane.Color = string.IsNullOrWhiteSpace(lane.Color) ? "#6A9EFF" : lane.Color;
            lane.TextOpacity = 1.0;
            lane.LastActiveUtc = DateTime.UtcNow;

            _byEvent[eventId] = lane;
            return lane;
        }

        // When user info is available, adopt an existing event lane or allocate one for the user
        LaneVM AdoptEventLaneForUser(string eventId, string userId, string username, string color)
        {
            if (_byEvent.TryGetValue(eventId, out var lane))
            {
                if (lane.UserId == null || IsTempUserId(lane.UserId) || lane.UserId != userId)
                {
                    if (lane.UserId is string oldId && !IsTempUserId(oldId)) _byUser.Remove(oldId);
                    lane.UserId = userId;
                    lane.Username = string.IsNullOrWhiteSpace(username) ? userId : username;
                    lane.Color = string.IsNullOrWhiteSpace(color) ? "#6A9EFF" : color;
                    lane.LastActiveUtc = DateTime.UtcNow;
                    _byUser[userId] = lane;
                }
                return lane;
            }
            lane = GetOrAssignLane(userId, username, color);
            _byEvent[eventId] = lane;
            return lane;
        }

        // ---------------- measure: recompute per-lane character budget ----------------
        void RecomputeCharBudgets()
        {
            // We scale all content uniformly by _scale. The text's effective pixel width
            // is proportional to FONT_SIZE * _scale. To keep the line budget reasonable,
            // estimate the usable width in *unscaled content units* and divide by the
            // average char pixel width (also scaled).
            //
            // Rough budget model:
            //   usableContentWidth ≈ (windowWidth - outerMargins*2 - side paddings) / _scale
            //   avgCharPx ≈ (FONT_SIZE * _scale) * 0.55
            //
            // Most constants below mirror the XAML layout (margins/paddings/columns).
            double windowW = this.ActualWidth;

            // Outer shell margins (12 each side), ItemsControl padding (16 each side)
            double outer = OUTER_MARGIN * 2.0;     // shell Grid Margin="12"
            double itemsPad = 16.0 * 2.0;          // ItemsControl Padding="16"
            double iconCol = 34.0;                 // approximate icon column incl. spacing (pre-scale)
            double misc    = 28.0;                 // extra interior gutters/spacers (pre-scale)

            // Convert visible width to content coordinates
            double contentW = Math.Max(200.0, (windowW - outer - itemsPad) / Math.Max(_scale, 0.001));

            // Effective average character width in pixels (scaled)
            double avgCharPx = Math.Max(7.0, (FONT_SIZE * Math.Max(_scale, 0.001)) * 0.55);

            // Remove icon + spacer (pre-scale units)
            double usable = Math.Max(120.0, contentW - iconCol - misc);

            int budget = (int)Math.Max(MIN_CHAR_BUDGET, Math.Floor(usable / avgCharPx));

            foreach (var lane in _lanes) lane.CharBudget = budget;
        }

        // ---------------- WebSocket client ----------------
        async Task RunWebSocketLoop(CancellationToken token)
        {
            var backoff = 500; // Start with 500ms
            var maxBackoff = 5000; // Cap at 5 seconds
            
            while (!token.IsCancellationRequested)
            {
                try
                {
                    UpdateStatus("Connecting...");
                    LogMessage($"[WS/Overlay] Connecting to {_wsUrl}");
                    
                    _ws = new ClientWebSocket();
                    _ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
                    
                    await _ws.ConnectAsync(new Uri(_wsUrl), token);
                    
                    LogMessage($"[WS/Overlay] OPEN");
                    UpdateStatus("Connected");
                    backoff = 500; // Reset backoff on successful connection

                    // Start heartbeat and receive tasks
                    var heartbeatTask = RunHeartbeat(token);
                    var receiveTask = RunReceiveLoop(token);
                    
                    // Wait for either task to complete (connection lost)
                    await Task.WhenAny(heartbeatTask, receiveTask);
                }
                catch (Exception ex)
                {
                    LogMessage($"[WS/Overlay] ERROR: {ex.Message}");
                    UpdateStatus($"Connection failed: {ex.Message}");
                }

                try { _ws?.Abort(); _ws?.Dispose(); } catch { }
                
                if (token.IsCancellationRequested) break;
                
                LogMessage($"[WS/Overlay] CLOSE - reconnecting in {backoff/1000}s");
                UpdateStatus($"Reconnecting in {backoff/1000}s...");
                await Task.Delay(backoff, token);
                backoff = Math.Min(backoff * 2, maxBackoff);
            }
        }

        async Task RunHeartbeat(CancellationToken token)
        {
            while (_ws?.State == WebSocketState.Open && !token.IsCancellationRequested)
            {
                try
                {
                    await Task.Delay(25000, token); // Send ping every 25 seconds
                    if (_ws?.State == WebSocketState.Open)
                    {
                        await _ws.SendAsync(Array.Empty<byte>(), WebSocketMessageType.Binary, true, token);
                    }
                }
                catch
                {
                    break; // Connection lost, exit heartbeat
                }
            }
        }

        async Task RunReceiveLoop(CancellationToken token)
        {
            var buf = new byte[64 * 1024];
            var messageBuffer = new ArrayBufferWriter<byte>();

            while (_ws?.State == WebSocketState.Open && !token.IsCancellationRequested)
            {
                try
                {
                    messageBuffer.Clear();
                    WebSocketReceiveResult res;
                    
                    do
                    {
                        res = await _ws.ReceiveAsync(buf, token);
                        if (res.MessageType == WebSocketMessageType.Close) break;
                        messageBuffer.Write(buf.AsSpan(0, res.Count));
                    }
                    while (!res.EndOfMessage && _ws.State == WebSocketState.Open);

                    if (res.MessageType == WebSocketMessageType.Close) break;

                    var json = Encoding.UTF8.GetString(messageBuffer.WrittenSpan);
                    HandleMessage(json);
                }
                catch
                {
                    break; // Connection lost, exit receive loop
                }
            }
        }

        void UpdateStatus(string status)
        {
            _status = status;
            Dispatcher.Invoke(() =>
            {
                this.Title = $"Discord Caption Overlay - {status}";
            }, DispatcherPriority.Background);
        }

        void HandleMessage(string json)
        {
            try
            {
                // Log raw message (first 500 chars)
                var rawPreview = json.Length > 500 ? json.Substring(0, 500) + "..." : json;
                LogMessage($"[WS/Overlay] RX raw: {rawPreview}");

                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;
                
                if (!root.TryGetProperty("type", out var typeProp))
                {
                    LogMessage("[WS/Overlay] WARN: message missing 'type' field");
                    return;
                }
                
                var type = typeProp.GetString();
                if (string.IsNullOrEmpty(type))
                {
                    LogMessage("[WS/Overlay] WARN: message has empty 'type' field");
                    return;
                }

                // Route by type (case-sensitive)
                switch (type)
                {
                    case "prefs":
                        HandlePrefs(root);
                        break;
                    case "caption":
                        HandleCaption(root);
                        break;
                    case "update":
                        HandleUpdate(root);
                        break;
                    case "finalize":
                        HandleFinalize(root);
                        break;
                    default:
                        LogMessage($"[WS/Overlay] WARN unknown type: {type}");
                        break;
                }
            }
            catch (Exception ex)
            {
                LogMessage($"[WS/Overlay] ERROR parsing message: {ex.Message}");
            }
        }

        void HandlePrefs(JsonElement root)
        {
            try
            {
                if (root.TryGetProperty("prefs", out var prefsEl))
                {
                    var translate = prefsEl.TryGetProperty("translate", out var tEl) ? tEl.GetBoolean() : false;
                    var targetLang = prefsEl.TryGetProperty("targetLang", out var tlEl) ? tlEl.GetString() ?? "en" : "en";
                    var langHint = prefsEl.TryGetProperty("langHint", out var lhEl) ? lhEl.GetString() ?? "en" : "en";

                    _translate = translate;
                    _targetLang = targetLang;
                    _langHint = langHint;

                    LogMessage($"[WS/Overlay] prefs: translate={translate}, targetLang={targetLang}, langHint={langHint}");
                }
            }
            catch (Exception ex)
            {
                LogMessage($"[WS/Overlay] ERROR parsing prefs: {ex.Message}");
            }
        }

        void HandleCaption(JsonElement root)
        {
            try
            {
                var eventId = root.TryGetProperty("eventId", out var eEl) ? eEl.GetString() ?? "" : "";
                var userId = root.TryGetProperty("userId", out var idEl) ? idEl.GetString() ?? "user" : "user";
                var username = root.TryGetProperty("username", out var uEl) ? uEl.GetString() ?? "User" : "User";
                var color = root.TryGetProperty("color", out var cEl) ? cEl.GetString() ?? "#6A9EFF" : "#6A9EFF";
                var text = root.TryGetProperty("text", out var tEl) ? tEl.GetString() ?? "" : "";

                if (string.IsNullOrEmpty(eventId))
                {
                    LogMessage("[WS/Overlay] WARN: caption missing eventId");
                    return;
                }

                LogMessage($"[WS/Overlay] caption(eventId={eventId})");

                Dispatcher.Invoke(() =>
                {
                    // Create or update in-flight message
                    _inFlight[eventId] = new InFlightMessage
                    {
                        EventId = eventId,
                        UserId = userId,
                        Username = username,
                        Color = color,
                        Text = text,
                        LastUpdate = DateTime.UtcNow
                    };

                    // Adopt or assign lane for this event/user
                    var lane = AdoptEventLaneForUser(eventId, userId, username, color);

                    // Replace displayed text with newest string (trim to budget tail if needed)
                    ReplaceLaneText(lane, text, isFinal: false);
                }, DispatcherPriority.Send);
            }
            catch (Exception ex)
            {
                LogMessage($"[WS/Overlay] ERROR parsing caption: {ex.Message}");
            }
        }

        void HandleUpdate(JsonElement root)
        {
            try
            {
                var eventId = root.TryGetProperty("eventId", out var eEl) ? eEl.GetString() ?? "" : "";
                var text = root.TryGetProperty("text", out var tEl) ? tEl.GetString() ?? "" : "";

                if (string.IsNullOrEmpty(eventId))
                {
                    LogMessage("[WS/Overlay] WARN: update missing eventId");
                    return;
                }

                LogMessage($"[WS/Overlay] update(eventId={eventId})");

                Dispatcher.Invoke(() =>
                {
                    // Ensure in-flight record exists (caption may have been missed)
                    if (_inFlight.TryGetValue(eventId, out var inFlight))
                    {
                        inFlight.Text = text;
                        inFlight.LastUpdate = DateTime.UtcNow;
                    }
                    else
                    {
                        _inFlight[eventId] = new InFlightMessage { EventId = eventId, Text = text, LastUpdate = DateTime.UtcNow };
                    }

                    // Ensure a lane exists for this event and update it
                    var lane = _byEvent.TryGetValue(eventId, out var l) ? l : GetOrCreateEventLane(eventId);
                    ReplaceLaneText(lane, text, isFinal: false);
                }, DispatcherPriority.Send);
            }
            catch (Exception ex)
            {
                LogMessage($"[WS/Overlay] ERROR parsing update: {ex.Message}");
            }
        }

        void HandleFinalize(JsonElement root)
        {
            try
            {
                var eventId = root.TryGetProperty("eventId", out var eEl) ? eEl.GetString() ?? "" : "";
                var userId = root.TryGetProperty("userId", out var idEl) ? idEl.GetString() ?? "user" : "user";
                var username = root.TryGetProperty("username", out var uEl) ? uEl.GetString() ?? "User" : "User";
                var color = root.TryGetProperty("color", out var cEl) ? cEl.GetString() ?? "#6A9EFF" : "#6A9EFF";
                var text = root.TryGetProperty("text", out var tEl) ? tEl.GetString() ?? "" : "";

                if (string.IsNullOrEmpty(eventId))
                {
                    LogMessage("[WS/Overlay] WARN: finalize missing eventId");
                    return;
                }

                // Extract meta information
                string srcText = "";
                string srcLang = "";
                if (root.TryGetProperty("meta", out var metaEl))
                {
                    srcText = metaEl.TryGetProperty("srcText", out var stEl) ? stEl.GetString() ?? "" : "";
                    srcLang = metaEl.TryGetProperty("srcLang", out var slEl) ? slEl.GetString() ?? "" : "";
                }

                LogMessage($"[WS/Overlay] finalize(eventId={eventId}, srcLang={srcLang}, len={text.Length})");

                Dispatcher.Invoke(() =>
                {
                    // Record final (even if in-flight was missing)
                    var finalized = new FinalizedMessage
                    {
                        EventId = eventId,
                        UserId = userId,
                        Username = username,
                        Color = color,
                        Text = text,
                        SrcText = srcText,
                        SrcLang = srcLang,
                        FinalizedAt = DateTime.UtcNow
                    };
                    _finalized[eventId] = finalized;
                    _inFlight.Remove(eventId);

                    // Ensure lane is bound to this user and show final text
                    var lane = AdoptEventLaneForUser(eventId, userId, username, color);
                    ReplaceLaneText(lane, text, isFinal: true);

                    // Clean event mapping later (let text linger)
                    Task.Delay(5000).ContinueWith(_ =>
                    {
                        Dispatcher.Invoke(() => { _byEvent.Remove(eventId); }, DispatcherPriority.Background);
                    });
                }, DispatcherPriority.Send);
            }
            catch (Exception ex)
            {
                LogMessage($"[WS/Overlay] ERROR parsing finalize: {ex.Message}");
            }
        }

        void LogMessage(string message)
        {
            try
            {
                var logPath = System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "overlay.log");
                var timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff");
                var logLine = $"{timestamp} {message}";
                
                // Simple ring buffer: keep last 1000 lines
                var lines = new List<string>();
                if (System.IO.File.Exists(logPath))
                {
                    lines = System.IO.File.ReadAllLines(logPath).ToList();
                }
                
                lines.Add(logLine);
                if (lines.Count > 1000)
                {
                    lines = lines.Skip(lines.Count - 1000).ToList();
                }
                
                System.IO.File.WriteAllLines(logPath, lines);
            }
            catch
            {
                // Ignore logging errors
            }
        }

        void SendPrefs(bool? translate = null, string? targetLang = null, string? langHint = null)
        {
            try
            {
                if (_ws?.State != WebSocketState.Open) return;

                var prefs = new Dictionary<string, object>();
                if (translate.HasValue) prefs["translate"] = translate.Value;
                if (!string.IsNullOrEmpty(targetLang)) prefs["targetLang"] = targetLang;
                if (!string.IsNullOrEmpty(langHint)) prefs["langHint"] = langHint;

                if (prefs.Count == 0) return; // No changes

                var message = new
                {
                    type = "setPrefs",
                    prefs = prefs
                };

                var json = System.Text.Json.JsonSerializer.Serialize(message);
                var buffer = Encoding.UTF8.GetBytes(json);
                
                _ws.SendAsync(buffer, WebSocketMessageType.Text, true, CancellationToken.None);
                LogMessage($"[WS/Overlay] TX setPrefs: {json}");
            }
            catch (Exception ex)
            {
                LogMessage($"[WS/Overlay] ERROR sending prefs: {ex.Message}");
            }
        }

        // ---------------- click-through + window chrome ----------------
        const int GWL_EXSTYLE       = -20;
        const int WS_EX_TRANSPARENT = 0x00000020;
        const int WS_EX_LAYERED     = 0x00080000;

        [DllImport("user32.dll")] static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);
        [DllImport("user32.dll")] static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);
        [DllImport("user32.dll")] static extern bool   RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
        [DllImport("user32.dll")] static extern bool   UnregisterHotKey(IntPtr hWnd, int id);

        const int  WM_HOTKEY            = 0x0312;
        const int  HOTKEY_CLICKTHROUGH  = 1001;
        const int  HOTKEY_OPA_UP        = 1002;
        const int  HOTKEY_OPA_DOWN      = 1003;
        const int  HOTKEY_SELFTEST      = 1004;
        const uint MOD_ALT              = 0x0001;
        const uint MOD_CONTROL          = 0x0002;

        void EnableLayeredAndResizable()
        {
            var hwnd = new System.Windows.Interop.WindowInteropHelper(this).EnsureHandle();
            var ex = GetWindowLongPtr(hwnd, GWL_EXSTYLE);
            var val = new IntPtr(ex.ToInt64() | WS_EX_LAYERED);
            SetWindowLongPtr(hwnd, GWL_EXSTYLE, val);

            var chrome = new WindowChrome
            {
                CaptionHeight = 0,
                CornerRadius = new CornerRadius(16),
                GlassFrameThickness = new Thickness(0),
                ResizeBorderThickness = new Thickness(6),
                UseAeroCaptionButtons = false
            };
            WindowChrome.SetWindowChrome(this, chrome);

            var src = System.Windows.Interop.HwndSource.FromHwnd(hwnd);
            src.AddHook(WndProc);
        }

        void SetClickThrough(bool on)
        {
            _clickThrough = on;
            var hwnd = new System.Windows.Interop.WindowInteropHelper(this).EnsureHandle();
            var ex = GetWindowLongPtr(hwnd, GWL_EXSTYLE).ToInt64();
            if (on) ex |= WS_EX_TRANSPARENT; else ex &= ~WS_EX_TRANSPARENT;
            SetWindowLongPtr(hwnd, GWL_EXSTYLE, new IntPtr(ex));
        }

        void RegisterHotkeys()
        {
            var hwnd = new System.Windows.Interop.WindowInteropHelper(this).EnsureHandle();
            RegisterHotKey(hwnd, HOTKEY_CLICKTHROUGH, MOD_CONTROL | MOD_ALT, (uint)KeyInterop.VirtualKeyFromKey(Key.C));
            RegisterHotKey(hwnd, HOTKEY_OPA_UP,       MOD_CONTROL | MOD_ALT, (uint)KeyInterop.VirtualKeyFromKey(Key.OemPlus));
            RegisterHotKey(hwnd, HOTKEY_OPA_DOWN,     MOD_CONTROL | MOD_ALT, (uint)KeyInterop.VirtualKeyFromKey(Key.OemMinus));
#if DEBUG
            RegisterHotKey(hwnd, HOTKEY_SELFTEST,     MOD_CONTROL | MOD_ALT, (uint)KeyInterop.VirtualKeyFromKey(Key.F6));
#endif
        }

        IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
        {
            if (msg == WM_HOTKEY)
            {
                var id = wParam.ToInt32();
                if      (id == HOTKEY_CLICKTHROUGH) { SetClickThrough(!_clickThrough); handled = true; }
                else if (id == HOTKEY_OPA_UP)       { this.Opacity = Math.Min(0.98, this.Opacity + 0.05); handled = true; }
                else if (id == HOTKEY_OPA_DOWN)     { this.Opacity = Math.Max(0.40, this.Opacity - 0.05); handled = true; }
#if DEBUG
                else if (id == HOTKEY_SELFTEST)     { RunSelfTest(); handled = true; }
#endif
            }
            return IntPtr.Zero;
        }

#if DEBUG
        async void RunSelfTest()
        {
            try
            {
                LogMessage("[TEST] Starting self-test mode");
                
                // Temporarily change WebSocket URL to test server
                var originalUrl = _wsUrl;
                _wsUrl = "ws://localhost:7071";
                
                // Close current connection
                try { _ws?.Abort(); _ws?.Dispose(); } catch { }
                
                // Wait a moment, then restore original URL
                await Task.Delay(2000);
                _wsUrl = originalUrl;
                
                LogMessage("[TEST] Self-test mode completed");
            }
            catch (Exception ex)
            {
                LogMessage($"[TEST] Self-test error: {ex.Message}");
            }
        }
#endif

        // ---------------- title bar + buttons ----------------
        private void TitleBar_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            if (!_clickThrough)
            {
                try { DragMove(); } catch { }
            }
        }

        private void MinimizeButton_Click(object sender, RoutedEventArgs e) => this.WindowState = WindowState.Minimized;
        private void CloseButton_Click(object sender, RoutedEventArgs e) => this.Close();

        // ---------------- cleanup ----------------
        protected override void OnClosed(EventArgs e)
        {
            base.OnClosed(e);

            try { _idleTimer?.Stop(); } catch { }

            var hwnd = new System.Windows.Interop.WindowInteropHelper(this).Handle;
            UnregisterHotKey(hwnd, HOTKEY_CLICKTHROUGH);
            UnregisterHotKey(hwnd, HOTKEY_OPA_UP);
            UnregisterHotKey(hwnd, HOTKEY_OPA_DOWN);
#if DEBUG
            UnregisterHotKey(hwnd, HOTKEY_SELFTEST);
#endif

            try { _cts?.Cancel(); } catch { }
            try { _ws?.Abort(); _ws?.Dispose(); } catch { }
        }
    }
}
// ---------------- end of file ----------------
