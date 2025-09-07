using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Timers;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using DiscordCaptionOverlay.Interop;
using DiscordCaptionOverlay.Services;
using DiscordCaptionOverlay.Typing;
using DiscordCaptionOverlay.ViewModels;

namespace DiscordCaptionOverlay
{
    public partial class MainWindow : Window
    {
        // Required fields per spec
        private OverlayViewModel _overlayVM = new();
        private readonly Dictionary<string, SpeakerViewModel> _byId = new();
        private readonly Dictionary<string, string> _byEvent = new(); // eventId -> userId
        private readonly CaptionMetrics _metrics = new();

        private AppConfig _cfg;
        private System.Windows.Forms.NotifyIcon? _tray;
        private ClientWebSocket? _ws;
        private CancellationTokenSource? _wsCts;
        private readonly DispatcherTimer _idleTimer;

        private readonly Dictionary<string, DispatcherTimer> _speakDebounce = new();
        private readonly Dictionary<string, System.Timers.Timer> _synthTimers = new();
        // Coalescer: latest text per eventId, flushed at ~60 FPS
        private readonly Dictionary<string, string> _pendingUpdates = new();
        private readonly DispatcherTimer _coalesce = new() { Interval = TimeSpan.FromMilliseconds(16) };
        private readonly HashSet<string> _finalizedEvents = new();
        private readonly HashSet<string> _synthFinalizedEvents = new();
        // Defer cleanup of eventId->userId mapping a bit to allow late updates to re-enter
        private readonly Dictionary<string, DispatcherTimer> _finalizeCleanup = new();
        // Also keep a short-lived map of finalized events for reentry after mapping is removed
        private readonly Dictionary<string, (string userId, DateTime expiresUtc)> _finalizedMap = new();
        
        // Enhanced tracking
        private readonly Dictionary<string, int> _latestSeq = new(); // segmentId -> latest sequence number
        private readonly Dictionary<string, string> _segmentToUser = new(); // segmentId -> userId

        public MainWindow()
        {
            InitializeComponent();
            _overlayVM.Metrics = _metrics;
            DataContext = _overlayVM;

            // Load + apply config
            _cfg = ConfigStore.Load();
            ApplyConfigOnWindow();
            // Apply typing speed from config (per-line overrides with fallback)
            try
            {
                double baseMult = _cfg.timing.typingSpeedMultiplier > 0 ? _cfg.timing.typingSpeedMultiplier : 1.0;
                double interimMult = _cfg.timing.interimTypingSpeedMultiplier > 0 ? _cfg.timing.interimTypingSpeedMultiplier : baseMult;
                double finalMult = _cfg.timing.finalTypingSpeedMultiplier > 0 ? _cfg.timing.finalTypingSpeedMultiplier : baseMult;
                _overlayVM.TypingSpeedMultiplier = baseMult;
                _overlayVM.InterimTypingSpeedMultiplier = interimMult;
                _overlayVM.FinalTypingSpeedMultiplier = finalMult;
            }
            catch { _overlayVM.TypingSpeedMultiplier = 1.0; _overlayVM.InterimTypingSpeedMultiplier = 1.0; _overlayVM.FinalTypingSpeedMultiplier = 1.0; }

            // Idle clear timer (500ms tick)
            _idleTimer = new DispatcherTimer(DispatcherPriority.Background);
            _idleTimer.Interval = TimeSpan.FromMilliseconds(500);
            _idleTimer.Tick += IdleTimer_Tick;
            _idleTimer.Start();

            // Create tray icon
            SetupTray();

            // Start WS
            _ = RunWebSocketLoop();

            // Start global coalescer
            InitCoalescer();
        }

        private void InitCoalescer()
        {
            _coalesce.Tick += (s, e) =>
            {
                if (_pendingUpdates.Count == 0) return;
                var snapshot = _pendingUpdates.ToArray();
                _pendingUpdates.Clear();

                foreach (var kv in snapshot)
                {
                    var eventId = kv.Key;
                    var text = kv.Value;
                    if (_byEvent.TryGetValue(eventId, out var uid) && _byId.TryGetValue(uid, out var svm))
                    {
                        ApplyInterimOrQueue(svm, text);
                    }
                }
            };
            _coalesce.Start();
        }

