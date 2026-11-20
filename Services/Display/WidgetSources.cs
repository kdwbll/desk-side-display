using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
sealed record WidgetSourceConfig(bool Clipboard = false, bool Notifications = false, bool Window = false,
    bool Actions = false, double? Latitude = null, double? Longitude = null,
    WidgetInterface[]? Interfaces = null, Dictionary<string, string>? Apps = null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
sealed record WidgetInterface(string Id, string Url, int RefreshMs = 10000);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
sealed record WidgetNotification(string Title, string? Body = null, string? App = null);

sealed class WidgetSources : IDisposable
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly object gate = new();
    private readonly string path;
    private readonly ClipboardHistory history;
    private readonly Dictionary<Uri, CachedDocument> documents = [];
    private readonly HttpClient http = new(new SocketsHttpHandler { AllowAutoRedirect = false, UseCookies = false, UseProxy = false })
        { Timeout = Timeout.InfiniteTimeSpan };
    private WidgetSourceConfig config = new();
    private WidgetNotification? notification;
    private int notificationCount;
    private long revision;
    private long lastAction;
    public string FeedKey { get; } = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
    public long Revision => Interlocked.Read(ref revision);

    public WidgetSources(string folder, ClipboardHistory history)
    {
        this.history = history;
        path = Path.Combine(folder, "widget-sources.json");
        if (!File.Exists(path) || new FileInfo(path).Length > 16_384) return;
        try
        {
            var saved = JsonSerializer.Deserialize<WidgetSourceConfig>(File.ReadAllBytes(path), Json);
            if (saved != null && Validate(saved) == null) config = saved;
        }
        catch (Exception error) when (error is JsonException or IOException) { }
    }

    public WidgetSourceConfig Read()
    {
        lock (gate) return config;
    }

    public string? Save(WidgetSourceConfig value)
    {
        var error = Validate(value);
        if (error != null) return error;
        var payload = JsonSerializer.SerializeToUtf8Bytes(value, Json);
        if (payload.Length > 16_384) return "数据源配置总大小超过 16 KB。";
        lock (gate)
        {
            PanelSettings.Save(path, payload);
            config = value;
            documents.Clear();
            Interlocked.Increment(ref revision);
            if (!config.Notifications)
            {
                notification = null;
                notificationCount = 0;
            }
        }
        return null;
    }

    public string? Publish(WidgetNotification next)
    {
        lock (gate)
        {
            if (!config.Notifications) return "请先允许通知数据源。";
            if (string.IsNullOrWhiteSpace(next.Title) || next.Title.Length > 160 ||
                next.Body?.Length > 1000 || next.App?.Length > 80) return "通知的标题或内容无效。";
            notification = next;
            notificationCount = Math.Min(notificationCount + 1, 10000);
            return null;
        }
    }

    public async Task<Dictionary<string, object?>> Sample(DisplayPage page, CancellationToken token)
    {
        var manifests = page.Widgets.Where(widget => widget.Type == "custom" && widget.Manifest?.Version == 2)
            .Select(widget => widget.Manifest!).ToArray();
        var requested = manifests.SelectMany(WidgetProtocol.References)
            .Distinct(StringComparer.Ordinal).ToHashSet(StringComparer.Ordinal);
        var values = new Dictionary<string, object?>(StringComparer.Ordinal);
        var options = Read();
        var groups = requested.Select(WidgetProtocol.Group).ToHashSet(StringComparer.Ordinal);
        if (groups.Contains("clipboard") && options.Clipboard)
        {
            if (requested.Contains("clipboard.history"))
                values["clipboard.history"] = await history.Read(token);
            if (requested.Overlaps(["clipboard.text", "clipboard.image", "clipboard.files"]))
            {
                var thumbnails = manifests.SelectMany(manifest => manifest.Blocks ?? []).Any(block =>
                    block.Kind == "files" && block.Source == "clipboard.files" && block.FileDisplay != "icon");
                Add(values, await WidgetWindows.ClipboardValues(requested, thumbnails));
            }
        }
        if (groups.Contains("window") && options.Window) Add(values, WidgetWindows.Foreground());
        if (groups.Contains("power")) Add(values, WidgetWindows.Power());
        if (groups.Contains("volume")) Add(values, WidgetWindows.Volume());
        if (groups.Contains("network")) Add(values, WidgetWindows.Network());
        if (groups.Contains("notification") && options.Notifications)
        {
            lock (gate)
            {
                values["notification.title"] = notification?.Title;
                values["notification.body"] = notification?.Body;
                values["notification.app"] = notification?.App;
                values["notification.count"] = notificationCount;
            }
        }
        if (groups.Contains("weather") && options.Latitude is double lat && options.Longitude is double lon)
        {
            var uri = new Uri(FormattableString.Invariant(
                $"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,weather_code,wind_speed_10m"));
            var data = await Document(uri, 300000, token);
            values["weather.temperature"] = Extract(data, ["current", "temperature_2m"]);
            values["weather.code"] = Extract(data, ["current", "weather_code"]);
            values["weather.wind"] = Extract(data, ["current", "wind_speed_10m"]);
        }
        if (groups.Contains("api"))
        {
            var jobs = (options.Interfaces ?? []).Select(async endpoint =>
            {
                var prefix = $"api.{endpoint.Id}.";
                var bindings = requested.Where(reference => reference.StartsWith(prefix, StringComparison.Ordinal)).ToArray();
                var data = bindings.Length == 0 ? default : await Document(new Uri(endpoint.Url), endpoint.RefreshMs, token);
                return (prefix, bindings, data);
            });
            foreach (var (prefix, bindings, data) in await Task.WhenAll(jobs))
                foreach (var binding in bindings) values[binding] = Extract(data, binding[prefix.Length..].Split('.'));
        }
        return values.Where(item => requested.Contains(item.Key) || item.Key == "clipboard.sequence")
            .ToDictionary(StringComparer.Ordinal);
    }

    public async Task<string?> Act(WidgetAction action, AppleMusic music, KeyboardShortcut keyboard, uint? clipboardVersion,
        string? historyItem, CancellationToken token)
    {
        WidgetSourceConfig options;
        lock (gate)
        {
            options = config;
            if (!options.Actions) return "请先在 Windows 面板允许自定义组件动作。";
            if (lastAction != 0 && Stopwatch.GetElapsedTime(lastAction) < TimeSpan.FromMilliseconds(240))
                return "操作过快，请稍后再试。";
            lastAction = Stopwatch.GetTimestamp();
        }
        if (action.Type == "refresh") return null;
        if (action.Type == "clipboard.history.paste")
        {
            if (!options.Clipboard) return "请先在 Windows 面板允许读取剪贴板。";
            return await history.Paste(historyItem, keyboard, token);
        }
        if (action.Type == "clipboard.paste")
        {
            if (!options.Clipboard) return "请先在 Windows 面板允许读取剪贴板。";
            if (clipboardVersion is not > 0 || clipboardVersion != WidgetWindows.ClipboardVersion)
                return "剪贴板内容已更新，请等手机刷新后重试。";
            return keyboard.Press("Ctrl+V");
        }
        if (action.Type == "copy")
            return await WidgetWindows.Copy(action.Value!) ? null : "Windows 剪贴板暂不可用。";
        if (action.Type.StartsWith("music.", StringComparison.Ordinal))
            return await music.ControlAsync(action.Type[6..]) ? null : "Apple Music 暂不可控制。";
        if (action.Type == "open-app" && options.Apps?.TryGetValue(action.Value!, out var executable) == true)
        {
            try
            {
                using var launched = Process.Start(new ProcessStartInfo(executable) { UseShellExecute = false });
                return launched == null ? "应用未能打开。" : null;
            }
            catch (System.ComponentModel.Win32Exception) { return "该应用暂时无法启动。"; }
        }
        return "请先在 Windows 注册这个应用别名。";
    }

    private static void Add(Dictionary<string, object?> sink, Dictionary<string, object?> source)
    {
        foreach (var value in source) sink[value.Key] = value.Value;
    }

    private static string? Validate(WidgetSourceConfig value)
    {
        if ((value.Latitude == null) != (value.Longitude == null) ||
            value.Latitude is < -90 or > 90 || value.Longitude is < -180 or > 180) return "请填写有效的天气经纬度。";
        if (value.Interfaces is { Length: > 8 } || value.Apps is { Count: > 8 }) return "接口与应用别名各最多 8 个。";
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var endpoint in value.Interfaces ?? [])
        {
            if (endpoint == null || !Alias(endpoint.Id) || !ids.Add(endpoint.Id) ||
                endpoint.RefreshMs is < 1000 or > 3600000 || endpoint.Url is not { Length: <= 350 } ||
                !Uri.TryCreate(endpoint.Url, UriKind.Absolute, out var uri) || uri.UserInfo.Length > 0 ||
                uri.Fragment.Length > 0 || (uri.Scheme != "https" && !(uri.Scheme == "http" && uri.IsLoopback)) ||
                (uri.IsLoopback && uri.Port is 8765 or 8766))
                return "接口须有唯一别名、有效刷新间隔和 HTTPS 或本机 HTTP 地址。";
        }
        if (value.Apps?.Any(item => !Alias(item.Key) || item.Value is not { Length: <= 520 } ||
            !Path.IsPathFullyQualified(item.Value) || item.Value.StartsWith(@"\\", StringComparison.Ordinal) ||
            !item.Value.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) == true)
            return "应用别名须固定指向本机 EXE 的完整路径。";
        return null;
    }

    private static bool Alias(string? name) => name is { Length: >= 1 and <= 32 } &&
        name.All(ch => ch is >= 'a' and <= 'z' or >= '0' and <= '9' or '-' or '_') && char.IsAsciiLetterOrDigit(name[0]);

    private async Task<JsonElement> Document(Uri uri, int interval, CancellationToken token)
    {
        CachedDocument entry;
        lock (gate)
        {
            if (!documents.TryGetValue(uri, out entry!)) documents[uri] = entry = new CachedDocument();
        }
        await entry.Gate.WaitAsync(token);
        try
        {
            if (entry.SampledAt != 0 && Stopwatch.GetElapsedTime(entry.SampledAt).TotalMilliseconds < interval)
                return entry.Content;
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
            deadline.CancelAfter(TimeSpan.FromSeconds(3));
            try
            {
                using var response = await http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
                response.EnsureSuccessStatusCode();
                if (response.Content.Headers.ContentLength > 131072) return entry.Content = default;
                await using var content = await response.Content.ReadAsStreamAsync(deadline.Token);
                using var bytes = new MemoryStream();
                var buffer = new byte[4096];
                int count;
                while ((count = await content.ReadAsync(buffer, deadline.Token)) != 0)
                {
                    if (bytes.Length + count > 131072) return entry.Content = default;
                    bytes.Write(buffer, 0, count);
                }
                using var document = JsonDocument.Parse(bytes.ToArray(), new JsonDocumentOptions { MaxDepth = 16 });
                return entry.Content = document.RootElement.Clone();
            }
            catch (Exception error) when (error is HttpRequestException or JsonException or IOException
                or OperationCanceledException)
            {
                return entry.Content = default;
            }
            finally { entry.SampledAt = Stopwatch.GetTimestamp(); }
        }
        finally { entry.Gate.Release(); }
    }

    private static object? Extract(JsonElement node, string[] segments)
    {
        foreach (var key in segments)
        {
            if (node.ValueKind == JsonValueKind.Object && node.TryGetProperty(key, out var child)) node = child;
            else if (node.ValueKind == JsonValueKind.Array && int.TryParse(key, NumberStyles.None,
                     CultureInfo.InvariantCulture, out var index) && index < node.GetArrayLength()) node = node[index];
            else return null;
        }
        return node.ValueKind switch
        {
            JsonValueKind.String => node.GetString() is string value && value.Length <= 120000 &&
                (value.Length <= 2048 || value.StartsWith("data:image/", StringComparison.Ordinal)) ? value : null,
            JsonValueKind.Number => node.TryGetDouble(out var number) && double.IsFinite(number) ? number : null,
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null
        };
    }

    public void Dispose() => http.Dispose();

    private sealed class CachedDocument
    {
        public SemaphoreSlim Gate { get; } = new(1, 1);
        public long SampledAt;
        public JsonElement Content;
    }
}
