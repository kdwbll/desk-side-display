using System.Net;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;

const int displayPort = 8765;
const int controlPort = 8766;
const string controlUrl = "http://127.0.0.1:8766";
const int maxPhotoBytes = 8 * 1024 * 1024;
const int maxLyricOffsetMs = 10_000;
var shortcutCapability = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    ContentRootPath = AppContext.BaseDirectory,
    Args = args.Where(arg => arg != "--open-control").ToArray()
});
builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);
var project = Directory.GetCurrentDirectory();
builder.WebHost.ConfigureKestrel(options =>
{
    options.Listen(IPAddress.Loopback, displayPort);
    options.Listen(IPAddress.Loopback, controlPort);
    options.Limits.MaxRequestBodySize = maxPhotoBytes + 64 * 1024;
});
builder.Services.AddSingleton(new PanelSettings(Path.Combine(project, ".data")));
builder.Services.AddSingleton(service => new LyricAppearanceSettings(service.GetRequiredService<PanelSettings>().DataPath));
builder.Services.AddSingleton(service => new LyricsCatalog(service.GetRequiredService<PanelSettings>().DataPath));
builder.Services.AddSingleton(service => new DisplayPages(service.GetRequiredService<PanelSettings>().DataPath));
builder.Services.AddSingleton(service => new WidgetSources(service.GetRequiredService<PanelSettings>().DataPath));
builder.Services.AddSingleton<KeyboardShortcut>();
builder.Services.AddSingleton<HardwareMetrics>();
builder.Services.AddSingleton<AppleMusic>();
builder.Services.AddHostedService(service => service.GetRequiredService<AppleMusic>());
builder.Services.AddSingleton(new UsbBridge(Path.Combine(project, ".tools", "platform-tools", "adb.exe"), displayPort));
builder.Services.AddHostedService(service => service.GetRequiredService<UsbBridge>());

var app = builder.Build();
var widgetSources = app.Services.GetRequiredService<WidgetSources>();
app.Use(async (context, next) =>
{
    var port = context.Connection.LocalPort;
    if (context.Request.Host.Port != port || context.Request.Host.Host is not ("127.0.0.1" or "localhost"))
    {
        context.Response.StatusCode = 400;
        return;
    }

    if (context.Request.Method == HttpMethods.Post)
    {
        var localControl = port == controlPort && context.Request.Headers["X-DeskSide-Control"] == "1";
        var phoneShortcut = port == displayPort && context.Request.Path.StartsWithSegments("/api/widgets") &&
            context.Request.Headers["X-DeskSide-Shortcut"] == shortcutCapability;
        var notificationFeed = port == controlPort && context.Request.Path == "/api/widget-notifications" &&
            context.Request.Headers["X-DeskSide-Feed"] == widgetSources.FeedKey;
        if (!notificationFeed && ((!localControl && !phoneShortcut) || context.Request.Headers.Origin != $"http://{context.Request.Host}"))
        {
            context.Response.StatusCode = 403;
            return;
        }
    }
    if ((context.Request.Path.Value ?? "").EndsWith(".html", StringComparison.OrdinalIgnoreCase))
    {
        context.Response.StatusCode = 404;
        return;
    }

    context.Response.Headers.CacheControl = "no-store";
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers.ContentSecurityPolicy =
        "default-src 'self'; img-src 'self' blob: data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
    await next(context);
});
app.UseStaticFiles();

app.MapGet("/", (HttpContext context) =>
{
    var page = context.Connection.LocalPort == controlPort ? "control" : "display";
    return Results.File(Path.Combine(app.Environment.WebRootPath, page, "index.html"), "text/html; charset=utf-8");
});

