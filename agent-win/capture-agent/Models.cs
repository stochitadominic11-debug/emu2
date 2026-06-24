namespace CaptureAgent;

public sealed record AppConfig(
    string ServerUrl,
    string AgentSecret,
    string SessionId,
    string ProcessName,
    int TargetFps,
    int JpegQuality,
    int ReconnectDelayMs,
    int MaxDimension,
    bool Verbose
);

public sealed record CaptureFrame(
    byte[] JpegBytes,
    int Width,
    int Height,
    long TimestampMs
);

public sealed record AgentStatus(
    string Type,
    string? Message = null,
    int? ProcessId = null,
    int? Width = null,
    int? Height = null
);
