using System.Diagnostics;

sealed class UsbBridge(string adbPath, int displayPort) : BackgroundService
{
    private string status = "checking";
    public string Status => Volatile.Read(ref status);

    protected override async Task ExecuteAsync(CancellationToken token)
    {
        if (!File.Exists(adbPath))
        {
            Volatile.Write(ref status, "tools-missing");
            return;
        }

        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(3));
        do
        {
            try { Volatile.Write(ref status, await CheckAsync(token)); }
            catch (Exception error) when (!token.IsCancellationRequested &&
                error is System.ComponentModel.Win32Exception or IOException or OperationCanceledException)
            {
                Volatile.Write(ref status, "error");
            }
        } while (await timer.WaitForNextTickAsync(token));
    }

    private async Task<string> CheckAsync(CancellationToken token)
    {
        var (code, output) = await RunAsync(token, "devices");
        if (code != 0) return "error";
        var devices = output.Split('\n', StringSplitOptions.TrimEntries)
            .Select(line => line.Split('\t', StringSplitOptions.TrimEntries))
            .Where(parts => parts.Length == 2 && !parts[0].Contains(':') &&
                !parts[0].StartsWith("emulator-", StringComparison.Ordinal)).ToArray();
        if (devices.Length == 0) return "disconnected";
        if (devices.Length > 1) return "multiple";
        var device = devices[0];
        if (device[1] == "unauthorized") return "unauthorized";
        if (device[1] != "device") return "offline";

        var endpoint = $"tcp:{displayPort}";
        var (listCode, list) = await RunAsync(token, "-s", device[0], "reverse", "--list");
        if (listCode != 0) return "error";
        var existing = list.Split('\n', StringSplitOptions.TrimEntries)
            .Select(line => line.Split(' ', StringSplitOptions.RemoveEmptyEntries))
            .FirstOrDefault(fields => fields.Length >= 2 && fields[^2] == endpoint);
        if (existing != null) return existing[^1] == endpoint ? "ready" : "port-in-use";
        var (bindCode, _) = await RunAsync(token, "-s", device[0], "reverse", "--no-rebind", endpoint, endpoint);
        return bindCode == 0 ? "ready" : "error";
    }

    private async Task<(int Code, string Output)> RunAsync(CancellationToken token, params string[] arguments)
    {
        var launch = new ProcessStartInfo(adbPath)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        foreach (var argument in arguments) launch.ArgumentList.Add(argument);
        using var process = Process.Start(launch) ?? throw new IOException("ADB did not start.");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
        timeout.CancelAfter(TimeSpan.FromSeconds(5));
        var output = process.StandardOutput.ReadToEndAsync(timeout.Token);
        var errors = process.StandardError.ReadToEndAsync(timeout.Token);
        try
        {
            await process.WaitForExitAsync(timeout.Token);
            await errors;
            return (process.ExitCode, await output);
        }
        catch (OperationCanceledException)
        {
            if (!process.HasExited) process.Kill();
            throw;
        }
    }
}
