using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;
using Microsoft.VisualBasic;
using YamlDotNet.Core;
using YamlDotNet.RepresentationModel;

sealed record LyricWord(long AtMs, long EndMs, string Text);
sealed record LyricLine(long AtMs, string Text, long? EndMs = null, LyricWord[]? Words = null);
sealed record LyricTimingPoint(int AtMs, int OffsetMs);
sealed record Lyrics(string Status, LyricLine[] Lines, string? TimingId = null);
sealed record LyricCalibration(int Offset, LyricTimingPoint[] Points);
sealed record RemoteLyrics(bool Instrumental, string? SyncedLyrics, double? Duration, bool HasWordSync,
    string? Lyricsfile, string? TrackName, string? ArtistName, string? AlbumName);
sealed record RemoteTrack(long Id, string? TrackName, string? ArtistName, string? AlbumName, double? Duration,
    bool HasWordSync, string? SyncedLyrics);
sealed record AmllResponse<T>(T? Data);
sealed record AmllSearch(AmllSong[] Items);
sealed record AmllSong(long Id, string[] MusicNames, string[] ArtistNames, string[] AlbumNames, string? Lyrics);

sealed partial class LyricsCatalog
{
    public const int DefaultLeadMs = 1300;
    private static readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(8) };
    private readonly string directory;
    private readonly string offsetsFile;
    private readonly string timingPointsFile;
    private readonly object offsetLock = new();
    private readonly Dictionary<string, int> offsets = new();
    private Dictionary<string, LyricTimingPoint[]> timingPoints = new();
    private readonly ConcurrentDictionary<string, Lyrics> local = new();
    private readonly ConcurrentDictionary<string, Lazy<Task<Lyrics>>> remote = new();
    private readonly ConcurrentDictionary<string, Lazy<Task<Lyrics?>>> wordSources = new();
    private readonly ConcurrentDictionary<string, Lazy<Task<Lyrics?>>> alternate = new();
    private readonly ConcurrentDictionary<string, Lazy<Task<Lyrics?>>> netease = new();
    private readonly ConcurrentDictionary<string, Lyrics> selectedWordTiming = new();
    private readonly ConcurrentDictionary<string, DateTimeOffset> retryAt = new();

    public LyricsCatalog(string dataPath)
    {
        directory = Path.Combine(dataPath, "lyrics");
        Directory.CreateDirectory(directory);
        prepared = ReadPreparedTimings(Path.Combine(directory, "prepared-word-timings.json"));
        offsetsFile = Path.Combine(directory, "offsets.json");
        timingPointsFile = Path.Combine(directory, "timing-points.json");
        if (File.Exists(offsetsFile))
        {
            try { offsets = JsonSerializer.Deserialize<Dictionary<string, int>>(File.ReadAllText(offsetsFile)) ?? new(); }
            catch (JsonException) { }
        }
        if (File.Exists(timingPointsFile))
        {
            try { timingPoints = JsonSerializer.Deserialize<Dictionary<string, LyricTimingPoint[]>>(
                File.ReadAllText(timingPointsFile)) ?? new(); }
            catch (JsonException) { }
        }
        http.DefaultRequestHeaders.UserAgent.ParseAdd("DeskSideDisplay/0.1");
    }

    public LyricCalibration ReadCalibration(Song? song, Lyrics source)
    {
        if (song == null) return new(0, []);
        lock (offsetLock)
        {
            var key = CalibrationKey(song, source);
            var legacy = !source.Lines.Any(line => line.Words is { Length: > 0 });
            var offset = offsets.TryGetValue(key, out var value) ? value
                : legacy ? offsets.GetValueOrDefault(song.Id, DefaultLeadMs) : DefaultLeadMs;
            var points = timingPoints.GetValueOrDefault(key)
                ?? (legacy ? timingPoints.GetValueOrDefault(song.Id) : null) ?? [];
            return new(offset, points);
        }
    }

    private static string CalibrationKey(Song song, Lyrics source) =>
        source.TimingId == null ? song.Id : song.Id + ":" + source.TimingId;

    public void SetOffset(Song song, Lyrics source, int offset)
    {
        lock (offsetLock)
        {
            var updated = new Dictionary<string, int>(offsets);
            updated[CalibrationKey(song, source)] = offset;
            PanelSettings.Save(offsetsFile, JsonSerializer.SerializeToUtf8Bytes(updated));
            offsets.Clear();
            foreach (var pair in updated) offsets.Add(pair.Key, pair.Value);
        }
    }

    public bool SetTimingPoint(Song song, Lyrics source, LyricTimingPoint point, int durationMs)
    {
        if (point.AtMs < 250 || point.AtMs > durationMs - 250) return false;
        lock (offsetLock)
        {
            var existing = ReadCalibration(song, source).Points;
            var updated = existing.Where(other => other.AtMs != point.AtMs)
                .Append(point).Where(other => other.OffsetMs != 0).OrderBy(other => other.AtMs).ToArray();
            if (updated.Length > 64) return false;
            var previous = new LyricTimingPoint(0, 0);
            foreach (var next in updated.Append(new LyricTimingPoint(durationMs, 0)))
            {
                var spacing = next.AtMs - previous.AtMs;
                if (spacing < 250 || Math.Abs(next.OffsetMs - previous.OffsetMs) >= spacing - 50)
                    return false;
                previous = next;
            }
            var saved = new Dictionary<string, LyricTimingPoint[]>(timingPoints)
            {
                [CalibrationKey(song, source)] = updated
            };
            PanelSettings.Save(timingPointsFile, JsonSerializer.SerializeToUtf8Bytes(saved));
            timingPoints = saved;
            return true;
        }
    }

    public Lyrics Read(Song? song, double? durationMs)
    {
        if (song == null) return new("waiting", []);
        var saved = local.GetOrAdd(song.Id, id =>
        {
            var path = Path.Combine(directory, id + ".lyrics");
            if (!File.Exists(path)) path = Path.Combine(directory, id + ".lrc");
            if (!File.Exists(path)) return new("missing", []);
            var contents = File.ReadAllText(path);
            return TimedLyrics("local", ParseFile(contents), contents);
        });
        if (saved.Lines.Length > 0) return saved;
        if (durationMs is not > 0 || string.IsNullOrWhiteSpace(song.Artist)) return new("metadata-incomplete", []);
        if (FindPreparedTiming(song, durationMs.Value) is Lyrics preparedTiming) return preparedTiming;

        var seconds = (int)Math.Round(durationMs.Value / 1000);
        var key = song.Id + ":" + seconds;
        if (selectedWordTiming.TryGetValue(key, out var selected)) return selected;
        var task = remote.GetOrAdd(key, _ => new Lazy<Task<Lyrics>>(() => LookupAsync(song, seconds))).Value;
        var wordTask = wordSources.GetOrAdd(key,
            _ => new Lazy<Task<Lyrics?>>(() => LookupWordTimingAsync(song, seconds))).Value;
        var primary = task.IsCompletedSuccessfully ? task.Result : null;
        if (primary?.Status == "instrumental") return primary;
        if (primary?.Status == "word-lrclib") return selectedWordTiming.GetOrAdd(key, primary);
        if (wordTask.IsCompletedSuccessfully && wordTask.Result is Lyrics timed) return selectedWordTiming.GetOrAdd(key, timed);
        var neteaseTask = netease.GetOrAdd(key,
            _ => new Lazy<Task<Lyrics?>>(() => LookupNeteaseAsync(song, durationMs.Value))).Value;
        var net = neteaseTask.IsCompletedSuccessfully ? neteaseTask.Result : null;
        if (net?.Status == "word-netease") return selectedWordTiming.GetOrAdd(key, net);
        if (primary == null) return net ?? new("searching", []);

        var alternateTask = alternate.GetOrAdd(key,
            _ => new Lazy<Task<Lyrics?>>(() => SearchAlternateAsync(song, seconds))).Value;
        var other = alternateTask.IsCompletedSuccessfully ? alternateTask.Result : null;
        if (other?.Status == "word-lrclib") return selectedWordTiming.GetOrAdd(key, other);
        if (primary.Lines.Length > 0) return primary;
        if (other != null || net != null) return other ?? net!;
        if (!alternateTask.IsCompleted || !wordTask.IsCompleted || !neteaseTask.IsCompleted)
            return new("searching", []);

        var now = DateTimeOffset.UtcNow;
        var retry = retryAt.GetOrAdd(key, now.AddSeconds(60));
        if (now >= retry && retryAt.TryUpdate(key, now.AddSeconds(60), retry))
        {
            remote.TryRemove(key, out _);
            wordSources.TryRemove(key, out _);
            alternate.TryRemove(key, out _);
            netease.TryRemove(key, out _);
            return new("searching", []);
        }
        return primary;
    }

    public bool SetLocal(Song song, string contents)
    {
        var lines = ParseFile(contents);
        if (lines.Length == 0) return false;
        PanelSettings.Save(Path.Combine(directory, song.Id + ".lyrics"), Encoding.UTF8.GetBytes(contents));
        local[song.Id] = TimedLyrics("local", lines, contents);
        return true;
    }

    private static LyricLine[] ParseFile(string contents) =>
        contents.AsSpan().TrimStart().StartsWith("<") ? ParseTtml(contents).Lines : Parse(contents);

    private static Lyrics TimedLyrics(string status, LyricLine[] lines, string contents) =>
        new(status, lines, Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(contents))));

    private static async Task<Lyrics?> LookupWordTimingAsync(Song song, int seconds)
    {
        if (string.IsNullOrWhiteSpace(song.Album)) return null;
        const string api = "https://api.amll.dev/v1/lyrics/";
        var title = Uri.EscapeDataString(song.Title);
        var artist = Uri.EscapeDataString(song.Artist);
        try
        {
            var result = await http.GetFromJsonAsync<AmllResponse<AmllSearch>>(
                $"{api}search?musicName={title}&artistName={artist}");
            var candidates = result?.Data?.Items.Where(item =>
                Matches(item.MusicNames, song.Title) && Matches(item.ArtistNames, song.Artist) &&
                Matches(item.AlbumNames, song.Album)).Take(2) ?? [];
            foreach (var candidate in candidates)
            {
                var full = await http.GetFromJsonAsync<AmllResponse<AmllSong>>($"{api}get?id={candidate.Id}");
                var content = full?.Data?.Lyrics ?? "";
                var (lines, duration) = ParseTtml(content);
                if (duration is long milliseconds && Math.Abs(milliseconds - seconds * 1000L) <= 2500 &&
                    lines.Any(line => line.Words is { Length: > 0 }))
                    return TimedLyrics("word-online", lines, content);
            }
        }
        catch (Exception error) when (error is HttpRequestException or OperationCanceledException or JsonException) { }
        return null;
    }

    private static bool Matches(string[]? values, string value) => values?.Any(candidate =>
        string.Equals(candidate.Trim(), value.Trim(), StringComparison.OrdinalIgnoreCase)) == true;

    private static async Task<Lyrics?> SearchAlternateAsync(Song song, int seconds)
    {
        var album = SearchKey(song.Album);
        if (album.Length == 0) return null;
        var traditional = song with
        {
            Title = Traditional(song.Title), Artist = Traditional(song.Artist), Album = Traditional(song.Album)
        };
        var latinArtist = ArtistKey(song.Artist) switch
        {
            "陶喆" => "David Tao",
            "孙燕姿" => "Stefanie Sun",
            "曹格" => "Gary Chaw",
            "方大同" => "Khalil Fong",
            _ => song.Artist
        };
        var latinAlbum = AlbumKey(song.Album) switch
        {
            "这一刻" when ArtistKey(song.Artist) == "孙燕姿" => "The Moment",
            "未完成" when ArtistKey(song.Artist) == "孙燕姿" => "To Be Continued",
            _ => traditional.Album
        };
        var spellings = new[]
        {
            traditional,
            song with { Artist = latinArtist, Album = latinAlbum },
            traditional with { Artist = latinArtist, Album = latinAlbum },
            traditional with { Artist = latinArtist, Album = song.Album }
        }.Where(candidate => candidate != song).Distinct().ToArray();
        var exact = await Task.WhenAll(spellings.Select(candidate => LookupAsync(candidate, seconds)));
        if (exact.FirstOrDefault(result => result.Status == "word-lrclib") is Lyrics timedExact) return timedExact;
        var fallback = exact.FirstOrDefault(result => result.Lines.Length > 0);
        if (fallback != null) return fallback;

        var searchKeys = spellings.Append(song).Select(item => (item.Title, item.Artist)).Distinct();
        var batches = await Task.WhenAll(searchKeys.Select(item => SearchByTitleAsync(item.Title, item.Artist)));
        var title = SearchKey(song.Title);
        var artist = ArtistKey(song.Artist);
        var candidates = batches.SelectMany(batch => batch)
            .Where(item => item.Id > 0 && item.Duration is double length && Math.Abs(length - seconds) <= 2 &&
                SearchKey(item.TrackName) == title && ArtistKey(item.ArtistName) == artist &&
                AlbumKey(item.AlbumName) == AlbumKey(song.Album))
            .DistinctBy(item => item.Id)
            .OrderByDescending(item => item.HasWordSync)
            .ThenBy(item => Math.Abs(item.Duration!.Value - seconds));

        foreach (var item in candidates.Take(5))
        {
            if (item.HasWordSync)
            {
                try
                {
                    var match = await http.GetFromJsonAsync<RemoteLyrics>($"https://lrclib.net/api/get/{item.Id}");
                    if (match != null && ParseRemote(match, seconds) is { Status: "word-lrclib" } timed) return timed;
                }
                catch (Exception error) when (error is HttpRequestException or OperationCanceledException or JsonException) { }
            }
            if (fallback == null && Parse(item.SyncedLyrics ?? "") is { Length: > 0 } lines)
                fallback = TimedLyrics("online", lines, item.SyncedLyrics!);
        }
        return fallback;
    }

    private static async Task<RemoteTrack[]> SearchByTitleAsync(string title, string artist)
    {
        try
        {
            return await http.GetFromJsonAsync<RemoteTrack[]>(
                $"https://lrclib.net/api/search?track_name={Uri.EscapeDataString(title)}&artist_name={Uri.EscapeDataString(artist)}") ?? [];
        }
        catch (Exception error) when (error is HttpRequestException or OperationCanceledException or JsonException)
        {
            return [];
        }
    }

    private static string SearchKey(string? text)
    {
        var simplified = ToChineseVariant(text ?? "", VbStrConv.SimplifiedChinese)
            .Normalize(NormalizationForm.FormKC).ToLowerInvariant();
        return string.Concat(simplified.Where(char.IsLetterOrDigit));
    }

    private static string ArtistKey(string? text) => SearchKey(text) switch
    {
        "davidtao" or "taodavid" => "陶喆",
        "stefaniesun" or "sunstefanie" or "yanzisun" => "孙燕姿",
        "garychaw" or "chawgary" => "曹格",
        "khalilfong" or "fongkhalil" => "方大同",
        var key => key
    };

    private static string AlbumKey(string? text) => SearchKey(text) switch
    {
        "themoment" or "themoment这一刻" or "这一刻themoment" => "这一刻",
        "tobecontinued" or "tobecontinued未完成" or "未完成tobecontinued" => "未完成",
        var key => key
    };

    private static string Traditional(string text) => ToChineseVariant(text, VbStrConv.TraditionalChinese);

    private static string ToChineseVariant(string text, VbStrConv conversion)
    {
        if (!text.Any(character => character is >= '\u3400' and <= '\u9fff')) return text;
        try { return Strings.StrConv(text, conversion, 0x0804) ?? text; }
        catch (ArgumentException) { return text; }
    }

    public static (LyricLine[] Lines, long? Duration) ParseTtml(string document)
    {
        try
        {
            using var input = new StringReader(document);
            using var reader = XmlReader.Create(input, new XmlReaderSettings
            {
                DtdProcessing = DtdProcessing.Prohibit,
                MaxCharactersInDocument = 1_000_000
            });
            var root = XDocument.Load(reader, LoadOptions.PreserveWhitespace);
            var body = root.Descendants().FirstOrDefault(element => element.Name.LocalName == "body");
            if (body == null) return ([], null);
            var lines = new List<LyricLine>();
            foreach (var element in body.Descendants().Where(element => element.Name.LocalName == "p"))
            {
                var start = ParseXmlTime((string?)element.Attribute("begin"));
                if (start == null) continue;
                var end = ParseXmlTime((string?)element.Attribute("end"));
                var words = new List<LyricWord>();
                var text = new StringBuilder();
                foreach (var node in element.Nodes())
                {
                    if (node is XText plain)
                    {
                        if (plain.Value.Contains('\n') || plain.Value.Contains('\r')) continue;
                        text.Append(plain.Value);
                    }
                    else if (node is XElement span && span.Name.LocalName == "span" &&
                             !span.Attributes().Any(attribute => attribute.Name.LocalName == "role"))
                    {
                        var wordStart = ParseXmlTime((string?)span.Attribute("begin"));
                        var wordEnd = ParseXmlTime((string?)span.Attribute("end"));
                        if (wordStart is long from && wordEnd is long to && from >= start && to > from)
                            words.Add(new(from, to, span.Value));
                        text.Append(span.Value);
                    }
                }
                var value = text.ToString().Trim();
                if (value.Length != 0)
                    lines.Add(new(start.Value, value, end, words.Count > 0 ? words.ToArray() : null));
            }
            var duration = ParseXmlTime((string?)body.Attribute("dur"))
                ?? ParseXmlTime((string?)body.Attribute("end"))
                ?? ParseXmlTime((string?)root.Root?.Attribute("dur"));
            return (lines.OrderBy(line => line.AtMs).ToArray(), duration);
        }
        catch (XmlException) { return ([], null); }
    }

    private static long? ParseXmlTime(string? timestamp)
    {
        if (string.IsNullOrWhiteSpace(timestamp)) return null;
        if (timestamp.EndsWith("ms", StringComparison.Ordinal) &&
            double.TryParse(timestamp.AsSpan(0, timestamp.Length - 2), NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var milliseconds))
            return milliseconds is >= 0 and <= int.MaxValue ? (long)Math.Round(milliseconds) : null;
        if (timestamp.EndsWith('s')) timestamp = timestamp[..^1];
        double total = 0;
        foreach (var part in timestamp.Split(':'))
        {
            if (!double.TryParse(part, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var quantity)) return null;
            total = total * 60 + quantity;
        }
        return total is >= 0 and <= int.MaxValue / 1000d ? (long)Math.Round(total * 1000) : null;
    }

    private static async Task<Lyrics> LookupAsync(Song song, int seconds)
    {
        var query = $"track_name={Uri.EscapeDataString(song.Title)}&artist_name={Uri.EscapeDataString(song.Artist)}" +
            $"&album_name={Uri.EscapeDataString(song.Album)}&duration={seconds}";
        try
        {
            using var response = await http.GetAsync($"https://lrclib.net/api/get?{query}");
            if (response.StatusCode == HttpStatusCode.NotFound) return new("missing", []);
            if (!response.IsSuccessStatusCode) return new("unavailable", []);
            var match = await response.Content.ReadFromJsonAsync<RemoteLyrics>();
            if (match == null || SearchKey(match.TrackName) != SearchKey(song.Title) ||
                ArtistKey(match.ArtistName) != ArtistKey(song.Artist) ||
                (!string.IsNullOrWhiteSpace(song.Album) && AlbumKey(match.AlbumName) != AlbumKey(song.Album)))
                return new("missing", []);
            return ParseRemote(match, seconds);
        }
        catch (Exception error) when (error is HttpRequestException or OperationCanceledException or System.Text.Json.JsonException)
        {
            return new("unavailable", []);
        }
    }

    private static Lyrics ParseRemote(RemoteLyrics match, int seconds)
    {
        if (match.Duration is not double duration || Math.Abs(duration - seconds) > 2) return new("missing", []);
        if (match.Instrumental) return new("instrumental", []);
        if (match.HasWordSync && match.Lyricsfile is { Length: > 0 and <= 262144 })
        {
            var timed = ParseLyricsfile(match.Lyricsfile);
            if (timed.Any(line => line.Words is { Length: > 0 })) return TimedLyrics("word-lrclib", timed, match.Lyricsfile);
        }
        var lines = Parse(match.SyncedLyrics ?? "");
        return lines.Length == 0 ? new("missing", []) : TimedLyrics("online", lines, match.SyncedLyrics!);
    }

    public static LyricLine[] ParseLyricsfile(string contents)
    {
        try
        {
            var yaml = new YamlStream();
            using var source = new StringReader(contents);
            yaml.Load(source);
            if (yaml.Documents.FirstOrDefault()?.RootNode is not YamlMappingNode root ||
                Child(root, "lines") is not YamlSequenceNode lines) return [];

            var shift = Child(root, "metadata") is YamlMappingNode metadata
                ? Milliseconds(metadata, "offset_ms") ?? 0 : 0;
            var result = new List<LyricLine>();
            foreach (var item in lines.Children.OfType<YamlMappingNode>())
            {
                var text = Scalar(item, "text");
                if (text == null || Milliseconds(item, "start_ms") is not int start || start < 0) continue;
                var rawEnd = Milliseconds(item, "end_ms");
                long? end = rawEnd > start ? Shift(rawEnd.Value, shift) : null;
                var words = Child(item, "words") is YamlSequenceNode sequence
                    ? ParseWordSequence(sequence, rawEnd, shift) : [];
                result.Add(new(Shift(start, shift), text, end, words.Length > 0 ? words : null));
            }
            return result.OrderBy(line => line.AtMs).ToArray();
        }
        catch (YamlException) { return []; }
    }

    private static LyricWord[] ParseWordSequence(YamlSequenceNode sequence, int? lineEnd, int shift)
    {
        var units = sequence.Children.OfType<YamlMappingNode>()
            .Select(word => (Text: Scalar(word, "text"), Start: Milliseconds(word, "start_ms"),
                End: Milliseconds(word, "end_ms"))).ToArray();
        var words = new List<LyricWord>();
        for (var i = 0; i < units.Length; i++)
        {
            var unit = units[i];
            var end = unit.End ?? (i + 1 < units.Length ? units[i + 1].Start : lineEnd);
            if (unit.Start is int start && start >= 0 && end is int finish &&
                Shift(finish, shift) > Shift(start, shift) && !string.IsNullOrEmpty(unit.Text))
                words.Add(new(Shift(start, shift), Shift(finish, shift), unit.Text));
        }
        return words.ToArray();
    }

    private static long Shift(int value, int offset) => Math.Max(0, value + (long)offset);
    private static YamlNode? Child(YamlMappingNode map, string key) =>
        map.Children.TryGetValue(new YamlScalarNode(key), out var node) ? node : null;
    private static string? Scalar(YamlMappingNode map, string key) => (Child(map, key) as YamlScalarNode)?.Value;
    private static int? Milliseconds(YamlMappingNode map, string key) =>
        int.TryParse(Scalar(map, key), CultureInfo.InvariantCulture, out var value) ? value : null;

    public static LyricLine[] Parse(string lrc)
    {
        var offsetMatch = OffsetPattern().Match(lrc);
        var offset = offsetMatch.Success && int.TryParse(offsetMatch.Groups[1].Value, out var ms) ? ms : 0;
        var lines = new List<LyricLine>();
        foreach (var line in lrc.Split('\n'))
        {
            var timestamps = TimestampPattern().Matches(line);
            if (timestamps.Count == 0 || timestamps[0].Index != 0) continue;
            var last = timestamps[^1];
            var text = line[(last.Index + last.Length)..].Trim();
            foreach (Match timestamp in timestamps)
            {
                var minute = int.Parse(timestamp.Groups[1].Value, CultureInfo.InvariantCulture);
                var second = int.Parse(timestamp.Groups[2].Value, CultureInfo.InvariantCulture);
                if (second >= 60) continue;
                var fraction = timestamp.Groups[3].Value.PadRight(3, '0');
                var at = minute * 60_000L + second * 1_000L + int.Parse(fraction, CultureInfo.InvariantCulture);
                lines.Add(new(Math.Max(0, at + offset), text));
            }
        }
        if (!lines.Any(line => line.Text.Length > 0)) return [];
        return lines.GroupBy(line => line.AtMs).OrderBy(group => group.Key).Select(group =>
            new LyricLine(group.Key, string.Join(" / ", group.Select(line => line.Text).Where(text => text.Length > 0).Distinct()))).ToArray();
    }

    [GeneratedRegex(@"\[([0-9]{1,4}):([0-9]{2})(?:[.:]([0-9]{1,3}))?\]")]
    private static partial Regex TimestampPattern();

    [GeneratedRegex(@"\[offset:\s*([+-]?[0-9]+)\]", RegexOptions.IgnoreCase)]
    private static partial Regex OffsetPattern();
}
