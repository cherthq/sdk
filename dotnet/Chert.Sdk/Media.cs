using System.Text.Json;
using System.Text.RegularExpressions;

namespace TryChert;

/// <summary>WHIP publish or experimental WHEP subscribe. v1 is video-only.</summary>
public enum MediaDirection { Publish, Subscribe }
/// <summary>v1 custom-video codecs. H.264 uses Annex B byte streams.</summary>
public enum VideoCodec { H264, Vp8 }

public sealed record MediaLimits(int MaxWidth, int MaxHeight, int MaxFps, int MaxFrameBytes);

/// <summary>RTCIceServer shape. Formatting hides credentials.</summary>
public sealed class MediaIceServer
{
    public required IReadOnlyList<string> Urls { get; init; }
    public string? Username { get; init; }
    public string? Credential { get; init; }
    public string? CredentialType { get; init; }
    public override string ToString() => "MediaIceServer { redacted }";
}

/// <summary>
/// One session-bound signaling grant. Treat <see cref="Endpoint"/> as opaque: pass it with <see cref="Token"/>
/// to a standard WHIP (RFC 9725) or WHEP client and send the same bearer on PATCH/DELETE. Formatting is redacted.
/// </summary>
public sealed class MediaSessionGrant
{
    public required string SessionId { get; init; }
    public required MediaDirection Direction { get; init; }
    public required string Endpoint { get; init; }
    /// <summary>Session-bound bearer; never log it.</summary>
    public required string Token { get; init; }
    public required DateTimeOffset ConnectBy { get; init; }
    public required DateTimeOffset ExpiresAt { get; init; }
    public required IReadOnlyList<MediaIceServer> IceServers { get; init; }
    public required IReadOnlyList<VideoCodec> Codecs { get; init; }
    public required MediaLimits Limits { get; init; }
    public override string ToString() => "MediaSessionGrant { redacted }";

