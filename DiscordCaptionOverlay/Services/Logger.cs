using System;
using System.IO;
using System.Text.Json;

namespace DiscordCaptionOverlay.Services
{
    public static class Logger
    {
        private static readonly object _lock = new();
        private static string _path = Path.Combine(AppContext.BaseDirectory, "overlay_frontend.jsonl");
        private static bool _debug = true; // flip to false to reduce noise

        public static void SetPath(string path) => _path = path;
        public static void SetDebug(bool on) => _debug = on;

        public static void Info(string evt, object data)  => Write("INFO", evt, data);
        public static void Debug(string evt, object data) { if (_debug) Write("DEBUG", evt, data); }
        public static void Error(string evt, Exception ex, object? data = null)
            => Write("ERROR", evt, new { error = ex.ToString(), data });

        private static void Write(string level, string evt, object data)
        {
            try
            {
                var line = JsonSerializer.Serialize(new {
                    ts = DateTimeOffset.UtcNow.ToString("o"),
                    level, evt, data
                });
                lock (_lock) File.AppendAllText(_path, line + Environment.NewLine);
            }
            catch { /* never throw from logging */ }
        }
    }
}
