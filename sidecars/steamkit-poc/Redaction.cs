using System.Text;
using System.Text.RegularExpressions;

namespace SteamKitPoc;

public class RedactionWriter : TextWriter
{
    private readonly TextWriter _inner;
    private readonly List<Regex> _patterns;

    public override Encoding Encoding => _inner.Encoding;

    public RedactionWriter(TextWriter inner)
    {
        _inner = inner;
        _patterns =
        [
            new(@"\b[0-9a-fA-F]{64}\b", RegexOptions.Compiled),
            new(@"eyJ[a-zA-Z0-9_\-]+\.eyJ[a-zA-Z0-9_\-]+\.[a-zA-Z0-9_\-]+", RegexOptions.Compiled),
            new(@"https://steamloopback\.host/[^\s""<>]*", RegexOptions.Compiled),
        ];
    }

    public override void Write(char value)
    {
        _inner.Write(value);
    }

    public override void Write(string? value)
    {
        if (value == null) return;
        _inner.Write(Redact(value));
    }

    public override void WriteLine(string? value)
    {
        _inner.WriteLine(value != null ? Redact(value) : null);
    }

    public string Redact(string input)
    {
        foreach (var pattern in _patterns)
        {
            input = pattern.Replace(input, "***REDACTED***");
        }
        return input;
    }

    public static string MaskHex(string hex)
    {
        if (hex.Length <= 16) return hex[..4] + "..." + hex[^4..];
        return hex[..8] + "..." + hex[^8..];
    }
}