        private void ApplyConfigOnWindow()
        {
            Width = _cfg.windowWidth;
            Height = _cfg.windowHeight;
            
            // If no position is configured, place window in top-right corner
            if (_cfg.windowLeft.HasValue) 
                Left = _cfg.windowLeft.Value;
            else
                Left = SystemParameters.PrimaryScreenWidth - Width - 50;
                
            if (_cfg.windowTop.HasValue) 
                Top = _cfg.windowTop.Value;
            else
                Top = 50;
                
            Topmost = true;

            if (_cfg.theme == "high-contrast")
                UseHighContrast(true);

            if (_cfg.clickThrough) ClickThrough.SetTransparent(this, true);
            
            // Make sure window is visible
            WindowState = WindowState.Normal;
            Show();
            Activate();
        }

        private void SetupTray()
        {
            _tray = new System.Windows.Forms.NotifyIcon();
            _tray.Icon = System.Drawing.SystemIcons.Information;
            _tray.Visible = true;
            _tray.Text = "AI Discord Live Translator";

            var menu = new System.Windows.Forms.ContextMenuStrip();

            var clickThroughItem = new System.Windows.Forms.ToolStripMenuItem("Click-through")
            {
                Checked = _cfg.clickThrough,
                CheckOnClick = true
            };
            clickThroughItem.CheckedChanged += (s, e) =>
            {
                _cfg.clickThrough = clickThroughItem.Checked;
                ClickThrough.SetTransparent(this, _cfg.clickThrough);
                ConfigStore.Save(_cfg);
            };
            menu.Items.Add(clickThroughItem);

            var themeItem = new System.Windows.Forms.ToolStripMenuItem("High Contrast Theme")
            {
                Checked = _cfg.theme == "high-contrast",
                CheckOnClick = true
            };
            themeItem.CheckedChanged += (s, e) =>
            {
                UseHighContrast(themeItem.Checked);
                _cfg.theme = themeItem.Checked ? "high-contrast" : "glass";
                ConfigStore.Save(_cfg);
            };
            menu.Items.Add(themeItem);

            var font90 = new System.Windows.Forms.ToolStripMenuItem("Font Scale 90%");
            var font100 = new System.Windows.Forms.ToolStripMenuItem("Font Scale 100%");
            var font120 = new System.Windows.Forms.ToolStripMenuItem("Font Scale 120%");
            font90.Click += (s, e) => { _overlayVM.FontScale = 0.9; _cfg.fontScale = 0.9; ConfigStore.Save(_cfg); };
            font100.Click += (s, e) => { _overlayVM.FontScale = 1.0; _cfg.fontScale = 1.0; ConfigStore.Save(_cfg); };
            font120.Click += (s, e) => { _overlayVM.FontScale = 1.2; _cfg.fontScale = 1.2; ConfigStore.Save(_cfg); };
            menu.Items.Add(font90);
            menu.Items.Add(font100);
            menu.Items.Add(font120);

            // Typing speed controls
            var speed50 = new System.Windows.Forms.ToolStripMenuItem("Typing Speed 0.5x");
            var speed75 = new System.Windows.Forms.ToolStripMenuItem("Typing Speed 0.75x");
            var speed100 = new System.Windows.Forms.ToolStripMenuItem("Typing Speed 1.0x");
            speed50.Click += (s, e) => SetTypingSpeed(0.5);
            speed75.Click += (s, e) => SetTypingSpeed(0.75);
            speed100.Click += (s, e) => SetTypingSpeed(1.0);
            menu.Items.Add(new System.Windows.Forms.ToolStripSeparator());
            menu.Items.Add(speed50);
            menu.Items.Add(speed75);
            menu.Items.Add(speed100);

            menu.Items.Add(new System.Windows.Forms.ToolStripSeparator());
            var exitItem = new System.Windows.Forms.ToolStripMenuItem("Exit");
            exitItem.Click += (s, e) => Close();
            menu.Items.Add(exitItem);

            _tray.ContextMenuStrip = menu;
        }

