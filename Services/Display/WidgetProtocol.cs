using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

sealed record WidgetManifest(int Version, string Name, string Size, string Color, string? Template,
    string? Detail = null, string? Gauge = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Widget = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Kind = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? MigratedFrom = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? RefreshMs = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string[]? Permissions = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] WidgetBlock[]? Blocks = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] WidgetLayout? Layout = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] WidgetTheme? Theme = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] WidgetMotion? Motion = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] WidgetFormat? Format = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Dictionary<string, WidgetAction>? Actions = null)
{
    [JsonExtensionData] public Dictionary<string, JsonElement>? Extensions { get; init; }
    [JsonIgnore] public bool IsV1 => Widget == null && Kind == null && MigratedFrom == null && RefreshMs == null &&
        Permissions == null && Blocks == null && Layout == null && Theme == null && Motion == null &&
        Format == null && Actions == null && Extensions is not { Count: > 0 };
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
sealed record WidgetBlock(string Kind, string? Source = null, string? Text = null, string? Label = null,
    string? Icon = null, string? Fallback = null, string? ValueType = null, int? MaxLength = null,
    int? Span = null, int? Rows = null, string? Align = null, double? FontScale = null, double? Min = null,
    double? Max = null, WidgetFormat? Format = null, WidgetAction? Action = null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
sealed record WidgetLayout(int? Columns = null, int? Gap = null, int? Padding = null, string? Align = null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
sealed record WidgetTheme(WidgetPalette? Light = null, WidgetPalette? Dark = null, bool HighContrast = false);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
sealed record WidgetPalette(string? Background = null, string? Foreground = null, string? Accent = null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
sealed record WidgetMotion(string Type, int? DurationMs = null, string? Easing = null, bool Loop = false);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
sealed record WidgetFormat(string? Locale = null, string? TimeZone = null, string? HourCycle = null,
    string? DateStyle = null, int? Digits = null, string? Unit = null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
sealed record WidgetAction(string Type, string? Value = null);

static class WidgetProtocol
{
    public const string Reference = @"[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9_-]+)*";
    private static readonly Regex ReferencePattern = new($"\\A{Reference}\\z", RegexOptions.CultureInvariant);
    private static readonly Regex Tokens = new(@"\{\{(" + Reference + @")\}\}", RegexOptions.CultureInvariant);
    private static readonly Regex Color = new(@"\A#[0-9a-fA-F]{6}\z", RegexOptions.CultureInvariant);
    internal static readonly Dictionary<string, string> BuiltInTypes = new(StringComparer.Ordinal)
    {
        ["time"] = "text", ["date"] = "text", ["time.second"] = "number", ["time.minute"] = "number",
        ["time.hour"] = "number", ["time.dayprogress"] = "number",
        ["music.title"] = "text", ["music.artist"] = "text", ["music.progress"] = "text",
        ["music.duration"] = "text", ["music.playing"] = "boolean",
        ["music.positionms"] = "number", ["music.durationms"] = "number",
        ["media.cover"] = "image", ["media.wallpaper"] = "image", ["gpu.name"] = "text",
        ["cpu.usage"] = "number", ["cpu.temperature"] = "number", ["gpu.usage"] = "number",
        ["gpu.temperature"] = "number", ["gpu.power"] = "number", ["gpu.fan"] = "number",
        ["gpu.clock"] = "number", ["ram.used"] = "number", ["ram.total"] = "number", ["ram.usage"] = "number",
        ["clipboard.text"] = "text", ["clipboard.image"] = "image", ["clipboard.files"] = "files",
        ["notification.title"] = "text", ["notification.body"] = "text", ["notification.app"] = "text",
        ["notification.count"] = "number", ["window.title"] = "text", ["window.process"] = "text",
        ["volume.percent"] = "number", ["volume.muted"] = "boolean", ["power.percent"] = "number",
        ["power.plugged"] = "boolean", ["power.charging"] = "boolean", ["network.online"] = "boolean",
        ["network.name"] = "text", ["network.down"] = "number", ["network.up"] = "number",
        ["weather.temperature"] = "number", ["weather.code"] = "number", ["weather.wind"] = "number"
    };
    internal static readonly string[] Permissions = ["clipboard", "notifications", "window", "weather", "interfaces", "actions"];
    internal static readonly string[] ServerGroups =
        ["clipboard", "notification", "window", "volume", "power", "network", "weather", "api"];
    private static readonly string[] Triggers = ["tap", "longPress", "swipeLeft", "swipeRight"];

    public static string? Validate(WidgetManifest manifest)
    {
        if (TooLong(manifest.Widget, 64) || TooLong(manifest.Kind, 40) || manifest.MigratedFrom is not (null or 1) ||
            manifest.RefreshMs is < 500 or > 60000)
            return "组件标识或刷新间隔无效。刷新间隔为 500–60000 毫秒。";
        if (manifest.Extensions is { } extensions && (extensions.Count > 12 || extensions.Any(item =>
            !item.Key.StartsWith("x-", StringComparison.Ordinal) || item.Key.Length > 60 ||
            !ReferencePattern.IsMatch(item.Key) || item.Value.GetRawText().Length > 2048)))
            return "扩展字段必须使用 x- 前缀，每项最多 2048 字符。";
        if (manifest.Permissions is { } permits && (permits.Length > Permissions.Length ||
            permits.Distinct().Count() != permits.Length || permits.Any(item => !Permissions.Contains(item))))
            return "组件权限列表无效。";
        if (!ValidLayout(manifest.Layout) || !ValidTheme(manifest.Theme) ||
            !ValidMotion(manifest.Motion) || !ValidFormat(manifest.Format))
            return "组件的布局、主题、动效或格式无效。";
        if (manifest.Blocks is { Length: > 12 } || (manifest.Blocks is not { Length: > 0 } && string.IsNullOrWhiteSpace(manifest.Template)))
            return "请提供模板或 1–12 个布局块。";
        if (!ValidTemplate(manifest.Template, 260) || !ValidTemplate(manifest.Detail, 260) ||
            (manifest.Gauge != null && !Numeric(manifest.Gauge)))
            return "模板或圆环绑定的数据标记无效。";
        foreach (var block in manifest.Blocks ?? [])
        {
            if (block == null || !ValidBlock(block, manifest.Layout?.Columns ?? 2))
                return "布局块无效。请检查块类型、数据类型、尺寸和绑定。";
        }
        foreach (var source in References(manifest))
        {
            var permission = RequiredPermission(source);
            if (permission != null && manifest.Permissions?.Contains(permission) != true)
                return $"数据 {source} 需要声明 {permission} 权限。";
        }
        if (manifest.Actions?.Any(item => !Triggers.Contains(item.Key) || !ValidAction(item.Value)) == true ||
            (Actions(manifest).Any() && manifest.Permissions?.Contains("actions") != true))
            return "动作类型无效，或缺少 actions 权限声明。";
        return null;
    }

    public static IEnumerable<string> References(WidgetManifest manifest)
    {
        var texts = new List<string?> { manifest.Template, manifest.Detail };
        if (manifest.Gauge != null) yield return manifest.Gauge;
        foreach (var block in manifest.Blocks ?? [])
        {
            if (block.Source != null) yield return block.Source;
            texts.Add(block.Text);
            texts.Add(block.Label);
        }
        foreach (var text in texts.Where(item => item != null))
            foreach (Match match in Tokens.Matches(text!))
                yield return match.Groups[1].Value;
    }

    public static string Group(string reference) => reference.Split('.', 2)[0];

    public static string? RequiredPermission(string source) => Group(source) switch
    {
        "clipboard" => "clipboard", "notification" => "notifications", "window" => "window",
        "weather" => "weather", "api" => "interfaces", _ => null
    };

    public static WidgetAction? Action(WidgetManifest manifest, string trigger)
    {
        if (trigger.StartsWith("button-", StringComparison.Ordinal) &&
            int.TryParse(trigger.AsSpan(7), out var index) && index >= 0 && index < (manifest.Blocks?.Length ?? 0))
            return manifest.Blocks![index].Action;
        return manifest.Actions?.GetValueOrDefault(trigger);
    }

    private static IEnumerable<WidgetAction> Actions(WidgetManifest manifest) =>
        (manifest.Actions?.Values.AsEnumerable() ?? []).Concat((manifest.Blocks ?? [])
            .Where(block => block.Action != null).Select(block => block.Action!));

    private static bool ValidBlock(WidgetBlock block, int columns)
    {
        if (block.Kind is not ("text" or "value" or "image" or "files" or "ring" or "progress" or "clock" or "button" or "icon") ||
            !ValidTemplate(block.Text, 260) || !ValidTemplate(block.Label, 100) || TooLong(block.Fallback, 80) ||
            TooLong(block.Icon, 30) || block.ValueType is not (null or "text" or "number" or "boolean" or "image" or "files") ||
            block.MaxLength is < 1 or > 2000 || block.Span is < 1 || block.Span > columns ||
            block.Rows is < 1 or > 4 || !Align(block.Align) || block.FontScale is < .55 or > 2.4 ||
            !ValidFormat(block.Format) || (block.Min is double min && !double.IsFinite(min)) ||
            (block.Max is double max && !double.IsFinite(max)) ||
            (block.Min != null && block.Max != null && block.Min >= block.Max) ||
            (block.Source != null && !Known(block.Source)) || (block.Kind != "button" && block.Action != null))
            return false;
        var expected = block.Kind switch
        {
            "image" => "image", "files" => "files", "ring" or "progress" => "number", _ => block.ValueType
        };
        if (block.Source != null && BuiltInTypes.TryGetValue(block.Source, out var type) && expected != null && expected != type)
            return false;
        return block.Kind switch
        {
            "image" or "files" or "ring" or "progress" or "value" => block.Source != null,
            "button" => ValidAction(block.Action) && (!string.IsNullOrWhiteSpace(block.Text) || !string.IsNullOrWhiteSpace(block.Label)),
            _ => true
        };
    }

    private static bool ValidAction(WidgetAction? action) => action?.Type switch
    {
        "music.previous" or "music.toggle" or "music.next" or "refresh" => action.Value == null,
        "copy" => !string.IsNullOrWhiteSpace(action.Value) && action.Value.Length <= 1000,
        "open-app" => action.Value is { Length: <= 32 } && ReferencePattern.IsMatch(action.Value) && !action.Value.Contains('.'),
        _ => false
    };

    private static bool ValidTemplate(string? value, int limit)
    {
        if (value == null) return true;
        if (value.Length > limit) return false;
        var rest = Tokens.Replace(value, "");
        return !rest.Contains("{{") && !rest.Contains("}}") && Tokens.Matches(value).All(match => Known(match.Groups[1].Value));
    }

    private static bool Known(string source) => BuiltInTypes.ContainsKey(source) ||
        (source.Length <= 96 && ReferencePattern.IsMatch(source) &&
            source.StartsWith("api.", StringComparison.Ordinal) && source.Count(c => c == '.') >= 2);
    private static bool Numeric(string source) => Known(source) &&
        (!BuiltInTypes.TryGetValue(source, out var type) || type == "number");
    private static bool Align(string? align) => align is null or "start" or "center" or "end";
    private static bool ValidLayout(WidgetLayout? layout) => layout == null ||
        (layout.Columns is not (< 1 or > 4) && layout.Gap is not (< 0 or > 24) &&
         layout.Padding is not (< 0 or > 28) && Align(layout.Align));
    private static bool ValidTheme(WidgetTheme? theme) => theme == null || (Palette(theme.Light) && Palette(theme.Dark));
    private static bool Palette(WidgetPalette? palette) => palette == null ||
        new[] { palette.Background, palette.Foreground, palette.Accent }.All(value =>
            value == null || (value.Length == 7 && Color.IsMatch(value)));
    private static bool ValidMotion(WidgetMotion? motion) => motion == null ||
        ((motion.Type is "fade" or "pulse" or "slide" or "bounce") &&
         motion.DurationMs is not (< 120 or > 10000) &&
         (motion.Easing is null or "linear" or "ease-in" or "ease-out" or "ease-in-out"));
    private static bool ValidFormat(WidgetFormat? format)
    {
        if (format == null) return true;
        if (TooLong(format.Locale, 35) || TooLong(format.TimeZone, 80) || TooLong(format.Unit, 12) ||
            format.HourCycle is not (null or "h12" or "h23") || format.DateStyle is not (null or "short" or "medium" or "long" or "full") ||
            format.Digits is < 0 or > 4)
            return false;
        try
        {
            if (format.Locale != null) _ = System.Globalization.CultureInfo.GetCultureInfo(format.Locale);
            return format.TimeZone == null || TimeZoneInfo.TryConvertIanaIdToWindowsId(format.TimeZone, out _);
        }
        catch (ArgumentException) { return false; }
    }

    private static bool TooLong(string? value, int limit) => value != null && value.Length > limit;
}
