using System;
using System.IO;
using System.Windows;
using DiscordCaptionOverlay.Services;

namespace DiscordCaptionOverlay
{
  public partial class App : Application
  {
    public App()
    {
      this.DispatcherUnhandledException += (s, e) =>
      {
        Logger.Error("Unhandled", e.Exception);
        MessageBox.Show(e.Exception.Message, "Overlay error");
        e.Handled = true;
      };
      AppDomain.CurrentDomain.UnhandledException += (s, e) =>
        Logger.Error("UnhandledDomain", e.ExceptionObject as Exception ?? new Exception(e.ExceptionObject?.ToString()));
    }
  }
}
