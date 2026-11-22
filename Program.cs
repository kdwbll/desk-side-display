using System.Net;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;

const int displayPort = 8765;
const int controlPort = 8766;
const string controlUrl = "http://127.0.0.1:8766";
const int maxPhotoBytes = 8 * 1024 * 1024;
const int maxLyricOffsetMs = 10_000;
#if DESKSIDE_SINGLE_FILE
var packaged = true;
#else
var packaged = false;
#endif
var openControl = packaged || args.Contains("--open-control");
if (packaged && await OpenExistingControlAsync()) return;

var project = packaged ? AppContext.BaseDirectory : Directory.GetCurrentDirectory();
var installRoot = packaged ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DeskSideDisplay") : null;
var nearbyData = Path.Combine(project, ".data");
var data = installRoot is not null && !Directory.Exists(nearbyData) ? Path.Combine(installRoot, "data") : nearbyData;
using var adbDownload = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false });
var androidTools = new AndroidTools(project, installRoot, adbDownload);
var shortcutCapability = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    ContentRootPath = AppContext.BaseDirectory,
    Args = args.Where(arg => arg != "--open-control").ToArray()
});
builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);
builder.WebHost.ConfigureKestrel(options =>
{
    options.Listen(IPAddress.Loopback, displayPort);
    options.Listen(IPAddress.Loopback, controlPort);
    options.Limits.MaxRequestBodySize = maxPhotoBytes + 64 * 1024;
});
builder.Services.AddSingleton(new PanelSettings(data));
builder.Services.AddSingleton(service => new LyricAppearanceSettings(service.GetRequiredService<PanelSettings>().DataPath));
builder.Services.AddSingleton(service => new LyricsCatalog(service.GetRequiredService<PanelSettings>().DataPath));
builder.Services.AddSingleton(service => new DisplayPages(service.GetRequiredService<PanelSettings>().DataPath));
builder.Services.AddSingleton(service => new WidgetImages(service.GetRequiredService<PanelSettings>().DataPath));
builder.Services.AddSingleton<ClipboardHistory>();
builder.Services.AddSingleton(service => new WidgetSources(service.GetRequiredService<PanelSettings>().DataPath,
    service.GetRequiredService<ClipboardHistory>()));
builder.Services.AddHostedService<ClipboardFileHistoryPoller>();
builder.Services.AddSingleton<KeyboardShortcut>();
builder.Services.AddSingleton(new DesktopNotes(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory)));
builder.Services.AddSingleton<HardwareMetrics>();
builder.Services.AddSingleton<MusicPlayers>();
builder.Services.AddHostedService(service => service.GetRequiredService<MusicPlayers>());
builder.Services.AddSingleton(service => new UsbBridge(androidTools, displayPort, packaged,
    service.GetRequiredService<IHostApplicationLifetime>()));
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
var webFiles = packaged ? new EmbeddedWebFiles() : app.Environment.WebRootFileProvider;
app.UseStaticFiles(new StaticFileOptions { FileProvider = webFiles });

app.MapGet("/", (HttpContext context) =>
{
    var page = context.Connection.LocalPort == controlPort ? "control" : "display";
    var file = webFiles.GetFileInfo($"{page}/index.html");
    return file.Exists ? Results.Stream(file.CreateReadStream(), "text/html; charset=utf-8") : Results.NotFound();
});

if (packaged)
{
    app.MapPost("/api/usb/install", async (HttpContext context) =>
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
        timeout.CancelAfter(TimeSpan.FromSeconds(90));
        try
        {
            await androidTools.InstallAsync(timeout.Token);
            return Results.NoContent();
        }
        catch (Exception error) when (error is IOException or InvalidDataException or HttpRequestException or
            UnauthorizedAccessException or OperationCanceledException)
        {
            app.Logger.LogWarning(error, "Could not install Android Platform-Tools");
            return Error("下载失败，请重试，或按使用说明手动放置 Android Platform-Tools。", 502);
        }
    });

    app.MapPost("/api/exit", (HttpContext context, IHostApplicationLifetime lifetime) =>
    {
        context.Response.OnCompleted(() =>
        {
            lifetime.StopApplication();
            return Task.CompletedTask;
        });
        return Results.NoContent();
    });
}

