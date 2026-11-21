using System.Text.Json;
using System.Text.Json.Serialization;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

sealed record DisplayLayout(int Revision, bool ShortcutsEnabled, DisplayPage[] Pages,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] WidgetManifest[]? WidgetLibrary = null);
sealed record DisplayPage(string Id, string Name, string Kind, string Color, DisplayWidget[] Widgets,
    string BackgroundMode = "fixed");
sealed record DisplayWidget(Guid Id, string Type, string Name, string Size, string Color,
    string? Text = null, string? Metric = null, string? Keys = null, WidgetManifest? Manifest = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] WidgetPlacement? Placement = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? MediaId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Fit = null);
sealed record WidgetPlacement(int X, int Y, int Width, int Height)
{
    public bool IsValid() => Width is >= 55 and <= 1000 && Height is >= 65 and <= 1000 &&
        X >= 0 && Y >= 0 && X <= 1000 - Width && Y <= 1000 - Height;

    public bool Overlaps(WidgetPlacement other) =>
        X < other.X + other.Width && X + Width > other.X &&
        Y < other.Y + other.Height && Y + Height > other.Y;
}

sealed class DisplayPages
{
    public const int MaxPages = 10;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly string[] BuiltIns = ["lyrics", "photo", "clock", "hardware"];
    private static readonly string[] Required = ["lyrics", "hardware"];
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
        if (!File.Exists(path) || new FileInfo(path).Length > 1024 * 1024) return;
        try
        {
            var saved = JsonSerializer.Deserialize<DisplayLayout>(File.ReadAllBytes(path), Json);
            if (saved != null && Validate(saved, allowLegacyOverlap: true) == null)
            {
                var pages = saved.Pages.Select(RepairLegacyPlacements).ToArray();
                var known = (saved.WidgetLibrary ?? []).Where(item => ValidateManifest(item) == null);
                layout = saved with { Pages = pages, WidgetLibrary = MergeLibrary(known, pages) };
            }
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
            var updated = next with { Revision = layout.Revision + 1, WidgetLibrary = MergeLibrary(layout.WidgetLibrary ?? [], next.Pages) };
            var bytes = JsonSerializer.SerializeToUtf8Bytes(updated, Json);
            if (bytes.Length > 1024 * 1024) return (null, "界面配置总大小超过 1 MB。", false);
            PanelSettings.Save(path, bytes);
            layout = updated;
            return (updated, null, false);
        }
    }

    private static WidgetManifest[] MergeLibrary(IEnumerable<WidgetManifest> known, DisplayPage[] pages)
    {
        var library = new Dictionary<string, WidgetManifest>(StringComparer.Ordinal);
        foreach (var item in known) library[LibraryKey(item)] = item;
        foreach (var widget in pages.SelectMany(page => page.Widgets)
                     .Where(widget => widget.Type == "custom" && widget.Manifest != null))
        {
            var item = widget.Manifest! with { Name = widget.Name, Size = widget.Size, Color = widget.Color };
            library[LibraryKey(item)] = item;
        }
        return library.Values.ToArray();
    }

    private static string LibraryKey(WidgetManifest item) =>
        !string.IsNullOrWhiteSpace(item.Widget) ? "widget:" + item.Widget.Trim() :
        Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(
            item with { Size = "small", Color = "#000000" }, Json)));

    private static DisplayPage RepairLegacyPlacements(DisplayPage page)
    {
        var placed = new List<WidgetPlacement>();
        var widgets = page.Widgets.Select(widget =>
        {
            if (widget.Placement is not { } rect) return widget;
            if (placed.Any(rect.Overlaps)) return widget with { Placement = null };
            placed.Add(rect);
            return widget;
        }).ToArray();
        return page with { Widgets = widgets };
    }

    private static string? Validate(DisplayLayout value, bool allowLegacyOverlap = false)
    {
        if (value.Revision < 0 || value.Revision == int.MaxValue ||
            value.Pages is not { Length: >= 2 and <= MaxPages } || value.Pages.Any(page => page == null))
            return $"界面总数需要在 2 至 {MaxPages} 个之间。";
        var pageIds = new HashSet<string>(StringComparer.Ordinal);
        var widgetIds = new HashSet<Guid>();
        foreach (var page in value.Pages)
        {
            if (page.Id == null || !pageIds.Add(page.Id) || !DisplayName(page.Name) || !Color(page.Color) ||
                page.BackgroundMode is not ("fixed" or "album") || page.Widgets is not { Length: <= 8 } ||
                (BuiltIns.Contains(page.Id) ? page.Kind != page.Id :
                    page.Kind != "custom" || !Guid.TryParseExact(page.Id, "N", out _)))
                return "页面名称、背景颜色或布局无效。每页最多八个组件。";
            var placed = new List<WidgetPlacement>();
            foreach (var widget in page.Widgets)
            {
                if (widget == null || widget.Id == Guid.Empty || !widgetIds.Add(widget.Id) ||
                    !DisplayName(widget.Name) || !Size(widget.Size) || !Color(widget.Color))
                    return "组件的名称、尺寸、颜色或标识无效。";
                if (widget.Placement is { } rect)
                {
                    if (!rect.IsValid()) return "组件位置及尺寸必须在界面范围内。";
                    if (!allowLegacyOverlap && placed.Any(rect.Overlaps)) return "组件不能重叠，请调整位置或大小。";
                    placed.Add(rect);
                }
                var error = widget.Type switch
                {
                    "clock" or "date" or "music" => null,
                    "emoji" => Named(widget.Text, 32) ? null : "请输入最多 32 个字符的 Emoji。",
                    "image" or "gif" => (widget.MediaId == null || WidgetImages.ValidId(widget.MediaId, widget.Type)) &&
                        (widget.Fit is null or "contain" or "cover") ? null : "组件的图片或填充方式无效。",
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
                if (widget.Type is not ("image" or "gif") && (widget.MediaId != null || widget.Fit != null))
                    return "图片文件只能配置在图片或 GIF 组件中。";
            }
        }
        return Required.All(pageIds.Contains) ? null : "请保留歌词和硬件监控。";
    }

    internal static string? ValidateManifest(WidgetManifest? manifest)
    {
        if (manifest == null || manifest.Version is not (1 or 2) || !DisplayName(manifest.Name) ||
            !Size(manifest.Size) || !Color(manifest.Color))
            return "自定义组件的版本、名称、尺寸或颜色无效。";
        if (manifest.Version == 2) return WidgetProtocol.Validate(manifest);
        if (!manifest.IsV1) return "v1 仅支持模板、补充文字和硬件圆环。";
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
    private static bool DisplayName(string? text) => text is { Length: <= 24 };
    private static bool Size(string? value) => value is "small" or "medium" or "large";
    private static bool Color(string? value) => value is { Length: 7 } && ColorPattern.IsMatch(value);

    private static DisplayLayout Defaults() => new(0, false,
    [
        new("lyrics", "歌词", "lyrics", "#171923", []),
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
