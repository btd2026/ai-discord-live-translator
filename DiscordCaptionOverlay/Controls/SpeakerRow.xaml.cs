using System;
using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using DiscordCaptionOverlay.ViewModels;
using DiscordCaptionOverlay.Typing;
using WpfUserControl = System.Windows.Controls.UserControl;

namespace DiscordCaptionOverlay.Controls
{
    public partial class SpeakerRow : WpfUserControl
    {
        private DiscordCaptionOverlay.ViewModels.SpeakerViewModel? _svm;
        public SpeakerRow()
        {
            InitializeComponent();
            this.SizeChanged += SpeakerRow_SizeChanged;
            this.Loaded += SpeakerRow_Loaded;
            this.DataContextChanged += SpeakerRow_DataContextChanged;
        }

        private void SpeakerRow_Loaded(object sender, RoutedEventArgs e)
        {
            Recompute();
            HookVm();
        }

        private void SpeakerRow_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            Recompute();
        }

        private void Recompute()
        {
            if (DataContext is SpeakerViewModel svm)
            {
                _svm = svm;
                double contentGridWidth = GetContentGridWidth();
                if (contentGridWidth > 0)
                {
                    svm.AvailableWidth = contentGridWidth;
                    // Update typing engine measures on resize
                    var overlay = System.Windows.Application.Current.MainWindow as DiscordCaptionOverlay.MainWindow;
                    double fontScale = 1.0;
                    if (overlay != null)
                    {
                        // Access OverlayViewModel.FontScale via MainWindow DataContext
                        if (overlay.DataContext is DiscordCaptionOverlay.ViewModels.OverlayViewModel ovm)
                            fontScale = ovm.FontScale;
                    }

                    var interimTf = new Typeface(new FontFamily("Segoe UI"), FontStyles.Italic, FontWeights.Normal, FontStretches.Normal);
                    var finalTf = new Typeface(new FontFamily("Segoe UI"), FontStyles.Normal, FontWeights.Normal, FontStretches.Normal);
                    double speedInterim = 1.0;
                    double speedFinal = 1.0;
                    if (overlay != null && overlay.DataContext is DiscordCaptionOverlay.ViewModels.OverlayViewModel ovm2)
                    {
                        speedInterim = ovm2.InterimTypingSpeedMultiplier;
                        speedFinal = ovm2.FinalTypingSpeedMultiplier;
                    }
                    // Use lane font sizes: final = LaneFontSize, interim = LaneFontSize - 2
                    double finalPt = Math.Max(1, svm.LaneFontSize) * fontScale;
                    double interimPt = Math.Max(1, svm.InterimFontSize) * fontScale;
                    svm.InterimType.SetMeasure(contentGridWidth, interimPt, interimTf, fontScale, speedInterim);
                    svm.FinalType.SetMeasure(contentGridWidth, finalPt, finalTf, fontScale, speedFinal);

                    bool firstMeasure = !svm.HasMeasuredWidth;
                    svm.HasMeasuredWidth = true;

                    // Flush any queued text now that we have a real width
                    if (firstMeasure)
                    {
                        DiscordCaptionOverlay.Services.Logger.Info("RowMeasured", new { userId = svm.UserId, width = contentGridWidth });

                        var mainWindow = System.Windows.Application.Current.MainWindow as DiscordCaptionOverlay.MainWindow;
                        if (mainWindow != null)
                        {
                            if (!string.IsNullOrEmpty(svm.PendingInterim))
                            {
                                DiscordCaptionOverlay.Services.Logger.Debug("FlushedQueuedInterim", new { userId = svm.UserId, len = svm.PendingInterim.Length });
                                svm.InterimRaw = svm.PendingInterim;
                                mainWindow.ApplyInterim(svm);
                                svm.PendingInterim = null;
                            }
                            if (!string.IsNullOrEmpty(svm.PendingFinal))
                            {
                                DiscordCaptionOverlay.Services.Logger.Debug("FlushedQueuedFinal", new { userId = svm.UserId, len = svm.PendingFinal.Length });
                                svm.FinalRaw = svm.PendingFinal;
                                mainWindow.ApplyFinal(svm);
                                svm.PendingFinal = null;
                            }
                        }
                    }
                }
            }
        }

        private void HookVm()
        {
            if (_svm == null && this.DataContext is SpeakerViewModel vm)
                _svm = vm;
            if (_svm != null)
            {
                _svm.PropertyChanged -= Vm_PropertyChanged;
                _svm.PropertyChanged += Vm_PropertyChanged;
            }
        }

        private void SpeakerRow_DataContextChanged(object sender, DependencyPropertyChangedEventArgs e)
        {
            if (e.OldValue is SpeakerViewModel oldVm)
                oldVm.PropertyChanged -= Vm_PropertyChanged;
            if (e.NewValue is SpeakerViewModel newVm)
            {
                _svm = newVm;
                _svm.PropertyChanged += Vm_PropertyChanged;
                Recompute();
            }
        }

        private void Vm_PropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
        {
            if (e.PropertyName == nameof(SpeakerViewModel.IsExpanded) ||
                e.PropertyName == nameof(SpeakerViewModel.LaneFontSize))
            {
                try
                {
                    // Re-apply line limits for 1/2 line modes
                    ApplyLineLimits();
                }
                catch { }
            }
        }

        private void ApplyLineLimits()
        {
            if (_svm == null) return;
            try
            {
                int maxLines = _svm.IsExpanded ? _svm.MaxLinesExpanded : _svm.MaxLinesCollapsed;
                if (FinalText != null)
                {
                    double fs = FinalText.FontSize > 0 ? FinalText.FontSize : _svm.LaneFontSize;
                    double lineH = fs * 1.25;
                    FinalText.LineStackingStrategy = LineStackingStrategy.BlockLineHeight;
                    FinalText.LineHeight = lineH;
                    FinalText.MaxHeight = (lineH * maxLines) + 1;
                }
                if (InterimText != null)
                {
                    double fs = InterimText.FontSize > 0 ? InterimText.FontSize : Math.Max(1, _svm.InterimFontSize);
                    double lineH = fs * 1.25;
                    InterimText.LineStackingStrategy = LineStackingStrategy.BlockLineHeight;
                    InterimText.LineHeight = lineH;
                    InterimText.MaxHeight = (lineH * maxLines) + 1;
                }
            }
            catch { }
        }
        
        private double GetContentGridWidth()
        {
            try
            {
                // Find the ContentGrid by name
                var contentGrid = this.FindName("ContentGrid") as Grid;
                if (contentGrid?.ActualWidth > 0)
                {
                    return contentGrid.ActualWidth;
                }
                
                // Fallback: compute based on total width minus fixed elements
                double avatar = 42;
                double speakingAccent = 4;
                double margins = 10 + 8 + 10; // Grid margin + column margin + right margin
                double available = Math.Max(50, this.ActualWidth - (speakingAccent + avatar + margins + 16));
                return available;
            }
            catch
            {
                return 0;
            }
        }
    }
}
