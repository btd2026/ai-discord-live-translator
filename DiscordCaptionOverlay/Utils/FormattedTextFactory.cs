using System.Globalization;
using System.Windows;
using System.Windows.Media;

namespace DiscordCaptionOverlay.Utils
{
    public static class FormattedTextFactory
    {
        public static FormattedText Create(
            string text,
            Typeface typeface,
            double fontSize,
            double pixelsPerDip)
        {
            return new FormattedText(
                text ?? string.Empty,
                CultureInfo.CurrentUICulture,
                FlowDirection.LeftToRight,
                typeface,
                fontSize,
                Brushes.Transparent,
                pixelsPerDip);
        }

        public static double MeasureOneLineWidth(
            string text,
            string fontFamily = "Segoe UI",
            double fontSize = 15,
            FontWeight? weight = null,
            double? pixelsPerDip = null)
        {
            var family = new FontFamily(fontFamily);
            var tf = new Typeface(family, FontStyles.Normal, weight ?? FontWeights.Normal, FontStretches.Normal);
            double dip = pixelsPerDip ?? VisualTreeHelper.GetDpi(Application.Current.MainWindow).PixelsPerDip;
            return Create(text, tf, fontSize, dip).WidthIncludingTrailingWhitespace;
        }
    }
}
