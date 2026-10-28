using System.Text.Json;
using System.Text.Json.Nodes;
using TryChert;

static partial class Program
{
    const string Grant = "{\"session_id\":\"0f8fad5b-d9cb-469f-a165-70867728950e\",\"direction\":\"publish\",\"endpoint\":\"https://signal.example/whip/s1\","
        + "\"token\":\"grant-secret-token\",\"connect_by\":\"2026-10-25T10:00:00Z\",\"expires_at\":\"2026-10-25T12:00:00.5+02:00\","
        + "\"ice_servers\":[{\"urls\":\"stun:stun.example:3478\"},{\"urls\":[\"turn:turn.example:3478\"],\"username\":\"u\",\"credential\":\"c\",\"credentialType\":\"password\"}],"
        + "\"codecs\":[\"h264\",\"vp8\"],\"limits\":{\"max_width\":1920,\"max_height\":1080,\"max_fps\":30,\"max_frame_bytes\":8388608}}";
    static string PatchGrant(string patch)
    {
        var grant = JsonNode.Parse(Grant)!.AsObject();
        foreach (var (name, value) in JsonNode.Parse(patch)!.AsObject().ToList()) grant[name] = value?.DeepClone();
        return grant.ToJsonString();
    }
    static MediaCapabilities Caps(string json) => MediaCapabilities.Parse(JsonDocument.Parse(json).RootElement);

