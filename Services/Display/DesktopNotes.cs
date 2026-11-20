using System.ComponentModel;
using System.Diagnostics;

sealed class DesktopNotes(string desktop)
{
    public string? CreateAndOpen(string text)
    {
        string path;
        try
        {
            if (!Directory.Exists(desktop)) return "找不到 Windows 桌面文件夹。";
            path = CreateFile(text);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return "无法在 Windows 桌面保存便签。";
        }

        try
        {
            OpenNotepad(path);
            return null;
        }
        catch (Exception error) when (error is Win32Exception or InvalidOperationException or UnauthorizedAccessException)
        {
            return $"已在桌面保存「{Path.GetFileName(path)}」，记事本未能打开。";
        }
    }

    private string CreateFile(string text)
    {
        var stem = "便签 " + DateTime.Now.ToString("yyyy-MM-dd HH-mm-ss", System.Globalization.CultureInfo.InvariantCulture);
        var temporary = Path.Combine(desktop, $".desk-side-display-{Guid.NewGuid():N}.tmp");
        try
        {
            File.WriteAllText(temporary, text);
            for (var number = 1; ; number++)
            {
                var filename = number == 1 ? stem + ".txt" : $"{stem} ({number}).txt";
                var path = Path.Combine(desktop, filename);
                try
                {
                    File.Move(temporary, path);
                    return path;
                }
                catch (IOException) when (File.Exists(path) || Directory.Exists(path)) { }
            }
        }
        finally { File.Delete(temporary); }
    }

    private static void OpenNotepad(string path)
    {
        var start = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "notepad.exe"))
        {
            UseShellExecute = false
        };
        start.ArgumentList.Add(path);
        using var process = Process.Start(start) ?? throw new InvalidOperationException();
    }
}
