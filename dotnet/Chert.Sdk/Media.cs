using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace TryChert;

/// <summary>WHIP publish or experimental WHEP subscribe. v1 is video-only.</summary>
public enum MediaDirection { Publish, Subscribe }
/// <summary>v1 custom-video codecs. H.264 uses Annex B byte streams.</summary>
public enum VideoCodec { H264, Vp8 }
/// <summary>What a capability section can carry. <c>Screen</c> on custom video means an agent can stream a screen (15 fps cap);
/// on inbound caller video it means the caller's shared screen is available as a <c>CallerScreen</c> subscription.</summary>
public enum MediaContent { Camera, Screen }
/// <summary>
/// What a session carries. Publish: <c>Camera</c> (default) or <c>Screen</c> (an agent's screen, capped at 15 fps).
/// Subscribe: omit for the caller's video, or <c>CallerScreen</c> for the caller's shared screen (only while sharing).
/// A call has one publish slot (<c>media_session_conflict</c>).
/// </summary>
public enum MediaSessionContent { Camera, Screen, CallerScreen }

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
    /// <summary>Echo of the requested content; null on grants for the default content.</summary>
    public MediaSessionContent? Content { get; init; }
    public override string ToString() => "MediaSessionGrant { redacted }";
    internal static string Wire(MediaSessionContent content) => content switch
    {
        MediaSessionContent.Camera => "camera", MediaSessionContent.Screen => "screen", MediaSessionContent.CallerScreen => "caller_screen",
        _ => throw new ArgumentOutOfRangeException(nameof(content))
    };

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
    internal static MediaSessionGrant Parse(JsonElement grant, MediaDirection direction, IReadOnlyList<VideoCodec>? requested,
        MediaSessionContent? content = null)
    {
        if (grant.ValueKind != JsonValueKind.Object) throw new JsonException();
        // A requested content must be echoed exactly; a default request accepts no echo or camera (either direction).
        var echoed = grant.TryGetProperty("content", out var echo);
        var echoText = echoed && echo.ValueKind == JsonValueKind.String ? echo.GetString() : null;
        if (content is { } wanted ? echoText != Wire(wanted) : echoed && echoText != "camera") throw new JsonException();
        MediaSessionContent? granted = echoed ? content ?? MediaSessionContent.Camera : null;
        var maxFps = granted == MediaSessionContent.Screen ? 15 : 30;
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
            IceServers = ice, Codecs = codecList, Content = granted,
            Limits = new(Limit("max_width", maxWidth), Limit("max_height", maxHeight), Limit("max_fps", maxFps), Limit("max_frame_bytes", VideoFrame.MaxFrameBytes))
        };
    }
}

