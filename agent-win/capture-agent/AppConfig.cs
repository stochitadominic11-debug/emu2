namespace CaptureAgent;

// Legge la configurazione dagli argomenti da riga di comando passati da agent.js, es:
// CaptureAgent.exe --serverUrl http://localhost:3000 --agentSecret xxx
//   --sessionId xxx --processName "Gamble With Your Friends.exe"
//   --targetFps 18 --jpegQuality 55 --maxDimension 960
//   --reconnectDelayMs 3000 --verbose true
public static class AppConfigLoader
{
    public static AppConfig Load(string[] args)
    {
        var map = ParseArgs(args);

        return new AppConfig(
            ServerUrl: Get(map, "serverUrl", "http://localhost:3000"),
            AgentSecret: Get(map, "agentSecret", ""),
            SessionId: Get(map, "sessionId", ""),
            ProcessName: Get(map, "processName", ""),
            TargetFps: GetInt(map, "targetFps", 18),
            JpegQuality: GetInt(map, "jpegQuality", 55),
            ReconnectDelayMs: GetInt(map, "reconnectDelayMs", 3000),
            MaxDimension: GetInt(map, "maxDimension", 960),
            Verbose: GetBool(map, "verbose", false)
        );
    }

    private static Dictionary<string, string> ParseArgs(string[] args)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < args.Length; i++)
        {
            if (!args[i].StartsWith("--")) continue;
            string key = args[i][2..];
            string value = "true";
            if (i + 1 < args.Length && !args[i + 1].StartsWith("--"))
            {
                value = args[++i];
            }
            map[key] = value;
        }
        return map;
    }

    private static string Get(Dictionary<string, string> map, string key, string fallback) =>
        map.TryGetValue(key, out var v) ? v : fallback;

    private static int GetInt(Dictionary<string, string> map, string key, int fallback) =>
        map.TryGetValue(key, out var v) && int.TryParse(v, out var n) ? n : fallback;

    private static bool GetBool(Dictionary<string, string> map, string key, bool fallback) =>
        map.TryGetValue(key, out var v) && bool.TryParse(v, out var b) ? b : fallback;
}
