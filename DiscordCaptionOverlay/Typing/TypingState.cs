using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text;
using System.Windows;
using System.Windows.Media;
using System.Windows.Threading;

namespace DiscordCaptionOverlay.Typing
{
    // Restartable, reusable typing engine for overlay lines
    public sealed class TypingState : INotifyPropertyChanged, IDisposable
    {
        private readonly DispatcherTimer _tick;
        private int _cursor = 0; // index into FullText

        private double _availablePx = 180;
        private double _fontSize = 14;
        private Typeface _typeface = new Typeface(new FontFamily("Segoe UI"), FontStyles.Normal, FontWeights.Normal, FontStretches.Normal);
        private int _charsPerTick = 2; // tune by font scale and speed multiplier
        private double _speedMultiplier = 1.0;

        private string _displayText = string.Empty;
        public string DisplayText
        {
            get => _displayText;
            private set { if (_displayText == value) return; _displayText = value; OnPropertyChanged(); }
        }

        public string FullText { get; private set; } = string.Empty;
        public bool IsRunning { get; private set; }

        // Optional hooks retained for compatibility/metrics
        public Action<string, object>? Log { get; set; }
        public Action? OnOverflow { get; set; }
        public Action<double>? OnCharsPerSecond { get; set; }

        public TypingState()
        {
            _tick = new DispatcherTimer(DispatcherPriority.Background)
            {
                Interval = TimeSpan.FromMilliseconds(16)
            };
            _tick.Tick += (_, __) => OnTick();
        }

        // Called on resize or font changes; does not restart animation
        public void SetMeasure(double availablePx, double fontSize, Typeface typeface, double fontScale = 1.0, double speedMultiplier = 1.0)
        {
            _availablePx = Math.Max(0, availablePx);
            _fontSize = fontSize;
            _typeface = typeface;
            _speedMultiplier = Math.Max(0.1, speedMultiplier);
            // Base chars per tick = 2, scale by fontScale and user speed multiplier
            // Lower multiplier -> fewer chars per tick (slower)
            var baseCpt = 2.0;
            var cpt = baseCpt * Math.Max(0.5, fontScale) * _speedMultiplier;
            _charsPerTick = Math.Max(1, (int)Math.Round(cpt));

            // Also slow down the tick interval for small multipliers.
            // Base 16ms at 1.0x; for slower speeds, increase interval proportionally.
            var intervalMs = 16.0 / _speedMultiplier; // 0.5x -> 32ms, 0.3x -> ~53ms
            if (intervalMs < 8) intervalMs = 8;       // clamp to avoid super-fast timers
            if (intervalMs > 120) intervalMs = 120;   // clamp to avoid too-slow timers
            _tick.Interval = TimeSpan.FromMilliseconds(intervalMs);
        }

        // Replace text and restart engine; tries to be incremental so updates feel seamless
        public void SetText(string text)
        {
            var incoming = text ?? string.Empty;
            var prior = FullText ?? string.Empty;

            if (string.IsNullOrEmpty(prior))
            {
                FullText = incoming;
                DisplayText = string.Empty;
                _cursor = 0;
            }
            else if (incoming.StartsWith(prior, StringComparison.Ordinal))
            {
                // Simple append case: keep cursor and current display
                FullText = incoming;
            }
            else
            {
                // Partial rewrite case: keep common prefix on-screen and continue typing from there
                int lcp = 0;
                int max = Math.Min(prior.Length, incoming.Length);
                while (lcp < max && prior[lcp] == incoming[lcp]) lcp++;
                FullText = incoming;
                _cursor = lcp;
                var keep = Math.Min(DisplayText?.Length ?? 0, lcp);
                DisplayText = keep > 0 ? incoming.Substring(0, keep) : string.Empty;
            }

            Start();

            // estimate for metrics: chars per second at current tick budget
            try
            {
                var frames = Math.Max(1, (int)Math.Ceiling((FullText.Length - _cursor) / (double)_charsPerTick));
                var ms = frames * (_tick.Interval.TotalMilliseconds > 0 ? _tick.Interval.TotalMilliseconds : 16.0);
                var cps = (Math.Max(0, FullText.Length - _cursor) * 1000.0) / Math.Max(1.0, ms);
                OnCharsPerSecond?.Invoke(cps);
            }
            catch { }
        }

        public void Clear()
        {
            FullText = string.Empty;
            DisplayText = string.Empty;
            _cursor = 0;
            Stop();
        }

        private void Start()
        {
            if (IsRunning) return;
            IsRunning = true;
            _tick.Start();
        }

        private void Stop()
        {
            if (!IsRunning) return;
            IsRunning = false;
            _tick.Stop();
        }

        private void OnTick()
        {
            if (_cursor >= (FullText?.Length ?? 0)) { Stop(); return; }

            var remaining = FullText!.Substring(_cursor);
            var take = Math.Min(_charsPerTick, remaining.Length);
            var append = remaining.Substring(0, take);
            var candidate = (DisplayText ?? string.Empty) + append;
            if (_availablePx > 0 && Measure(candidate) > _availablePx)
            {
                // overflow -> request lane expansion, but keep accumulated text (allow wrapping)
                Log?.Invoke("TypingOverflow", new { available = _availablePx, fontSize = _fontSize, candidateLen = candidate.Length });
                OnOverflow?.Invoke();
            }
            DisplayText = candidate;
            _cursor += take;
        }

        private double Measure(string s)
        {
            if (string.IsNullOrEmpty(s)) return 0;
            var dpi = VisualTreeHelper.GetDpi(Application.Current.MainWindow).PixelsPerDip;
            var ft = new FormattedText(
                s,
                CultureInfo.CurrentUICulture,
                FlowDirection.LeftToRight,
                _typeface,
                _fontSize,
                Brushes.White,
                dpi);
            return ft.WidthIncludingTrailingWhitespace;
        }

        public void Dispose() => Stop();

        public event PropertyChangedEventHandler? PropertyChanged;
        private void OnPropertyChanged([CallerMemberName] string? name = null)
            => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
