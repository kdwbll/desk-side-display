using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using Windows.Media.Control;
using Windows.Storage.Streams;

using MediaManager = Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager;
using MediaSession = Windows.Media.Control.GlobalSystemMediaTransportControlsSession;
using PlaybackStatus = Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus;

sealed record Song(string Id, string Title, string Artist, string Album)
{
    public static Song Create(string title, string artist, string album)
    {
        // Apple Music for Windows sometimes puts the album after the artist in the same field.
        if (string.IsNullOrWhiteSpace(album))
        {
            var parts = artist.Split(" \u2014 ", 2, StringSplitOptions.TrimEntries);
            if (parts.Length == 2 && parts[0].Length > 0 && parts[1].Length > 0)
                (artist, album) = (parts[0], parts[1]);
        }

        var key = Encoding.UTF8.GetBytes(string.Join('\0', title, artist, album));
        return new Song(Convert.ToHexString(SHA256.HashData(key)), title, artist, album);
    }
}

sealed record MusicState(
    string Status = "waiting",
    Song? Song = null,
    bool Playing = false,
    bool Paused = false,
    DateTimeOffset LastPlaying = default,
    long SampledAt = 0,
    double? PositionMs = null,
    double? DurationMs = null,
    double Rate = 1,
    bool CanToggle = false,
    bool CanPrevious = false,
    bool CanNext = false,
    ImageBytes? Artwork = null);

sealed class AppleMusic(ILogger<AppleMusic> logger) : BackgroundService
{
    private MediaManager? manager;
    private MusicState state = new();
    private DateTimeOffset nextArtworkRead;
    private Task<ImageBytes?>? pendingArtwork;
    private string? lastRejectedArtwork;
    private string? lastPublishedArtwork;
    private Song? lastPublishedArtworkSong;
    private Song? artworkSong;
    private (DateTimeOffset Updated, TimeSpan Position, TimeSpan End) lastTimeline;
    private (DateTimeOffset Updated, TimeSpan Position, TimeSpan End)? previousSongTimeline;

    public MusicState Read() => Volatile.Read(ref state);

    private static MediaSession? FindSession(MediaManager? current) => current?.GetSessions()
        .FirstOrDefault(session => session.SourceAppUserModelId.StartsWith("AppleInc.AppleMusicWin_", StringComparison.OrdinalIgnoreCase));

