using System.Diagnostics;

sealed class UsbBridge(AndroidTools tools, int displayPort, bool openOnConnect, IHostApplicationLifetime lifetime) : BackgroundService
{
    private string status = "checking";
    private string? openedDevice;
    public string Status => Volatile.Read(ref status);

    protected override async Task ExecuteAsync(CancellationToken token)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(3));
        do
        {
            try
            {
                var adbPath = tools.FindAdb();
                var current = adbPath is null ? "tools-missing" : await CheckAsync(adbPath, token);
                if (current is "disconnected" or "unauthorized" or "offline" or "tools-missing") openedDevice = null;
                Volatile.Write(ref status, current);
            }
            catch (Exception error) when (!token.IsCancellationRequested &&
                error is System.ComponentModel.Win32Exception or IOException or OperationCanceledException)
            {
                Volatile.Write(ref status, "error");
            }
        } while (await timer.WaitForNextTickAsync(token));
    }

    private async Task<string> CheckAsync(string adbPath, CancellationToken token)
    {
        var (code, output) = await RunAsync(adbPath, token, "devices");
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
        var (listCode, list) = await RunAsync(adbPath, token, "-s", device[0], "reverse", "--list");
        if (listCode != 0) return "error";
        var existing = list.Split('\n', StringSplitOptions.TrimEntries)
            .Select(line => line.Split(' ', StringSplitOptions.RemoveEmptyEntries))
            .FirstOrDefault(fields => fields.Length >= 2 && fields[^2] == endpoint);
        if (existing is not null && existing[^1] != endpoint) return "port-in-use";
        if (existing is null)
        {
            var (bindCode, _) = await RunAsync(adbPath, token, "-s", device[0], "reverse", "--no-rebind", endpoint, endpoint);
            if (bindCode != 0) return "error";
        }
        if (openOnConnect && lifetime.ApplicationStarted.IsCancellationRequested && openedDevice != device[0])
        {
            openedDevice = device[0];
            try
            {
                await RunAsync(adbPath, token, "-s", device[0], "shell", "am", "start",
                    "-a", "android.intent.action.VIEW", "-d", $"http://127.0.0.1:{displayPort}/");
            }
            catch (OperationCanceledException) when (!token.IsCancellationRequested) { }
        }
        return "ready";
    }

    private static async Task<(int Code, string Output)> RunAsync(string adbPath, CancellationToken token, params string[] arguments)
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
