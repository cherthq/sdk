using System.Text.Json;
using TryChert;

static partial class Program
{
    const string Project = "22000000-0000-4000-8000-000000000002";
    const string Call = "33000000-0000-4000-8000-000000000003";
    const string DeviceCode = "fdc_0123456789012345678901234567890123456789012";
    const string CallJson = "{\"id\":\"" + Call + "\",\"status\":\"queued\",\"media\":{\"audio\":true,\"video\":false}}";
    static string Envelope(string data) => "{\"data\":" + data + ",\"request_id\":\"request-123\"}";
    static CreateCallRequest Managed() => new() { Mode = "managed", AssistantId = Chat, Destination = "+15550000002", Media = new() { Audio = true, Video = false } };
    static void Wire(Loopback server, string method, string path, string auth = "project", string? body = null, string? key = null)
    {
        var request = server.Requests.Last();
        Check(request.Method == method && request.Target == "/api/v1" + path, "wire route " + path);
        Check(!request.Headers.ContainsKey("x-chert-tenant"), "iMessage tenant leaked");
        Check(auth == "public" ? !request.Headers.ContainsKey("authorization") : request.Headers["authorization"] == "Bearer face-secret", "auth " + path);
        Check(auth == "project" ? request.Headers["x-chert-project-id"] == Project : !request.Headers.ContainsKey("x-chert-project-id"), "project " + path);
        Check(key is null ? !request.Headers.ContainsKey("idempotency-key") : request.Headers["idempotency-key"] == key, "key " + path);
        if (body is not null) Check(JsonEqual(JsonDocument.Parse(body).RootElement, JsonDocument.Parse(request.Body).RootElement), "body " + path);
        else Check(request.Body.Length == 0, "unexpected body " + path);
    }
    static bool JsonEqual(JsonElement a, JsonElement b)
    {
        if (a.ValueKind != b.ValueKind) return false;
        if (a.ValueKind == JsonValueKind.Object)
            return a.EnumerateObject().Count() == b.EnumerateObject().Count() && a.EnumerateObject().All(p => b.TryGetProperty(p.Name, out var v) && JsonEqual(p.Value, v));
        if (a.ValueKind == JsonValueKind.Array) return a.GetArrayLength() == b.GetArrayLength() && a.EnumerateArray().Zip(b.EnumerateArray()).All(p => JsonEqual(p.First, p.Second));
        return a.ToString() == b.ToString();
    }
    static async Task FaceTimeTests()
    {
        await using var server = new Loopback();
        using var client = new FaceTimeClient(new() { BaseUrl = server.Origin, Token = "face-secret", ProjectId = Project });
        void ReplyWith(string json, int status = 200) => server.Handler = _ => Task.FromResult(new Reply(status, Envelope(json)));
        await Run("public assembly and every exported SDK type use TryChert identity", () =>
        {
            var assembly = typeof(TryChert.ChertClient).Assembly;
            Check(assembly.GetName().Name == "TryChert" && assembly.GetExportedTypes().All(t => t.Namespace == "TryChert"));
            Check(assembly.GetReferencedAssemblies().All(a => a.Name!.StartsWith("System", StringComparison.Ordinal)));
            return Task.CompletedTask;
        });
        await Run("production channel defaults need no caller URLs and construction has no effects", async () =>
        {
            var options = new FaceTimeOptions { Token = "face-secret", ProjectId = Project };
            var messaging = new IMessageOptions { ApiKey = "message-secret" };
            Check(options.BaseUrl == "https://facetime.trychert.com/api/v1");
            Check(messaging.BaseUrl == "https://console.trychert.com/api/v1");
            using var standalone = new FaceTimeClient(options);
            using var unified = new TryChert.ChertClient(messaging, options);
            Check(unified.IMessage is not null && unified.FaceTime is not null);
            using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
            await Throws<OperationCanceledException>(() => standalone.ListCallsAsync(cancellationToken: cancelled.Token));
            await Throws<OperationCanceledException>(() => unified.IMessage!.RequestAsync("/whoami", cancellationToken: cancelled.Token));
        });
        await Run("channel URL overrides retain exactly one validated deployment prefix", async () =>
        {
            await using var peer = new Loopback();
            peer.Handler = _ => Task.FromResult(new Reply(200, Envelope(CallJson)));
            foreach (var prefix in new[] { "", "/", "/api/v1", "/api/v1/", "/self-hosted/v2/" })
            {
                using var overridden = new FaceTimeClient(new() { BaseUrl = peer.Origin + prefix, Token = "face-secret", ProjectId = Project });
                await overridden.GetCallAsync(Call);
                var expectedPrefix = prefix is "" or "/" ? "/api/v1" : prefix.TrimEnd('/');
                Check(peer.Requests.Last().Target == expectedPrefix + "/calls/" + Call);
                using var messages = new IMessageClient(new IMessageOptions { BaseUrl = peer.Origin + prefix, ApiKey = "message-secret" });
                await messages.RequestAsync("/whoami");
                Check(peer.Requests.Last().Target == expectedPrefix + "/whoami");
            }
            foreach (var invalid in new[] { "", "http://example.test", "https://example.test/api/../escape", "https://example.test?token=secret", null })
            {
                await Throws<ArgumentException>(() => { using var rejected = new FaceTimeClient(new() { BaseUrl = invalid! }); return Task.CompletedTask; });
                await Throws<ArgumentException>(() => { using var rejected = new IMessageClient(new IMessageOptions { BaseUrl = invalid!, ApiKey = "message-secret" }); return Task.CompletedTask; });
            }
            Check(peer.Requests.Count == 10);
        });
        await Run("unified channels isolate credentials, projects and origins concurrently", async () =>
        {
            await using var messages = new Loopback();
            using var unified = new TryChert.ChertClient(new() { BaseUrl = messages.Origin, ApiKey = "message-secret", Tenant = "tenant-only" },
                new() { BaseUrl = server.Origin, Token = "face-secret", ProjectId = Project });
            Check(messages.Requests.IsEmpty && server.Requests.IsEmpty);
            messages.Handler = _ => Task.FromResult(new Reply(202, TextReceipt()));
            ReplyWith(CallJson);
            await Task.WhenAll(unified.IMessage!.SendTextAsync("+15550000002", "hello"), unified.FaceTime!.GetCallAsync(Call));
            Wire(server, "GET", "/calls/" + Call);
            var m = messages.Requests.Last(); Check(m.Headers["authorization"] == "Bearer message-secret" && m.Headers["x-chert-tenant"] == "tenant-only" && !m.Headers.ContainsKey("x-chert-project-id"));
            using var one = new TryChert.ChertClient(faceTime: new() { BaseUrl = server.Origin }); Check(one.IMessage is null && one.FaceTime is not null);
            await Throws<ArgumentException>(() => { using var none = new TryChert.ChertClient(); return Task.CompletedTask; });
        });
        await Run("FaceTime call creation has exact managed wire shape and stable key", async () =>
        {
            ReplyWith(CallJson, 201); var call = await client.CreateCallAsync(Managed(), "stable-123");
            Check(call.Id == Call && call.Status == "queued" && call.Media!.Audio && !call.Media.Video);
            Wire(server, "POST", "/calls", body: "{\"direction\":\"outbound\",\"mode\":\"managed\",\"assistant_id\":\"" + Chat + "\",\"destination\":\"+15550000002\",\"media\":{\"audio\":true,\"video\":false},\"authorized_test_call\":false}", key: "stable-123");
        });
        await Run("FaceTime database media_status is an object with independent audio and video", async () =>
        {
            // facetime_calls.media_status is jsonb, default {}; outbound migrations set per-medium strings.
            foreach (var media in new[] { "{}", "{\"audio\":\"ready\",\"video\":\"pending\"}" })
            {
                ReplyWith(CallJson[..^1] + ",\"media_status\":" + media + "}");
                var call = await client.GetCallAsync(Call);
                Check(call.Id == Call && call.MediaStatus is not null);
                Check(media == "{}" ? call.MediaStatus!.Audio is null && call.MediaStatus.Video is null
                    : call.MediaStatus!.Audio == "ready" && call.MediaStatus.Video == "pending");
            }
        });
        await Run("FaceTime BYOR credentials are payload-only and redact in formatting", async () =>
        {
            ReplyWith(CallJson, 201);
            var input = new CreateCallRequest { Mode = "customer_managed", LineId = Chat, Destination = "person@example.test", DestinationType = "email",
                Media = new() { Audio = true, Video = true }, LivekitUrl = "wss://room.example.test", ParticipantToken = "room-secret", RemoteParticipantIdentity = "agent-7" };
            await client.CreateCallAsync(input, "byor-1234");
            var request = server.Requests.Last(); using var doc = JsonDocument.Parse(request.Body); var p = doc.RootElement;
            Check(p.GetProperty("livekit_url").GetString() == input.LivekitUrl && p.GetProperty("participant_token").GetString() == "room-secret"
                && p.GetProperty("remote_participant_identity").GetString() == "agent-7" && !p.TryGetProperty("assistant_id", out _));
            Check(!input.ToString().Contains("secret") && !string.Join(',', request.Headers.Values).Contains("room-secret"));
        });
        await Run("FaceTime links and typed groups preserve destinations", async () =>
        {
            ReplyWith(CallJson, 201);
            const string link = "https://facetime.apple.com/join#v=1&k=opaque";
            await client.CreateCallAsync(new() { Mode = "managed", AssistantId = Chat, LineId = Chat, Destination = link, DestinationType = "facetime_link", Media = new() { Audio = true, Video = true } }, "link-1234");
            Check(JsonDocument.Parse(server.Requests.Last().Body).RootElement.GetProperty("destination").GetString() == link);
            await client.CreateCallAsync(new() { Mode = "managed", AssistantId = Chat, LineId = Chat, Recipients = [new() { Type = "phone_number", Value = "+15550000002" }, new() { Type = "email", Value = "Person@example.test" }], Media = new() { Audio = true, Video = false } }, "group-1234");
            var p = JsonDocument.Parse(server.Requests.Last().Body).RootElement;
            Check(p.GetProperty("recipients")[1].GetProperty("value").GetString() == "Person@example.test" && !p.TryGetProperty("destination", out _));
        });
        foreach (var action in new[] { "answer", "reject", "end" })
            await Run("FaceTime " + action + " is a 202 command acknowledgement", async () =>
            {
                ReplyWith(CallJson, 202);
                var call = action switch { "answer" => await client.AnswerCallAsync(Call, "action-123", "operator"), "reject" => await client.RejectCallAsync(Call, "action-123", "operator"), _ => await client.EndCallAsync(Call, "action-123", "operator") };
                Check(call.Status == "queued"); Wire(server, "POST", $"/calls/{Call}/{action}", body: "{\"reason\":\"operator\"}", key: "action-123");
            });
        await Run("FaceTime typed read routes preserve pages, unknown states and extension fields", async () =>
        {
            ReplyWith("{\"items\":[" + CallJson + "],\"total\":19,\"limit\":3,\"offset\":7}");
            var calls = await client.ListCallsAsync(3, 7); Check(calls.Items[0].Id == Call && calls.Total == 19 && calls.Offset == 7); Wire(server, "GET", "/calls?limit=3&offset=7");
            ReplyWith("{\"items\":[{\"id\":\"" + Chat + "\",\"status\":\"future_state\",\"supports_video\":false,\"extension\":17}],\"total\":1,\"limit\":50,\"offset\":0}");
            var lines = await client.ListLinesAsync(); Check(lines.Items[0].Status == "future_state" && lines.Items[0].SupportsVideo == false && lines.Items[0].AdditionalData!["extension"].GetInt32() == 17); Wire(server, "GET", "/lines");
            ReplyWith("{\"items\":[{\"id\":\"" + Chat + "\",\"status\":\"accepting\",\"enabled\":true}],\"total\":9,\"limit\":100,\"offset\":2}");
            Check((await client.ListWorkersAsync(100, 2)).Items[0].Enabled); Wire(server, "GET", "/workers?limit=100&offset=2");
            ReplyWith(CallJson[..^1] + ",\"facetime_call_events\":[{\"id\":\"event-1\",\"event_type\":\"call.queued\",\"payload\":{\"safe\":true}}]}");
            Check((await client.GetCallAsync(Call)).FacetimeCallEvents![0].EventType == "call.queued"); Wire(server, "GET", "/calls/" + Call);
            ReplyWith("{\"call_id\":\"" + Call + "\",\"events\":[{\"id\":\"e1\",\"type\":\"call.active\",\"at\":\"2026-10-23T00:00:00Z\",\"sequence\":null}]}");
            Check((await client.GetCallEventsAsync(Call)).Events[0].Type == "call.active"); Wire(server, "GET", $"/calls/{Call}/events");
            ReplyWith("{\"call_id\":\"" + Call + "\",\"schema_version\":1,\"turns\":[{\"occurred_at\":\"2026-10-23T00:00:00Z\",\"speaker\":\"caller\",\"text\":\"Private 🌅\"}]}");
            var transcript = await client.GetTranscriptAsync(Call); Check(transcript.Turns[0].Text == "Private 🌅" && !transcript.ToString().Contains("Private")); Wire(server, "GET", $"/calls/{Call}/transcript");
        });
        await Run("FaceTime login separates public, user and project authentication", async () =>
        {
            ReplyWith("{\"device_code\":\"" + DeviceCode + "\",\"user_code\":\"ABCD-2345\",\"verification_url\":\"https://example.test/cli\",\"verification_url_complete\":\"https://example.test/cli?code=ABCD-2345\",\"expires_in\":900,\"interval\":5}", 201);
            Check((await client.BeginLoginAsync("Test device")).Interval == 5); Wire(server, "POST", "/cli/logins", "public", "{\"device_name\":\"Test device\"}");
            ReplyWith("{\"status\":\"pending\"}", 202); Check((await client.PollLoginAsync(DeviceCode)).AccessToken is null); Wire(server, "POST", "/cli/logins/token", "public", "{\"device_code\":\"" + DeviceCode + "\"}");
            ReplyWith("{\"status\":\"approved\",\"access_token\":\"approved-secret\",\"project\":{\"id\":\"" + Project + "\"},\"expires_in\":300}");
            var approved = await client.PollLoginAsync(DeviceCode); Check(approved.AccessToken == "approved-secret" && !approved.ToString().Contains("secret"));
            ReplyWith("{\"device_name\":\"device\",\"created_at\":\"2026-10-23\",\"expires_in\":300}");
            Check((await client.InspectLoginAsync("ABCD-2345")).DeviceName == "device"); Wire(server, "POST", "/cli/logins/inspect", "user", "{\"user_code\":\"ABCD-2345\"}");
            ReplyWith("{\"device_name\":\"device\",\"project_id\":\"" + Project + "\"}");
            Check((await client.ApproveLoginAsync("ABCD-2345", Project)).ProjectId == Project); Wire(server, "POST", "/cli/logins/approve", "user", "{\"user_code\":\"ABCD-2345\",\"project_id\":\"" + Project + "\"}");
            ReplyWith("{\"project\":{\"id\":\"" + Project + "\",\"name\":null},\"role\":\"owner\",\"email\":null}");
            Check((await client.WhoAmIAsync()).Project.Id == Project); Wire(server, "GET", "/cli/whoami");
            ReplyWith("{\"credentials\":[]}"); Check((await client.ListCredentialsAsync()).Credentials.Length == 0); Wire(server, "GET", "/cli/credentials");
            ReplyWith("{\"revoked\":true}"); Check((await client.RevokeCredentialAsync(Chat)).Revoked); Wire(server, "DELETE", "/cli/credentials/" + Chat);
            Check((await client.LogoutAsync()).Revoked); Wire(server, "POST", "/cli/logout", "user");
        });
        await Run("FaceTime connector operations retain explicit CAS null and never activate enrollment", async () =>
        {
            ReplyWith("{\"bindings\":[]}"); await client.ListConnectorsAsync(); Wire(server, "GET", "/connectors");
            ReplyWith("{\"credentials\":{\"connection\":\"connection-secret\",\"recovery\":\"recovery-secret\"}}");
            var before = server.Requests.Count; var enrollment = await client.EnrollConnectorAsync(Chat, "agent", "development", "byor");
            Check(server.Requests.Count == before + 1 && enrollment.Credentials.Connection == "connection-secret" && !enrollment.Credentials.ToString().Contains("secret"));
            Wire(server, "POST", "/connectors", body: "{\"action\":\"enroll\",\"line_id\":\"" + Chat + "\",\"name\":\"agent\",\"environment\":\"development\",\"session_mode\":\"byor\"}");
            ReplyWith("{}"); await client.ActivateConnectorAsync(Chat, null, 7);
            Wire(server, "POST", "/connectors", body: "{\"action\":\"activate\",\"binding_id\":\"" + Chat + "\",\"expected_binding_id\":null,\"assignment_generation\":7}");
            await client.DrainConnectorAsync(Chat); Wire(server, "POST", "/connectors", body: "{\"action\":\"drain\",\"binding_id\":\"" + Chat + "\"}");
            await client.RevokeConnectorAsync(Chat); Wire(server, "POST", "/connectors", body: "{\"action\":\"revoke\",\"binding_id\":\"" + Chat + "\"}");
        });
        await Run("FaceTime billing distinguishes public catalog, no checkout and explicit purchase", async () =>
        {
            ReplyWith("{\"version\":\"2026-10-22\",\"enabled\":false,\"test_mode\":true,\"plans\":[{\"id\":\"shared\",\"name\":\"Shared\",\"currency\":\"usd\",\"amount\":2500,\"interval\":\"month\",\"available\":false}]}");
            var catalog = await client.GetBillingCatalogAsync(); Check(!catalog.Enabled && catalog.Plans[0].Amount == 2500); Wire(server, "GET", "/billing/catalog", "public");
            ReplyWith("null"); Check(await client.GetCurrentCheckoutAsync() is null); Wire(server, "GET", "/billing/checkout");
            ReplyWith("{\"id\":\"checkout-1\",\"project_id\":\"" + Project + "\",\"plan_id\":\"shared\",\"state\":\"open\",\"checkout_url\":\"https://checkout.example.test/token\"}");
            Check((await client.CreateCheckoutAsync("shared", "2026-10-22", "checkout-123")).State == "open");
            Wire(server, "POST", "/billing/checkout", body: "{\"plan_id\":\"shared\",\"catalog_version\":\"2026-10-22\"}", key: "checkout-123");
        });
        await Run("FaceTime missing auth and invalid arguments have zero HTTP effects", async () =>
        {
            var before = server.Requests.Count;
            using var publicOnly = new FaceTimeClient(new() { BaseUrl = server.Origin });
            Check((await Throws<ChertApiException>(() => publicOnly.ListLinesAsync())).Code == "unauthorized");
            using var userOnly = new FaceTimeClient(new() { BaseUrl = server.Origin, Token = "face-secret" });
            Check((await Throws<ChertApiException>(() => userOnly.ListLinesAsync())).Code == "project_required");
            foreach (var id in new[] { "../call", "%2F", "x?query", "", "{" + Call + "}" }) await Throws<ArgumentException>(() => client.GetCallAsync(id));
            foreach (var limit in new[] { -1, 0, 101 }) await Throws<ArgumentException>(() => client.ListCallsAsync(limit));
            await Throws<ArgumentException>(() => client.ListLinesAsync(offset: -1));
            foreach (var key in new[] { "", "short", " leading-key", "trailing-key ", "inject\r\nkey", "unicode-é", new string('k', 201) }) await Throws<ArgumentException>(() => client.CreateCallAsync(Managed(), key));
            await Throws<ArgumentException>(() => client.PollLoginAsync("bad"));
            await Throws<ArgumentException>(() => client.BeginLoginAsync("invisible\nname"));
            await Throws<ArgumentException>(() => client.CreateCheckoutAsync("dedicated", "2026-10-22", "stable-key"));
            await Throws<ArgumentException>(() => client.ActivateConnectorAsync(Chat, null, -1));
            await Throws<ArgumentException>(() => client.EnrollConnectorAsync(Chat, "agent", "staging"));
            Check(server.Requests.Count == before);
        });
        await Run("FaceTime invalid mode, BYOR and group combinations fail before HTTP", async () =>
        {
            var before = server.Requests.Count;
            foreach (var input in new CreateCallRequest[] {
                new() { Mode = "managed", Destination = "+15550000002", Media = new() { Audio = true, Video = false } },
                new() { Mode = "customer_managed", Destination = "+15550000002", Media = new() { Audio = true, Video = false } },
                new() { Mode = "customer_managed", LineId = Chat, Destination = "+15550000002", Media = new() { Audio = false, Video = true }, LivekitUrl = "wss://room.test", ParticipantToken = "token", RemoteParticipantIdentity = "agent" },
                new() { Mode = "managed", AssistantId = Chat, Destination = "+15550000002", Media = new() { Audio = true, Video = false }, ParticipantToken = "token" },
                new() { Mode = "managed", AssistantId = Chat, LineId = Chat, Destination = "https://evil.test/#link", DestinationType = "facetime_link", Media = new() { Audio = true, Video = false } },
                new() { Mode = "managed", AssistantId = Chat, LineId = Chat, Recipients = [new() { Type = "email", Value = "A@b.test" }, new() { Type = "email", Value = "a@b.test" }], Media = new() { Audio = true, Video = false } }
            }) await Throws<ArgumentException>(() => client.CreateCallAsync(input, "stable-key"));
            Check(server.Requests.Count == before);
        });
        await Run("FaceTime malformed envelopes and required fields never fabricate success", async () =>
        {
            foreach (var data in new[] { "{}", "null", "[]", "{\"id\":null,\"status\":\"active\"}", "{\"id\":\"x\",\"status\":9}", "{\"id\":\"x\",\"status\":\"active\",\"status\":\"failed\"}" })
            { ReplyWith(data); Check((await Throws<ChertApiException>(() => client.GetCallAsync(Call))).Code == "invalid_response"); }
            foreach (var wire in new[] { "{}", "null", "{\"data\":" + CallJson + ",\"data\":" + CallJson + "}" })
            { server.Handler = _ => Task.FromResult(new Reply(200, wire)); await Throws<ChertApiException>(() => client.GetCallAsync(Call)); }
            ReplyWith(CallJson, 200); await Throws<ChertApiException>(() => client.CreateCallAsync(Managed(), "stable-key"));
            ReplyWith("{\"status\":\"approved\"}"); await Throws<ChertApiException>(() => client.PollLoginAsync(DeviceCode));
            ReplyWith("{\"status\":\"pending\"}"); await Throws<ChertApiException>(() => client.PollLoginAsync(DeviceCode));
            ReplyWith("{\"items\":[null],\"total\":1,\"limit\":1,\"offset\":0}"); await Throws<ChertApiException>(() => client.ListLinesAsync());
            ReplyWith("{\"call_id\":\"" + Call + "\",\"schema_version\":1,\"turns\":[null]}"); await Throws<ChertApiException>(() => client.GetTranscriptAsync(Call));
            ReplyWith(CallJson.Replace("queued", "")); await Throws<ChertApiException>(() => client.GetCallAsync(Call));
        });
        await Run("FaceTime HTTP errors expose code and request ID without leaking bodies or retrying", async () =>
        {
            foreach (var status in new[] { 401, 403, 409, 422, 429, 500, 503 })
            {
                server.Handler = _ => Task.FromResult(new Reply(status, "{\"error\":{\"code\":\"cli_scope_denied\",\"message\":\"PRIVATE\"},\"request_id\":\"rid-body\"}"));
                var before = server.Requests.Count; var e = await Throws<ChertApiException>(() => client.CreateCallAsync(Managed(), "stable-key"));
                Check(e.Status == status && e.Code == "cli_scope_denied" && e.RequestId == "rid-body" && e.ResponseData is not null && !e.ToString().Contains("PRIVATE") && server.Requests.Count == before + 1);
            }
        });
        await Run("FaceTime redirect, stream limit, dropped reply and cancellation remain bounded", async () =>
        {
            await using var sink = new Loopback();
            server.Handler = _ => Task.FromResult(new Reply(302, "{}", Headers: new() { ["Location"] = sink.Origin }));
            Check((await Throws<ChertApiException>(() => client.GetCallAsync(Call))).Status == 302 && sink.Requests.IsEmpty);
            using var small = new FaceTimeClient(new() { BaseUrl = server.Origin, Token = "face-secret", ProjectId = Project, MaxResponseBytes = 32 });
            server.Handler = _ => Task.FromResult(new Reply(200, new string('x', 200), NoLength: true));
            Check((await Throws<ChertApiException>(() => small.ListLinesAsync())).Code == "response_too_large");
            server.Handler = _ => Task.FromResult(new Reply(0, "", Drop: true)); var before = server.Requests.Count;
            Check((await Throws<ChertApiException>(() => client.CreateCallAsync(Managed(), "stable-key"))).Code == "transport_error" && server.Requests.Count == before + 1);
            using var cancel = new CancellationTokenSource(); cancel.Cancel(); before = server.Requests.Count;
            await Throws<OperationCanceledException>(() => client.ListCallsAsync(cancellationToken: cancel.Token)); Check(server.Requests.Count == before);
            using var shortClient = new FaceTimeClient(new() { BaseUrl = server.Origin, Token = "face-secret", ProjectId = Project, Timeout = TimeSpan.FromMilliseconds(70) });
            server.Handler = _ => Task.FromResult(new Reply(200, Envelope(CallJson), SlowBody: true));
            Check((await Throws<ChertApiException>(() => shortClient.GetCallAsync(Call))).Code == "timeout");
        });
        await Run("FaceTime raw extension requests unwrap owned JSON without inventing schemas", async () =>
        {
            ReplyWith("{\"value\":17}", 201); Check((await client.RequestAsync("/extension", Json(new { test = true }))).GetProperty("value").GetInt32() == 17);
            Wire(server, "POST", "/extension", body: "{\"test\":true}");
            ReplyWith("null"); Check((await client.RequestAsync("/extension")).ValueKind == JsonValueKind.Null);
            ReplyWith("{}"); await client.RequestAsync("/extension", Json(null)); Wire(server, "POST", "/extension", body: "null");
            foreach (var path in new[] { "//foreign", "/../x", "/%2e%2e/x", "/x?token=%0A" }) await Throws<ArgumentException>(() => client.RequestAsync(path));
        });
        await Run("channel request bounds accept exact limits and reject the next byte", async () =>
        {
            using var messages = new IMessageClient(server.Origin, "message-secret");
            server.Handler = _ => Task.FromResult(new Reply(202, TextReceipt()));
            await messages.SendTextAsync("+15550000002", new string('é', 8192), new string('é', 100));
            var before = server.Requests.Count;
            await Throws<ArgumentException>(() => messages.SendTextAsync("+15550000002", new string('é', 8192) + "x"));
            await Throws<ArgumentException>(() => messages.SendTextAsync("+15550000002", "ok", new string('é', 100) + "x"));
            Check(server.Requests.Count == before);
            ReplyWith(CallJson, 201);
            await client.CreateCallAsync(Managed(), new string('k', 8)); await client.CreateCallAsync(Managed(), new string('k', 200));
            before = server.Requests.Count;
            await Throws<ArgumentException>(() => client.CreateCallAsync(Managed(), new string('k', 7)));
            await Throws<ArgumentException>(() => client.CreateCallAsync(Managed(), new string('k', 201)));
            Check(server.Requests.Count == before);
            var body = Envelope("{}");
            using var bounded = new FaceTimeClient(new() { BaseUrl = server.Origin, Token = "face-secret", ProjectId = Project, MaxResponseBytes = System.Text.Encoding.UTF8.GetByteCount(body) });
            ReplyWith("{}"); await bounded.RequestAsync("/extension");
            server.Handler = _ => Task.FromResult(new Reply(200, body + " "));
            Check((await Throws<ChertApiException>(() => bounded.RequestAsync("/extension"))).Code == "response_too_large");
        });
    }
}