    // Case-insensitive T/Z as in the reference SDK.
    private static readonly Regex Rfc3339 = new(@"\A([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})\z",
        RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);
    private static DateTimeOffset Time(JsonElement grant, string name)
    {
        if (!grant.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.String || Rfc3339.Match(value.GetString()!) is not { Success: true } match)
            throw new JsonException();
        // .NET keeps 7 fractional digits; comparisons use milliseconds, as JavaScript Date.parse does.
        var fraction = match.Groups[2].Value.Length > 8 ? match.Groups[2].Value[..8] : match.Groups[2].Value;
        if (!DateTimeOffset.TryParse((match.Groups[1].Value + fraction + match.Groups[3].Value).ToUpperInvariant(),
            System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var time)) throw new JsonException();
        return time;
    }
    private static string? Text(JsonElement value, string name)
        => value.TryGetProperty(name, out var field) && field.ValueKind == JsonValueKind.String ? field.GetString() : null;
    internal static bool LocalOrHttps(string endpoint)
    {
        if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) || uri.UserInfo.Length > 0 || uri.Fragment is not ("" or "#")) return false;
        return uri.Scheme == "https" || (uri.Scheme == "http" && uri.Host is "localhost" or "127.0.0.1" or "[::1]");
    }
    /// <summary>Throws <see cref="JsonException"/> for any contract violation.</summary>
    internal static MediaSessionGrant Parse(JsonElement grant, MediaDirection direction, IReadOnlyList<VideoCodec>? requested)
    {
        if (grant.ValueKind != JsonValueKind.Object) throw new JsonException();
        var wire = direction == MediaDirection.Publish ? "publish" : "subscribe";
        var id = Text(grant, "session_id");
        var endpoint = Text(grant, "endpoint");
        var token = Text(grant, "token");
        if (Text(grant, "direction") != wire || id is null || !Regex.IsMatch(id, @"\A[0-9a-fA-F-]{36}\z") || endpoint is null || !LocalOrHttps(endpoint)
            || string.IsNullOrEmpty(token) || token.IndexOfAny(new[] { '\r', '\n' }) >= 0) throw new JsonException();
        var connectBy = Time(grant, "connect_by");
        var expiresAt = Time(grant, "expires_at");
        if (connectBy.ToUnixTimeMilliseconds() > expiresAt.ToUnixTimeMilliseconds()) throw new JsonException();
        if (!grant.TryGetProperty("ice_servers", out var servers) || servers.ValueKind != JsonValueKind.Array) throw new JsonException();
        var ice = new List<MediaIceServer>();
        foreach (var server in servers.EnumerateArray())
        {
            if (server.ValueKind != JsonValueKind.Object || !server.TryGetProperty("urls", out var urls)) throw new JsonException();
            List<string> list;
            if (urls.ValueKind == JsonValueKind.String) list = [urls.GetString()!];
            else if (urls.ValueKind == JsonValueKind.Array && urls.GetArrayLength() > 0 && urls.EnumerateArray().All(u => u.ValueKind == JsonValueKind.String))
                list = urls.EnumerateArray().Select(u => u.GetString()!).ToList();
            else throw new JsonException();
            // Optional fields must be absent or strings (JSON null rejects); credentialType is only "password".
            foreach (var field in new[] { "username", "credential", "credentialType" })
                if (server.TryGetProperty(field, out var optional) && optional.ValueKind != JsonValueKind.String) throw new JsonException();
            if (server.TryGetProperty("credentialType", out var kind) && kind.GetString() != "password") throw new JsonException();
            ice.Add(new() { Urls = list, Username = Text(server, "username"), Credential = Text(server, "credential"), CredentialType = Text(server, "credentialType") });
        }
        if (!grant.TryGetProperty("codecs", out var codecs) || codecs.ValueKind != JsonValueKind.Array || codecs.GetArrayLength() == 0) throw new JsonException();
        var codecList = codecs.EnumerateArray().Select(c => c.ValueKind != JsonValueKind.String ? throw new JsonException()
            : c.GetString() switch { "h264" => VideoCodec.H264, "vp8" => VideoCodec.Vp8, _ => throw new JsonException() }).ToList();
        if (codecList.Distinct().Count() != codecList.Count || (requested is not null && codecList.Any(c => !requested.Contains(c)))) throw new JsonException();
        var (maxWidth, maxHeight) = direction == MediaDirection.Publish ? (1920, 1080) : (1280, 720);
        if (!grant.TryGetProperty("limits", out var limits) || limits.ValueKind != JsonValueKind.Object) throw new JsonException();
        int Limit(string name, int max) => MediaCapabilities.JsInteger(limits, name, max) ?? throw new JsonException();
        return new()
        {
            SessionId = id, Direction = direction, Endpoint = endpoint, Token = token, ConnectBy = connectBy, ExpiresAt = expiresAt,
            IceServers = ice, Codecs = codecList,
            Limits = new(Limit("max_width", maxWidth), Limit("max_height", maxHeight), Limit("max_fps", 30), Limit("max_frame_bytes", VideoFrame.MaxFrameBytes))
        };
    }
}

/// <summary>Customer-published video (WHIP or LiveKit).</summary>
public sealed record CustomVideoCapability(IReadOnlyList<string> Transports, IReadOnlyList<VideoCodec> Codecs, int MaxWidth, int MaxHeight, int MaxFps)
{
    public bool Supported => true;
}
/// <summary>Caller video delivered to the customer (WHEP or LiveKit).</summary>
public sealed record InboundCallerVideoCapability(IReadOnlyList<string> Transports, int MaxWidth, int MaxHeight, int MaxFps)
{
    public bool Supported => true;
}

/// <summary>Explicit, versioned media capabilities. A null section is unsupported; never infer from generic video flags.</summary>
public sealed record MediaCapabilities(CustomVideoCapability? CustomVideo, InboundCallerVideoCapability? InboundCallerVideo)
{
    public int Version => 1;
    public static MediaCapabilities Unsupported { get; } = new(null, null);

