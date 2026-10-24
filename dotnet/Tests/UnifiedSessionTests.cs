using System.Text.Json;
using System.Text.Json.Nodes;
using TryChert;

static partial class Program
{
    static async Task UnifiedSessionTests()
    {
        await using var messaging = new Loopback();
        await using var faceTime = new Loopback();
        await using var foreign = new Loopback();
        const string token = "chu_abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE";
        string[] scopes = ["imessage:events:read", "imessage:webhooks:manage", "imessage:messages:send",
            "facetime:calls:read", "facetime:calls:create", "facetime:calls:control"];
        var descriptor = JsonSerializer.Serialize(new { data = new {
            contract = "chert-unified", contract_version = 1,
            auth = new { scheme = "Bearer", token_prefix = "chu_", audience = "chert.unified-api:v1", login_url = faceTime.Origin + "/api/v1/cli/logins" },
            services = new { imessage = new { base_url = messaging.Origin + "/api/v1" }, facetime = new { base_url = faceTime.Origin + "/api/v1" } }, scopes
        } });
        UnifiedSessionOptions Options(string access = token, string project = Chat, string? im = null, string? ft = null, TimeSpan? timeout = null)
            => new() { AccessToken = access, ProjectId = project, IMessageBaseUrl = im ?? messaging.Origin,
                FaceTimeBaseUrl = ft ?? faceTime.Origin, Timeout = timeout ?? TimeSpan.FromSeconds(15) };
        var echo = new Dictionary<string, string> { ["X-Chert-Contract"] = "chert-unified-v1" };
        await Run("unified connect validates credentials project and both origins before discovery", async () =>
        {
            var before = messaging.Requests.Count;
            foreach (var bad in new[] { "legacy", token + "\n", token[..^1], token + "x", token[..^1] + "+" })
                await Throws<ArgumentException>(() => TryChert.ChertClient.ConnectAsync(Options(access: bad)));
            foreach (var bad in new[] { "", "{" + Chat + "}", Chat.Replace("-", ""), Chat + "\n" })
                await Throws<ArgumentException>(() => TryChert.ChertClient.ConnectAsync(Options(project: bad)));
            foreach (var bad in new[] { "http://foreign.invalid", "https://user:pass@example.com", messaging.Origin + "/../escape", messaging.Origin + "?x=1",
                messaging.Origin + "/deployment", messaging.Origin + "/deployment/", messaging.Origin + "/api/v1", messaging.Origin + "//" })
            {
                await Throws<ArgumentException>(() => TryChert.ChertClient.ConnectAsync(Options(im: bad)));
                await Throws<ArgumentException>(() => TryChert.ChertClient.ConnectAsync(Options(ft: bad)));
            }
            using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
            await Throws<OperationCanceledException>(() => TryChert.ChertClient.ConnectAsync(Options(), cancelled.Token));
            Check(messaging.Requests.Count == before && faceTime.Requests.Count == 0 && foreign.Requests.Count == 0);
            Check(!Options().ToString().Contains(token));
        });
        await Run("unified discovery is unauthenticated and one session binds both guarded channels", async () =>
        {
            messaging.Handler = _ => Task.FromResult(new Reply(200, descriptor));
            using var client = await TryChert.ChertClient.ConnectAsync(Options(im: messaging.Origin + "/", ft: faceTime.Origin + "/"));
            var discovery = messaging.Requests.Last();
            Check(discovery.Method == "GET" && discovery.Target == "/api/v1/sdk/capabilities");
            Check(!discovery.Headers.ContainsKey("authorization") && !discovery.Headers.ContainsKey("x-chert-tenant")
                && !discovery.Headers.ContainsKey("x-chert-project-id") && !discovery.Headers.ContainsKey("x-chert-contract") && !discovery.Headers.ContainsKey("cookie"));
            Check(faceTime.Requests.Count == 0);
            messaging.Handler = _ => Task.FromResult(new Reply(200, "{\"events\":[]}", echo));
            await client.IMessage!.ListEventsAsync();
            faceTime.Handler = _ => Task.FromResult(new Reply(200, "{\"data\":{\"ok\":true}}", echo));
            await client.FaceTime!.RequestAsync("/calls");
            foreach (var request in new[] { messaging.Requests.Last(), faceTime.Requests.Last() })
            {
                Check(request.Headers["authorization"] == "Bearer " + token && request.Headers["x-chert-contract"] == "chert-unified-v1");
                Check(!request.Headers.ContainsKey("x-chert-tenant"));
            }
            Check(faceTime.Requests.Last().Headers["x-chert-project-id"] == Chat);
            Check(!messaging.Requests.Last().Headers.ContainsKey("x-chert-project-id"));
            var sse = new Dictionary<string, string>(echo) { ["Content-Type"] = "text/event-stream" };
            messaging.Handler = _ => Task.FromResult(new Reply(200, "event: close\ndata:{}\n\n", sse));
            var count = 0; await foreach (var frame in client.IMessage.StreamEventsAsync()) { Check(frame.Event == "close"); count++; }
            Check(count == 1 && messaging.Requests.Last().Headers["x-chert-contract"] == "chert-unified-v1");
            // Existing strict text route is deliberately unchanged.
            messaging.Handler = _ => Task.FromResult(new Reply(202, TextReceipt(), echo));
            var receipt = await client.IMessage.SendTextAsync("+15550000002", "fixture", "stable-operation");
            var send = messaging.Requests.Last();
            Check(send.Target == "/api/v1/text-operations/v1" && send.Method == "POST");
            Check(send.Headers["authorization"] == "Bearer " + token && send.Headers["x-chert-contract"] == "chert-unified-v1");
            Check(!send.Headers.ContainsKey("idempotency-key") && !send.Headers.ContainsKey("x-chert-tenant"));
            using var payload = JsonDocument.Parse(send.Body);
            Check(payload.RootElement.EnumerateObject().Count() == 3
                && payload.RootElement.GetProperty("phone").GetString() == "+15550000002"
                && payload.RootElement.GetProperty("body").GetString() == "fixture"
                && payload.RootElement.GetProperty("idempotency_key").GetString() == "stable-operation");
            Check(receipt.Success && receipt.Status == "queued" && receipt.MessageId == PublicId && receipt.ChatId == Chat);
            foreach (var reply in new[] { new Reply(200, TextReceipt(), echo), new Reply(202, TextReceipt("sent"), echo) })
            {
                messaging.Handler = _ => Task.FromResult(reply);
                var before = messaging.Requests.Count;
                Check((await Throws<ChertApiException>(() => client.IMessage.SendTextAsync("+15550000002", "fixture"))).Code == "unconfirmed_text_outcome");
                Check(messaging.Requests.Count == before + 1);
            }
            faceTime.Handler = _ => Task.FromResult(new Reply(200, "{\"data\":{\"revoked\":true}}", echo));
            Check((await client.FaceTime.LogoutAsync()).Revoked);
            var logout = faceTime.Requests.Last();
            Check(logout.Method == "POST" && logout.Target == "/api/v1/cli/logout"
                && logout.Headers["authorization"] == "Bearer " + token && logout.Headers["x-chert-contract"] == "chert-unified-v1");
        });
        await Run("unified scope entries reject duplicates and nonstrings but accept unique future scopes", async () =>
        {
            foreach (var extra in new object?[] { null, 1, true, new { scope = "future" }, new[] { "future" }, scopes[0] })
            {
                var tree = JsonNode.Parse(descriptor)!;
                tree["data"]!["scopes"]!.AsArray().Add(JsonSerializer.SerializeToNode(extra));
                messaging.Handler = _ => Task.FromResult(new Reply(200, tree.ToJsonString()));
                var before = messaging.Requests.Count;
                await Throws<UnsupportedUnifiedBackendException>(() => TryChert.ChertClient.ConnectAsync(Options()));
                Check(messaging.Requests.Count == before + 1 && !messaging.Requests.Last().Headers.ContainsKey("authorization"));
            }
            var future = JsonNode.Parse(descriptor)!;
            future["data"]!["scopes"]!.AsArray().Add("future:read");
            messaging.Handler = _ => Task.FromResult(new Reply(200, future.ToJsonString()));
            using var accepted = await TryChert.ChertClient.ConnectAsync(Options());
            future["data"]!["scopes"]!.AsArray().Add("future:read");
            await Throws<UnsupportedUnifiedBackendException>(() => TryChert.ChertClient.ConnectAsync(Options()));
        });
        await Run("unified rejects malformed descriptors foreign service URLs login URLs and every missing scope without token requests", async () =>
        {
            var invalid = new List<string> { "{}", "null", "not-json", descriptor.Replace("\"contract_version\":1", "\"contract_version\":1,\"contract_version\":1") };
            foreach (var path in new[] { "contract", "contract_version", "auth.scheme", "auth.token_prefix", "auth.audience", "auth.login_url", "services.imessage.base_url", "services.facetime.base_url", "scopes" })
            {
                var tree = JsonNode.Parse(descriptor)!; JsonNode parent = tree["data"]!;
                var parts = path.Split('.'); foreach (var part in parts[..^1]) parent = parent[part]!;
                parent[parts[^1]] = path.Contains("url") ? foreign.Origin + "/api/v1" : "wrong";
                invalid.Add(tree.ToJsonString());
            }
            foreach (var scope in scopes)
            {
                var tree = JsonNode.Parse(descriptor)!;
                tree["data"]!["scopes"] = JsonSerializer.SerializeToNode(scopes.Where(s => s != scope));
                invalid.Add(tree.ToJsonString());
            }
            var beforeFt = faceTime.Requests.Count;
            foreach (var body in invalid)
            {
                messaging.Handler = _ => Task.FromResult(new Reply(200, body));
                var before = messaging.Requests.Count;
                Check((await Throws<UnsupportedUnifiedBackendException>(() => TryChert.ChertClient.ConnectAsync(Options()))).Code == "unsupported_unified_backend");
                Check(messaging.Requests.Count == before + 1 && !messaging.Requests.Last().Headers.ContainsKey("authorization"));
            }
            Check(faceTime.Requests.Count == beforeFt && foreign.Requests.Count == 0);
        });
        await Run("unified discovery bounds redirects old servers deadlines and cancellation fail closed", async () =>
        {
            foreach (var reply in new[] { new Reply(404, "{}"), new Reply(307, "{}", new() { ["Location"] = foreign.Origin }),
                new Reply(200, "{}", AdvertisedLength: 65537), new Reply(200, new string(' ', 65537), NoLength: true), new Reply(0, "", Drop: true) })
            {
                messaging.Handler = _ => Task.FromResult(reply); var before = messaging.Requests.Count;
                await Throws<UnsupportedUnifiedBackendException>(() => TryChert.ChertClient.ConnectAsync(Options()));
                Check(messaging.Requests.Count == before + 1, $"discovery status {reply.Status}: {messaging.Requests.Count - before} attempts");
            }
            messaging.Handler = _ => Task.FromResult(new Reply(200, descriptor, DelayMs: 300));
            var beforeTimeout = messaging.Requests.Count;
            await Throws<UnsupportedUnifiedBackendException>(() => TryChert.ChertClient.ConnectAsync(Options(timeout: TimeSpan.FromMilliseconds(50))));
            Check(messaging.Requests.Count == beforeTimeout + 1 && !messaging.Requests.Last().Headers.ContainsKey("authorization"));
            using var cancelled = new CancellationTokenSource(50);
            await Throws<OperationCanceledException>(() => TryChert.ChertClient.ConnectAsync(Options(), cancelled.Token));
            Check(foreign.Requests.Count == 0);
        });
        await Run("unified discovery caps a longer caller timeout at fifteen seconds", async () =>
        {
            messaging.Handler = _ => Task.FromResult(new Reply(200, descriptor, DelayMs: 17000));
            var before = messaging.Requests.Count;
            using var guard = new CancellationTokenSource(TimeSpan.FromSeconds(20));
            await Throws<UnsupportedUnifiedBackendException>(() => TryChert.ChertClient.ConnectAsync(Options(timeout: TimeSpan.FromSeconds(30)), guard.Token));
            Check(!guard.IsCancellationRequested && messaging.Requests.Count == before + 1);
            Check(!messaging.Requests.Last().Headers.ContainsKey("authorization"));
        });
        await Run("unified guarded reads and SSE never replay dropped replies or follow echoed redirects", async () =>
        {
            messaging.Handler = _ => Task.FromResult(new Reply(200, descriptor));
            using var client = await TryChert.ChertClient.ConnectAsync(Options());
            var redirect = new Dictionary<string, string>(echo) { ["Location"] = foreign.Origin + "/api/v1/events" };
            foreach (var reply in new[] { new Reply(0, "", Drop: true), new Reply(307, "{}", redirect) })
            {
                messaging.Handler = faceTime.Handler = _ => Task.FromResult(reply);
                var before = messaging.Requests.Count + faceTime.Requests.Count;
                await Throws<ChertApiException>(() => client.IMessage!.ListEventsAsync());
                await Throws<ChertApiException>(() => client.FaceTime!.RequestAsync("/calls"));
                await using var frames = client.IMessage!.StreamEventsAsync().GetAsyncEnumerator();
                await Throws<ChertApiException>(async () => { await frames.MoveNextAsync(); });
                Check(messaging.Requests.Count + faceTime.Requests.Count == before + 3);
                Check(foreign.Requests.Count == 0);
            }
        });
        await Run("unified requires exact echo before parsing JSON errors empty responses or yielding SSE", async () =>
        {
            messaging.Handler = _ => Task.FromResult(new Reply(200, descriptor));
            using var client = await TryChert.ChertClient.ConnectAsync(Options());
            foreach (var marker in new string?[] { null, "chert-unified-v2", "CHERT-UNIFIED-V1", "chert-unified-v1, chert-unified-v1" })
            {
                var headers = new Dictionary<string, string>(); if (marker is not null) headers["X-Chert-Contract"] = marker;
                foreach (var status in new[] { 200, 204, 401, 404, 307 })
                {
                    messaging.Handler = faceTime.Handler = _ => Task.FromResult(new Reply(status, "not-json", headers));
                    var before = messaging.Requests.Count + faceTime.Requests.Count;
                    await Throws<UnsupportedUnifiedBackendException>(() => client.IMessage!.RequestAsync("/events"));
                    await Throws<UnsupportedUnifiedBackendException>(() => client.FaceTime!.RequestAsync("/calls"));
                    Check(messaging.Requests.Count + faceTime.Requests.Count == before + 2);
                }
                headers["Content-Type"] = "text/event-stream";
                messaging.Handler = _ => Task.FromResult(new Reply(200, "data:{}\n\n", headers));
                await using var frames = client.IMessage!.StreamEventsAsync().GetAsyncEnumerator();
                await Throws<UnsupportedUnifiedBackendException>(async () => { await frames.MoveNextAsync(); });
            }
            Check(foreign.Requests.Count == 0);
        });
    }
}
