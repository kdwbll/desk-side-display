using System.Text.Json;

sealed record PreparedWordTiming(string Title, string Artist, string Album, double DurationMs, Lyrics Lyrics);

sealed partial class LyricsCatalog
{
    private readonly record struct PreparedKey(string Title, string Artist, string Album);
    private readonly Dictionary<PreparedKey, PreparedWordTiming[]> prepared;

    private static Dictionary<PreparedKey, PreparedWordTiming[]> ReadPreparedTimings(string path)
    {
        if (!File.Exists(path)) return new();
        try
        {
            var records = JsonSerializer.Deserialize<PreparedWordTiming[]>(File.ReadAllText(path),
                new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? [];
            return records.Where(row => row != null && !string.IsNullOrWhiteSpace(row.Title) &&
                    !string.IsNullOrWhiteSpace(row.Artist) && !string.IsNullOrWhiteSpace(row.Album) &&
                    row.DurationMs > 0 && row.Lyrics?.TimingId != null &&
                    row.Lyrics.Lines?.Any(line => line?.Words is { Length: > 0 }) == true)
                .GroupBy(row => MakePreparedKey(row.Title, row.Artist, row.Album))
                .ToDictionary(group => group.Key, group => group.ToArray());
        }
        catch (Exception error) when (error is IOException or JsonException) { return new(); }
    }

    private Lyrics? FindPreparedTiming(Song song, double durationMs)
    {
        if (prepared.Count == 0 || !prepared.TryGetValue(MakePreparedKey(song.Title, song.Artist, song.Album), out var recordings))
            return null;
        return recordings.Where(row => Math.Abs(row.DurationMs - durationMs) <= 1750)
            .MinBy(row => Math.Abs(row.DurationMs - durationMs))?.Lyrics;
    }

    private static PreparedKey MakePreparedKey(string title, string artist, string album) =>
        new(SearchKey(title), ArtistKey(artist), AlbumKey(album));
}