/// <summary>Customer-published video (WHIP or LiveKit).</summary>
public sealed record CustomVideoCapability(IReadOnlyList<string> Transports, IReadOnlyList<VideoCodec> Codecs, int MaxWidth, int MaxHeight, int MaxFps)
{
    public bool Supported => true;
    /// <summary>What may be published; never empty.</summary>
    public IReadOnlyList<MediaContent> Contents { get; init; } = [MediaContent.Camera];
}
/// <summary>Caller video delivered to the customer (WHEP or LiveKit).</summary>
public sealed record InboundCallerVideoCapability(IReadOnlyList<string> Transports, int MaxWidth, int MaxHeight, int MaxFps)
{
    public bool Supported => true;
    /// <summary>What may be received; never empty.</summary>
    public IReadOnlyList<MediaContent> Contents { get; init; } = [MediaContent.Camera];
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
    // Unknown entries are ignored for forward compatibility; absent or empty means camera only.
    private static List<MediaContent> Contents(JsonElement owner)
    {
        var result = new List<MediaContent>();
        if (owner.TryGetProperty("contents", out var value) && value.ValueKind == JsonValueKind.Array)
            foreach (var item in value.EnumerateArray())
                if (item.ValueKind == JsonValueKind.String && item.GetString() switch { "camera" => MediaContent.Camera, "screen" => MediaContent.Screen, _ => (MediaContent?)null } is { } c
                    && !result.Contains(c)) result.Add(c);
        if (result.Count == 0) result.Add(MediaContent.Camera);
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
                custom = new(transports, codecs.Select(c => c == "h264" ? VideoCodec.H264 : VideoCodec.Vp8).ToList(), w, h, f) { Contents = Contents(cv) };
        }
        if (Enabled(raw, "inbound_caller_video", out var iv))
        {
            var transports = List(iv, "transports", "whep", "livekit");
            if (transports is { Count: > 0 } && JsInteger(iv, "max_width", 1280) is int w
                && JsInteger(iv, "max_height", 720) is int h && JsInteger(iv, "max_fps", 30) is int f)
                inbound = new(transports, w, h, f) { Contents = Contents(iv) };
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

// Call video composition (draft, unreleased): the call's video as up to two layers, composed server-side and published
// through the call's single publish slot. A base layer (z 0) carries camera frames over a publish grant or a
// backend-managed source; page layers (z >= 1) are living sessions of ready deployments. Native SDKs do not deploy
// pages or drive page state, events or input.

/// <summary><c>Camera</c>: the response carries a publish grant for WHIP frames. <c>Managed</c>: a backend-provided source,
/// only where the <c>video_composition</c> capability lists it.</summary>
public enum CompositionBaseKind { Camera, Managed }
/// <summary><c>Transparent</c> renders the page with alpha (premultiplied source-over).</summary>
public enum CompositionBackground { Opaque, Transparent }
public enum LivingInputKind { Pointer, Keyboard, Text }
public enum CompositionStatus { Starting, Live, Stopping, Stopped, Failed }
public enum LivingSessionStatus { Starting, Ready, Live, Stopping, Stopped, Failed }

/// <summary>Normalized to the output frame: 0..1, width/height &gt; 0, and x+width, y+height &lt;= 1.</summary>
public sealed record CompositionRegion(double X, double Y, double Width, double Height)
{
    public static CompositionRegion Full { get; } = new(0, 0, 1, 1);
}

public abstract record VideoLayerInput(string Id);
public sealed record BaseLayerInput(string Id, CompositionBaseKind Source) : VideoLayerInput(Id);
/// <summary>
/// A page layer. <see cref="DeploymentId"/> names a ready living-service deployment: the call-video resource never loads a
/// URL, and native SDKs cannot deploy one (deploy with the TypeScript SDK).
/// </summary>
public sealed record PageLayerInput(string Id, int Z, string DeploymentId) : VideoLayerInput(Id)
{
    /// <summary>Default: full frame.</summary>
    public CompositionRegion? Region { get; init; }
    /// <summary>Default: opaque.</summary>
    public CompositionBackground? Background { get; init; }
    /// <summary>Layer multiplier 0..1. Default 1.</summary>
    public double? Opacity { get; init; }
    /// <summary>Agent-relayed input kinds; null for a non-interactive layer.</summary>
    public IReadOnlyList<LivingInputKind>? Input { get; init; }
    /// <summary>Plain JSON up to 64 KiB.</summary>
    public JsonElement? InitialState { get; init; }
}

/// <summary>
/// Set either <see cref="DeploymentId"/> (the page shortcut: one opaque full-frame page layer, id <c>page</c>, z 1) or
/// <see cref="Layers"/>. <see cref="Revision"/> makes the PUT compare-and-set; it must equal the current revision.
/// </summary>
public sealed class SetCallVideo
{
    /// <summary>A ready deployment ID. URL pages are not accepted: deploy them with the TypeScript SDK first.</summary>
    public string? DeploymentId { get; init; }
    public IReadOnlyList<LivingInputKind>? Input { get; init; }
    public JsonElement? InitialState { get; init; }
    public IReadOnlyList<VideoLayerInput>? Layers { get; init; }
    public long? Revision { get; init; }
}

public sealed record LivingViewport(int Width, int Height);
/// <summary>The living session rendering a page layer; effective viewport and fps.</summary>
public sealed record LivingSession(string SessionId, string CallId, string DeploymentId, LivingSessionStatus Status, LivingViewport Viewport,
    int Fps, string? ReadyAt, string? LastHeartbeatAt, string? ErrorCode);
/// <summary>Effective output: fps = min(base fps, grant limit); page layers render at or below it.</summary>
public sealed record CompositionOutput(int Width, int Height, int Fps);
public abstract record VideoLayer(string Id, int Z);
/// <summary>The base layer, always at z 0. <see cref="Publish"/> is a camera publish grant when the backend issues one.</summary>
public sealed record BaseLayer(string Id, CompositionBaseKind Source, MediaSessionGrant? Publish) : VideoLayer(Id, 0);
public sealed record PageLayer(string Id, int Z, LivingSession LivingSession, CompositionRegion Region, CompositionBackground Background,
    double Opacity, IReadOnlyList<LivingInputKind> Input) : VideoLayer(Id, Z);

/// <summary>One validated composition. Formatting is redacted because a base layer may carry a publish grant.</summary>
public sealed class CallVideoComposition
{
    /// <summary>SDK v1 layer bound. The capability's <c>max_layers</c> is the backend's real limit.</summary>
    public const int MaxLayers = 2;
    public required string CompositionId { get; init; }
    public required string CallId { get; init; }
    public required long Revision { get; init; }
    public required CompositionStatus Status { get; init; }
    public required CompositionOutput Output { get; init; }
    public required IReadOnlyList<VideoLayer> Layers { get; init; }
    public string? ErrorCode { get; init; }
    public override string ToString() => "CallVideoComposition { redacted }";

    private const long MaxSafeInteger = 9_007_199_254_740_991;
    private static readonly Regex LayerId = new(@"\A[a-z][a-z0-9_-]{0,31}\z", RegexOptions.CultureInvariant);
    // initial_state may nest 64 levels below the body's own nesting.
    internal static readonly JsonSerializerOptions Deep = new() { MaxDepth = 256 };
    private static readonly JsonSerializerOptions Compact = new() { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping, MaxDepth = 256 };
    private static bool Unit(double n) => double.IsFinite(n) && n >= 0 && n <= 1;
    private static bool RegionOk(CompositionRegion? r) => r is not null && Unit(r.X) && Unit(r.Y) && Unit(r.Width) && Unit(r.Height)
        && r.Width > 0 && r.Height > 0 && r.X + r.Width <= 1 + 1e-9 && r.Y + r.Height <= 1 + 1e-9;
    private static bool InputsOk(IReadOnlyList<LivingInputKind> kinds) => kinds.All(Enum.IsDefined) && kinds.Distinct().Count() == kinds.Count;
    private static string Wire(LivingInputKind kind) => kind.ToString().ToLowerInvariant();
    private static void PlainJson(JsonElement value, int max)
    {
        var nodes = 0;
        bool Walk(JsonElement v, int depth) => depth <= 64 && ++nodes <= max && v.ValueKind switch
        {
            JsonValueKind.Array => v.EnumerateArray().All(x => Walk(x, depth + 1)),
            JsonValueKind.Object => v.EnumerateObject().All(p => Walk(p.Value, depth + 1)),
            JsonValueKind.Undefined => false,
            _ => true
        };
        if (!Walk(value, 0)) throw new ArgumentException("initial_state must be plain JSON.");
        if (JsonSerializer.SerializeToUtf8Bytes(value, Compact).Length > max) throw new ArgumentException($"initial_state exceeds {max} bytes.");
    }

    /// <summary>Validates locally and returns the PUT body. Throws <see cref="ArgumentException"/> before any request.</summary>
    internal static JsonObject Body(SetCallVideo input)
    {
        if (input is null) throw new ArgumentException("SetCallVideo needs a deployment ID or layers.");
        var layers = input.DeploymentId is not null && input.Layers is null
            ? new VideoLayerInput[] { new PageLayerInput("page", 1, input.DeploymentId) { Input = input.Input, InitialState = input.InitialState } }
            : input.Layers;
        if (layers is null || layers.Count is < 1 or > MaxLayers) throw new ArgumentException($"A composition has 1-{MaxLayers} layers.");
        if (input.Revision is < 0 or > MaxSafeInteger) throw new ArgumentException("revision must be a non-negative integer.");
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var zs = new HashSet<int>();
        var bases = 0;
        var output = new JsonArray();
        PageLayerInput? bottom = null;
        foreach (var layer in layers)
        {
            if (layer?.Id is null || !LayerId.IsMatch(layer.Id) || !ids.Add(layer.Id))
                throw new ArgumentException("Layer ids are unique, 1-32 chars: lowercase letter, then [a-z0-9_-].");
            if (layer is BaseLayerInput b)
            {
                if (++bases > 1) throw new ArgumentException("At most one base layer, always at z 0.");
                if (b.Source is not (CompositionBaseKind.Camera or CompositionBaseKind.Managed)) throw new ArgumentException("A base source is camera or managed.");
                output.Add(new JsonObject { ["id"] = b.Id, ["z"] = 0, ["source"] = new JsonObject { ["kind"] = b.Source == CompositionBaseKind.Camera ? "camera" : "managed" } });
                continue;
            }
            if (layer is not PageLayerInput p) throw new ArgumentException("Layers are BaseLayerInput or PageLayerInput.");
            if (p.Z is < 1 or > 64 || !zs.Add(p.Z)) throw new ArgumentException("Page layer z values are unique integers 1..64.");
            var region = p.Region ?? CompositionRegion.Full;
            if (!RegionOk(region)) throw new ArgumentException("region is normalized 0..1 and must stay inside the frame.");
            var background = p.Background ?? CompositionBackground.Opaque;
            if (background is not (CompositionBackground.Opaque or CompositionBackground.Transparent)) throw new ArgumentException("background is opaque or transparent.");
            var opacity = p.Opacity ?? 1;
            if (!Unit(opacity)) throw new ArgumentException("opacity must be 0..1.");
            if (p.Input is not null && !InputsOk(p.Input)) throw new ArgumentException("input must be a unique subset of pointer, keyboard, text.");
            if (p.InitialState is { } state) PlainJson(state, 64 * 1024);
            if (p.DeploymentId is null || p.DeploymentId.Length is < 1 or > 128 || p.DeploymentId.Contains("://", StringComparison.Ordinal))
                throw new ArgumentException("Pages must be a ready deployment ID; native SDKs cannot deploy URL pages (deploy with the TypeScript SDK).");
            var body = new JsonObject
            {
                ["id"] = p.Id, ["z"] = p.Z, ["page"] = new JsonObject { ["deployment_id"] = p.DeploymentId },
                ["region"] = new JsonObject { ["x"] = region.X, ["y"] = region.Y, ["width"] = region.Width, ["height"] = region.Height },
                ["background"] = background == CompositionBackground.Opaque ? "opaque" : "transparent", ["opacity"] = opacity
            };
            if (p.Input is not null) body["input"] = new JsonArray(p.Input.Select(k => (JsonNode)Wire(k)).ToArray());
            if (p.InitialState is { } initial) body["initial_state"] = JsonNode.Parse(initial.GetRawText(), documentOptions: new() { MaxDepth = 256 });
            if (bottom is null || p.Z < bottom.Z) bottom = p with { Region = region, Background = background, Opacity = opacity };
            output.Add(body);
        }
        // Nothing below the bottom page: it must fill the frame without showing through.
        if (bases == 0 && (bottom!.Region != CompositionRegion.Full || bottom.Background != CompositionBackground.Opaque || bottom.Opacity != 1))
            throw new ArgumentException("Without a base, the bottom page layer must be opaque, full frame and opacity 1.");
        var result = new JsonObject();
        if (input.Revision is { } revision) result["revision"] = revision;
        result["layers"] = output;
        return result;
    }

    // JavaScript Number.isInteger(v) && min <= v <= max (safe integers only).
    private static long? Int(JsonElement owner, string name, long min, long max)
        => owner.ValueKind == JsonValueKind.Object && owner.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number
            && value.TryGetDouble(out var n) && Math.Truncate(n) == n && n >= min && n <= max ? (long)n : null;
    private static int Even(JsonElement owner, string name, int max)
        => Int(owner, name, 16, max) is { } n && n % 2 == 0 ? (int)n : throw new JsonException();
    private static string? NullableText(JsonElement owner, string name)
        => !owner.TryGetProperty(name, out var v) || v.ValueKind == JsonValueKind.Null ? null
            : v.ValueKind == JsonValueKind.String ? v.GetString() : throw new JsonException();
    private static string Text(JsonElement owner, string name)
        => owner.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : throw new JsonException();
    private static double UnitNumber(JsonElement owner, string name)
        => owner.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out var n) && Unit(n) ? n : throw new JsonException();
    private static LivingSession Session(JsonElement s)
    {
        if (s.ValueKind != JsonValueKind.Object || !s.TryGetProperty("viewport", out var viewport) || viewport.ValueKind != JsonValueKind.Object) throw new JsonException();
        var id = Text(s, "session_id");
        if (id.Length == 0) throw new JsonException();
        var status = Text(s, "status") switch
        {
            "starting" => LivingSessionStatus.Starting, "ready" => LivingSessionStatus.Ready, "live" => LivingSessionStatus.Live,
            "stopping" => LivingSessionStatus.Stopping, "stopped" => LivingSessionStatus.Stopped, "failed" => LivingSessionStatus.Failed,
            _ => throw new JsonException()
        };
        return new(id, Text(s, "call_id"), Text(s, "deployment_id"), status, new(Even(viewport, "width", 1920), Even(viewport, "height", 1080)),
            (int)(Int(s, "fps", 1, 30) ?? throw new JsonException()), NullableText(s, "ready_at"), NullableText(s, "last_heartbeat_at"), NullableText(s, "error_code"));
    }

    /// <summary>Throws <see cref="JsonException"/> for any response outside the contract.</summary>
    internal static CallVideoComposition Parse(JsonElement c)
    {
        if (c.ValueKind != JsonValueKind.Object) throw new JsonException();
        var compositionId = Text(c, "composition_id");
        var callId = Text(c, "call_id");
        if (compositionId.Length == 0 || callId.Length == 0) throw new JsonException();
        var revision = Int(c, "revision", 0, MaxSafeInteger) ?? throw new JsonException();
        var status = Text(c, "status") switch
        {
            "starting" => CompositionStatus.Starting, "live" => CompositionStatus.Live, "stopping" => CompositionStatus.Stopping,
            "stopped" => CompositionStatus.Stopped, "failed" => CompositionStatus.Failed, _ => throw new JsonException()
        };
        if (!c.TryGetProperty("error_code", out var errorCode) || errorCode.ValueKind is not (JsonValueKind.Null or JsonValueKind.String)) throw new JsonException();
        if (!c.TryGetProperty("output", out var o) || o.ValueKind != JsonValueKind.Object) throw new JsonException();
        var output = new CompositionOutput(Even(o, "width", 1920), Even(o, "height", 1080), (int)(Int(o, "fps", 1, 30) ?? throw new JsonException()));
        if (!c.TryGetProperty("layers", out var raw) || raw.ValueKind != JsonValueKind.Array || raw.GetArrayLength() > MaxLayers) throw new JsonException();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var zs = new HashSet<long>();
        var layers = new List<VideoLayer>();
        var hasBase = false;
        foreach (var layer in raw.EnumerateArray())
        {
            if (layer.ValueKind != JsonValueKind.Object) throw new JsonException();
            var id = Text(layer, "id");
            var z = Int(layer, "z", 0, MaxSafeInteger);
            if (!ids.Add(id) || (z is { } zv && !zs.Add(zv))) throw new JsonException();
            if (layer.TryGetProperty("source", out var source))
            {
                var kind = source.ValueKind == JsonValueKind.Object && source.TryGetProperty("kind", out var k) && k.ValueKind == JsonValueKind.String
                    ? k.GetString() switch { "camera" => CompositionBaseKind.Camera, "managed" => CompositionBaseKind.Managed, _ => throw new JsonException() }
                    : throw new JsonException();
                if (hasBase || z != 0) throw new JsonException();
                hasBase = true;
                MediaSessionGrant? publish = null;
                if (layer.TryGetProperty("publish", out var grant))
                {
                    if (kind != CompositionBaseKind.Camera) throw new JsonException();
                    publish = MediaSessionGrant.Parse(grant, MediaDirection.Publish, null, MediaSessionContent.Camera);
                    if (output.Fps > publish.Limits.MaxFps) throw new JsonException();
                }
                layers.Add(new BaseLayer(id, kind, publish));
                continue;
            }
            if (z is not { } pz || pz < 1 || pz > int.MaxValue || !layer.TryGetProperty("region", out var r) || r.ValueKind != JsonValueKind.Object) throw new JsonException();
            var region = new CompositionRegion(UnitNumber(r, "x"), UnitNumber(r, "y"), UnitNumber(r, "width"), UnitNumber(r, "height"));
            var background = Text(layer, "background") switch
            {
                "opaque" => CompositionBackground.Opaque, "transparent" => CompositionBackground.Transparent, _ => throw new JsonException()
            };
            var opacity = UnitNumber(layer, "opacity");
            if (!layer.TryGetProperty("input", out var kinds) || kinds.ValueKind != JsonValueKind.Array) throw new JsonException();
            var input = kinds.EnumerateArray().Select(i => i.ValueKind != JsonValueKind.String ? throw new JsonException() : i.GetString() switch
            {
                "pointer" => LivingInputKind.Pointer, "keyboard" => LivingInputKind.Keyboard, "text" => LivingInputKind.Text, _ => throw new JsonException()
            }).ToList();
            if (!RegionOk(region) || !InputsOk(input) || !layer.TryGetProperty("living_session", out var ls)) throw new JsonException();
            var session = Session(ls);
            if (session.CallId != callId || session.Fps > output.Fps) throw new JsonException();
            layers.Add(new PageLayer(id, (int)pz, session, region, background, opacity, input));
        }
        return new()
        {
            CompositionId = compositionId, CallId = callId, Revision = revision, Status = status, Output = output, Layers = layers,
            ErrorCode = errorCode.ValueKind == JsonValueKind.String ? errorCode.GetString() : null
        };
    }

    /// <summary>
    /// The topmost page layer accepting pointer input under an output-frame point (x, y normalized 0..1), or null.
    /// The backend maps output-frame coordinates into the page.
    /// </summary>
    public PageLayer? InputTarget(double x, double y)
        => !Unit(x) || !Unit(y) ? null : Layers.OfType<PageLayer>().Where(p => p.Input.Contains(LivingInputKind.Pointer)).OrderByDescending(p => p.Z)
            .FirstOrDefault(p => x >= p.Region.X && x <= p.Region.X + p.Region.Width && y >= p.Region.Y && y <= p.Region.Y + p.Region.Height);
}

/// <summary>Explicit, versioned <c>video_composition</c> capability. Never inferred from custom video or living services.</summary>
public sealed record VideoCompositionCapability(int MaxLayers, IReadOnlyList<CompositionBaseKind> Bases, bool PageAlpha, bool Regions,
    int MaxWidth, int MaxHeight, int MaxFps)
{
    public int Version => 1;
    public bool Supported => true;

    /// <summary>Absent, malformed, unknown-version or unsupported input returns null. Unknown bases are ignored and larger
    /// limits clamp to SDK v1 bounds.</summary>
    public static VideoCompositionCapability? Parse(JsonElement? input)
    {
        if (input is not { ValueKind: JsonValueKind.Object } raw || !raw.TryGetProperty("version", out var version) || version.ValueKind != JsonValueKind.Number
            || !version.TryGetDouble(out var v) || v != 1 || !raw.TryGetProperty("supported", out var supported) || supported.ValueKind != JsonValueKind.True
            || !raw.TryGetProperty("bases", out var bases) || bases.ValueKind != JsonValueKind.Array) return null;
        int? Positive(string name, int cap) => raw.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var n)
            && n > 0 && Math.Truncate(n) == n ? (int)Math.Min(n, cap) : null;
        if (Positive("max_layers", CallVideoComposition.MaxLayers) is not { } layers || Positive("max_width", 1920) is not { } width
            || Positive("max_height", 1080) is not { } height || Positive("max_fps", 30) is not { } fps) return null;
        var kinds = new List<CompositionBaseKind>();
        foreach (var item in bases.EnumerateArray())
            if (item.ValueKind == JsonValueKind.String && item.GetString() switch { "camera" => CompositionBaseKind.Camera, "managed" => CompositionBaseKind.Managed, _ => (CompositionBaseKind?)null } is { } kind
                && !kinds.Contains(kind)) kinds.Add(kind);
        bool Flag(string name) => raw.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.True;
        return new(layers, kinds, Flag("page_alpha"), Flag("regions"), width, height, fps);
    }
}
