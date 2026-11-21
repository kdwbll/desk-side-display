using System.Text.Json;
using System.Text.RegularExpressions;

sealed record LyricAppearance(string TextColor, int ContextOpacity, decimal Blur, string BackgroundColor,
    string BackgroundMode = "fixed", decimal FlowSpeed = 1m, int FlowBlend = 0)
{
    public static LyricAppearance Default { get; } = new("#f8f1e8", 29, 0.8m, "#171923");

    public bool IsValid() =>
        IsColor(TextColor) && IsColor(BackgroundColor) && BackgroundMode is "fixed" or "album" &&
        ContextOpacity is >= 0 and <= 100 && Blur is >= 0 and <= 6 &&
        FlowSpeed is >= 0 and <= 3 && FlowBlend is >= -100 and <= 100;

    private static bool IsColor(string? value) => value != null && Regex.IsMatch(value, @"\A#[0-9a-fA-F]{6}\z");
}

sealed record LyricPreset(Guid Id, string Name, LyricAppearance Appearance);
sealed record LyricAppearanceState(LyricAppearance Appearance, LyricPreset[] Presets);
sealed record LyricPresetRequest(Guid? Id, string? Name, LyricAppearance? Appearance);

sealed class LyricAppearanceSettings
{
    public const int MaxPresets = 10;
    private readonly object gate = new();
    private readonly string path;
    private LyricAppearanceState state = new(LyricAppearance.Default, []);

    public LyricAppearanceSettings(string dataPath)
    {
        path = Path.Combine(dataPath, "lyrics-appearance.json");
        if (!File.Exists(path)) return;
        try
        {
            var saved = JsonSerializer.Deserialize<LyricAppearanceState>(File.ReadAllText(path));
            if (saved?.Appearance?.IsValid() != true) return;
            var presets = (saved.Presets ?? [])
                .Where(preset => preset?.Appearance?.IsValid() == true && preset.Name is { Length: > 0 and <= 24 })
                .DistinctBy(preset => preset.Id).Take(MaxPresets).ToArray();
            state = new(saved.Appearance, presets);
        }
        catch (JsonException) { }
    }

    public LyricAppearanceState Read()
    {
        lock (gate) return state;
    }

    public LyricAppearanceState SetAppearance(LyricAppearance appearance)
    {
        lock (gate) return Save(state with { Appearance = appearance });
    }

    public (LyricAppearanceState? State, string? Error) SavePreset(Guid? id, string? name, LyricAppearance? appearance)
    {
        name = name?.Trim();
        if (name is not { Length: > 0 and <= 24 } || appearance?.IsValid() != true)
            return (null, "请输入 1 到 24 个字符的预设名称，并检查外观设置。");

        lock (gate)
        {
            var existing = Array.FindIndex(state.Presets, preset => preset.Id == id);
            if (id != null && existing < 0) return (null, "这组预设已被删除。");
            if (id == null && state.Presets.Length >= MaxPresets) return (null, "已保存 10 组预设。");
            if (state.Presets.Any(preset => preset.Id != id && preset.Name.Equals(name, StringComparison.OrdinalIgnoreCase)))
                return (null, "已有同名预设。");

            var saved = new LyricPreset(id ?? Guid.NewGuid(), name, appearance);
            var presets = existing < 0 ? [.. state.Presets, saved] : state.Presets.ToArray();
            if (existing >= 0) presets[existing] = saved;
            return (Save(new(appearance, presets)), null);
        }
    }

    public LyricAppearanceState? ApplyPreset(Guid id)
    {
        lock (gate)
        {
            var preset = Array.Find(state.Presets, preset => preset.Id == id);
            return preset == null ? null : Save(state with { Appearance = preset.Appearance });
        }
    }

    public LyricAppearanceState? DeletePreset(Guid id)
    {
        lock (gate)
        {
            var presets = state.Presets.Where(preset => preset.Id != id).ToArray();
            return presets.Length == state.Presets.Length ? null : Save(state with { Presets = presets });
        }
    }

    private LyricAppearanceState Save(LyricAppearanceState next)
    {
        if (state == next) return state;
        PanelSettings.Save(path, JsonSerializer.SerializeToUtf8Bytes(next));
        state = next;
        return state;
    }
}
