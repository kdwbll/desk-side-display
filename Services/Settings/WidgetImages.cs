using System.Text.RegularExpressions;

sealed class WidgetImages(string dataPath)
{
    private readonly string directory = Path.Combine(dataPath, "widget-images");
    private static readonly Regex IdPattern = new(@"\A[0-9A-F]{16}\.(jpg|png|webp|gif)\z", RegexOptions.CultureInvariant);

    public static bool Supports(string kind, string type) => kind switch
    {
        "image" => type is "image/jpeg" or "image/png" or "image/webp",
        "gif" => type == "image/gif",
        _ => false
    };

    public static bool ValidId(string? id, string kind) =>
        id is { Length: >= 20 and <= 21 } && IdPattern.IsMatch(id) && Supports(kind, ContentType(id));

    public string Save(ImageBytes image)
    {
        var extension = image.Type switch
        {
            "image/jpeg" => "jpg",
            "image/png" => "png",
            "image/webp" => "webp",
            "image/gif" => "gif",
            _ => throw new ArgumentException("Unsupported widget image type.", nameof(image))
        };
        var id = image.Version + "." + extension;
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, id);
        if (!File.Exists(path)) PanelSettings.Save(path, image.Bytes);
        return id;
    }

    public (string Path, string Type)? Find(string id)
    {
        if (!ValidId(id, "image") && !ValidId(id, "gif")) return null;
        var path = Path.Combine(directory, id);
        return File.Exists(path) ? (path, ContentType(id)) : null;
    }

    private static string ContentType(string id) => Path.GetExtension(id) == ".jpg"
        ? "image/jpeg" : "image/" + Path.GetExtension(id)[1..];
}
