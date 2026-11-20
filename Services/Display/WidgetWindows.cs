using System.Collections.Concurrent;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

static class WidgetWindows
{
    private static readonly BlockingCollection<Action> ClipboardJobs = new(8);
    private static readonly Lazy<Thread> ClipboardThread = new(() =>
    {
        var thread = new Thread(() =>
        {
            foreach (var job in ClipboardJobs.GetConsumingEnumerable()) job();
        }) { Name = "Desk Side Display clipboard", IsBackground = true };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        return thread;
    });
    private static readonly object NetworkGate = new();
    private static (string Id, long ReadingAt, long Received, long Sent, double? Down, double? Up)? previousNetwork;

    public static uint ClipboardVersion => GetClipboardSequenceNumber();

    public static Task<Dictionary<string, object?>> ClipboardValues(HashSet<string> requested, bool includeThumbnails) =>
        InClipboard(() =>
        {
            var version = ClipboardVersion;
            var values = new Dictionary<string, object?>();
            if (requested.Contains("clipboard.text") && Clipboard.ContainsText() && Clipboard.GetText() is { Length: > 0 } text)
                values["clipboard.text"] = Limit(text, 2048);
            if (requested.Contains("clipboard.image") && Clipboard.ContainsImage())
            {
                using var image = Clipboard.GetImage();
                if (image != null && Thumbnail(image) is string thumbnail) values["clipboard.image"] = thumbnail;
            }
            if (requested.Contains("clipboard.files") && Clipboard.ContainsFileDropList())
            {
                var files = Clipboard.GetFileDropList().Cast<string>().Take(6).Select(file => FileItem(file, includeThumbnails)).ToArray();
                if (files.Length > 0) values["clipboard.files"] = files;
            }
            if (version != ClipboardVersion) return new();
            if (version != 0 && values.Count > 0) values["clipboard.sequence"] = version;
            return values;
        }, new());

    public static Task<bool> Copy(string text) => InClipboard(() =>
    {
        Clipboard.SetText(text);
        return true;
    }, false);

