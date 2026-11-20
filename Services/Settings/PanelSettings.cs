using System.Security.Cryptography;
using System.Text.Json;

sealed record PanelPreferences(string Mode, string Idle);

sealed class PanelSettings
{
    private readonly object gate = new();
    private PanelPreferences preferences = new("auto", "clock");
    private ImageBytes? wallpaper;
    private long displayRevision;
    private readonly string preferenceFile;
    private readonly string wallpaperFile;
    public string DataPath { get; }

    public PanelSettings(string path)
    {
        DataPath = path;
        preferenceFile = Path.Combine(path, "settings.json");
        wallpaperFile = Path.Combine(path, "wallpaper");
        Directory.CreateDirectory(DataPath);
        if (File.Exists(preferenceFile))
        {
            try
            {
                var saved = JsonSerializer.Deserialize<PanelPreferences>(File.ReadAllText(preferenceFile));
                if (saved != null && Valid(saved)) preferences = saved;
            }
            catch (JsonException) { }
        }

        if (File.Exists(wallpaperFile) && new FileInfo(wallpaperFile).Length <= 8 * 1024 * 1024)
            wallpaper = ImageBytes.Create(File.ReadAllBytes(wallpaperFile));
    }

    public (PanelPreferences Preferences, ImageBytes? Wallpaper, long DisplayRevision) Read()
    {
        lock (gate) return (preferences, wallpaper, displayRevision);
    }

    public bool Update(PanelPreferences next)
    {
        if (!Valid(next)) return false;
        lock (gate)
        {
            Save(preferenceFile, JsonSerializer.SerializeToUtf8Bytes(next));
            preferences = next;
            displayRevision++;
        }
        return true;
    }

    public void SetWallpaper(ImageBytes image)
    {
        lock (gate)
        {
            Save(wallpaperFile, image.Bytes);
            wallpaper = image;
        }
    }

    private static bool Valid(PanelPreferences value) =>
        value.Mode is "auto" or "lyrics" or "clock" or "photo" && value.Idle is "clock" or "photo" or "hardware";

    public static void Save(string destination, byte[] bytes)
    {
        var temporary = destination + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllBytes(temporary, bytes);
            File.Move(temporary, destination, overwrite: true);
        }
        finally { File.Delete(temporary); }
    }
}

sealed record ImageBytes(byte[] Bytes, string Type, string Version)
{
    public static ImageBytes? Create(byte[] bytes)
    {
        ReadOnlySpan<byte> data = bytes;
        string? type = null;
        if (data.StartsWith(new byte[] { 0xFF, 0xD8, 0xFF })) type = "image/jpeg";
        else if (data.StartsWith(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 })) type = "image/png";
        else if (data.StartsWith("GIF89a"u8) || data.StartsWith("GIF87a"u8)) type = "image/gif";
        else if (data.Length >= 12 && data.StartsWith("RIFF"u8) && data[8..].StartsWith("WEBP"u8)) type = "image/webp";
        return type == null ? null : new ImageBytes(bytes, type, Convert.ToHexString(SHA256.HashData(bytes))[..16]);
    }
}