        private void SetTypingSpeed(double mult)
        {
            _overlayVM.TypingSpeedMultiplier = Math.Max(0.1, mult);
            _overlayVM.InterimTypingSpeedMultiplier = _overlayVM.TypingSpeedMultiplier;
            // keep final speed fast unless user explicitly changes final in config
            _cfg.timing.typingSpeedMultiplier = _overlayVM.TypingSpeedMultiplier;
            _cfg.timing.interimTypingSpeedMultiplier = _overlayVM.InterimTypingSpeedMultiplier;
            ConfigStore.Save(_cfg);

            // Re-apply measures for current rows so the new speed takes effect immediately
            try
            {
                foreach (var vm in _overlayVM.Speakers)
                {
                    var interimTf = new Typeface(new FontFamily("Segoe UI"), FontStyles.Italic, FontWeights.Normal, FontStretches.Normal);
                    var finalTf = new Typeface(new FontFamily("Segoe UI"), FontStyles.Normal, FontWeights.Normal, FontStretches.Normal);
                    vm.InterimType.SetMeasure(vm.AvailableWidth, 13 * _overlayVM.FontScale, interimTf, _overlayVM.FontScale, _overlayVM.InterimTypingSpeedMultiplier);
                    vm.FinalType.SetMeasure(vm.AvailableWidth, 15 * _overlayVM.FontScale, finalTf, _overlayVM.FontScale, _overlayVM.FinalTypingSpeedMultiplier);
                }
            }
            catch { }
        }

        private void UseHighContrast(bool on)
        {
            var app = System.Windows.Application.Current;
            var newTheme = new ResourceDictionary
            {
                Source = new Uri(on
                  ? "pack://application:,,,/DiscordCaptionOverlay;component/Themes/HighContrast.xaml"
                  : "pack://application:,,,/DiscordCaptionOverlay;component/Themes/Glass.xaml",
                  UriKind.Absolute)
            };
            var dicts = app.Resources.MergedDictionaries;
            if (dicts.Count == 0) dicts.Add(newTheme); else dicts[0] = newTheme;
        }

        private async Task RunWebSocketLoop()
        {
            var backoff = 500;
            while (true)
            {
                try
                {
                    _overlayVM.ConnectionStatus = "Connecting";
                    _wsCts = new CancellationTokenSource();
                    _ws = new ClientWebSocket();
                    await _ws.ConnectAsync(new Uri(_cfg.wsUrl), _wsCts.Token);
                    _overlayVM.ConnectionStatus = "Connected";
                    await ReceiveLoop(_ws, _wsCts.Token);
                }
                catch
                {
                    _overlayVM.ConnectionStatus = "Disconnected";
                }
                finally
                {
                    try { _ws?.Dispose(); } catch { }
                }

                await Task.Delay(backoff);
                backoff = Math.Min(10000, backoff * 2);
            }
        }

        private async Task ReceiveLoop(ClientWebSocket ws, CancellationToken ct)
        {
            var buf = new ArraySegment<byte>(new byte[1 << 15]);
            while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
            {
                var ms = new System.IO.MemoryStream();
                WebSocketReceiveResult res;
                do
                {
                    res = await ws.ReceiveAsync(buf, ct);
                    if (res.MessageType == WebSocketMessageType.Close) break;
                    ms.Write(buf.Array!, buf.Offset, res.Count);
                } while (!res.EndOfMessage);

                if (res.MessageType == WebSocketMessageType.Text)
                {
                    var s = Encoding.UTF8.GetString(ms.ToArray());
                    try { HandleMessage(s); }
                    catch { /* ignore per-msg errors */ }
                }
            }
        }

        private void HandleMessage(string json)
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            var type = root.GetProperty("type").GetString() ?? "";
            switch (type)
            {
                case "prefs":
                    HandlePrefs(root);
                    break;
                case "speakers:snapshot":
                    HandleSpeakersSnapshot(root);
                    break;
                case "speakers:update":
                    HandleSpeakersUpdate(root);
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
            }
        }

        private void HandlePrefs(JsonElement e)
        {
            // currently nothing to do for overlay
        }

        private void HandleSpeakersSnapshot(JsonElement e)
        {
            if (e.TryGetProperty("speakers", out var list) && list.ValueKind == JsonValueKind.Array)
            {
                foreach (var s in list.EnumerateArray())
                {
                    var uid = s.GetProperty("userId").GetString() ?? "";
                    var vm = GetOrCreate(uid);
                    if (s.TryGetProperty("username", out var u)) vm.Username = u.GetString() ?? vm.Username;
                    if (s.TryGetProperty("avatar", out var a)) vm.AvatarUrl = a.GetString() ?? vm.AvatarUrl;
                    if (s.TryGetProperty("color", out var c)) vm.ColorHex = c.GetString() ?? vm.ColorHex;
                }
            }
        }