    // JavaScript Number.isInteger(v) && 0 < v <= max.
    internal static int? JsInteger(JsonElement owner, string name, int max)
        => owner.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number)
            && number > 0 && number <= max && Math.Truncate(number) == number ? (int)number : null;
    private static List<string>? List(JsonElement owner, string name, params string[] allowed)
    {
        if (!owner.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Array) return null;
        var result = new List<string>();
        foreach (var item in value.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String || !allowed.Contains(item.GetString())) return null;
            if (!result.Contains(item.GetString()!)) result.Add(item.GetString()!);
        }
        return result;
    }
    private static bool Enabled(JsonElement owner, string name, out JsonElement section)
        => owner.TryGetProperty(name, out section) && section.ValueKind == JsonValueKind.Object
            && section.TryGetProperty("supported", out var supported) && supported.ValueKind == JsonValueKind.True;

    /// <summary>
    /// Parses a raw <c>media_capabilities</c> value. Absent, malformed or unknown-version input is unsupported;
    /// a malformed section disables only that section. Bounds are capped at SDK v1 limits.
    /// </summary>
    public static MediaCapabilities Parse(JsonElement? input)
    {
        if (input is not { ValueKind: JsonValueKind.Object } raw || !raw.TryGetProperty("version", out var version)
            || version.ValueKind != JsonValueKind.Number || !version.TryGetDouble(out var v) || v != 1) return Unsupported;
        CustomVideoCapability? custom = null;
        InboundCallerVideoCapability? inbound = null;
        if (Enabled(raw, "custom_video", out var cv))
        {
            var transports = List(cv, "transports", "whip", "livekit");
            var codecs = List(cv, "codecs", "h264", "vp8");
            if (transports is { Count: > 0 } && codecs is { Count: > 0 } && JsInteger(cv, "max_width", 1920) is int w
                && JsInteger(cv, "max_height", 1080) is int h && JsInteger(cv, "max_fps", 30) is int f)
                custom = new(transports, codecs.Select(c => c == "h264" ? VideoCodec.H264 : VideoCodec.Vp8).ToList(), w, h, f);
        }
        if (Enabled(raw, "inbound_caller_video", out var iv))
        {
            var transports = List(iv, "transports", "whep", "livekit");
            if (transports is { Count: > 0 } && JsInteger(iv, "max_width", 1280) is int w
                && JsInteger(iv, "max_height", 720) is int h && JsInteger(iv, "max_fps", 30) is int f)
                inbound = new(transports, w, h, f);
        }
        return new(custom, inbound);
    }
}

public enum PixelFormat { I420, Nv12, Rgba, Bgra }
public enum ColorSpace { Bt709Limited, Bt601Limited, SrgbFull }

/// <summary>One image plane; Stride is bytes per row.</summary>
public sealed record VideoPlane(ReadOnlyMemory<byte> Data, int Stride);

/// <summary>Caller-owned raw frame. TimestampUs is monotonic microseconds from the source clock.</summary>
public sealed class VideoFrameInit
{
    public required PixelFormat Format { get; init; }
    public required int Width { get; init; }
    public required int Height { get; init; }
    public required IReadOnlyList<VideoPlane> Planes { get; init; }
    public required long TimestampUs { get; init; }
    public long? DurationUs { get; init; }
    /// <summary>Clockwise degrees: 0, 90, 180 or 270. Defaults to 0.</summary>
    public int? Rotation { get; init; }
    /// <summary>Defaults to Bt709Limited for YUV and SrgbFull for RGB.</summary>
    public ColorSpace? ColorSpace { get; init; }
}

/// <summary>Code is <c>invalid_frame</c> or <c>frame_too_large</c>.</summary>
public sealed class MediaFrameException : ArgumentException
{
    public string Code { get; }
    internal MediaFrameException(string code, string message) : base(message) => Code = code;
}