    static async Task MediaTests()
    {
        await using var server = new Loopback();
        using var client = new FaceTimeClient(new() { BaseUrl = server.Origin, Token = "face-secret", ProjectId = Project });
        void ReplyWith(string json, int status = 201) => server.Handler = _ => Task.FromResult(new Reply(status, json));
        await Run("media session request shape, project auth and full grant", async () =>
        {
            ReplyWith(Envelope(Grant));
            var grant = await client.CreateMediaSessionAsync(Call, MediaDirection.Publish);
            Wire(server, "POST", "/calls/" + Call + "/media-sessions", body: "{\"direction\":\"publish\"}");
            Check(grant.Token == "grant-secret-token" && grant.Endpoint == "https://signal.example/whip/s1" && grant.Direction == MediaDirection.Publish);
            Check(grant.Limits == new MediaLimits(1920, 1080, 30, 8388608) && grant.Codecs.SequenceEqual(new[] { VideoCodec.H264, VideoCodec.Vp8 }));
            Check(grant.ConnectBy == DateTimeOffset.Parse("2026-10-25T10:00:00Z") && grant.IceServers.Count == 2);
            Check(grant.IceServers[0].Urls.SequenceEqual(new[] { "stun:stun.example:3478" }) && grant.IceServers[1].Credential == "c" && grant.IceServers[1].CredentialType == "password");
            Check(!grant.ToString().Contains("secret") && !grant.ToString().Contains("signal"));
            Check(!$"{grant} {grant.IceServers[1]}".Contains("grant-secret"));
            await client.CreateMediaSessionAsync(Call, MediaDirection.Publish, new[] { VideoCodec.Vp8, VideoCodec.H264 });
            Wire(server, "POST", "/calls/" + Call + "/media-sessions", body: "{\"direction\":\"publish\",\"codecs\":[\"vp8\",\"h264\"]}");
        });
        await Run("media session local validation has zero requests", async () =>
        {
            var before = server.Requests.Count;
            await Throws<ArgumentException>(() => client.CreateMediaSessionAsync(Call, (MediaDirection)7));
            foreach (var codecs in new[] { Array.Empty<VideoCodec>(), new[] { (VideoCodec)9 }, new[] { VideoCodec.H264, VideoCodec.H264 } })
                await Throws<ArgumentException>(() => client.CreateMediaSessionAsync(Call, MediaDirection.Publish, codecs));
            await Throws<ArgumentException>(() => client.CreateMediaSessionAsync("call", MediaDirection.Publish));
            Check(server.Requests.Count == before);
        });
        await Run("invalid grants including publish-sized subscribe fail as invalid_response", async () =>
        {
            var replies = new List<(MediaDirection, int, string)>
            {
                (MediaDirection.Subscribe, 201, Envelope(PatchGrant("{\"direction\":\"subscribe\"}"))),
                (MediaDirection.Subscribe, 201, Envelope(Grant)),
                (MediaDirection.Publish, 200, Envelope(Grant)),
                (MediaDirection.Publish, 201, "{\"data\":null}"),
                (MediaDirection.Publish, 201, "{\"request_id\":\"x\"}"),
                (MediaDirection.Publish, 201, "not json"),
            };
            foreach (var patch in new[] { "{\"endpoint\":\"http://signal.example/x\"}", "{\"endpoint\":\"https://u:p@signal.example/x\"}", "{\"endpoint\":\"https://signal.example/x#f\"}",
                "{\"endpoint\":\"/relative\"}", "{\"endpoint\":7}", "{\"token\":\"a\\r\\nb\"}", "{\"token\":\"\"}", "{\"token\":null}", "{\"connect_by\":\"soon\"}", "{\"expires_at\":null}",
                "{\"codecs\":[\"av1\"]}", "{\"codecs\":[]}", "{\"ice_servers\":[{\"urls\":7}]}", "{\"ice_servers\":[{\"urls\":[1]}]}", "{\"ice_servers\":[null]}", "{\"ice_servers\":{}}",
                "{\"limits\":{\"max_width\":1920,\"max_height\":1080,\"max_fps\":30,\"max_frame_bytes\":9000000}}",
                "{\"limits\":{\"max_width\":1920,\"max_height\":1080,\"max_fps\":31,\"max_frame_bytes\":1}}",
                "{\"limits\":{\"max_width\":1920.5,\"max_height\":1080,\"max_fps\":30,\"max_frame_bytes\":1}}",
                "{\"limits\":{\"max_width\":0,\"max_height\":1080,\"max_fps\":30,\"max_frame_bytes\":1}}", "{\"limits\":null}",
                "{\"session_id\":\"x\"}", "{\"direction\":\"subscribe\"}",
                // Tightened reference rules: unique codecs, ordered instants, strict ICE servers.
                "{\"codecs\":[\"h264\",\"h264\"]}", "{\"connect_by\":\"2026-10-25T10:00:00.002Z\",\"expires_at\":\"2026-10-25T10:00:00.001Z\"}",
                "{\"connect_by\":\"2026-10-25T10:00:00+00:00\",\"expires_at\":\"2026-10-25T11:00:00+02:00\"}",
                "{\"ice_servers\":[{\"urls\":[]}]}", "{\"ice_servers\":[{\"urls\":\"stun:a\",\"username\":null}]}", "{\"ice_servers\":[{\"urls\":\"stun:a\",\"username\":7}]}",
                "{\"ice_servers\":[{\"urls\":\"stun:a\",\"credential\":null}]}", "{\"ice_servers\":[{\"urls\":\"stun:a\",\"credential\":{}}]}",
                "{\"ice_servers\":[{\"urls\":\"stun:a\",\"credentialType\":\"oauth\"}]}", "{\"ice_servers\":[{\"urls\":\"stun:a\",\"credentialType\":null}]}" })
                replies.Add((MediaDirection.Publish, 201, Envelope(PatchGrant(patch))));
            foreach (var (direction, status, body) in replies)
            {
                ReplyWith(body, status); var before = server.Requests.Count;
                var error = await Throws<ChertApiException>(() => client.CreateMediaSessionAsync(Call, direction));
                Check(error.Code == "invalid_response" && error.ResponseData is null && server.Requests.Count == before + 1, "accepted " + body);
            }
            // A returned codec outside the requested list is rejected.
            ReplyWith(Envelope(Grant));
            var outside = await Throws<ChertApiException>(() => client.CreateMediaSessionAsync(Call, MediaDirection.Publish, new[] { VideoCodec.Vp8 }));
            Check(outside.Code == "invalid_response", "codec outside request");
            // Accepted: requested subset, equal or ordered instants across offsets (lowercase t/z), complete ICE servers.
            foreach (var (patch, codecs) in new (string, VideoCodec[]?)[] {
                ("{\"codecs\":[\"h264\"]}", new[] { VideoCodec.Vp8, VideoCodec.H264 }),
                ("{\"connect_by\":\"2026-10-25T10:00:00+02:00\",\"expires_at\":\"2026-10-25T09:00:00Z\"}", null),
                ("{\"connect_by\":\"2026-10-25t08:00:00z\",\"expires_at\":\"2026-10-25T10:00:00.000999999+02:00\"}", null),
                ("{\"ice_servers\":[{\"urls\":\"\",\"username\":\"u\",\"credential\":\"c\",\"credentialType\":\"password\"}]}", null) })
            {
                ReplyWith(Envelope(PatchGrant(patch)));
                await client.CreateMediaSessionAsync(Call, MediaDirection.Publish, codecs);
            }
            ReplyWith(Envelope(PatchGrant("{\"direction\":\"subscribe\",\"endpoint\":\"http://[::1]:8443/whep\",\"limits\":{\"max_width\":1280,\"max_height\":720.0,\"max_fps\":30,\"max_frame_bytes\":8388608}}")));
            Check((await client.CreateMediaSessionAsync(Call, MediaDirection.Subscribe)).Limits.MaxHeight == 720);
        });
        await Run("media session error codes surface without server text", async () =>
        {
            foreach (var (status, code) in new[] { (401, "unauthorized"), (401, "media_session_expired"), (404, "call_not_found"), (409, "media_capability_unsupported"),
                (409, "media_session_conflict"), (409, "call_not_active"), (410, "call_ended"), (503, "media_transport_unavailable") })
            {
                ReplyWith("{\"error\":{\"code\":\"" + code + "\",\"message\":\"internal host 192.0.2.5\"},\"request_id\":\"r\"}", status);
                var before = server.Requests.Count;
                var error = await Throws<ChertApiException>(() => client.CreateMediaSessionAsync(Call, MediaDirection.Publish));
                Check(error.Status == status && error.Code == code && error.ResponseData is null && server.Requests.Count == before + 1, code);
                Check(!error.Message.Contains("192.0.2.5") && !error.ToString().Contains("192.0.2.5"), "server text " + code);
            }
        });
        await Run("unknown media session error code becomes request_failed without data", async () =>
        {
            foreach (var body in new[] { "{\"error\":{\"code\":\"internal_detail\",\"message\":\"internal host 192.0.2.5\"},\"request_id\":\"r\"}", "not json" })
            {
                ReplyWith(body, 418);
                var error = await Throws<ChertApiException>(() => client.CreateMediaSessionAsync(Call, MediaDirection.Publish));
                Check(error.Status == 418 && error.Code == "request_failed" && error.ResponseData is null, "unknown code " + body);
            }
        });
        await Run("media capabilities parse strictly and per section", () =>
        {
            var full = Caps("{\"version\":1,\"custom_video\":{\"supported\":true,\"transports\":[\"whip\",\"livekit\",\"whip\"],\"codecs\":[\"vp8\",\"h264\",\"vp8\"],\"max_width\":1920,\"max_height\":1080.0,\"max_fps\":30},"
                + "\"inbound_caller_video\":{\"supported\":true,\"transports\":[\"whep\"],\"max_width\":1280,\"max_height\":720,\"max_fps\":15}}");
            Check(full.Version == 1 && full.CustomVideo is { Supported: true, MaxWidth: 1920, MaxHeight: 1080, MaxFps: 30 } custom
                && custom.Transports.SequenceEqual(new[] { "whip", "livekit" }) && custom.Codecs.SequenceEqual(new[] { VideoCodec.Vp8, VideoCodec.H264 }));
            Check(full.InboundCallerVideo is { MaxWidth: 1280, MaxHeight: 720, MaxFps: 15 } inbound && inbound.Transports.SequenceEqual(new[] { "whep" }));
            Check(MediaCapabilities.Parse(null) == MediaCapabilities.Unsupported);
            foreach (var raw in new[] { "null", "[]", "\"x\"", "{}", "{\"version\":\"1\"}",
                "{\"version\":2,\"custom_video\":{\"supported\":true,\"transports\":[\"whip\"],\"codecs\":[\"h264\"],\"max_width\":1,\"max_height\":1,\"max_fps\":1}}" })
                Check(Caps(raw) is { CustomVideo: null, InboundCallerVideo: null }, raw);
            const string okIv = "{\"supported\":true,\"transports\":[\"livekit\"],\"max_width\":640,\"max_height\":360,\"max_fps\":30}";
            const string okCv = "{\"supported\":true,\"transports\":[\"whip\"],\"codecs\":[\"h264\"],\"max_width\":640,\"max_height\":360,\"max_fps\":30}";
            string Section(string cv, string iv) => "{\"version\":1,\"custom_video\":" + cv + ",\"inbound_caller_video\":" + iv + "}";
            foreach (var cv in new[] { okCv.Replace("640", "1921"), okCv.Replace("360", "1081"), okCv.Replace("30}", "31}"), okCv.Replace("640", "0"), okCv.Replace("640", "1.5"),
                okCv.Replace("\"whip\"", "\"rtmp\""), okCv.Replace("[\"whip\"]", "[\"whip\",\"rtmp\"]"), okCv.Replace("[\"whip\"]", "[]"), okCv.Replace("\"h264\"", "\"av1\""),
                okCv.Replace("[\"h264\"]", "[]"), okCv.Replace("true", "\"true\""), okCv.Replace("true", "false"), "[]", "null" })
                Check(Caps(Section(cv, okIv)) is { CustomVideo: null, InboundCallerVideo: not null }, cv);
            foreach (var iv in new[] { okIv.Replace("640", "1281"), okIv.Replace("360", "721"), okIv.Replace("\"livekit\"", "\"whip\""), okIv.Replace("[\"livekit\"]", "\"whep\"") })
                Check(Caps(Section(okCv, iv)) is { CustomVideo: not null, InboundCallerVideo: null }, iv);
            var line = JsonSerializer.Deserialize<FaceTimeLine>("{\"id\":\"l\",\"status\":\"available\",\"supports_video\":true}", new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower })!;
            Check(MediaCapabilities.Parse(line.MediaCapabilities) == MediaCapabilities.Unsupported, "inferred from supports_video");
            return Task.CompletedTask;
        });
        await Run("video frame bounds, defaults and copy semantics", () =>
        {
            VideoFrameInit I420(Action<List<VideoPlane>>? edit = null, int width = 16, int height = 16, long timestamp = 0, long? duration = null, int? rotation = null, ColorSpace? space = null, PixelFormat format = PixelFormat.I420)
            {
                var planes = new List<VideoPlane> { new(new byte[256], 16), new(new byte[64], 8), new(new byte[64], 8) };
                edit?.Invoke(planes);
                return new() { Format = format, Width = width, Height = height, Planes = planes, TimestampUs = timestamp, DurationUs = duration, Rotation = rotation, ColorSpace = space };
            }
            var frame = VideoFrame.Copy(I420());
            Check(frame.ColorSpace == ColorSpace.Bt709Limited && frame.Rotation == 0 && frame.Planes.Count == 3);
            var source = new byte[100 * 20]; source[0] = 7;
            frame = VideoFrame.Copy(new() { Format = PixelFormat.Rgba, Width = 16, Height = 20, Planes = [new(source, 100)], TimestampUs = 5, Rotation = 270 });
            source[0] = 9;
            Check(frame.Planes[0].Data.Length == 100 * 19 + 64 && frame.Planes[0].Data.Span[0] == 7 && frame.ColorSpace == ColorSpace.SrgbFull && frame.Rotation == 270);
            frame = VideoFrame.Copy(new() { Format = PixelFormat.Nv12, Width = 1920, Height = 1080, Planes = [new(new byte[1920 * 1080], 1920), new(new byte[1920 * 540], 1920)], TimestampUs = 1, ColorSpace = ColorSpace.Bt601Limited });
            Check(frame.ColorSpace == ColorSpace.Bt601Limited);
            VideoFrame.Copy(new() { Format = PixelFormat.Bgra, Width = 1920, Height = 1080, Planes = [new(new byte[7680 * 1080], 7680)], TimestampUs = 1 });
            var large = Assert(() => VideoFrame.Copy(new() { Format = PixelFormat.Rgba, Width = 1920, Height = 1080, Planes = [new(new byte[7936 * 1080], 7936)], TimestampUs = 1 }));
            Check(large == "frame_too_large", "8 MiB bound");
            foreach (var bad in new Func<VideoFrameInit>[] {
                () => I420(format: (PixelFormat)9), () => I420(width: 17), () => I420(width: 14, height: 14), () => I420(width: 1922), () => I420(height: 1082),
                () => I420(timestamp: -1), () => I420(duration: 0), () => I420(rotation: 45), () => I420(space: (ColorSpace)9), () => I420(p => p.RemoveAt(2)),
                () => I420(p => p[1] = new(new byte[64], 7)), () => I420(p => p[0] = new(new byte[4096], 16 + 257)), () => I420(p => p[2] = new(new byte[63], 8)) })
                Check(Assert(() => VideoFrame.Copy(bad())) == "invalid_frame");
            VideoFrame.Copy(I420(p => p[0] = new(new byte[272 * 15 + 16], 272)));
            return Task.CompletedTask;
        });
    }
    static string Assert(Action body)
    {
        try { body(); } catch (MediaFrameException error) { return error.Code; }
        return "accepted";
    }
}
