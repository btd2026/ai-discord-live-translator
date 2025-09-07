using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using DiscordCaptionOverlay.Services;

namespace DiscordCaptionOverlay.ViewModels
{
    public class OverlayViewModel : INotifyPropertyChanged
    {
        public ObservableCollection<SpeakerViewModel> Speakers { get; } = new();

        private double _fontScale = 1.0;
        public double FontScale
        {
            get => _fontScale;
            set { _fontScale = value; OnPropertyChanged(); }
        }

        private string _connectionStatus = "Disconnected";
        public string ConnectionStatus
        {
            get => _connectionStatus;
            set { _connectionStatus = value; OnPropertyChanged(); }
        }

        private CaptionMetrics? _metrics;
        public CaptionMetrics? Metrics
        {
            get => _metrics;
            set { _metrics = value; OnPropertyChanged(); }
        }

        private double _typingSpeedMultiplier = 1.0;
        public double TypingSpeedMultiplier
        {
            get => _typingSpeedMultiplier;
            set { _typingSpeedMultiplier = value; OnPropertyChanged(); }
        }

        private double _interimTypingSpeedMultiplier = 1.0;
        public double InterimTypingSpeedMultiplier
        {
            get => _interimTypingSpeedMultiplier;
            set { _interimTypingSpeedMultiplier = value; OnPropertyChanged(); }
        }

        private double _finalTypingSpeedMultiplier = 1.0;
        public double FinalTypingSpeedMultiplier
        {
            get => _finalTypingSpeedMultiplier;
            set { _finalTypingSpeedMultiplier = value; OnPropertyChanged(); }
        }

        public event PropertyChangedEventHandler? PropertyChanged;
        protected void OnPropertyChanged([CallerMemberName] string? name=null)
            => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
