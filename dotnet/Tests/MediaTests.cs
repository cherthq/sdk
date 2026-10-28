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
    static string PatchJson(string json, string patch)
    {
        var value = JsonNode.Parse(json)!.AsObject();
        foreach (var (name, replacement) in JsonNode.Parse(patch)!.AsObject().ToList()) value[name] = replacement?.DeepClone();
        return value.ToJsonString();
    }
    const string CameraGrant = "{\"session_id\":\"3f2b8c1e-0d4a-4b7e-9c11-2a6f5e0d9b77\",\"direction\":\"publish\",\"content\":\"camera\",\"endpoint\":\"https://signal.example/opaque/abc\","
        + "\"token\":\"session-bearer\",\"connect_by\":\"2026-10-25T00:05:00Z\",\"expires_at\":\"2026-10-25T01:00:00Z\",\"ice_servers\":[{\"urls\":[\"turn:turn.example:3478\"]}],"
        + "\"codecs\":[\"h264\"],\"limits\":{\"max_width\":1920,\"max_height\":1080,\"max_fps\":24,\"max_frame_bytes\":8388608}}";
    static string Living(int fps, string call = "call") => "{\"session_id\":\"ls\",\"call_id\":\"" + call + "\",\"deployment_id\":\"dep\",\"status\":\"starting\","
        + "\"viewport\":{\"width\":1920,\"height\":270},\"fps\":" + fps + ",\"ready_at\":null,\"last_heartbeat_at\":null,\"error_code\":null}";
    static readonly string Captions = "{\"id\":\"captions\",\"z\":1,\"living_session\":" + Living(12) + ",\"region\":{\"x\":0,\"y\":0.75,\"width\":1,\"height\":0.25},"
        + "\"background\":\"transparent\",\"opacity\":0.8,\"input\":[\"pointer\"]}";
    static readonly string BaseJson = "{\"id\":\"base\",\"z\":0,\"source\":{\"kind\":\"camera\"},\"publish\":" + CameraGrant + "}";
    static readonly string Layered = "{\"composition_id\":\"cmp\",\"call_id\":\"call\",\"revision\":3,\"status\":\"starting\",\"output\":{\"width\":1920,\"height\":1080,\"fps\":24},"
        + "\"error_code\":null,\"layers\":[" + BaseJson + "," + Captions + "]}";
    static readonly string PageOnly = PatchJson(Layered, "{\"output\":{\"width\":1280,\"height\":720,\"fps\":30},\"layers\":[{\"id\":\"page\",\"z\":1,\"living_session\":" + Living(30)
        + ",\"region\":{\"x\":0,\"y\":0,\"width\":1,\"height\":1},\"background\":\"opaque\",\"opacity\":1,\"input\":[]}]}");
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
        await Run("screen media sessions: content is validated, echoed and capped at 15 fps", async () =>
        {
            var screen = PatchGrant("{\"content\":\"screen\",\"limits\":{\"max_width\":1920,\"max_height\":1080,\"max_fps\":15,\"max_frame_bytes\":8388608}}");
            var callerScreen = PatchGrant("{\"direction\":\"subscribe\",\"content\":\"caller_screen\",\"limits\":{\"max_width\":1280,\"max_height\":720,\"max_fps\":30,\"max_frame_bytes\":8388608}}");
            ReplyWith(Envelope(screen));
            var grant = await client.CreateMediaSessionAsync(Call, MediaDirection.Publish, content: MediaSessionContent.Screen);
            Wire(server, "POST", "/calls/" + Call + "/media-sessions", body: "{\"direction\":\"publish\",\"content\":\"screen\"}");
            Check(grant.Content == MediaSessionContent.Screen && grant.Limits.MaxFps == 15);
            ReplyWith(Envelope(callerScreen));
            grant = await client.CreateMediaSessionAsync(Call, MediaDirection.Subscribe, content: MediaSessionContent.CallerScreen);
            Wire(server, "POST", "/calls/" + Call + "/media-sessions", body: "{\"direction\":\"subscribe\",\"content\":\"caller_screen\"}");
            Check(grant.Content == MediaSessionContent.CallerScreen);

            // Wrong combinations fail locally with no request.
            var before = server.Requests.Count;
            foreach (var (direction, content) in new[] { (MediaDirection.Publish, MediaSessionContent.CallerScreen), (MediaDirection.Subscribe, MediaSessionContent.Screen),
                (MediaDirection.Subscribe, MediaSessionContent.Camera), (MediaDirection.Publish, (MediaSessionContent)9) })
                await Throws<ArgumentException>(() => client.CreateMediaSessionAsync(Call, direction, content: content));
            Check(server.Requests.Count == before, "invalid content reached the network");

            var noEcho = JsonNode.Parse(screen)!.AsObject();
            noEcho.Remove("content");
            foreach (var (direction, content, body) in new (MediaDirection, MediaSessionContent?, string)[] {
                (MediaDirection.Publish, MediaSessionContent.Screen, PatchGrant("{\"content\":\"screen\"}")),
                (MediaDirection.Publish, MediaSessionContent.Screen, noEcho.ToJsonString()),
                (MediaDirection.Publish, MediaSessionContent.Screen, PatchGrant("{\"content\":\"camera\",\"limits\":{\"max_width\":1920,\"max_height\":1080,\"max_fps\":15,\"max_frame_bytes\":8388608}}")),
                (MediaDirection.Publish, null, screen), (MediaDirection.Subscribe, null, callerScreen),
                (MediaDirection.Subscribe, null, PatchGrant("{\"direction\":\"subscribe\",\"content\":\"screen\",\"limits\":{\"max_width\":1280,\"max_height\":720,\"max_fps\":15,\"max_frame_bytes\":8388608}}")) })
            {
                ReplyWith(Envelope(body));
                var error = await Throws<ChertApiException>(() => client.CreateMediaSessionAsync(Call, direction, content: content));
                Check(error.Code == "invalid_response", "accepted " + body);
            }
            // The backend echoes the resolved camera content on default requests in both directions.
            ReplyWith(Envelope(PatchGrant("{\"content\":\"camera\"}")));
            Check((await client.CreateMediaSessionAsync(Call, MediaDirection.Publish)).Content == MediaSessionContent.Camera);
            ReplyWith(Envelope(PatchGrant("{\"direction\":\"subscribe\",\"content\":\"camera\",\"limits\":{\"max_width\":1280,\"max_height\":720,\"max_fps\":30,\"max_frame_bytes\":8388608}}")));
            Check((await client.CreateMediaSessionAsync(Call, MediaDirection.Subscribe)).Content == MediaSessionContent.Camera);
            ReplyWith(Envelope(Grant));
            Check((await client.CreateMediaSessionAsync(Call, MediaDirection.Publish)).Content is null);

            ReplyWith("{\"error\":{\"code\":\"caller_screen_not_shared\",\"message\":\"internal host 10.0.0.5\"},\"request_id\":\"r\"}", 409);
            var notShared = await Throws<ChertApiException>(() => client.CreateMediaSessionAsync(Call, MediaDirection.Subscribe, content: MediaSessionContent.CallerScreen));
            Check(notShared.Status == 409 && notShared.Code == "caller_screen_not_shared" && !notShared.ToString().Contains("10.0.0.5"));
            foreach (var (status, code) in new[] { (409, "media_content_unsupported"), (409, "caller_screen_unsupported"), (422, "media_limit_exceeded") })
            {
                ReplyWith("{\"error\":{\"code\":\"" + code + "\",\"message\":\"internal host 10.0.0.5\"},\"request_id\":\"r\"}", status);
                var denied = await Throws<ChertApiException>(() => client.CreateMediaSessionAsync(Call, MediaDirection.Publish, content: MediaSessionContent.Screen));
                Check(denied.Status == status && denied.Code == code && !denied.ToString().Contains("10.0.0.5"));
            }
        });
        await Run("media capability contents ignore unknown entries and default to camera", () =>
        {
            MediaCapabilities WithContents(string cv, string iv) => Caps("{\"version\":1,\"custom_video\":{\"supported\":true,\"transports\":[\"whip\"],\"codecs\":[\"h264\"],\"max_width\":1920,\"max_height\":1080,\"max_fps\":30" + cv
                + "},\"inbound_caller_video\":{\"supported\":true,\"transports\":[\"whep\"],\"max_width\":1280,\"max_height\":720,\"max_fps\":30" + iv + "}}");
            var parsed = WithContents(",\"contents\":[\"screen\",\"window\",\"camera\",\"screen\"]", ",\"contents\":[\"screen\"]");
            Check(parsed.CustomVideo!.Contents.SequenceEqual(new[] { MediaContent.Screen, MediaContent.Camera }));
            Check(parsed.InboundCallerVideo!.Contents.SequenceEqual(new[] { MediaContent.Screen }));
            foreach (var contents in new[] { "", ",\"contents\":[]", ",\"contents\":[\"window\"]", ",\"contents\":\"screen\"", ",\"contents\":null", ",\"contents\":[7]" })
            {
                parsed = WithContents(contents, contents);
                Check(parsed.CustomVideo!.Contents.SequenceEqual(new[] { MediaContent.Camera }) && parsed.InboundCallerVideo!.Contents.SequenceEqual(new[] { MediaContent.Camera }), contents);
            }
            return Task.CompletedTask;
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
        await Run("call video: deployment page shortcut, layered base + overlay, get and clear", async () =>
        {
            ReplyWith(Envelope(PageOnly), 200);
            var page = await client.SetCallVideoAsync(Call, new() { DeploymentId = "dep-url" }, "video-key-1");
            Wire(server, "PUT", "/calls/" + Call + "/video", key: "video-key-1", body: "{\"layers\":[{\"id\":\"page\",\"z\":1,\"page\":{\"deployment_id\":\"dep-url\"},"
                + "\"region\":{\"x\":0,\"y\":0,\"width\":1,\"height\":1},\"background\":\"opaque\",\"opacity\":1}]}");
            Check(page.Output == new CompositionOutput(1280, 720, 30) && page.Layers.Single() is PageLayer { Id: "page", Z: 1 });
            ReplyWith(Envelope(Layered), 200);
            var layered = await client.SetCallVideoAsync(Call, new()
            {
                Revision = 2,
                Layers = [new BaseLayerInput("base", CompositionBaseKind.Camera), new PageLayerInput("captions", 1, "dep")
                {
                    Region = new(0, 0.75, 1, 0.25), Background = CompositionBackground.Transparent, Opacity = 0.8, Input = [LivingInputKind.Pointer],
                    InitialState = JsonDocument.Parse("{\"lang\":\"en\"}").RootElement
                }]
            }, "video-key-2");
            Wire(server, "PUT", "/calls/" + Call + "/video", key: "video-key-2", body: "{\"revision\":2,\"layers\":[{\"id\":\"base\",\"z\":0,\"source\":{\"kind\":\"camera\"}},"
                + "{\"id\":\"captions\",\"z\":1,\"page\":{\"deployment_id\":\"dep\"},\"region\":{\"x\":0,\"y\":0.75,\"width\":1,\"height\":0.25},\"background\":\"transparent\","
                + "\"opacity\":0.8,\"input\":[\"pointer\"],\"initial_state\":{\"lang\":\"en\"}}]}");
            Check(layered.Layers[0] is BaseLayer { Publish.Token: "session-bearer" } && !layered.ToString().Contains("session-bearer"));
            await client.GetCallVideoAsync(Call);
            Wire(server, "GET", "/calls/" + Call + "/video");
            await client.ClearCallVideoAsync(Call);
            Wire(server, "DELETE", "/calls/" + Call + "/video");
            // Input targets use output-frame coordinates; only the overlay's region accepts pointer input.
            Check(layered.InputTarget(0.5, 0.9)?.Id == "captions" && layered.InputTarget(0.5, 0.74) is null && page.InputTarget(0.5, 0.5) is null);
        });
        await Run("call video: invalid compositions and URL pages are rejected locally before any request", async () =>
        {
            ReplyWith(Envelope(Layered), 200);
            var before = server.Requests.Count;
            var page = new PageLayerInput("p", 1, "dep");
            var baseLayer = new BaseLayerInput("base", CompositionBaseKind.Camera);
            var deep = "0";
            for (var i = 0; i < 70; i++) deep = "[" + deep + "]";
            // Unrepresentable here: z 1.5 (int) and a base at z != 0 (no z on BaseLayerInput).
            var cases = new SetCallVideo[]
            {
                new() { Layers = [] }, new() { Layers = [baseLayer, page, page with { Id = "q", Z = 2 }] },
                new() { Layers = [baseLayer, baseLayer with { Id = "b2" }] }, new() { Layers = [baseLayer, page with { Id = "base" }] },
                new() { Layers = [baseLayer, page with { Z = 0 }] }, new() { Layers = [baseLayer, page with { Z = 65 }] },
                new() { Layers = [baseLayer, page with { Region = new(0.5, 0, 0.6, 1) }] }, new() { Layers = [baseLayer, page with { Region = new(0, 0, 0, 1) }] },
                new() { Layers = [baseLayer, page with { Region = new(double.NaN, 0, 1, 1) }] },
                new() { Layers = [baseLayer, page with { Opacity = 1.2 }] }, new() { Layers = [baseLayer, page with { Background = (CompositionBackground)7 }] },
                new() { Layers = [page with { Background = CompositionBackground.Transparent }] }, new() { Layers = [page with { Opacity = 0.5 }] },
                new() { Layers = [page with { Region = new(0, 0, 0.5, 1) }] },
                new() { Layers = [baseLayer, page with { Input = [LivingInputKind.Pointer, LivingInputKind.Pointer] }] },
                new() { Layers = [baseLayer, page with { Input = [(LivingInputKind)9] }] },
                new() { Layers = [new BaseLayerInput("base", (CompositionBaseKind)5)] }, new() { Layers = [page with { Id = "Upper" }] },
                new() { Layers = [baseLayer, null!] }, new() { Layers = [page with { DeploymentId = "" }] }, new() { Layers = [page with { DeploymentId = new string('d', 129) }] },
                new() { Layers = [baseLayer, page with { InitialState = JsonDocument.Parse("{\"blob\":\"" + new string('x', 64 * 1024) + "\"}").RootElement }] },
                new() { DeploymentId = "dep", InitialState = JsonDocument.Parse(deep, new JsonDocumentOptions { MaxDepth = 128 }).RootElement },
                new() { DeploymentId = "dep", Revision = -1 }, new() { DeploymentId = "" }, new(),
                // URL pages need a deployment created with the TypeScript SDK first.
                new() { DeploymentId = "https://agent.example/p" }, new() { Layers = [baseLayer, page with { DeploymentId = "https://agent.example/p" }] },
            };
            foreach (var input in cases) await Throws<ArgumentException>(() => client.SetCallVideoAsync(Call, input, "video-key-1"));
            await Throws<ArgumentException>(() => client.SetCallVideoAsync(Call, null!, "video-key-1"));
            await Throws<ArgumentException>(() => client.SetCallVideoAsync(Call, new() { DeploymentId = "dep" }, "short"));
            await Throws<ArgumentException>(() => client.SetCallVideoAsync("call", new() { DeploymentId = "dep" }, "video-key-1"));
            var url = await Throws<ArgumentException>(() => client.SetCallVideoAsync(Call, new() { DeploymentId = "https://agent.example/p" }, "video-key-1"));
            Check(url.Message.Contains("TypeScript SDK"), "URL page message");
            Check(server.Requests.Count == before, "invalid composition reached the network");
            // A region touching the frame edge is inside it.
            await client.SetCallVideoAsync(Call, new() { Layers = [baseLayer, page with { Region = new(0.75, 0.75, 0.25, 0.25) }] }, "video-key-1");
            Check(server.Requests.Count == before + 1);
        });
        await Run("call video: responses outside the contract fail as invalid_response", async () =>
        {
            string WithLayers(string layers, string extra = "") => PatchJson(Layered, "{\"layers\":[" + layers + "]" + extra + "}");
            string Caption(string patch) => PatchJson(Captions, patch);
            var screenBase = PatchJson(BaseJson, "{\"publish\":" + PatchJson(CameraGrant, "{\"content\":\"screen\"}") + "}");
            var missingErrorCode = JsonNode.Parse(Layered)!.AsObject();
            missingErrorCode.Remove("error_code");
            foreach (var bad in new[]
            {
                WithLayers(BaseJson + "," + Caption("{\"living_session\":" + Living(30) + "}")),
                WithLayers(BaseJson + "," + Captions, ",\"output\":{\"width\":1920,\"height\":1080,\"fps\":30}"),
                WithLayers("{\"id\":\"base\",\"z\":0,\"source\":{\"kind\":\"managed\"},\"publish\":" + CameraGrant + "}," + Captions),
                WithLayers(screenBase + "," + Captions),
                WithLayers(BaseJson + "," + Captions + "," + Caption("{\"id\":\"more\",\"z\":2}")),
                WithLayers(BaseJson + "," + Caption("{\"living_session\":" + Living(12, "other") + "}")),
                WithLayers(BaseJson + "," + Caption("{\"region\":{\"x\":0.5,\"y\":0,\"width\":0.6,\"height\":1}}")),
                WithLayers(BaseJson + "," + Caption("{\"z\":0}")),
                WithLayers(BaseJson + "," + Caption("{\"input\":[\"pointer\",\"pointer\"]}")),
                PatchJson(Layered, "{\"status\":\"paused\"}"), PatchJson(Layered, "{\"output\":{\"width\":1921,\"height\":1080,\"fps\":24}}"),
                missingErrorCode.ToJsonString(), "null",
            })
            {
                ReplyWith(Envelope(bad), 200);
                var error = await Throws<ChertApiException>(() => client.GetCallVideoAsync(Call));
                Check(error.Code == "invalid_response" && error.ResponseData is null, "accepted " + bad);
            }
            ReplyWith(Envelope(WithLayers("{\"id\":\"base\",\"z\":0,\"source\":{\"kind\":\"managed\"}}," + Captions)), 200);
            Check((await client.GetCallVideoAsync(Call)).Layers[0] is BaseLayer { Source: CompositionBaseKind.Managed, Publish: null });
        });
        await Run("call video: composition error codes survive sanitization without server text", async () =>
        {
            foreach (var (status, code) in new[] { (409, "video_composition_unsupported"), (422, "composition_invalid"), (409, "composition_revision_conflict"),
                (409, "composition_base_unavailable"), (409, "media_session_conflict"), (409, "composition_secret") })
            {
                ReplyWith("{\"error\":{\"code\":\"" + code + "\",\"message\":\"internal host 192.0.2.5\"},\"request_id\":\"r\"}", status);
                var error = await Throws<ChertApiException>(() => client.SetCallVideoAsync(Call, new() { DeploymentId = "dep" }, "video-key-1"));
                Check(error.Status == status && error.Code == (code == "composition_secret" ? "request_failed" : code) && error.ResponseData is null, code);
                Check(!error.Message.Contains("192.0.2.5") && !error.ToString().Contains("192.0.2.5"), "server text " + code);
            }
        });
        await Run("video_composition capability: explicit, versioned, clamped to SDK v1 bounds", () =>
        {
            const string cap = "{\"version\":1,\"supported\":true,\"max_layers\":4,\"bases\":[\"camera\",\"hologram\",\"managed\",\"camera\",3],\"page_alpha\":true,\"regions\":true,"
                + "\"max_width\":3840,\"max_height\":1080,\"max_fps\":60}";
            VideoCompositionCapability? Parse(string json) => VideoCompositionCapability.Parse(JsonDocument.Parse(json).RootElement);
            Check(Parse(cap) is { Version: 1, Supported: true, MaxLayers: 2, PageAlpha: true, Regions: true, MaxWidth: 1920, MaxHeight: 1080, MaxFps: 30 } parsed
                && parsed.Bases.SequenceEqual(new[] { CompositionBaseKind.Camera, CompositionBaseKind.Managed }));
            Check(Parse(PatchJson(cap, "{\"page_alpha\":\"yes\"}"))?.PageAlpha == false);
            Check(VideoCompositionCapability.Parse(null) is null && Parse("null") is null);
            foreach (var patch in new[] { "{\"version\":2}", "{\"supported\":false}", "{\"max_layers\":0}", "{\"max_fps\":1.5}", "{\"bases\":\"camera\"}" })
                Check(Parse(PatchJson(cap, patch)) is null, patch);
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
