using System;
using System.IO;
using System.Text.Json;

namespace DiscordCaptionOverlay.Services
{
    public class AppConfig
    {
        public string wsUrl { get; set; } = "ws://localhost:7071";
        public double panelWidth { get; set; } = 320;
        public double fontScale { get; set; } = 1.0;
        public string theme { get; set; } = "glass"; // "glass" | "high-contrast"
        public bool clickThrough { get; set; } = false;
        public double? windowLeft { get; set; } = null;
        public double? windowTop { get; set; } = null;
        public double windowWidth { get; set; } = 320;
        public double windowHeight { get; set; } = 540;
        public TimingConfig timing { get; set; } = new TimingConfig();
        public UiConfig ui { get; set; } = new UiConfig();
    }

    public class UiConfig
    {
        public LaneConfig lane { get; set; } = new LaneConfig();
    }

    public class TimingConfig
    {
        // Multiplier for typing speed; 1.0 = default, lower = slower
        public double typingSpeedMultiplier { get; set; } = 1.0;
        // Optional per-line overrides; if <= 0, fallback to typingSpeedMultiplier
        public double interimTypingSpeedMultiplier { get; set; } = 0.0;
        public double finalTypingSpeedMultiplier { get; set; } = 0.0;
    }

    public class LaneConfig
    {
        public bool expandOnOverflow { get; set; } = true;
        public int expandMaxLines { get; set; } = 2;
        public int shrinkDelayMs { get; set; } = 800;
        public string fontFamily { get; set; } = "Segoe UI";
        public double fontSizePt { get; set; } = 15;
        public bool allowReentryAfterFinalize { get; set; } = true;
        public int reentryDelayMs { get; set; } = 250;
        public bool clearOnReentry { get; set; } = true;
    }

    public static class ConfigStore
    {
        private static string Path => System.IO.Path.Combine(AppContext.BaseDirectory, "config.json");
        public static AppConfig Load()
        {
            try
            {
                if (File.Exists(Path))
                {
                    var json = File.ReadAllText(Path);
                    var cfg = JsonSerializer.Deserialize<AppConfig>(json);
                    return cfg ?? new AppConfig();
                }
            }
            catch { }
            return new AppConfig();
        }

        public static void Save(AppConfig cfg)
        {
            try
            {
                var json = JsonSerializer.Serialize(cfg, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(Path, json);
            }
            catch { }
        }
    }
}
