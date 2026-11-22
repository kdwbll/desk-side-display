using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.VisualBasic;

sealed record NeteaseResponse(NeteaseResults? Result);
sealed record NeteaseResults(NeteaseTrack[]? Songs);
sealed record NeteaseName(string? Name, string[]? Alias = null);
sealed record NeteaseTrack(long Id, string? Name, int Dt, NeteaseName? Al, NeteaseName[]? Ar);
sealed record NeteaseLyric(string? Lyric);
sealed record NeteaseLyrics(NeteaseLyric? Yrc, NeteaseLyric? Lrc);

sealed partial class LyricsCatalog
{
    private static async Task<Lyrics?> LookupNeteaseAsync(Song song, double? durationMs)
    {
        const string url = "https://music.163.com/api/";
        var query = Uri.EscapeDataString(ToChineseVariant(song.Title + " " + song.Artist, VbStrConv.SimplifiedChinese));
        var title = SearchKey(song.Title);
        var artist = ArtistKey(song.Artist);
        var album = AlbumKey(song.Album);
        try
        {
            var search = await http.GetFromJsonAsync<NeteaseResponse>($"{url}cloudsearch/pc?s={query}&type=1&limit=16");
            var candidates = (search?.Result?.Songs ?? []).Where(item =>
                item.Id > 0 && item.Dt > 0 && (durationMs == null || Math.Abs(item.Dt - durationMs.Value) <= 2300) &&
                SearchKey(item.Name) == title && MatchesNeteaseArtist(item.Ar, artist)).ToArray();
            var sameAlbum = candidates.Where(item => album.Length != 0 && AlbumKey(item.Al?.Name) == album).ToArray();
            var sameRecording = candidates.Where(item =>
                (durationMs == null || Math.Abs(item.Dt - durationMs.Value) <= 1250) &&
                !VersionQualifier().IsMatch(item.Al?.Name ?? "")).ToArray();
            // Prefer the same release. A reissue is usable when matches agree on one studio recording length.
            var accepted = sameAlbum.Length != 0 && (durationMs != null || AgreeOnDuration(sameAlbum))
                ? sameAlbum : AgreeOnDuration(sameRecording) ? sameRecording : [];
            Lyrics? lineFallback = null;
            foreach (var track in accepted.OrderBy(item => Math.Abs(item.Dt - (durationMs ?? item.Dt))).Take(3))
            {
                var result = await http.GetFromJsonAsync<NeteaseLyrics>(
                    $"{url}song/lyric/v1?id={track.Id}&lv=0&kv=0&tv=0&yv=0&ytv=0&yrv=0");
                if (result?.Yrc?.Lyric is { Length: > 0 and <= 262144 } yrc)
                {
                    var lines = ParseYrc(yrc);
                    if (lines.Length > 0) return TimedLyrics("word-netease", lines, yrc) with { DurationMs = track.Dt };
                }
                if (lineFallback == null && result?.Lrc?.Lyric is { Length: > 0 and <= 262144 } lrc &&
                    Parse(lrc) is { Length: > 0 } lineSynced)
                    lineFallback = TimedLyrics("line-netease", lineSynced, lrc) with { DurationMs = track.Dt };
            }
            return lineFallback ?? (durationMs == null && accepted.Length > 0
                ? new Lyrics("missing", [], DurationMs: accepted[0].Dt) : null);
        }
        catch (Exception error) when (error is HttpRequestException or OperationCanceledException or JsonException)
        {
            return null;
        }
    }

    private static bool AgreeOnDuration(NeteaseTrack[] tracks) =>
        tracks.Length != 0 && tracks.Max(item => item.Dt) - tracks.Min(item => item.Dt) <= 250;

    private static bool MatchesNeteaseArtist(NeteaseName[]? names, string artist)
    {
        if (names is not { Length: > 0 }) return false;
        if (names.Length == 1) return ArtistKey(names[0].Name) == artist ||
            names[0].Alias?.Any(name => ArtistKey(name) == artist) == true;
        return SearchKey(string.Join(" ", names.Select(item => item.Name))) == artist;
    }

    public static LyricLine[] ParseYrc(string text)
    {
        var lines = new List<LyricLine>();
        foreach (var raw in text.Split('\n'))
        {
            var header = YrcLine().Match(raw);
            if (!header.Success || !ReadTime(header, 1, out var start) || !ReadTime(header, 2, out var duration)) continue;
            var content = raw[header.Length..].TrimEnd('\r');
            var matches = YrcWord().Matches(content);
            var words = new List<LyricWord>();
            for (var i = 0; i < matches.Count; i++)
            {
                var match = matches[i];
                var textStart = match.Index + match.Length;
                var textEnd = i + 1 < matches.Count ? matches[i + 1].Index : content.Length;
                if (textEnd <= textStart || !ReadTime(match, 1, out var at) || !ReadTime(match, 2, out var span)) continue;
                words.Add(new(at, at + Math.Max(1, span), content[textStart..textEnd]));
            }
            if (words.Count == 0) continue;
            var lyric = string.Concat(words.Select(word => word.Text));
            if (string.IsNullOrWhiteSpace(lyric)) continue;
            lines.Add(new(Math.Min(start, words[0].AtMs), lyric,
                Math.Max(start + duration, words.Max(word => word.EndMs)), words.ToArray()));
        }
        return lines.OrderBy(line => line.AtMs).ToArray();
    }

    private static bool ReadTime(Match match, int index, out long value) =>
        long.TryParse(match.Groups[index].Value, NumberStyles.None, CultureInfo.InvariantCulture, out value) &&
        value <= int.MaxValue;

    [GeneratedRegex(@"^\[(\d+),(\d+)\]")]
    private static partial Regex YrcLine();

    [GeneratedRegex(@"\((\d+),(\d+),-?\d+\)")]
    private static partial Regex YrcWord();

    [GeneratedRegex(@"\b(live|remix|concert|demo|karaoke|instrumental)\b|現場|现场|演唱會|演唱会|伴奏|加速|翻唱",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex VersionQualifier();
}