    private static Task<T> InClipboard<T>(Func<T> read, T fallback)
    {
        _ = ClipboardThread.Value;
        var result = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!ClipboardJobs.TryAdd(() =>
        {
            try { result.SetResult(read()); }
            catch (Exception error) when (error is ExternalException or ArgumentException or IOException or InvalidOperationException)
            { result.SetResult(fallback); }
        })) return Task.FromResult(fallback);
        return result.Task;
    }

    private static ClipboardFile FileItem(string path, bool includeThumbnail)
    {
        var name = Limit(Path.GetFileName(path), 140);
        if (name.Length == 0) name = "文件";
        string? icon = null, thumbnail = null;
        if (Path.IsPathFullyQualified(path) && !path.StartsWith(@"\\", StringComparison.Ordinal))
        {
            try
            {
                var info = new FileInfo(path);
                if (info.Exists)
                {
                    if (includeThumbnail && info.Length <= 4 * 1024 * 1024 &&
                        info.Extension.ToLowerInvariant() is ".png" or ".jpg" or ".jpeg" or ".bmp" or ".gif")
                    {
                        using var image = Image.FromFile(path);
                        thumbnail = Thumbnail(image);
                    }
                    using var associated = Icon.ExtractAssociatedIcon(path);
                    using var iconImage = associated?.ToBitmap();
                    if (iconImage != null) icon = Thumbnail(iconImage, 48);
                }
            }
            catch (Exception error) when (error is IOException or ExternalException or ArgumentException or OutOfMemoryException
                or UnauthorizedAccessException or System.Security.SecurityException) { }
        }
        return new ClipboardFile(name, icon, thumbnail);
    }

    private static string? Thumbnail(Image image, int limit = 192)
    {
        if (image.Width <= 0 || image.Height <= 0 || (long)image.Width * image.Height > 30_000_000) return null;
        var scale = Math.Min(1d, limit / (double)Math.Max(image.Width, image.Height));
        using var reduced = new Bitmap(Math.Max(1, (int)(image.Width * scale)), Math.Max(1, (int)(image.Height * scale)));
        using (var graphics = Graphics.FromImage(reduced))
            graphics.DrawImage(image, 0, 0, reduced.Width, reduced.Height);
        using var buffer = new MemoryStream();
        reduced.Save(buffer, ImageFormat.Png);
        return buffer.Length <= 180000 ? "data:image/png;base64," + Convert.ToBase64String(buffer.ToArray()) : null;
    }

    public static Dictionary<string, object?> Foreground()
    {
        var window = GetForegroundWindow();
        var title = new StringBuilder(257);
        _ = GetWindowText(window, title, title.Capacity);
        _ = GetWindowThreadProcessId(window, out var id);
        string? process = null;
        try { using var owner = Process.GetProcessById((int)id); process = owner.ProcessName; }
        catch (Exception error) when (error is ArgumentException or InvalidOperationException
            or System.ComponentModel.Win32Exception) { }
        return new() { ["window.title"] = title.Length == 0 ? null : title.ToString(), ["window.process"] = process };
    }

    public static Dictionary<string, object?> Power()
    {
        var status = SystemInformation.PowerStatus;
        return new()
        {
            ["power.percent"] = status.BatteryChargeStatus is BatteryChargeStatus.NoSystemBattery or BatteryChargeStatus.Unknown
                ? null : status.BatteryLifePercent * 100d,
            ["power.plugged"] = status.PowerLineStatus == PowerLineStatus.Unknown ? null : status.PowerLineStatus == PowerLineStatus.Online,
            ["power.charging"] = status.BatteryChargeStatus == BatteryChargeStatus.Unknown ? null :
                status.BatteryChargeStatus.HasFlag(BatteryChargeStatus.Charging)
        };
    }

    public static Dictionary<string, object?> Network()
    {
        lock (NetworkGate)
        {
            try
            {
                var adapter = NetworkInterface.GetAllNetworkInterfaces().Where(item =>
                    item.OperationalStatus == OperationalStatus.Up &&
                    item.NetworkInterfaceType is not (NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel))
                    .OrderByDescending(item => item.GetIPProperties().GatewayAddresses.Count > 0).FirstOrDefault();
                if (adapter == null) return new() { ["network.online"] = false };
                var counts = adapter.GetIPStatistics();
                var now = Stopwatch.GetTimestamp();
                double? down = null, up = null;
                if (previousNetwork is { } before && before.Id == adapter.Id)
                {
                    var elapsed = Stopwatch.GetElapsedTime(before.ReadingAt, now).TotalSeconds;
                    if (elapsed < .8) { down = before.Down; up = before.Up; }
                    else
                    {
                        down = Math.Max(0, counts.BytesReceived - before.Received) / elapsed;
                        up = Math.Max(0, counts.BytesSent - before.Sent) / elapsed;
                        previousNetwork = (adapter.Id, now, counts.BytesReceived, counts.BytesSent, down, up);
                    }
                }
                else previousNetwork = (adapter.Id, now, counts.BytesReceived, counts.BytesSent, null, null);
                return new() { ["network.online"] = true, ["network.name"] = adapter.Name,
                    ["network.down"] = down, ["network.up"] = up };
            }
            catch (NetworkInformationException) { return new(); }
        }
    }

    public static Dictionary<string, object?> Volume()
    {
        AudioEnumerator? enumerator = null;
        AudioDevice? device = null;
        object? endpoint = null;
        try
        {
            var type = Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"), true)!;
            enumerator = (AudioEnumerator)Activator.CreateInstance(type)!;
            if (enumerator.GetDefaultAudioEndpoint(0, 1, out device) < 0) return new();
            var id = typeof(AudioVolume).GUID;
            if (device.Activate(ref id, 23, IntPtr.Zero, out endpoint) < 0 || endpoint is not AudioVolume volume) return new();
            return new() {
                ["volume.percent"] = volume.GetMasterVolumeLevelScalar(out var scalar) >= 0 ? 100d * scalar : null,
                ["volume.muted"] = volume.GetMute(out var muted) >= 0 ? muted : null
            };
        }
        catch (Exception error) when (error is COMException or InvalidCastException) { return new(); }
        finally
        {
            if (endpoint != null) Marshal.ReleaseComObject(endpoint);
            if (device != null) Marshal.ReleaseComObject(device);
            if (enumerator != null) Marshal.ReleaseComObject(enumerator);
        }
    }

    private static string Limit(string text, int length) => text.Length <= length ? text : text[..length];
    private sealed record ClipboardFile(string Name, string? Icon, string? Thumbnail);

    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr window, StringBuilder text, int length);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface AudioEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int flow, uint mask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out AudioDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface AudioDevice
    {
        [PreserveSig] int Activate(ref Guid id, uint context, IntPtr options, [MarshalAs(UnmanagedType.IUnknown)] out object endpoint);
    }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface AudioVolume
    {
        [PreserveSig] int RegisterControlChangeNotify(IntPtr callback);
        [PreserveSig] int UnregisterControlChangeNotify(IntPtr callback);
        [PreserveSig] int GetChannelCount(out uint channels);
        [PreserveSig] int SetMasterVolumeLevel(float level, IntPtr context);
        [PreserveSig] int SetMasterVolumeLevelScalar(float level, IntPtr context);
        [PreserveSig] int GetMasterVolumeLevel(out float level);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
        [PreserveSig] int SetChannelVolumeLevel(uint channel, float level, IntPtr context);
        [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, IntPtr context);
        [PreserveSig] int GetChannelVolumeLevel(uint channel, out float level);
        [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool value, IntPtr context);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool value);
    }
}