    protected override async Task ExecuteAsync(CancellationToken token)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(180));
        do
        {
            try
            {
                var activeManager = Volatile.Read(ref manager);
                if (activeManager == null)
                {
                    activeManager = await MediaManager.RequestAsync();
                    Volatile.Write(ref manager, activeManager);
                }
                await SampleAsync(FindSession(activeManager), token);
            }
            catch (Exception error) when (!token.IsCancellationRequested)
            {
                if (Read().Status != "error") logger.LogWarning(error, "Could not read the Apple Music session");
                Volatile.Write(ref state, new MusicState(Status: "error"));
                Volatile.Write(ref manager, null);
            }
        } while (await timer.WaitForNextTickAsync(token));
    }

    private async Task SampleAsync(MediaSession? session, CancellationToken token)
    {
        if (session == null)
        {
            Volatile.Write(ref state, new MusicState());
            return;
        }

        var media = await session.TryGetMediaPropertiesAsync();
        var playback = session.GetPlaybackInfo();
        var timeline = session.GetTimelineProperties();
        var sampledAt = Stopwatch.GetTimestamp();
        var now = DateTimeOffset.UtcNow;
        var playing = playback.PlaybackStatus == PlaybackStatus.Playing;
        var paused = playback.PlaybackStatus == PlaybackStatus.Paused;
        var rate = playback.PlaybackRate is > 0 and <= 8 ? playback.PlaybackRate.Value : 1;
        var hasSong = !string.IsNullOrWhiteSpace(media?.Title);
        var song = hasSong ? Song.Create(media!.Title, media.Artist ?? "", media.AlbumTitle ?? "") : null;
        var previous = Read();
        var sameSong = song != null && previous.Song == song;
        var timelineKey = (timeline.LastUpdatedTime, timeline.Position, timeline.EndTime);
        if (!sameSong && song != null && previous.Song != null)
            previousSongTimeline = lastTimeline;
        if (previousSongTimeline != timelineKey)
            previousSongTimeline = null;
        lastTimeline = timelineKey;
        var duration = (timeline.EndTime - timeline.StartTime).TotalMilliseconds;
        var rawPosition = Math.Max(0, (timeline.Position - timeline.StartTime).TotalMilliseconds);
        var validTimeline = song != null && previousSongTimeline == null && (duration > 0 || rawPosition > 0);
        var elapsed = (now - timeline.LastUpdatedTime).TotalMilliseconds;
        // A moving timeline is anchored at the timestamp published by the player.
        var position = rawPosition +
            (playing && timeline.LastUpdatedTime > DateTimeOffset.UnixEpoch && elapsed >= 0 && elapsed <= Math.Max(duration, 300_000)
                ? elapsed * rate : 0);
        var controls = playback.Controls;
        var artwork = PollArtwork(song, sameSong ? previous.Artwork : null, media?.Thumbnail, now, token);
        Volatile.Write(ref state, new MusicState(
            Status: hasSong ? "ready" : "no-track",
            Song: song,
            Playing: playing,
            Paused: paused,
            LastPlaying: playing ? now : sameSong ? previous.LastPlaying : default,
            SampledAt: sampledAt,
            PositionMs: validTimeline ? Math.Min(position, duration > 0 ? duration : double.MaxValue) : null,
            DurationMs: duration > 0 && validTimeline ? duration : null,
            Rate: rate,
            CanToggle: controls.IsPlayPauseToggleEnabled || (playing ? controls.IsPauseEnabled : controls.IsPlayEnabled),
            CanPrevious: controls.IsPreviousEnabled,
            CanNext: controls.IsNextEnabled,
            Artwork: artwork));
    }

    private ImageBytes? PollArtwork(Song? song, ImageBytes? artwork, IRandomAccessStreamReference? thumbnail,
        DateTimeOffset now, CancellationToken token)
    {
        if (song != artworkSong)
        {
            var sameAlbum = !string.IsNullOrWhiteSpace(song?.Album) && song.Album == lastPublishedArtworkSong?.Album &&
                song.Artist == lastPublishedArtworkSong?.Artist;
            lastRejectedArtwork = sameAlbum || song == lastPublishedArtworkSong ? null : lastPublishedArtwork;
            artworkSong = song;
            pendingArtwork = null;
            nextArtworkRead = now;
        }
        if (song == null) return null;

        if (pendingArtwork is { IsCompletedSuccessfully: true })
        {
            var candidate = pendingArtwork.Result;
            if (candidate != null && candidate.Version != lastRejectedArtwork)
            {
                artwork = candidate;
                lastPublishedArtwork = artwork.Version;
                lastPublishedArtworkSong = song;
            }
            pendingArtwork = null;
            nextArtworkRead = now.AddMilliseconds(artwork == null ? 270 : 2000);
        }
        if (pendingArtwork == null && thumbnail != null && now >= nextArtworkRead)
            pendingArtwork = ReadArtworkAsync(thumbnail, token);
        return artwork;
    }

    private async Task<ImageBytes?> ReadArtworkAsync(IRandomAccessStreamReference thumbnail, CancellationToken token)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
        timeout.CancelAfter(TimeSpan.FromSeconds(2));
        try
        {
            using var stream = await thumbnail.OpenReadAsync().AsTask(timeout.Token);
            var size = stream.Size;
            if (size is 0 or > 8 * 1024 * 1024) return null;
            using var reader = new DataReader(stream);
            if (await reader.LoadAsync((uint)size).AsTask(timeout.Token) != size) return null;
            var bytes = new byte[size];
            reader.ReadBytes(bytes);
            return ImageBytes.Create(bytes);
        }
        catch (Exception error)
        {
            logger.LogDebug(error, "Could not read the current cover");
            return null;
        }
    }

    public async Task<bool> ControlAsync(string action)
    {
        try
        {
            var session = FindSession(Volatile.Read(ref manager));
            if (session == null) return false;
            if (action == "previous") return await session.TrySkipPreviousAsync();
            if (action == "next") return await session.TrySkipNextAsync();
            var info = session.GetPlaybackInfo();
            if (info.Controls.IsPlayPauseToggleEnabled && await session.TryTogglePlayPauseAsync()) return true;
            return info.PlaybackStatus == PlaybackStatus.Playing
                ? await session.TryPauseAsync() : await session.TryPlayAsync();
        }
        catch (Exception error)
        {
            logger.LogDebug(error, "Could not control the Apple Music session");
            return false;
        }
    }
}
