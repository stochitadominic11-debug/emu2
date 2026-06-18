using System.Text.Json;

namespace CaptureAgent;

public static class AppConfigLoader
{
    public static AppConfig Load(string[] args)
    {
        // Uso:
        // capture-agent.exe --sessionId abc --serverUrl http://localhost:3000 --agentSecret xxx --processName "Gamble With Your Friends.exe"
        var map = ParseArgs(args);

        string serverUrl = map.GetValueOrDefault("serverUrl") ?? "http://localhost:3000";
        string agentSecret = map.GetValueOrDefault("agentSecret") ?? throw new InvalidOperationException("Missing --agentSecret");
        string sessionId = map.GetValueOrDefault("sessionId") ?? throw new InvalidOperationException("Missing --sessionId");
        string processName = map.GetValueOrDefault("processName") ?? throw new InvalidOperationException("Missing --processName");

        int targetFps = ParseInt(map.GetValueOrDefault("targetFps"), 30);
        int jpegQuality = ParseInt(map.GetValueOrDefault("jpegQuality"), 75);
        int reconnectDelayMs = ParseInt(map.GetValueOrDefault("reconnectDelayMs"), 3000);
        int maxDimension = ParseInt(map.GetValueOrDefault("maxDimension"), 1280);
        bool verbose = ParseBool(map.GetValueOrDefault("verbose"), false);

        return new AppConfig(
            serverUrl,
            agentSecret,
            sessionId,
            processName,
            targetFps,
            jpegQuality,
            reconnectDelayMs,
            maxDimension,
            verbose
        );
    }

    private static Dictionary<string, string> ParseArgs(string[] args)
    {
        var dict = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        for (int i = 0; i < args.Length; i++)
        {
            var a = args[i];
            if (!a.StartsWith("--")) continue;

            var key = a[2..];
            string value = "true";

            if (i + 1 < args.Length && !args[i + 1].StartsWith("--"))
            {
                value = args[++i];
            }

            dict[key] = value;
        }

        return dict;
    }

    private static int ParseInt(string? value, int fallback)
        => int.TryParse(value, out var n) ? n : fallback;

    private static bool ParseBool(string? value, bool fallback)
        => bool.TryParse(value, out var b) ? b : fallback;
}