        private void HandleSpeakersUpdate(JsonElement e)
        {
            var uid = e.GetProperty("userId").GetString() ?? "";
            var vm = GetOrCreate(uid);
            // Support both flat and nested patch formats
            if (e.TryGetProperty("username", out var u)) vm.Username = u.GetString() ?? vm.Username;
            if (e.TryGetProperty("avatar", out var a)) vm.AvatarUrl = a.GetString() ?? vm.AvatarUrl;
            if (e.TryGetProperty("color", out var c)) vm.ColorHex = c.GetString() ?? vm.ColorHex;

            if (e.TryGetProperty("patch", out var patch) && patch.ValueKind == JsonValueKind.Object)
            {
                if (patch.TryGetProperty("username", out var up)) vm.Username = up.GetString() ?? vm.Username;
                if (patch.TryGetProperty("avatar", out var ap)) vm.AvatarUrl = ap.GetString() ?? vm.AvatarUrl;
                if (patch.TryGetProperty("color", out var cp)) vm.ColorHex = cp.GetString() ?? vm.ColorHex;
            }
        }

        private void HandleCaption(JsonElement e)
        {
            _metrics.IncrementEvents();
            var eventId = e.GetProperty("eventId").GetString() ?? Guid.NewGuid().ToString();
            var userId = e.GetProperty("userId").GetString() ?? "";
            _byEvent[eventId] = userId;
            var vm = GetOrCreate(userId);
            if (e.TryGetProperty("username", out var u)) vm.Username = u.GetString() ?? vm.Username;
            if (e.TryGetProperty("avatar", out var a0)) vm.AvatarUrl = a0.GetString() ?? vm.AvatarUrl;
            if (e.TryGetProperty("color", out var c)) vm.ColorHex = c.GetString() ?? vm.ColorHex;

            vm.LastHeardUtc = DateTime.UtcNow;
            SetSpeaking(vm);

            // captions always unlock the lane
            if (vm.IsFinalShowing)
                vm.ClearFinalAndResume(eventId);

            var text = e.TryGetProperty("text", out var t) ? (t.GetString() ?? "") : "";
            ApplyInterimOrQueue(vm, text);

            Logger.Info("WS_IN_caption", new {
                eventId, userId, username = vm.Username, len = text.Length,
                preview = text.Length > 120 ? text[..120] : text,
                availablePx = vm.AvailableWidth, line = "interim"
            });
        }

