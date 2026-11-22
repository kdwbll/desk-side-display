using System.IO.Compression;

sealed class AndroidTools(string project, string? installRoot, HttpClient download)
{
    private const string DownloadUrl = "https://dl.google.com/android/repository/platform-tools-latest-windows.zip";
    private const long MaxDownloadBytes = 32 * 1024 * 1024;
    private static readonly string[] ToolFiles =
        ["adb.exe", "AdbWinApi.dll", "AdbWinUsbApi.dll", "libwinpthread-1.dll", "NOTICE.txt", "source.properties"];
    private readonly SemaphoreSlim installLock = new(1);

    public string? FindAdb()
    {
        var local = Path.Combine(project, ".tools", "platform-tools", "adb.exe");
        if (File.Exists(local)) return local;
        if (installRoot is null) return null;

        var managed = Path.Combine(installRoot, "platform-tools", "adb.exe");
        if (File.Exists(managed)) return managed;
        foreach (var sdk in new[]
        {
            Environment.GetEnvironmentVariable("ANDROID_HOME"),
            Environment.GetEnvironmentVariable("ANDROID_SDK_ROOT"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Android", "Sdk")
        })
        {
            if (string.IsNullOrWhiteSpace(sdk)) continue;
            var installed = Path.Combine(sdk, "platform-tools", "adb.exe");
            if (File.Exists(installed)) return installed;
        }
        return null;
    }

    public async Task InstallAsync(CancellationToken cancellationToken)
    {
        if (installRoot is null) throw new InvalidOperationException("Automatic installation is disabled.");
        await installLock.WaitAsync(cancellationToken);
        try
        {
            if (FindAdb() is not null) return;
            var staging = Path.Combine(installRoot, Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(staging);
            try
            {
                using var response = await download.GetAsync(DownloadUrl, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
                response.EnsureSuccessStatusCode();
                await using var input = await response.Content.ReadAsStreamAsync(cancellationToken);
                using var buffer = new MemoryStream();
                var block = new byte[81920];
                int length;
                while ((length = await input.ReadAsync(block, cancellationToken)) != 0)
                {
                    if (buffer.Length + length > MaxDownloadBytes) throw new InvalidDataException("Platform-Tools download is too large.");
                    buffer.Write(block, 0, length);
                }
                buffer.Position = 0;
                using var archive = new ZipArchive(buffer);
                foreach (var file in ToolFiles)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    var entry = archive.GetEntry("platform-tools/" + file);
                    // Older Windows releases ship this separately. Newer ADB builds do not need it.
                    if (entry is null && file == "libwinpthread-1.dll") continue;
                    if (entry is null || entry.Length <= 0 || entry.Length > MaxDownloadBytes)
                        throw new InvalidDataException($"Invalid Platform-Tools entry: {file}");
                    await using var source = entry.Open();
                    await using var destination = File.Create(Path.Combine(staging, file));
                    await source.CopyToAsync(destination, cancellationToken);
                }
                Directory.Move(staging, Path.Combine(installRoot, "platform-tools"));
            }
            finally
            {
                if (Directory.Exists(staging)) Directory.Delete(staging, recursive: true);
            }
        }
        finally
        {
            installLock.Release();
        }
    }
}
