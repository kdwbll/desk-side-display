using System.Reflection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Primitives;

sealed class EmbeddedWebFiles : IFileProvider
{
    private readonly Assembly assembly = typeof(EmbeddedWebFiles).Assembly;
    private readonly Dictionary<string, string> paths;

    public EmbeddedWebFiles()
    {
        paths = assembly.GetManifestResourceNames()
            .Where(name => name.StartsWith("web/", StringComparison.Ordinal))
            .ToDictionary(name => name[4..].Replace('\\', '/'), StringComparer.Ordinal);
    }

    public IFileInfo GetFileInfo(string subpath) =>
        paths.TryGetValue(subpath.TrimStart('/'), out var name)
            ? new WebFile(assembly, name, Path.GetFileName(subpath))
            : new NotFoundFileInfo(subpath);

    public IDirectoryContents GetDirectoryContents(string subpath) => NotFoundDirectoryContents.Singleton;
    public IChangeToken Watch(string filter) => NullChangeToken.Singleton;

    private sealed class WebFile(Assembly assembly, string resource, string name) : IFileInfo
    {
        public bool Exists => true;
        public long Length { get { using var stream = CreateReadStream(); return stream.Length; } }
        public string? PhysicalPath => null;
        public string Name => name;
        public DateTimeOffset LastModified => DateTimeOffset.UnixEpoch;
        public bool IsDirectory => false;
        public Stream CreateReadStream() => assembly.GetManifestResourceStream(resource)!;
    }
}