        private void HandleUpdate(JsonElement e)
        {
            var eventId = e.GetProperty("eventId").GetString() ?? "";
            var segmentId = e.TryGetProperty("segmentId", out var segEl) ? segEl.GetString() ?? "" : "";
            var seq = e.TryGetProperty("seq", out var seqEl) ? seqEl.GetInt32() : 0;
            var tSend = e.TryGetProperty("t_send", out var tSendEl) ? tSendEl.GetDouble() : 0;
            var tRecv = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            
            // Check sequence ordering
            if (!string.IsNullOrEmpty(segmentId) && seq > 0)
            {
                if (_latestSeq.TryGetValue(segmentId, out var lastSeq) && seq <= lastSeq)
                {
                    _metrics.IncrementDroppedOutOfOrder();
                    Logger.Debug("UpdateIgnoredOutOfOrder", new { eventId, segmentId, seq, lastSeq });
                    return;
                }
                _latestSeq[segmentId] = seq;
            }
            
            if (_finalizedEvents.Contains(eventId))
            {
                // Check if we should allow reentry
                var now = DateTime.UtcNow;
                int? seqOpt = seq; // Use the seq already extracted above
                
                if (!_byEvent.TryGetValue(eventId, out var reentryUserId)) return;
                var reentryVm = GetOrCreate(reentryUserId);
                
                if (reentryVm.ShouldReenterFromUpdate(eventId, seqOpt, now))
                {
                    _metrics.IncrementLateRespawns();
                    Logger.Info("PostFinalReentry", new { 
                        eventId, 
                        userId = reentryUserId, 
                        activeEventId = reentryVm.ActiveEventId, 
                        seq = seqOpt,
                        elapsed = (now - reentryVm.LastFinalizedAtUtc).TotalMilliseconds
                    });
                    reentryVm.ClearFinalAndResume(eventId);
                    _finalizedEvents.Remove(eventId); // Allow processing
                }
                else
                {
                    // Still within brief post-final window? drop just those micro-corrections
                    if (reentryVm.IsFinalShowing && reentryVm.ActiveEventId == eventId &&
                        (now - reentryVm.LastFinalizedAtUtc).TotalMilliseconds < reentryVm.ReentryDelayMs)
                    {
                        Logger.Debug("UpdateIgnoredWithinFinalWindow", new { eventId, elapsed = (now - reentryVm.LastFinalizedAtUtc).TotalMilliseconds });
                        return;
                    }
                    // Otherwise, this is probably an old finalized event, still ignore
                    Logger.Debug("UpdateIgnoredPostFinalize", new { eventId, segmentId, seq });
                    return;
                }
            }
            
            if (!_byEvent.TryGetValue(eventId, out var userId))
            {
                // Reentry path: if this event was recently finalized and mapping cleared, restore it
                if (_finalizedMap.TryGetValue(eventId, out var rec) && rec.expiresUtc > DateTime.UtcNow)
                {
                    _byEvent[eventId] = rec.userId;
                    _finalizedMap.Remove(eventId);
                    userId = rec.userId;
                }
                else
                {
                    return;
                }
            }
            var vm = GetOrCreate(userId);
            vm.LastHeardUtc = DateTime.UtcNow;
            SetSpeaking(vm);

            var newText = e.TryGetProperty("text", out var textElUpdate) ? (textElUpdate.GetString() ?? "") : "";
            // store latest text; global coalescer will flush
            _pendingUpdates[eventId] = newText;

            // If a translated interim is provided, reflect it immediately on the top (final) line
            try
            {
                if (e.TryGetProperty("translated", out var translatedEl))
                {
                    var translated = translatedEl.GetString() ?? string.Empty;
                    if (!string.IsNullOrEmpty(translated))
                    {
                        vm.FinalRaw = translated;
                        ApplyFinal(vm); // animate using final line typing speed (configurable)
                    }
                }
            }
            catch { }

            Logger.Debug("WS_IN_update", new {
                eventId, segmentId, seq, 
                len = newText.Length,
                preview = newText.Length > 120 ? newText[..120] : newText,
                availablePx = vm.AvailableWidth, 
                t_send = tSend, t_recv = tRecv, dt_ms = tRecv - tSend,
                line = "interim"
            });
        }        private void HandleFinalize(JsonElement e)
        {
            _metrics.IncrementFinalizations();
            var eventId = e.GetProperty("eventId").GetString() ?? "";
            if (!_byEvent.TryGetValue(eventId, out var userId)) return;
            var vm = GetOrCreate(userId);

            var text = e.TryGetProperty("text", out var textElFinal) ? (textElFinal.GetString() ?? "") : "";

            // Check if we should ignore this as a subset of synthetic final
            if (!string.IsNullOrWhiteSpace(vm.FinalRaw) && vm.HasSyntheticFinal)
            {
                if (RealIsSubsetOfSynth(text, vm.FinalRaw))
                {
                    Logger.Info("FinalizeIgnoredAsSuffix", new { eventId, userId = vm.UserId, realLen = text.Length, synthLen = vm.FinalRaw.Length });
                    _finalizedEvents.Add(eventId);
                    vm.HasSyntheticFinal = false; // mark closed
                    vm.MarkFinalDisplayed(eventId); // Still track as finalized
                    return;
                }
            }

            // Duplicate guard: if synthetic final already equals this, just log and return
            if (!string.IsNullOrWhiteSpace(vm.FinalRaw) && Normalize(vm.FinalRaw) == Normalize(text))
            {
                Logger.Info("FinalizeIgnoredAsDuplicate", new { eventId, userId, len = text.Length });
                _finalizedEvents.Add(eventId);
                vm.MarkFinalDisplayed(eventId); // Still track as finalized
                return;
            }

            _finalizedEvents.Add(eventId);
            vm.LastHeardUtc = DateTime.UtcNow;
            SetSpeaking(vm);
            ApplyFinalOrQueue(vm, text);
            vm.HasSyntheticFinal = false; // mark as real final now
            vm.MarkFinalDisplayed(eventId); // Track finalization state for reentry

            Logger.Info("WS_IN_finalize", new {
                eventId, userId, len = text.Length,
                preview = text.Length > 120 ? text[..120] : text,
                availablePx = vm.AvailableWidth, line = "final"
            });

            // Lifecycle hygiene with grace period: allow late updates to re-enter
            try
            {
                if (_finalizeCleanup.TryGetValue(eventId, out var old)) { old.Stop(); _finalizeCleanup.Remove(eventId); }
                var t = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(2000) };
                t.Tick += (ss, ee2) =>
                {
                    try { ((DispatcherTimer)ss!).Stop(); } catch { }
                    _finalizeCleanup.Remove(eventId);
                    _pendingUpdates.Remove(eventId);
                    _byEvent.Remove(eventId);
                };
                _finalizeCleanup[eventId] = t;
                t.Start();

                // Record mapping for a short window so late updates can re-enter even after _byEvent is cleared
                _finalizedMap[eventId] = (userId, DateTime.UtcNow.AddMilliseconds(2000));
            }
            catch { }
        }

        private void SetSpeaking(SpeakerViewModel vm)
        {
            vm.IsSpeaking = true;
            if (!_speakDebounce.TryGetValue(vm.UserId, out var timer))
            {
                timer = new DispatcherTimer();
                timer.Interval = TimeSpan.FromMilliseconds(800);
                timer.Tick += (s, e) => { vm.IsSpeaking = false; ((DispatcherTimer)s!).Stop(); ScheduleSynthFinalize(vm); };
                _speakDebounce[vm.UserId] = timer;
            }
            timer.Stop();
            timer.Start();
        }

        private void ScheduleSynthFinalize(SpeakerViewModel vm)
        {
            // Find current eventId for this user
            string? currentEventId = null;
            foreach (var kvp in _byEvent)
            {
                if (kvp.Value == vm.UserId)
                {
                    currentEventId = kvp.Key;
                    break;
                }
            }
            
            if (currentEventId == null || _synthFinalizedEvents.Contains(currentEventId)) return;
            
            if (_synthTimers.TryGetValue(vm.UserId, out var t)) { t.Stop(); t.Dispose(); }
            
            // Variable delay based on text length
            var idleMs = vm.InterimRaw is { Length: >= 50 } ? 400 : 900;
            var nt = new System.Timers.Timer(idleMs) { AutoReset = false };
            
            nt.Elapsed += (s, e2) =>
            {
                Dispatcher.Invoke(() =>
                {
                    if (_finalizedEvents.Contains(currentEventId)) return;
                    if (!string.IsNullOrWhiteSpace(vm.FinalRaw)) return;

                    if (IsPromotable(vm.InterimRaw))
                    {
                        // promote interim to final
                        var tf = new Typeface(new FontFamily("Segoe UI"), FontStyles.Normal, FontWeights.Normal, FontStretches.Normal);
                        vm.FinalRaw = vm.InterimRaw!;
                        vm.HasSyntheticFinal = true;
                        vm.FinalType.SetMeasure(vm.AvailableWidth, 15 * _overlayVM.FontScale, tf, _overlayVM.FontScale);
                        vm.FinalType.SetText(vm.FinalRaw);
                        _synthFinalizedEvents.Add(currentEventId);
                        Logger.Info("SynthFinalize", new { userId = vm.UserId, len = vm.FinalRaw.Length });
                    }
                });
            };
            _synthTimers[vm.UserId] = nt;
            nt.Start();
        }

        private static bool IsPromotable(string? s)
        {
            if (string.IsNullOrWhiteSpace(s)) return false;
            var t = s.Trim();

            // Reject placeholders & noise
            if (t is "…" or "." or "… …") return false;
            if (t.All(ch => char.IsPunctuation(ch))) return false;

            // Require some substance
            // - at least 12 chars
            // - at least 3 words
            // - and ends cleanly (punctuation) or looks like a complete clause
            if (t.Length < 12) return false;
            var words = t.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (words.Length < 3) return false;

            // End cleanliness
            if (!".?!…—\"'".Contains(t[^1]))
            {
                // allow no punctuation only if fairly long (e.g. > 30)
                if (t.Length < 30) return false;
            }
            return true;
        }

        private static string Normalize(string s) => s.Trim().TrimEnd('.', '…');

        private static string Norm(string s) => s.Trim().TrimEnd('.', '…', ' ', '\n');

        private static bool RealIsSubsetOfSynth(string real, string synth)
        {
            var R = Norm(real);
            var S = Norm(synth);
            return S.EndsWith(R, StringComparison.Ordinal) || S.Contains(R, StringComparison.Ordinal);
        }

        public void ApplyInterim(SpeakerViewModel vm)
        {
            if (!vm.HasMeasuredWidth)
            {
                // Approximate with window width — avatar/name/padding
                var approx = Math.Max(120, this.ActualWidth - 160);
                var tfI = new Typeface(new FontFamily("Segoe UI"), FontStyles.Italic, FontWeights.Normal, FontStretches.Normal);
                var tfF = new Typeface(new FontFamily("Segoe UI"), FontStyles.Normal, FontWeights.Normal, FontStretches.Normal);
                double finalPt = Math.Max(1, vm.LaneFontSize) * _overlayVM.FontScale;
                double interimPt = Math.Max(1, vm.InterimFontSize) * _overlayVM.FontScale;
                vm.InterimType.SetMeasure(approx, interimPt, tfI, _overlayVM.FontScale, _overlayVM.InterimTypingSpeedMultiplier);
                vm.FinalType.SetMeasure(approx, finalPt, tfF, _overlayVM.FontScale, _overlayVM.FinalTypingSpeedMultiplier);
            }
            vm.InterimType.SetText(vm.InterimRaw);
        }

        public void ApplyFinal(SpeakerViewModel vm)
        {
            if (!vm.HasMeasuredWidth)
            {
                // Approximate with window width — avatar/name/padding
                var approx = Math.Max(120, this.ActualWidth - 160);
                var tfI = new Typeface(new FontFamily("Segoe UI"), FontStyles.Italic, FontWeights.Normal, FontStretches.Normal);
                var tfF = new Typeface(new FontFamily("Segoe UI"), FontStyles.Normal, FontWeights.Normal, FontStretches.Normal);
                double finalPt = Math.Max(1, vm.LaneFontSize) * _overlayVM.FontScale;
                double interimPt = Math.Max(1, vm.InterimFontSize) * _overlayVM.FontScale;
                vm.InterimType.SetMeasure(approx, interimPt, tfI, _overlayVM.FontScale, _overlayVM.InterimTypingSpeedMultiplier);
                vm.FinalType.SetMeasure(approx, finalPt, tfF, _overlayVM.FontScale, _overlayVM.FinalTypingSpeedMultiplier);
            }
            vm.FinalType.SetText(vm.FinalRaw);
        }

        private void ApplyInterimOrQueue(SpeakerViewModel vm, string text)
        {
            if (!vm.HasMeasuredWidth)
            {
                vm.PendingInterim = text;
                Logger.Debug("QueuedInterimDueToNoMeasure", new { userId = vm.UserId, len = text.Length });
                return;
            }
            vm.InterimRaw = text;
            ApplyInterim(vm);
        }

        private void ApplyFinalOrQueue(SpeakerViewModel vm, string text)
        {
            if (!vm.HasMeasuredWidth)
            {
                vm.PendingFinal = text;
                Logger.Debug("QueuedFinalDueToNoMeasure", new { userId = vm.UserId, len = text.Length });
                return;
            }
            vm.FinalRaw = text;
            ApplyFinal(vm);
        }

        private SpeakerViewModel GetOrCreate(string userId)
        {
            if (_byId.TryGetValue(userId, out var vm))
                return vm;

            vm = new SpeakerViewModel { UserId = userId, Username = userId, ColorHex = ColorFromUserId(userId) };
            
            // Configure from config.json
            var laneConfig = _cfg.ui.lane;
            vm.LaneFontFamily = laneConfig.fontFamily;
            vm.LaneFontSize = laneConfig.fontSizePt;
            vm.ShrinkDelayMs = laneConfig.shrinkDelayMs;
            vm.MaxLinesCollapsed = 1;
            vm.MaxLinesExpanded = laneConfig.expandMaxLines;
            vm.AllowReentryAfterFinalize = laneConfig.allowReentryAfterFinalize;
            vm.ReentryDelayMs = laneConfig.reentryDelayMs;
            vm.ClearOnReentry = laneConfig.clearOnReentry;
            
            _byId[userId] = vm;
            _overlayVM.Speakers.Add(vm);

            // Attach logging hooks for typing overflow detection
            vm.FinalType.Log = (evt, data) => Logger.Debug(evt, new { userId = vm.UserId, line = "final", data });
            vm.InterimType.Log = (evt, data) => Logger.Debug(evt, new { userId = vm.UserId, line = "interim", data });
            
            // Attach overflow callbacks for lane expansion
            vm.FinalType.OnOverflow = () => { vm.RequestExpand(); _metrics.IncrementOverflowExpansions(); };
            vm.InterimType.OnOverflow = () => { vm.RequestExpand(); _metrics.IncrementOverflowExpansions(); };
            
            // Attach chars per second tracking
            vm.FinalType.OnCharsPerSecond = _metrics.UpdateCharsPerSecond;
            vm.InterimType.OnCharsPerSecond = _metrics.UpdateCharsPerSecond;

            return vm;
        }

        private string ColorFromUserId(string uid)
        {
            // simple deterministic color based on hash → HSL
            uint hash = 2166136261;
            foreach (var ch in uid) { hash ^= ch; hash *= 16777619; }
            double h = (hash % 360);
            double s = 0.6;
            double l = 0.5;
            var c = HslToColor(h, s, l);
            return $"#{c.R:X2}{c.G:X2}{c.B:X2}";
        }

        private System.Windows.Media.Color HslToColor(double h, double s, double l)
        {
            h /= 360.0;
            double r = l, g = l, b = l;
            if (s != 0)
            {
                double q = l < 0.5 ? l * (1 + s) : l + s - l * s;
                double p = 2 * l - q;
                r = HueToRgb(p, q, h + 1.0 / 3.0);
                g = HueToRgb(p, q, h);
                b = HueToRgb(p, q, h - 1.0 / 3.0);
            }
            return System.Windows.Media.Color.FromRgb((byte)(r * 255), (byte)(g * 255), (byte)(b * 255));
        }
        private double HueToRgb(double p, double q, double t)
        {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1.0/6.0) return p + (q - p) * 6 * t;
            if (t < 1.0/2.0) return q;
            if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6;
            return p;
        }

        private void IdleTimer_Tick(object? sender, EventArgs e)
        {
            var now = DateTime.UtcNow;
            foreach (var vm in _overlayVM.Speakers)
            {
                if ((now - vm.LastHeardUtc).TotalSeconds >= 5)
                {
                    vm.InterimType.Clear();
                    vm.FinalType.Clear();
                    vm.InterimRaw = string.Empty;
                    vm.FinalRaw = string.Empty;
                }
            }

            // Purge expired finalized reentry records
            try
            {
                if (_finalizedMap.Count > 0)
                {
                    var toRemove = new List<string>();
                    foreach (var kv in _finalizedMap)
                    {
                        if (kv.Value.expiresUtc <= now) toRemove.Add(kv.Key);
                    }
                    foreach (var k in toRemove) _finalizedMap.Remove(k);
                }
            }
            catch { }
        }

        private void Background_MouseDown(object sender, MouseButtonEventArgs e)
        {
            if (e.ChangedButton == MouseButton.Left)
                DragMove();
        }

        private void MetricsToggle_Click(object sender, RoutedEventArgs e)
        {
            var panel = FindName("MetricsPanel") as Border;
            if (panel != null)
            {
                panel.Visibility = panel.Visibility == Visibility.Visible 
                    ? Visibility.Collapsed 
                    : Visibility.Visible;
            }
        }

        private void MetricsToggle_RightClick(object sender, MouseButtonEventArgs e)
        {
            _metrics.Reset();
            Logger.Info("MetricsReset", new { });
        }

        private void MinimizeButton_Click(object sender, RoutedEventArgs e)
        {
            this.WindowState = WindowState.Minimized;
        }

        private void CloseButton_Click(object sender, RoutedEventArgs e)
        {
            this.Close();
        }

        protected override void OnClosed(EventArgs e)
        {
            base.OnClosed(e);
            try
            {
                _cfg.windowWidth = Width;
                _cfg.windowHeight = Height;
                _cfg.windowLeft = Left;
                _cfg.windowTop = Top;
                ConfigStore.Save(_cfg);
            }
            catch { }

            try { _idleTimer.Stop(); } catch { }
            try { _wsCts?.Cancel(); } catch { }
            try { if (_tray != null) _tray.Visible = false; } catch { }
        }

        // Outbound method per spec (no UI surface)
        private Task SendSetInlangAsync(string userId, string lang)
            => SendJsonAsync(new { type = "speakers:set-inlang", userId, lang });

        private async Task SendJsonAsync(object payload)
        {
            try
            {
                if (_ws == null || _ws.State != WebSocketState.Open) return;
                var json = JsonSerializer.Serialize(payload);
                var bytes = Encoding.UTF8.GetBytes(json);
                await _ws.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None);
            }
            catch { }
        }
    }

    // Value converter for connection badge color
    public class ConnectionToBrushConverter : System.Windows.Data.IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            var s = (value as string) ?? "Disconnected";
            var color = s == "Connected" ? System.Windows.Media.Brushes.LimeGreen :
                        s == "Connecting" ? System.Windows.Media.Brushes.Gold :
                        System.Windows.Media.Brushes.IndianRed;
            return color;
        }
        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) => Binding.DoNothing;
    }
}