app.MapGet("/api/state", (HttpContext context, AppleMusic player, PanelSettings settings, LyricsCatalog catalog,
    UsbBridge usb, LyricAppearanceSettings appearance) =>
{
    var state = player.Read();
    var (preferences, wallpaper, displayRevision) = settings.Read();
    var labels = catalog.Read(state.Song, state.DurationMs);
    var calibration = catalog.ReadCalibration(state.Song, labels);
    var recentSong = state.Song != null &&
        (state.Playing || (state.Paused && DateTimeOffset.UtcNow - state.LastPlaying < TimeSpan.FromSeconds(15)));
    var mode = preferences.Mode == "auto" ? (recentSong ? "lyrics" : preferences.Idle) : preferences.Mode;
    var age = Math.Clamp((DateTimeOffset.UtcNow - state.SampledAt).TotalMilliseconds, 0, 4_000);
    double? position = state.PositionMs == null ? null : Math.Min(
        state.DurationMs ?? double.MaxValue, state.PositionMs.Value + (state.Playing ? age * state.Rate : 0));
    var control = context.Connection.LocalPort == controlPort ? new
    {
        preferences,
        usb = usb.Status,
        state.Status,
        state.CanToggle,
        state.CanPrevious,
        state.CanNext,
        defaultLyricOffsetMs = LyricsCatalog.DefaultLeadMs,
        lyricsStatus = labels.Status
    } : null;
    return Results.Ok(new
    {
        mode,
        displayRevision,
        lyricAppearance = appearance.Read().Appearance,
        song = state.Song,
        state.Playing,
        state.Rate,
        positionMs = position,
        lyricsStatus = position == null && state.Song != null ? "no-timeline" : labels.Status,
        lyricTimingId = labels.TimingId,
        lyricOffsetMs = calibration.Offset,
        lyricTimingPoints = calibration.Points
            .Where(point => state.DurationMs > point.AtMs).ToArray(),
        state.DurationMs,
        cover = state.Artwork == null ? null : $"/media/cover?v={state.Artwork.Version}",
        wallpaper = wallpaper == null ? null : $"/media/wallpaper?v={wallpaper.Version}",
        lines = position == null ? [] : labels.Lines,
        control
    });
});

app.MapGet("/api/pages", (HttpContext context, DisplayPages pages, UsbBridge usb, WidgetSources sources) =>
{
    var layout = pages.Read();
    var actionsEnabled = sources.Read().Actions;
    var capability = context.Connection.LocalPort == displayPort && (layout.ShortcutsEnabled || actionsEnabled) && usb.Status == "ready"
        ? shortcutCapability : null;
    return Results.Ok(new { layout, shortcutCapability = capability, actionsEnabled, sourcesRevision = sources.Revision });
});

app.MapPost("/api/pages", (DisplayLayout proposed, DisplayPages pages) =>
{
    var result = pages.Save(proposed);
    return result.Value != null ? Results.Ok(result.Value) :
        Error(result.Error!, result.Conflict ? 409 : 400);
});

app.MapPost("/api/pages/validate-widget", (WidgetManifest manifest) =>
{
    var error = DisplayPages.ValidateManifest(manifest);
    return error == null ? Results.Ok(manifest) : Error(error);
});

app.MapGet("/api/metrics", async (HardwareMetrics metrics, CancellationToken token) =>
    Results.Ok(await metrics.ReadAsync(token)));

app.MapGet("/api/widget-sources", (HttpContext context, WidgetSources sources) =>
{
    if (context.Connection.LocalPort != controlPort) return Results.NotFound();
    var config = sources.Read();
    return Results.Ok(new { config, notificationKey = config.Notifications ? sources.FeedKey : null });
});

app.MapPost("/api/widget-sources", (WidgetSourceConfig config, WidgetSources sources) =>
{
    var error = sources.Save(config);
    return error == null ? Results.Ok(new { config, notificationKey = config.Notifications ? sources.FeedKey : null }) : Error(error);
});

app.MapPost("/api/widget-notifications", (WidgetNotification message, HttpContext context, WidgetSources sources) =>
{
    if (context.Connection.LocalPort != controlPort || context.Request.Headers["X-DeskSide-Feed"] != sources.FeedKey)
        return Results.StatusCode(403);
    var error = sources.Publish(message);
    return error == null ? Results.NoContent() : Error(error);
});

