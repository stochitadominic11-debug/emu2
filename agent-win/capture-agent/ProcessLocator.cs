using System.Diagnostics;

namespace CaptureAgent;

public sealed class ProcessLocator
{
    public Process? WaitForProcess(string processName, CancellationToken ct)
    {
        string normalized = Normalize(processName);

        while (!ct.IsCancellationRequested)
        {
            var found = Process.GetProcesses()
                .FirstOrDefault(p => Normalize(p.ProcessName).Equals(normalized, StringComparison.OrdinalIgnoreCase));

            if (found is not null)
                return found;

            Thread.Sleep(500);
        }

        return null;
    }

    private static string Normalize(string name)
    {
        name = Path.GetFileNameWithoutExtension(name);
        return name.Trim();
    }
}