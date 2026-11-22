using System.Runtime.InteropServices;
using Windows.Media.Control;

using MediaManager = Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager;
using MediaSession = Windows.Media.Control.GlobalSystemMediaTransportControlsSession;
using PlaybackStatus = Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus;

sealed record MusicPlayback(MusicState Apple, MusicState Netease)
{
    public (string? Source, MusicState State) Select(string preference)
    {
        if (preference == MusicPlayers.Apple) return (MusicPlayers.Apple, Apple);
        if (preference == MusicPlayers.Netease) return (MusicPlayers.Netease, Netease);
        if (Apple.Playing && Netease.Playing) return (null, new MusicState(Status: "choose-source"));
        if (Apple.Playing) return (MusicPlayers.Apple, Apple);
        if (Netease.Playing) return (MusicPlayers.Netease, Netease);
        if (Netease.Song != null && (Apple.Song == null || Netease.LastPlaying > Apple.LastPlaying))
            return (MusicPlayers.Netease, Netease);
        if (Apple.Song != null || Apple.Session != null) return (MusicPlayers.Apple, Apple);
        if (Netease.Session != null) return (MusicPlayers.Netease, Netease);
        return (null, Apple.Status == "error" || Netease.Status == "error" ? new MusicState(Status: "error") : Apple);
    }
}

sealed class MusicPlayers(PanelSettings settings, ILogger<MusicPlayers> logger) : BackgroundService
{
    public const string Auto = "auto";
    public const string Apple = "apple";
    public const string Netease = "netease";
    private MusicPlayback playback = new(new MusicState(), new MusicState());

    public MusicPlayback Read() => Volatile.Read(ref playback);

    public (string? Source, MusicState State) Selected() => Read().Select(settings.Read().Preferences.MusicSource);

    public static string? Identify(string appId)
    {
        var app = appId[(appId.LastIndexOfAny(['/', '\\']) + 1)..].Split('!', 2)[0];
        if (app.StartsWith("AppleInc.AppleMusicWin_", StringComparison.OrdinalIgnoreCase) ||
            app.Equals("AppleMusic.exe", StringComparison.OrdinalIgnoreCase)) return Apple;
        if (app.StartsWith("NetEase.CloudMusic_", StringComparison.OrdinalIgnoreCase) ||
            app.Equals("NetEase.CloudMusic", StringComparison.OrdinalIgnoreCase) ||
            app.Equals("com.netease.cloudmusic", StringComparison.OrdinalIgnoreCase) ||
            app.Equals("cloudmusic.exe", StringComparison.OrdinalIgnoreCase) ||
            app.Equals("cloudmusic", StringComparison.OrdinalIgnoreCase)) return Netease;
        return null;
    }

    protected override async Task ExecuteAsync(CancellationToken token)
    {
        var apple = new MusicSession(Apple, logger);
        var netease = new MusicSession(Netease, logger);
        MediaManager? manager = null;
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(180));
        do
        {
            try
            {
                manager ??= await MediaManager.RequestAsync().AsTask(token);
                var sessions = manager.GetSessions();
                var neteaseSessions = sessions.Where(session => Identify(session.SourceAppUserModelId) == Netease).ToArray();
                // InfLink-rs may publish a complete timeline alongside the native NetEase session.
                var neteaseSession = neteaseSessions.Length > 1
                    ? neteaseSessions.FirstOrDefault(HasTimeline) ?? neteaseSessions[0]
                    : neteaseSessions.FirstOrDefault();
                var reads = await Task.WhenAll(
                    apple.SampleAsync(sessions.FirstOrDefault(session => Identify(session.SourceAppUserModelId) == Apple), token),
                    netease.SampleAsync(neteaseSession, token));
                Volatile.Write(ref playback, new MusicPlayback(reads[0], reads[1]));
            }
            catch (Exception error) when (!token.IsCancellationRequested)
            {
                if (Read().Apple.Status != "error" || Read().Netease.Status != "error")
                    logger.LogWarning(error, "Could not read Windows music sessions");
                var unavailable = new MusicState(Status: "error");
                Volatile.Write(ref playback, new MusicPlayback(unavailable, unavailable));
                manager = null;
            }
        } while (await timer.WaitForNextTickAsync(token));
    }

    private static bool HasTimeline(MediaSession session)
    {
        try
        {
            var timeline = session.GetTimelineProperties();
            return timeline.EndTime > timeline.StartTime && timeline.LastUpdatedTime > DateTimeOffset.UnixEpoch;
        }
        catch (COMException)
        {
            return false;
        }
    }

    public async Task<string?> ControlAsync(string action, string? expectedSource, CancellationToken token)
    {
        var (source, state) = Selected();
        if (state.Status == "choose-source") return "两个播放器都在播放，请先在控制面板选择播放源。";
        if (expectedSource != null && expectedSource != source) return "播放源已切换，请重试。";
        if (state.Session is not { } session) return "请先在所选的 Windows 播放器里播放一首歌。";
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
        timeout.CancelAfter(TimeSpan.FromSeconds(2));
        try
        {
            if (action == "previous" && await session.TrySkipPreviousAsync().AsTask(timeout.Token)) return null;
            if (action == "next" && await session.TrySkipNextAsync().AsTask(timeout.Token)) return null;
            if (action == "toggle")
            {
                var info = session.GetPlaybackInfo();
                if (info.Controls.IsPlayPauseToggleEnabled && await session.TryTogglePlayPauseAsync().AsTask(timeout.Token)) return null;
                var changed = info.PlaybackStatus == PlaybackStatus.Playing
                    ? await session.TryPauseAsync().AsTask(timeout.Token) : await session.TryPlayAsync().AsTask(timeout.Token);
                if (changed) return null;
            }
        }
        catch (Exception error) when (!token.IsCancellationRequested)
        {
            logger.LogDebug(error, "Could not control the {Source} session", source);
        }
        return "当前播放源无法执行这个操作。";
    }
}