app.MapGet("/api/widget-data", async (string page, HttpContext context, DisplayPages pages, WidgetSources sources,
    UsbBridge usb, CancellationToken token) =>
{
    if (context.Connection.LocalPort != displayPort || usb.Status != "ready") return Results.StatusCode(403);
    var displayPage = pages.Read().Pages.FirstOrDefault(item => item.Id == page);
    return displayPage == null ? Results.NotFound() : Results.Ok(await sources.Sample(displayPage, token));
});

app.MapPost("/api/widgets/{id:guid}/action/{trigger}", async (Guid id, string trigger, uint? clipboardVersion,
    HttpContext context, DisplayPages pages, WidgetSources sources, UsbBridge usb, AppleMusic music,
    KeyboardShortcut keyboard) =>
{
    if (context.Connection.LocalPort != displayPort || usb.Status != "ready" || !sources.Read().Actions)
        return Results.StatusCode(403);
    var widget = pages.Read().Pages.SelectMany(page => page.Widgets)
        .FirstOrDefault(item => item.Id == id && item.Type == "custom" && item.Manifest?.Version == 2);
    var action = widget == null ? null : WidgetProtocol.Action(widget.Manifest!, trigger);
    if (action == null) return Results.NotFound();
    var error = await sources.Act(action, music, keyboard, clipboardVersion);
    return error == null ? Results.NoContent() : Error(error, 409);
});

app.MapPost("/api/widgets/{id:guid}/press", (Guid id, HttpContext context, DisplayPages pages,
    UsbBridge usb, KeyboardShortcut keyboard) =>
{
    var layout = pages.Read();
    if (context.Connection.LocalPort != displayPort || usb.Status != "ready" || !layout.ShortcutsEnabled)
        return Error("请在 Windows 面板启用手机快捷键并通过 USB 连接。", 403);
    var widget = layout.Pages.SelectMany(page => page.Widgets)
        .FirstOrDefault(widget => widget.Id == id && widget.Type == "shortcut");
    if (widget == null) return Error("该快捷键组件已移除。", 404);
    var error = keyboard.Press(widget.Keys);
    return error == null ? Results.NoContent() : Error(error, 409);
});

app.MapGet("/api/appearance", (HttpContext context, LyricAppearanceSettings settings) =>
    context.Connection.LocalPort == controlPort ? Results.Ok(settings.Read()) : Results.NotFound());

app.MapPost("/api/appearance", (LyricAppearance appearance, LyricAppearanceSettings settings) =>
    appearance.IsValid() ? Results.Ok(settings.SetAppearance(appearance)) : Error("外观参数超出范围。"));

app.MapPost("/api/appearance/presets", (LyricPresetRequest request, LyricAppearanceSettings settings) =>
{
    var result = settings.SavePreset(request.Id, request.Name, request.Appearance);
    return result.State == null ? Error(result.Error!, 409) : Results.Ok(result.State);
});

app.MapPost("/api/appearance/presets/{id:guid}/{action}",
    (Guid id, string action, LyricAppearanceSettings settings) =>
{
    if (action is not ("apply" or "delete")) return Results.NotFound();
    var result = action == "apply" ? settings.ApplyPreset(id) : settings.DeletePreset(id);
    return result == null ? Error("这组预设已被删除。", 404) : Results.Ok(result);
});

app.MapGet("/media/cover", (string? v, AppleMusic player) => ImageResult(player.Read().Artwork, v));
app.MapGet("/media/wallpaper", (string? v, PanelSettings settings) => ImageResult(settings.Read().Wallpaper, v));

app.MapPost("/api/settings", async (HttpRequest request, PanelSettings settings, CancellationToken token) =>
{
    var preferences = await request.ReadFromJsonAsync<PanelPreferences>(token);
    return preferences != null && settings.Update(preferences)
        ? Results.NoContent() : Error("无效的显示模式。");
});

