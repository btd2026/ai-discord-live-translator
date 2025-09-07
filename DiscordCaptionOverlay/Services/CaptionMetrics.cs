using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.CompilerServices;

namespace DiscordCaptionOverlay.Services
{
    public class CaptionMetrics : INotifyPropertyChanged
    {
        private int _totalEvents = 0;
        private int _lateRespawns = 0;
        private int _overflowExpansions = 0;
        private int _droppedOutOfOrder = 0;
        private int _finalizations = 0;
        private int _reentrysAllowed = 0;
        private int _updateCoalesces = 0;
        private double _avgCharsPerSecond = 0;
        private DateTime _lastResetTime = DateTime.UtcNow;

        public int TotalEvents
        {
            get => _totalEvents;
            private set { _totalEvents = value; OnPropertyChanged(); }
        }

        public int LateRespawns
        {
            get => _lateRespawns;
            private set { _lateRespawns = value; OnPropertyChanged(); }
        }

        public int OverflowExpansions
        {
            get => _overflowExpansions;
            private set { _overflowExpansions = value; OnPropertyChanged(); }
        }

        public int DroppedOutOfOrder
        {
            get => _droppedOutOfOrder;
            private set { _droppedOutOfOrder = value; OnPropertyChanged(); }
        }

        public int Finalizations
        {
            get => _finalizations;
            private set { _finalizations = value; OnPropertyChanged(); }
        }

        public int ReentrysAllowed
        {
            get => _reentrysAllowed;
            private set { _reentrysAllowed = value; OnPropertyChanged(); }
        }

        public int UpdateCoalesces
        {
            get => _updateCoalesces;
            private set { _updateCoalesces = value; OnPropertyChanged(); }
        }

        public double AvgCharsPerSecond
        {
            get => _avgCharsPerSecond;
            private set { _avgCharsPerSecond = value; OnPropertyChanged(); }
        }

        public TimeSpan UptimeSpan => DateTime.UtcNow - _lastResetTime;

        public string UptimeFormatted => FormatTimeSpan(UptimeSpan);

        // Metrics operations
        public void IncrementEvents() => TotalEvents++;
        public void IncrementLateRespawns() => LateRespawns++;
        public void IncrementOverflowExpansions() => OverflowExpansions++;
        public void IncrementDroppedOutOfOrder() => DroppedOutOfOrder++;
        public void IncrementFinalizations() => Finalizations++;
        public void IncrementReentrysAllowed() => ReentrysAllowed++;
        public void IncrementUpdateCoalesces() => UpdateCoalesces++;

        public void UpdateCharsPerSecond(double charsPerSec)
        {
            // Simple moving average
            AvgCharsPerSecond = (AvgCharsPerSecond + charsPerSec) / 2.0;
        }

        public void Reset()
        {
            TotalEvents = 0;
            LateRespawns = 0;
            OverflowExpansions = 0;
            DroppedOutOfOrder = 0;
            Finalizations = 0;
            ReentrysAllowed = 0;
            UpdateCoalesces = 0;
            AvgCharsPerSecond = 0;
            _lastResetTime = DateTime.UtcNow;
            OnPropertyChanged(nameof(UptimeSpan));
            OnPropertyChanged(nameof(UptimeFormatted));
        }

        public Dictionary<string, object> GetSnapshot()
        {
            return new Dictionary<string, object>
            {
                ["totalEvents"] = TotalEvents,
                ["lateRespawns"] = LateRespawns,
                ["overflowExpansions"] = OverflowExpansions,
                ["droppedOutOfOrder"] = DroppedOutOfOrder,
                ["finalizations"] = Finalizations,
                ["reentrysAllowed"] = ReentrysAllowed,
                ["updateCoalesces"] = UpdateCoalesces,
                ["avgCharsPerSecond"] = Math.Round(AvgCharsPerSecond, 2),
                ["uptimeSeconds"] = UptimeSpan.TotalSeconds
            };
        }

        private static string FormatTimeSpan(TimeSpan span)
        {
            if (span.TotalDays >= 1)
                return $"{span.Days}d {span.Hours:D2}h {span.Minutes:D2}m";
            if (span.TotalHours >= 1)
                return $"{span.Hours:D2}h {span.Minutes:D2}m {span.Seconds:D2}s";
            if (span.TotalMinutes >= 1)
                return $"{span.Minutes:D2}m {span.Seconds:D2}s";
            return $"{span.Seconds:D2}s";
        }

        public event PropertyChangedEventHandler? PropertyChanged;
        protected virtual void OnPropertyChanged([CallerMemberName] string? propertyName = null)
        {
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
        }
    }
}