app.MapGet("/api/state", (HttpContext context, MusicPlayers player, PanelSettings settings, DisplayPages pages,
    LyricsCatalog catalog, UsbBridge usb, LyricAppearanceSettings appearance) =>
{
    var (preferences, wallpaper, displayRevision) = settings.Read();
    var playback = player.Read();
    var (musicSource, state) = playback.Select(preferences.MusicSource);
    var availablePresets = pages.Read().Pages.Where(page => page.Kind is "clock" or "photo")
        .Select(page => page.Id).ToArray();
    var idle = preferences.Idle == "hardware" || availablePresets.Contains(preferences.Idle) ? preferences.Idle
        : availablePresets.Contains("clock") ? "clock" : availablePresets.FirstOrDefault() ?? "hardware";
    var selectedMode = preferences.Mode is "auto" or "lyrics" || availablePresets.Contains(preferences.Mode)
        ? preferences.Mode : "auto";
    var allowNeteaseText = musicSource == MusicPlayers.Netease && state.PositionMs == null;
    var labels = catalog.Read(state.Song, state.DurationMs, allowNeteaseText);
    var calibration = catalog.ReadCalibration(state.Song, labels, musicSource);
    var recentSong = state.Song != null &&
        (state.Playing || (state.Paused && DateTimeOffset.UtcNow - state.LastPlaying < TimeSpan.FromSeconds(15)));
    var mode = selectedMode == "auto" ? (recentSong ? "lyrics" : idle) : selectedMode;
    var age = state.SampledAt == 0 ? 0 : Math.Clamp(Stopwatch.GetElapsedTime(state.SampledAt).TotalMilliseconds, 0, 5_000);
    var duration = state.DurationMs ?? labels.DurationMs;
    var positionAtSample = state.PositionMs ?? (duration is > 0 ? state.EstimatedPositionMs : null);
    var positionEstimated = state.PositionMs == null && positionAtSample != null;
    var rate = positionEstimated ? 1 : state.Rate;
    double? position = positionAtSample == null ? null : Math.Min(
        duration ?? double.MaxValue, positionAtSample.Value + (state.Playing ? age * rate : 0));
    var staticLyrics = allowNeteaseText && position == null && labels.Lines.Length > 0;
    var lyricsStatus = state.Status == "choose-source" ? state.Status :
        staticLyrics ? "static-lyrics" :
        position == null && state.Song != null && (!allowNeteaseText || labels.Status != "searching")
            ? "no-timeline" : labels.Status;
    var control = context.Connection.LocalPort == controlPort ? new
    {
        preferences = preferences with { Mode = selectedMode, Idle = idle },
        musicSources = new[]
        {
            new { id = MusicPlayers.Apple, connected = playback.Apple.Session != null, playback.Apple.Playing },
            new { id = MusicPlayers.Netease, connected = playback.Netease.Session != null, playback.Netease.Playing }
        },
        availablePresets,
        usb = usb.Status,
        standalone = packaged,
        state.Status,
        state.CanToggle,
        state.CanPrevious,
        state.CanNext,
        defaultLyricOffsetMs = LyricsCatalog.DefaultLeadMs,
        lyricsStatus = staticLyrics ? "static-lyrics" : labels.Status
    } : null;
    return Results.Ok(new
    {
        mode,
        displayRevision,
        musicSource,
        lyricAppearance = appearance.Read().Appearance,
        song = state.Song,
        state.Playing,
        rate,
        playback = new { state.CanToggle, state.CanPrevious, state.CanNext },
        positionMs = position,
        positionEstimated,
        lyricsStatus,
        lyricTimingId = labels.TimingId,
        lyricOffsetMs = calibration.Offset,
        lyricTimingPoints = calibration.Points
            .Where(point => duration > point.AtMs).ToArray(),
        durationMs = duration,
        cover = state.Artwork == null ? null : $"/media/cover?v={state.Artwork.Version}",
        wallpaper = wallpaper == null ? null : $"/media/wallpaper?v={wallpaper.Version}",
        lines = staticLyrics ? labels.Lines.Select(line => new LyricLine(line.AtMs, line.Text)).ToArray()
            : position == null ? [] : labels.Lines,
        control
    });
});

