using System;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows;
using System.Windows.Media;
using DiscordCaptionOverlay.Typing;
using DiscordCaptionOverlay.Utils;

namespace DiscordCaptionOverlay.ViewModels
{
    public class SpeakerViewModel : INotifyPropertyChanged
    {
        public string UserId { get; set; } = "";
        private string _username = "";
        public string Username { get => _username; set { _username = value; OnPropertyChanged(); } }

        private string _colorHex = "#77AADD";
        public string ColorHex { get => _colorHex; set { _colorHex = value; OnPropertyChanged(); } }

        private bool _isSpeaking;
        public bool IsSpeaking { get => _isSpeaking; set { _isSpeaking = value; OnPropertyChanged(); } }

        public DateTime LastHeardUtc { get; set; } = DateTime.UtcNow;

        private string? _avatarUrl;
        public string? AvatarUrl
        {
            get => _avatarUrl;
            set
            {
                if (_avatarUrl == value) return;
                _avatarUrl = value;
                try { Services.Logger.Info("AvatarSet", new { userId = UserId, len = _avatarUrl?.Length ?? 0 }); } catch { }
                System.Diagnostics.Debug.WriteLine($"AvatarUrl changed userId={UserId} len={_avatarUrl?.Length ?? 0}");
                OnPropertyChanged();
            }
        }

        private string _interimRaw = "";
        public string InterimRaw { get => _interimRaw; set { _interimRaw = value; OnPropertyChanged(); RecomputeExpand(); } }

        private string _finalRaw = "";
        public string FinalRaw { get => _finalRaw; set { _finalRaw = value; OnPropertyChanged(); RecomputeExpand(); } }

        // Text width available to lines (set by row size changed)
        private double _availableWidth = 180;
        public double AvailableWidth 
        { 
            get => _availableWidth; 
            set 
            { 
                if (Math.Abs(_availableWidth - value) < 0.5) return;
                _availableWidth = value; 
                OnPropertyChanged(); 
                RecomputeExpand(); 
            } 
        }

        // Lane expansion properties
        private bool _isExpanded;
        public bool IsExpanded
        {
            get => _isExpanded;
            private set { if (_isExpanded == value) return; _isExpanded = value; OnPropertyChanged(); }
        }

        private DateTime _lastExpandedAtUtc;
        
        // Configuration properties
        public string LaneFontFamily { get; set; } = "Segoe UI";
        public double LaneFontSize { get; set; } = 15;
        public double InterimFontSize => Math.Max(1, LaneFontSize - 2);
        public int ShrinkDelayMs { get; set; } = 800;
        public int MaxLinesCollapsed { get; set; } = 1;
        public int MaxLinesExpanded { get; set; } = 2;

        // Legacy properties for compatibility
        public bool HasMeasuredWidth { get; set; }
        public string? PendingInterim { get; set; }
        public string? PendingFinal { get; set; }
        public bool HasSyntheticFinal { get; set; }

        // Finalization state tracking
        private string _activeEventId = "";
        public string ActiveEventId
        {
            get => _activeEventId;
            set { if (_activeEventId == value) return; _activeEventId = value; OnPropertyChanged(); }
        }

        private bool _isFinalShowing;
        public bool IsFinalShowing
        {
            get => _isFinalShowing;
            set { if (_isFinalShowing == value) return; _isFinalShowing = value; OnPropertyChanged(); }
        }

        private DateTime _lastFinalizedAtUtc;
        public DateTime LastFinalizedAtUtc
        {
            get => _lastFinalizedAtUtc;
            private set { _lastFinalizedAtUtc = value; OnPropertyChanged(); }
        }

        // Reentry configuration (from config.json)
        public bool AllowReentryAfterFinalize { get; set; } = true;
        public int ReentryDelayMs { get; set; } = 250;
        public bool ClearOnReentry { get; set; } = true;

        public TypingState InterimType { get; } = new();
        public TypingState FinalType { get; } = new();

