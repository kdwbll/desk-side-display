using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

sealed record DisplayLayout(int Revision, bool ShortcutsEnabled, DisplayPage[] Pages);
sealed record DisplayPage(string Id, string Name, string Kind, string Color, DisplayWidget[] Widgets);
sealed record DisplayWidget(Guid Id, string Type, string Name, string Size, string Color,
    string? Text = null, string? Metric = null, string? Keys = null, WidgetManifest? Manifest = null);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
sealed record WidgetManifest(int Version, string Name, string Size, string Color, string Template,
    string? Detail = null, string? Gauge = null);

sealed class DisplayPages
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly string[] BuiltIns = ["lyrics", "photo", "clock", "hardware"];
    private static readonly string[] Metrics =
    [
        "cpu.usage", "cpu.temperature", "gpu.usage", "gpu.temperature", "gpu.power",
        "gpu.fan", "gpu.clock", "ram.used", "ram.total", "ram.usage"
    ];
    private static readonly string[] Tokens =
        [.. Metrics, "time", "date", "music.title", "music.artist", "music.progress", "music.duration", "gpu.name"];
    private static readonly Regex ColorPattern = new(@"\A#[0-9a-fA-F]{6}\z", RegexOptions.CultureInvariant);
    private static readonly Regex TokenPattern = new(@"\{\{([a-z][a-z.]*)\}\}", RegexOptions.CultureInvariant);
    private readonly object gate = new();
    private readonly string path;
    private DisplayLayout layout = Defaults();

    public DisplayPages(string dataPath)
    {
        path = Path.Combine(dataPath, "display-pages.json");
        if (!File.Exists(path) || new FileInfo(path).Length > 64 * 1024) return;
        try
        {
            var saved = JsonSerializer.Deserialize<DisplayLayout>(File.ReadAllBytes(path), Json);
            if (saved != null && Validate(saved) == null) layout = saved;
        }
        catch (JsonException) { }
    }

    public DisplayLayout Read()
    {
        lock (gate) return layout;
    }

    public (DisplayLayout? Value, string? Error, bool Conflict) Save(DisplayLayout next)
    {
        lock (gate)
        {
            if (next.Revision != layout.Revision)
                return (null, "页面已在另一窗口更新。请重新读取后再修改。", true);
            var error = Validate(next);
            if (error != null) return (null, error, false);
            var updated = next with { Revision = layout.Revision + 1 };
            PanelSettings.Save(path, JsonSerializer.SerializeToUtf8Bytes(updated, Json));
            layout = updated;
            return (updated, null, false);
        }
    }

    private static string? Validate(DisplayLayout value)
    {
        if (value.Revision < 0 || value.Revision == int.MaxValue ||
            value.Pages is not { Length: >= 4 and <= 6 } || value.Pages.Any(page => page == null))
            return "需要保留四个内置界面，界面总数最多为六个。";
        var pageIds = new HashSet<string>(StringComparer.Ordinal);
        var widgetIds = new HashSet<Guid>();
        foreach (var page in value.Pages)
        {
            if (page.Id == null || !pageIds.Add(page.Id) || !Named(page.Name, 24) || !Color(page.Color) ||
                page.Widgets is not { Length: <= 8 } ||
                (BuiltIns.Contains(page.Id) ? page.Kind != page.Id :
                    page.Kind != "custom" || !Guid.TryParseExact(page.Id, "N", out _)))
                return "页面名称、背景颜色或布局无效。每页最多八个组件。";
            foreach (var widget in page.Widgets)
            {
                if (widget == null || widget.Id == Guid.Empty || !widgetIds.Add(widget.Id) ||
                    !Named(widget.Name, 24) || !Size(widget.Size) || !Color(widget.Color))
                    return "组件的名称、尺寸、颜色或标识无效。";
                var error = widget.Type switch
                {
                    "clock" or "date" or "music" => null,
                    "text" => Named(widget.Text, 160) ? null : "便签需要 1–160 个字符。",
                    "metric" => Metrics.Contains(widget.Metric) ? null : "请选择可用的硬件指标。",
                    "shortcut" => KeyboardShortcut.TryParseChord(widget.Keys, out _) ? null :
                        "快捷键格式无效。例 Ctrl+Shift+K、Win+E、F12 或 Ctrl+VKBA。",
                    "custom" => ValidateManifest(widget.Manifest),
                    _ => "未知的组件类型。"
                };
                if (error != null) return error;
                if (widget.Type != "shortcut" && widget.Keys != null)
                    return "快捷键只能配置在快捷键组件中。";
            }
        }
        return BuiltIns.All(pageIds.Contains) ? null : "请保留歌词、相框、时钟和硬件监控。";
    }

    internal static string? ValidateManifest(WidgetManifest? manifest)
    {
        if (manifest == null || manifest.Version != 1 || !Named(manifest.Name, 24) ||
            !Size(manifest.Size) || !Color(manifest.Color))
            return "自定义组件的版本、名称、尺寸或颜色无效。";
        if (!Template(manifest.Template, 120) || (manifest.Detail != null && !Template(manifest.Detail, 160)))
            return "自定义组件文字过长，或使用了规范里没有的数据标记。";
        return manifest.Gauge == null || Metrics.Contains(manifest.Gauge) ? null : "自定义组件的仪表指标无效。";
    }

    private static bool Template(string? text, int limit)
    {
        if (!Named(text, limit)) return false;
        var literals = TokenPattern.Replace(text!, "");
        return !literals.Contains("{{") && !literals.Contains("}}") &&
            TokenPattern.Matches(text!).All(match => Tokens.Contains(match.Groups[1].Value));
    }

    private static bool Named(string? text, int limit) => !string.IsNullOrWhiteSpace(text) && text.Length <= limit;
    private static bool Size(string? value) => value is "small" or "medium" or "large";
    private static bool Color(string? value) => value is { Length: 7 } && ColorPattern.IsMatch(value);

    private static DisplayLayout Defaults() => new(0, false,
    [
        new("lyrics", "歌词", "lyrics", "#171923", []),
        new("photo", "相框", "photo", "#171923", []),
        new("clock", "时钟", "clock", "#171923", []),
        new("hardware", "硬件监控", "hardware", "#151621",
        [
            Metric("162024d1-b79b-4f67-9bd7-54433a4f045f", "CPU", "#39dbc6", "cpu.usage"),
            Metric("cdae4484-a0b8-4f75-a97c-08421bd82a9d", "GPU", "#afe64f", "gpu.usage"),
            Metric("ddb1fd47-adf9-418a-805a-e56ce8a5d44a", "内存", "#ae9cff", "ram.used"),
            Metric("47147e95-e7ae-4d60-bdfd-6076c66f0066", "GPU 温度", "#ff9a57", "gpu.temperature")
        ])
    ]);

    private static DisplayWidget Metric(string id, string name, string color, string metric) =>
        new(Guid.Parse(id), "metric", name, "small", color, Metric: metric);
}