app.MapGet("/api/pages", (HttpContext context, DisplayPages pages, UsbBridge usb, WidgetSources sources) =>
{
    var layout = pages.Read();
    var actionsEnabled = sources.Read().Actions;
    var capability = context.Connection.LocalPort == displayPort && (layout.ShortcutsEnabled || actionsEnabled) && usb.Status == "ready"
        ? shortcutCapability : null;
    var clientLayout = context.Connection.LocalPort == controlPort ? layout : layout with { WidgetLibrary = null };
    return Results.Ok(new { layout = clientLayout, maxPages = DisplayPages.MaxPages, shortcutCapability = capability,
        actionsEnabled, sourcesRevision = sources.Revision });
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

app.MapPost("/api/widgets/{id:guid}/action/{trigger}", async (Guid id, string trigger, uint? clipboardVersion, string? historyItem,
    string? source, HttpContext context, DisplayPages pages, WidgetSources sources, UsbBridge usb, MusicPlayers music,
    KeyboardShortcut keyboard, CancellationToken token) =>
{
    if (context.Connection.LocalPort != displayPort || usb.Status != "ready" || !sources.Read().Actions)
        return Results.StatusCode(403);
    var widget = pages.Read().Pages.SelectMany(page => page.Widgets)
        .FirstOrDefault(item => item.Id == id && item.Type == "custom" && item.Manifest?.Version == 2);
    var action = widget == null ? null : WidgetProtocol.Action(widget.Manifest!, trigger);
    if (action == null) return Results.NotFound();
    var error = await sources.Act(action, music, keyboard, clipboardVersion, historyItem, source, token);
    return error == null ? Results.NoContent() : Error(error, 409);
});

app.MapPost("/api/widgets/{id:guid}/media/{action}", async (Guid id, string action, string? source, HttpContext context,
    DisplayPages pages, WidgetSources sources, UsbBridge usb, MusicPlayers music, CancellationToken token) =>
{
    if (context.Connection.LocalPort != displayPort || usb.Status != "ready" || !sources.Read().Actions)
        return Results.StatusCode(403);
    if (action is not ("previous" or "toggle" or "next") ||
        !pages.Read().Pages.SelectMany(page => page.Widgets).Any(widget => widget.Id == id && widget.Type == "music"))
        return Results.NotFound();
    var error = await music.ControlAsync(action, source, token);
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

app.MapPost("/api/widgets/{id:guid}/open-note", (Guid id, HttpContext context, DisplayPages pages,
    UsbBridge usb, WidgetSources sources, DesktopNotes notes) =>
{
    if (context.Connection.LocalPort != displayPort || usb.Status != "ready" || !sources.Read().Actions)
        return Error("请在 Windows 面板允许组件动作，并通过 USB 连接。", 403);
    var widget = pages.Read().Pages.SelectMany(page => page.Widgets)
        .FirstOrDefault(item => item.Id == id && item.Type == "text");
    if (widget?.Text is not { } text) return Error("该便签组件已移除。", 404);
    var error = notes.CreateAndOpen(text);
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

app.MapGet("/media/cover", (string? v, MusicPlayers player) => ImageResult(player.Selected().State.Artwork, v));
app.MapGet("/media/wallpaper", (string? v, PanelSettings settings) => ImageResult(settings.Read().Wallpaper, v));
app.MapGet("/media/widgets/{id}", (string id, WidgetImages images) =>
    images.Find(id) is { } media ? Results.File(media.Path, media.Type) : Results.NotFound());

app.MapPost("/api/settings", async (HttpRequest request, PanelSettings settings, CancellationToken token) =>
{
    var preferences = await request.ReadFromJsonAsync<PanelPreferences>(token);
    return preferences != null && settings.Update(preferences)
        ? Results.NoContent() : Error("无效的显示模式。");
});

app.MapPost("/api/music-source", (MusicSourceRequest request, PanelSettings settings) =>
    settings.SetMusicSource(request.Source) ? Results.NoContent() : Error("无效的播放源。"));

app.MapPost("/api/playback/{action}", async (string action, string? source, MusicPlayers player, CancellationToken token) =>
{
    if (action is not ("previous" or "toggle" or "next")) return Results.NotFound();
    var error = await player.ControlAsync(action, source, token);
    return error == null ? Results.NoContent() : Error(error, 409);
});

app.MapPost("/api/wallpaper", async (HttpRequest request, PanelSettings settings, CancellationToken token) =>
{
    var (image, error) = await ReadUploadedImage(request, token);
    if (image == null) return Error(error!);
    settings.SetWallpaper(image);
    return Results.NoContent();
});

app.MapPost("/api/widget-images/{kind}", async (string kind, HttpRequest request, WidgetImages images,
    CancellationToken token) =>
{
    if (kind is not ("image" or "gif")) return Results.NotFound();
    var (image, error) = await ReadUploadedImage(request, token);
    if (image == null) return Error(error!);
    if (!WidgetImages.Supports(kind, image.Type))
        return Error(kind == "gif" ? "请选择 GIF 文件。" : "请选择 JPG、PNG 或 WebP 图片。");
    return Results.Ok(new { id = images.Save(image) });
});

app.MapPost("/api/lyrics/offset", async (HttpRequest request, MusicPlayers player, LyricsCatalog catalog, CancellationToken token) =>
{
    var offset = await request.ReadFromJsonAsync<OffsetRequest>(token);
    var (musicSource, state) = player.Selected();
    var current = state.Song;
    if (offset == null || offset.OffsetMs is < -maxLyricOffsetMs or > maxLyricOffsetMs)
        return Error("歌词校准范围是提前或延后 10 秒。");
    if (current == null || current.Id != offset.Song || offset.Source != null && musicSource != offset.Source)
        return Error("歌曲已切换，请重新校准。", 409);
    if (state.PositionMs == null) return Error("校准需要播放器提供实际进度。", 409);
    var source = catalog.Read(current, state.DurationMs);
    if (source.Lines.Length == 0 || offset.TimingId != null && offset.TimingId != source.TimingId)
        return Error("歌词时间轴已更新，请重新校准。", 409);
    if (offset.AtMs is int at)
    {
        if (state.DurationMs is not double duration || duration > int.MaxValue ||
            !catalog.SetTimingPoint(current, source, musicSource, new LyricTimingPoint(at, offset.OffsetMs), (int)duration))
            return Error("这个点离相邻校准点或歌曲边界太近，请稍移位置或减小调整。");
    }
    else catalog.SetOffset(current, source, musicSource, offset.OffsetMs);
    return Results.NoContent();
});

app.MapPost("/api/lyrics", async (HttpRequest request, MusicPlayers player, LyricsCatalog catalog, CancellationToken token) =>
{
    var form = await request.ReadFormAsync(token);
    var file = form.Files.GetFile("file");
    var (musicSource, state) = player.Selected();
    var current = state.Song;
    if (current == null || current.Id != form["song"].ToString() ||
        form.TryGetValue("source", out var source) && musicSource != source.ToString())
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

try
{
    await app.StartAsync();
}
catch (IOException) when (packaged)
{
    if (!await OpenExistingControlAsync())
        System.Windows.Forms.MessageBox.Show("无法启动。请检查本机端口 8765 和 8766 是否被其他程序占用。", "桌面副屏");
    return;
}
Console.WriteLine($"Windows 控制面板  {controlUrl}/");
Console.WriteLine($"Android USB 页面  http://127.0.0.1:{displayPort}/");
if (openControl) OpenControl();
await app.WaitForShutdownAsync();

static void OpenControl() => Process.Start(new ProcessStartInfo(controlUrl + "/") { UseShellExecute = true });

static async Task<bool> OpenExistingControlAsync()
{
    using var probe = new HttpClient(new HttpClientHandler { UseProxy = false, AllowAutoRedirect = false })
    {
        Timeout = TimeSpan.FromSeconds(1)
    };
    try
    {
        using var response = await probe.GetAsync(controlUrl + "/");
        if (!response.IsSuccessStatusCode) return false;
        var page = await response.Content.ReadAsStringAsync();
        if (!page.Contains("/control/control.js", StringComparison.Ordinal)) return false;
        OpenControl();
        return true;
    }
    catch (Exception error) when (error is HttpRequestException or OperationCanceledException)
    {
        return false;
    }
}

static IResult ImageResult(ImageBytes? image, string? version) => image != null && version == image.Version
    ? Results.File(image.Bytes, image.Type) : Results.NotFound();

static async Task<(ImageBytes? Image, string? Error)> ReadUploadedImage(HttpRequest request, CancellationToken token)
{
    var file = request.HasFormContentType ? (await request.ReadFormAsync(token)).Files.GetFile("file") : null;
    if (file == null || file.Length == 0 || file.Length > maxPhotoBytes)
        return (null, "请选择 8 MB 以内的图片。");
    using var output = new MemoryStream((int)file.Length);
    await file.CopyToAsync(output, token);
    var image = ImageBytes.Create(output.ToArray());
    return (image, image == null ? "请选择 JPG、PNG、WebP 或 GIF。" : null);
}

static IResult Error(string message, int code = 400) =>
    Results.Text(message, "text/plain; charset=utf-8", statusCode: code);

sealed record MusicSourceRequest(string Source);
sealed record OffsetRequest(string Song, int OffsetMs, int? AtMs = null, string? TimingId = null, string? Source = null);
