using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;

sealed class KeyboardShortcut
{
    private const uint ExtendedKey = 0x0001;
    private const uint KeyUp = 0x0002;
    private readonly object gate = new();
    private long lastPress;
    private static readonly Dictionary<string, ushort> Modifiers = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Ctrl"] = 0x11, ["Alt"] = 0x12, ["Shift"] = 0x10, ["Win"] = 0x5B
    };
    private static readonly Dictionary<string, ushort> NamedKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Backspace"] = 0x08, ["Tab"] = 0x09, ["Enter"] = 0x0D, ["Pause"] = 0x13,
        ["CapsLock"] = 0x14, ["Esc"] = 0x1B, ["Escape"] = 0x1B, ["Space"] = 0x20,
        ["PageUp"] = 0x21, ["PageDown"] = 0x22, ["End"] = 0x23, ["Home"] = 0x24,
        ["Left"] = 0x25, ["Up"] = 0x26, ["Right"] = 0x27, ["Down"] = 0x28,
        ["PrintScreen"] = 0x2C, ["Insert"] = 0x2D, ["Delete"] = 0x2E, ["Menu"] = 0x5D,
        ["Multiply"] = 0x6A, ["Add"] = 0x6B, ["Subtract"] = 0x6D, ["Decimal"] = 0x6E,
        ["Divide"] = 0x6F, ["NumLock"] = 0x90, ["ScrollLock"] = 0x91,
        ["VolumeMute"] = 0xAD, ["VolumeDown"] = 0xAE, ["VolumeUp"] = 0xAF,
        ["NextTrack"] = 0xB0, ["PreviousTrack"] = 0xB1, ["MediaStop"] = 0xB2, ["MediaPlayPause"] = 0xB3,
        [";"] = 0xBA, ["="] = 0xBB, [","] = 0xBC, ["-"] = 0xBD,
        ["."] = 0xBE, ["/"] = 0xBF, ["`"] = 0xC0, ["["] = 0xDB, ["\\"] = 0xDC, ["]"] = 0xDD, ["'"] = 0xDE
    };

    public static bool TryParseChord(string? text, out ushort[] keys)
    {
        keys = [];
        if (string.IsNullOrWhiteSpace(text) || text.Length > 64) return false;
        var pieces = text.Split('+', StringSplitOptions.TrimEntries);
        if (pieces.Length > 5 || !TryKey(pieces[^1], out var key)) return false;
        var chord = new List<ushort>(pieces.Length);
        foreach (var part in pieces[..^1])
        {
            if (!Modifiers.TryGetValue(part, out var modifier) || chord.Contains(modifier)) return false;
            chord.Add(modifier);
        }
        if (chord.Contains(key)) return false;
        chord.Add(key);
        keys = chord.ToArray();
        return true;
    }

    private static bool TryKey(string text, out ushort key)
    {
        if (NamedKeys.TryGetValue(text, out key) || Modifiers.TryGetValue(text, out key)) return true;
        var upper = text.ToUpperInvariant();
        if (upper.Length == 1 && upper[0] is >= '0' and <= '9' or >= 'A' and <= 'Z')
            key = upper[0];
        else if (upper.StartsWith('F') && ushort.TryParse(upper.AsSpan(1), out var function) && function is >= 1 and <= 24)
            key = (ushort)(0x6F + function);
        else if (upper is ['N', 'U', 'M', 'P', 'A', 'D', >= '0' and <= '9'])
            key = (ushort)(0x60 + upper[^1] - '0');
        else if (upper.Length == 4 && upper.StartsWith("VK", StringComparison.Ordinal) &&
                 ushort.TryParse(upper.AsSpan(2), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out var raw) &&
                 raw is >= 0x08 and <= 0xFE && raw != 0xE7)
            key = raw;
        else
            return false;
        return true;
    }

    public string? Press(string? text)
    {
        if (!TryParseChord(text, out var keys)) return "快捷键配置无效。";
        lock (gate)
        {
            var now = Stopwatch.GetTimestamp();
            if (lastPress != 0 && Stopwatch.GetElapsedTime(lastPress, now) < TimeSpan.FromMilliseconds(150))
                return "点击过快，请稍后再试。";
            if ((GetAsyncKeyState(keys[^1]) & 0x8000) != 0)
                return "主按键已经按下。请松开后再试。";
            lastPress = now;
            var down = keys.Where(key => (GetAsyncKeyState(key) & 0x8000) == 0).ToArray();
            if (down.Length == 0) return "这些按键已在按下。";
            var up = down.Reverse().Select(key => Input.ForKey(key, true)).ToArray();
            var inputs = down.Select(key => Input.ForKey(key, false)).Concat(up).ToArray();
            var sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<Input>());
            if (sent == inputs.Length) return null;
            if (sent > 0) SendInput((uint)up.Length, up, Marshal.SizeOf<Input>());
            return "Windows 未接收快捷键。请确认目标窗口可接收普通键盘输入。";
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Input
    {
        public uint Type;
        public InputData Data;

        public static Input ForKey(ushort key, bool release) => new()
        {
            Type = 1,
            Data = new InputData
            {
                Keyboard = new KeyboardInput
                {
                    Key = key,
                    Flags = (release ? KeyUp : 0) |
                            (key is >= 0x21 and <= 0x2E or 0x5B or 0x5C or 0x5D or 0x6F or 0x90 or 0xA3 or 0xA5 ? ExtendedKey : 0)
                }
            }
        };
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputData
    {
        [FieldOffset(0)] public KeyboardInput Keyboard;
        [FieldOffset(0)] public MouseInput Mouse;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardInput
    {
        public ushort Key, Scan;
        public uint Flags, Time;
        public nuint Extra;
    }

    // INPUT contains a union. Its mouse variant determines the native union size.
    [StructLayout(LayoutKind.Sequential)]
    private struct MouseInput
    {
        public int X, Y;
        public uint Data, Flags, Time;
        public nuint Extra;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint count, Input[] inputs, int size);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int key);
}
