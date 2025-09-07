using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

namespace DiscordCaptionOverlay.Interop
{
    public static class ClickThrough
    {
        const int GWL_EXSTYLE = -20;
        const int WS_EX_TRANSPARENT = 0x20;
        const int WS_EX_TOOLWINDOW = 0x00000080;

        [DllImport("user32.dll")]
        static extern int GetWindowLong(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll")]
        static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

        public static void SetTransparent(Window window, bool enable)
        {
            var hwnd = new WindowInteropHelper(window).EnsureHandle();
            int styles = GetWindowLong(hwnd, GWL_EXSTYLE);
            if (enable)
                styles |= WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW;
            else
                styles &= ~WS_EX_TRANSPARENT;
            SetWindowLong(hwnd, GWL_EXSTYLE, styles);
        }
    }
}