/// <summary>A validated frame that owns copies of exactly the bytes each plane requires.</summary>
public sealed class VideoFrame
{
    public const int MaxWidth = 1920, MaxHeight = 1080, MinDimension = 16, MaxFrameBytes = 8 * 1024 * 1024;
    public PixelFormat Format { get; }
    public int Width { get; }
    public int Height { get; }
    public IReadOnlyList<VideoPlane> Planes { get; }
    public long TimestampUs { get; }
    public long? DurationUs { get; }
    public int Rotation { get; }
    public ColorSpace ColorSpace { get; }
    private VideoFrame(VideoFrameInit input, IReadOnlyList<VideoPlane> planes, ColorSpace colorSpace)
        => (Format, Width, Height, Planes, TimestampUs, DurationUs, Rotation, ColorSpace)
            = (input.Format, input.Width, input.Height, planes, input.TimestampUs, input.DurationUs, input.Rotation ?? 0, colorSpace);

    public static void CheckDimensions(int width, int height)
    {
        if (width % 2 != 0 || height % 2 != 0 || width < MinDimension || height < MinDimension || width > MaxWidth || height > MaxHeight)
            throw new MediaFrameException("invalid_frame", $"Dimensions must be even integers between {MinDimension} and {MaxWidth}x{MaxHeight}.");
    }

    /// <summary>Validates and copies stride*(rows-1)+rowBytes bytes per plane so callers may reuse buffers.</summary>
    public static VideoFrame Copy(VideoFrameInit input)
    {
        ArgumentNullException.ThrowIfNull(input);
        int cw = input.Width / 2, ch = input.Height / 2;
        (int RowBytes, int Rows)[] layout = input.Format switch
        {
            PixelFormat.Rgba or PixelFormat.Bgra => [(input.Width * 4, input.Height)],
            PixelFormat.I420 => [(input.Width, input.Height), (cw, ch), (cw, ch)],
            PixelFormat.Nv12 => [(input.Width, input.Height), (input.Width, ch)],
            _ => throw new MediaFrameException("invalid_frame", "Unsupported pixel format.")
        };
        CheckDimensions(input.Width, input.Height);
        if (input.TimestampUs < 0) throw new MediaFrameException("invalid_frame", "TimestampUs must be non-negative.");
        if (input.DurationUs is <= 0) throw new MediaFrameException("invalid_frame", "DurationUs must be a positive integer.");
        if (input.Rotation is not (null or 0 or 90 or 180 or 270)) throw new MediaFrameException("invalid_frame", "Unsupported rotation.");
        if (input.ColorSpace is { } space && !Enum.IsDefined(space)) throw new MediaFrameException("invalid_frame", "Unsupported color space.");
        if (input.Planes is null || input.Planes.Count != layout.Length) throw new MediaFrameException("invalid_frame", $"{input.Format} requires {layout.Length} plane(s).");
        var total = 0;
        var copied = new VideoPlane[layout.Length];
        for (var i = 0; i < layout.Length; i++)
        {
            var (rowBytes, rows) = layout[i];
            var plane = input.Planes[i];
            if (plane is null || plane.Stride < rowBytes || plane.Stride > rowBytes + 256)
                throw new MediaFrameException("invalid_frame", $"Plane {i} stride must be between {rowBytes} and {rowBytes + 256} bytes.");
            var needed = plane.Stride * (rows - 1) + rowBytes;
            if (plane.Data.Length < needed) throw new MediaFrameException("invalid_frame", $"Plane {i} needs at least {needed} bytes.");
            total += needed;
            if (total > MaxFrameBytes) throw new MediaFrameException("frame_too_large", "Frame exceeds 8 MiB.");
            copied[i] = new(plane.Data[..needed].ToArray(), plane.Stride);
        }
        var yuv = input.Format is PixelFormat.I420 or PixelFormat.Nv12;
        return new(input, copied, input.ColorSpace ?? (yuv ? ColorSpace.Bt709Limited : ColorSpace.SrgbFull));
    }
}
