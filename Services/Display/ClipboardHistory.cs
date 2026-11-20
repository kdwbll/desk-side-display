using System.Drawing;
using System.Net;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using Windows.ApplicationModel.DataTransfer;
using Windows.Storage.Streams;
using WinClipboard = Windows.ApplicationModel.DataTransfer.Clipboard;

sealed record ClipboardHistoryPreview(string Id, string Kind, DateTimeOffset CopiedAt, string? Text = null,
    string? Image = null, WidgetWindows.ClipboardFile[]? Files = null);

sealed class ClipboardHistory
{
    private const int Capacity = 25;
    private readonly object gate = new();
    private readonly SemaphoreSlim nativeGate = new(1, 1);
    private readonly List<FileEntry> fileHistory = [];
    private Dictionary<string, ClipboardHistoryPreview> nativePreviews = new(StringComparer.Ordinal);
    private uint fileVersion;
    private long clearRevision;

    public async Task ObserveFiles()
    {
        var version = WidgetWindows.ClipboardVersion;
        long revision;
        lock (gate)
        {
            if (version == 0 || version == fileVersion) return;
            fileVersion = version;
            revision = clearRevision;
        }
        var files = await WidgetWindows.ClipboardFilePaths(version);
        if (files.Length == 0) return;
        var items = files.Take(6).Select(file => WidgetWindows.FileItem(file, includeThumbnail: false)).ToArray();
        var preview = new ClipboardHistoryPreview("file-" + Guid.NewGuid().ToString("N"), "files", DateTimeOffset.Now, Files: items);
        lock (gate)
        {
            if (revision != clearRevision) return;
            var previous = fileHistory.FindIndex(entry => entry.Paths.SequenceEqual(files, StringComparer.OrdinalIgnoreCase));
            if (previous >= 0)
            {
                preview = preview with { Id = fileHistory[previous].Preview.Id };
                fileHistory.RemoveAt(previous);
            }
            fileHistory.Insert(0, new(preview, files));
            if (fileHistory.Count > Capacity) fileHistory.RemoveAt(Capacity);
        }
    }

    public void ClearFileHistory()
    {
        if (nativePreviews.Count > 0) nativePreviews = new(StringComparer.Ordinal);
        lock (gate)
        {
            if (fileVersion == 0 && fileHistory.Count == 0) return;
            fileVersion = 0;
            clearRevision++;
            fileHistory.Clear();
        }
    }

    public async Task<ClipboardHistoryPreview[]> Read(CancellationToken token)
    {
        await nativeGate.WaitAsync(token);
        try
        {
            var previews = new Dictionary<string, ClipboardHistoryPreview>(StringComparer.Ordinal);
            foreach (var item in await NativeItems(token))
            {
                token.ThrowIfCancellationRequested();
                var id = "win-" + item.Id;
                if (!nativePreviews.TryGetValue(id, out var preview)) preview = await Preview(item, id, token);
                if (preview != null) previews[id] = preview;
            }
            nativePreviews = previews;
            lock (gate)
                return previews.Values.Concat(fileHistory.Select(entry => entry.Preview))
                    .OrderByDescending(item => item.CopiedAt).Take(Capacity).ToArray();
        }
        finally { nativeGate.Release(); }
    }

    public async Task<string?> Paste(string? id, KeyboardShortcut keyboard, CancellationToken token)
    {
        if (id is not { Length: > 5 and <= 128 }) return "请选择一个剪贴板历史条目。";
        if (id.StartsWith("file-", StringComparison.Ordinal))
        {
            string[]? paths;
            lock (gate) paths = fileHistory.FirstOrDefault(entry => entry.Preview.Id == id)?.Paths;
            if (paths == null) return "该文件条目已移出历史。";
            if (!await WidgetWindows.RestoreFiles(paths)) return "Windows 剪贴板暂不可用。";
        }
        else if (id.StartsWith("win-", StringComparison.Ordinal))
        {
            var item = (await NativeItems(token)).FirstOrDefault(item => "win-" + item.Id == id);
            if (item == null) return "该条目已移出 Windows 剪贴板历史。";
            try
            {
                if (WinClipboard.SetHistoryItemAsContent(item) != SetHistoryItemAsContentStatus.Success)
                    return "Windows 暂时无法恢复此剪贴板条目。";
            }
            catch (Exception error) when (error is COMException or InvalidOperationException or UnauthorizedAccessException)
            { return "Windows 暂时无法恢复此剪贴板条目。"; }
        }
        else return "请选择一个剪贴板历史条目。";
        return keyboard.Press("Ctrl+V");
    }

    private static async Task<ClipboardHistoryItem[]> NativeItems(CancellationToken token)
    {
        try
        {
            if (!WinClipboard.IsHistoryEnabled()) return [];
            var history = await WinClipboard.GetHistoryItemsAsync().AsTask(token);
            return history.Status == ClipboardHistoryItemsResultStatus.Success ? history.Items.Take(Capacity).ToArray() : [];
        }
        catch (Exception error) when (error is COMException or UnauthorizedAccessException or InvalidOperationException)
        { return []; }
    }

    private static async Task<ClipboardHistoryPreview?> Preview(ClipboardHistoryItem item, string id, CancellationToken token)
    {
        try
        {
            var content = item.Content;
            if (content.Contains(StandardDataFormats.Bitmap))
                return new(id, "image", item.Timestamp, Image: await PreviewBitmap(content, token));
            string? text = null;
            if (content.Contains(StandardDataFormats.Text))
                text = await content.GetTextAsync().AsTask(token);
            else if (content.Contains(StandardDataFormats.Html))
            {
                var html = await content.GetHtmlFormatAsync().AsTask(token);
                var fragment = HtmlFormatHelper.GetStaticFragment(html);
                text = WebUtility.HtmlDecode(Regex.Replace(fragment[..Math.Min(fragment.Length, 4000)], "<[^>]*>", " "));
            }
            return text == null ? null : new(id, "text", item.Timestamp, Text: text[..Math.Min(text.Length, 320)]);
        }
        catch (Exception error) when (error is ExternalException or UnauthorizedAccessException or InvalidOperationException
            or IOException or ArgumentException or OutOfMemoryException) { return null; }
    }

    private static async Task<string?> PreviewBitmap(DataPackageView content, CancellationToken token)
    {
        try
        {
            var bitmap = await content.GetBitmapAsync().AsTask(token);
            using var input = await bitmap.OpenReadAsync().AsTask(token);
            if (input.Size is 0 or > 4 * 1024 * 1024) return null;
            using var stream = input.AsStreamForRead();
            using var image = Image.FromStream(stream);
            return WidgetWindows.Thumbnail(image, 144);
        }
        catch (Exception error) when (error is ExternalException or UnauthorizedAccessException or InvalidOperationException
            or IOException or ArgumentException or OutOfMemoryException) { return null; }
    }

    private sealed record FileEntry(ClipboardHistoryPreview Preview, string[] Paths);
}

sealed class ClipboardFileHistoryPoller(DisplayPages pages, WidgetSources sources, ClipboardHistory history) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken token)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(450));
        do
        {
            if (sources.Read().Clipboard && pages.Read().Pages.SelectMany(page => page.Widgets)
                .Any(widget => widget.Type == "custom" && widget.Manifest?.Version == 2 &&
                    WidgetProtocol.References(widget.Manifest).Contains("clipboard.history")))
                await history.ObserveFiles();
            else history.ClearFileHistory();
        } while (await timer.WaitForNextTickAsync(token));
    }
}