        public void RequestExpand() // callable by TypingState on overflow
        {
            if (!IsExpanded)
            {
                IsExpanded = true;
                _lastExpandedAtUtc = DateTime.UtcNow;
                LogLane("LaneExpand");
            }
            else
            {
                _lastExpandedAtUtc = DateTime.UtcNow; // keep-alive
            }
        }

        public void RequestShrinkNow() // e.g., on clear/final end
        {
            if (IsExpanded)
            {
                IsExpanded = false;
                LogLane("LaneShrink");
            }
        }

        private void RecomputeExpand()
        {
            if (_availableWidth <= 0) return;

            bool needsWrap = WillWrap(_interimRaw) || WillWrap(_finalRaw);

            if (needsWrap)
            {
                if (!IsExpanded)
                {
                    IsExpanded = true;
                    _lastExpandedAtUtc = DateTime.UtcNow;
                    LogLane("LaneExpand");
                }
                else
                {
                    _lastExpandedAtUtc = DateTime.UtcNow;
                }
            }
            else
            {
                if (IsExpanded)
                {
                    var elapsed = DateTime.UtcNow - _lastExpandedAtUtc;
                    if (elapsed.TotalMilliseconds >= ShrinkDelayMs)
                    {
                        IsExpanded = false;
                        LogLane("LaneShrink");
                    }
                }
            }
        }

        private bool WillWrap(string text)
        {
            if (string.IsNullOrWhiteSpace(text)) return false;
            var w = FormattedTextFactory.MeasureOneLineWidth(
                text,
                LaneFontFamily,
                LaneFontSize,
                FontWeights.Normal,
                null);
            // small tolerance so we expand slightly BEFORE we visually touch the edge
            return w > Math.Max(0, _availableWidth - 8);
        }

        private void LogLane(string evt)
        {
            // Use existing logger if available
            try 
            {
                Services.Logger.Info(evt, new { 
                    userId = UserId, 
                    expanded = IsExpanded, 
                    avail = _availableWidth, 
                    lenI = _interimRaw?.Length ?? 0, 
                    lenF = _finalRaw?.Length ?? 0 
                });
            }
            catch 
            {
                System.Diagnostics.Trace.WriteLine($"{DateTime.UtcNow:o} {evt} userId={UserId} expanded={IsExpanded} avail={_availableWidth:0.##} lenI={_interimRaw?.Length ?? 0} lenF={_finalRaw?.Length ?? 0}");
            }
        }

        public void MarkFinalDisplayed(string eventId)
        {
            ActiveEventId = eventId;
            IsFinalShowing = true;
            LastFinalizedAtUtc = DateTime.UtcNow;
            LogLane("LaneFinalShown");
        }

        public void ClearFinalAndResume(string eventId)
        {
            // This is called when fresh interim should displace the final snapshot
            if (ClearOnReentry)
            {
                // Do not force-collapse on reentry; keep current expansion state
                // so the lane can wrap immediately as new text streams in.
                // RecomputeExpand and typing overflow will manage expansion/shrink.
                _lastExpandedAtUtc = DateTime.UtcNow; // keep expanded window fresh
            }

            IsFinalShowing = false;
            ActiveEventId = eventId; // accept this as active
            LogLane("LaneFinalCleared");
        }

        public bool ShouldReenterFromUpdate(string incomingEventId, int? seqOpt, DateTime nowUtc)
        {
            if (!IsFinalShowing) return false; // already live
            if (!AllowReentryAfterFinalize) return false;

            // 1) brand new event id
            if (!string.IsNullOrEmpty(ActiveEventId) && !string.Equals(ActiveEventId, incomingEventId, StringComparison.Ordinal))
                return true;

            // 2) server reused event id but restarted sequence
            if (seqOpt.HasValue && seqOpt.Value == 0)
                return true;

            // 3) same event id, but beyond short reentry delay => treat as new burst
            var elapsed = nowUtc - LastFinalizedAtUtc;
            if (elapsed.TotalMilliseconds >= ReentryDelayMs)
                return true;

            return false;
        }

        public event PropertyChangedEventHandler? PropertyChanged;
        protected void OnPropertyChanged([CallerMemberName] string? name=null)
            => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