app.MapPost("/api/playback/{action}", async (string action, AppleMusic player) =>
{
    if (action is not ("previous" or "toggle" or "next")) return Results.NotFound();
    return await player.ControlAsync(action) ? Results.NoContent()
        : Error("Apple Music 当前无法执行这个操作。请先在桌面客户端播放一首歌。", 409);
});

app.MapPost("/api/wallpaper", async (HttpRequest request, PanelSettings settings, CancellationToken token) =>
{
    var file = (await request.ReadFormAsync(token)).Files.GetFile("file");
    if (file == null || file.Length == 0 || file.Length > maxPhotoBytes)
        return Error("请选择 8 MB 以内的图片。");

    using var output = new MemoryStream((int)file.Length);
    await file.CopyToAsync(output, token);
    var image = ImageBytes.Create(output.ToArray());
    if (image == null) return Error("请选择 JPG、PNG、WebP 或 GIF。");
    settings.SetWallpaper(image);
    return Results.NoContent();
});

app.MapPost("/api/lyrics/offset", async (HttpRequest request, AppleMusic player, LyricsCatalog catalog, CancellationToken token) =>
{
    var offset = await request.ReadFromJsonAsync<OffsetRequest>(token);
    var state = player.Read();
    var current = state.Song;
    if (offset == null || offset.OffsetMs is < -maxLyricOffsetMs or > maxLyricOffsetMs)
        return Error("歌词校准范围是提前或延后 10 秒。");
    if (current == null || current.Id != offset.Song)
        return Error("歌曲已切换，请重新校准。", 409);
    var source = catalog.Read(current, state.DurationMs);
    if (source.Lines.Length == 0 || offset.TimingId != null && offset.TimingId != source.TimingId)
        return Error("歌词时间轴已更新，请重新校准。", 409);
    if (offset.AtMs is int at)
    {
        if (state.DurationMs is not double duration || duration > int.MaxValue ||
            !catalog.SetTimingPoint(current, source, new LyricTimingPoint(at, offset.OffsetMs), (int)duration))
            return Error("这个点离相邻校准点或歌曲边界太近，请稍移位置或减小调整。");
    }
    else catalog.SetOffset(current, source, offset.OffsetMs);
    return Results.NoContent();
});

app.MapPost("/api/lyrics", async (HttpRequest request, AppleMusic player, LyricsCatalog catalog, CancellationToken token) =>
{
    var form = await request.ReadFormAsync(token);
    var file = form.Files.GetFile("file");
    var current = player.Read().Song;
    if (current == null || current.Id != form["song"].ToString())
        return Error("歌曲已切换。请确认正在播放的歌曲后重试。", 409);
    if (file == null || file.Length == 0 || file.Length > 256 * 1024)
        return Error("请选择 256 KB 以内的 LRC 或 TTML 文件。");

    using var reader = new StreamReader(file.OpenReadStream(), new UTF8Encoding(false, true));
    string contents;
    try { contents = await reader.ReadToEndAsync(token); }
    catch (DecoderFallbackException) { return Error("请先把歌词文件保存为 UTF-8 编码。"); }
    return catalog.SetLocal(current, contents) ? Results.NoContent()
        : Error("文件中没有可读的时间戳歌词。");
});

await app.StartAsync();
Console.WriteLine($"Windows 控制面板  {controlUrl}/");
Console.WriteLine($"Android USB 页面  http://127.0.0.1:{displayPort}/");
if (args.Contains("--open-control"))
    Process.Start(new ProcessStartInfo(controlUrl + "/") { UseShellExecute = true });
await app.WaitForShutdownAsync();

static IResult ImageResult(ImageBytes? image, string? version) => image != null && version == image.Version
    ? Results.File(image.Bytes, image.Type) : Results.NotFound();

static IResult Error(string message, int code = 400) =>
    Results.Text(message, "text/plain; charset=utf-8", statusCode: code);

sealed record OffsetRequest(string Song, int OffsetMs, int? AtMs = null, string? TimingId = null);
