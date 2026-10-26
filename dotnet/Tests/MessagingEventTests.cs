using System.Security.Cryptography;
using System.Text;
using TryChert;

static partial class Program
{
    static async Task MessagingEventTests()
    {
        await using var server = new Loopback();
        using var client = new IMessageClient(server.Origin, "event-key", "event-tenant");
        await Run("event list filters and subscription CRUD preserve JSON and verbs", async () =>
        {
            await client.ListEventsAsync(new() { Type = "message.received", Status = "failed", LeadId = "lead", Since = "opaque+token=", Cursor = "a/b", Limit = 200 });
            Check(server.Requests.Last().Target == "/api/v1/events?type=message.received&status=failed&lead_id=lead&since=opaque%2Btoken%3D&cursor=a%2Fb&limit=200");
            await client.GetEventAsync("row-1"); Check(server.Requests.Last().Target.EndsWith("/events/row-1"));
            await client.ListWebhookSubscriptionsAsync(); Check(server.Requests.Last().Method == "GET");
            await client.GetWebhookSubscriptionAsync("sub-1"); Check(server.Requests.Last().Target.EndsWith("/webhook-subscriptions/sub-1"));
            await client.CreateWebhookSubscriptionAsync(new() { Url = "https://example.com/hook", Events = ["message.received"] });
            Check(server.Requests.Last().Method == "POST" && !server.Requests.Last().Body.Contains("version"));
            await client.UpdateWebhookSubscriptionAsync("sub-1", new() { IsActive = false });
            Check(server.Requests.Last().Method == "PATCH" && server.Requests.Last().Body == "{\"is_active\":false}");
            await client.DeleteWebhookSubscriptionAsync("sub-1"); Check(server.Requests.Last().Method == "DELETE");
            var before = server.Requests.Count;
            foreach (var limit in new[] { 0, 201 }) await Throws<ArgumentException>(() => client.ListEventsAsync(new() { Limit = limit }));
            await Throws<ArgumentException>(() => client.GetEventAsync("../bad"));
            Check(server.Requests.Count == before);
        });
        var headers = new Dictionary<string, string> { ["Content-Type"] = "text/event-stream; charset=utf-8" };
        await Run("opaque event cursors round trip percent punctuation and Unicode", async () =>
        {
            foreach (var token in new[] { "%", "%2F", "+", "/", "=", "&", "é🌅" })
            {
                server.Handler = _ => Task.FromResult(new Reply(200, "{}"));
                await client.ListEventsAsync(new() { Since = token, Cursor = token });
                var query = server.Requests.Last().Target.Split('?', 2)[1].Split('&');
                Check(query.Length == 2);
                Check(Uri.UnescapeDataString(query[0].Split('=', 2)[1]) == token);
                Check(Uri.UnescapeDataString(query[1].Split('=', 2)[1]) == token);
                server.Handler = _ => Task.FromResult(new Reply(200, "data:{}\n\n", headers));
                await foreach (var frame in client.StreamEventsAsync(token)) { }
                Check(Uri.UnescapeDataString(server.Requests.Last().Target.Split("?since=", 2)[1]) == token);
            }
        });
        await Run("SSE close is terminal with extra frames or a lingering connection", async () =>
        {
            foreach (var extra in new[] { "data:{}\n\n", "" })
            {
                server.Handler = _ => Task.FromResult(new Reply(200, "event: close\r\ndata:{\"since\":\"next\"}\r\n\r\n" + extra,
                    headers, NoLength: true, LingerMs: 5000));
                using var deadline = new CancellationTokenSource(1000);
                var count = 0;
                await foreach (var frame in client.StreamEventsAsync(cancellationToken: deadline.Token))
                {
                    Check(frame.Event == "close" && frame.Data.GetProperty("since").GetString() == "next");
                    count++;
                }
                Check(count == 1 && !deadline.IsCancellationRequested);
            }
        });
        await Run("SSE fragmented UTF8 CRLF multiline JSON named error and close no reconnect", async () =>
        {
            server.Handler = _ => Task.FromResult(new Reply(200, ":heartbeat\r\n\r\ndata: {\r\ndata: \"text\":\"é🌅\"}\r\n\r\nevent: error\ndata: {\"code\":\"notice\"}\n\nevent: close\ndata: {\"since\":\"next\"}\n\n", headers, SlowBody: true));
            var before = server.Requests.Count;
            var frames = new List<MessagingStreamFrame>();
            await foreach (var frame in client.StreamEventsAsync("opaque+=")) frames.Add(frame);
            Check(frames.Count == 3 && frames[0].Event == "message" && frames[0].Data.GetProperty("text").GetString() == "é🌅" && frames[1].Event == "error" && frames[2].Event == "close");
            var request = server.Requests.Last();
            Check(request.Target == "/api/v1/events/stream?since=opaque%2B%3D" && request.Headers["authorization"] == "Bearer event-key" && request.Headers["x-chert-tenant"] == "event-tenant");
            Check(!request.Headers.ContainsKey("last-event-id") && !request.Headers.ContainsKey("x-chert-project-id") && server.Requests.Count == before + 1);
        });
        await Run("SSE malformed oversized redirect cancellation and early disposal", async () =>
        {
            async Task Consume(CancellationToken ct = default) { await foreach (var frame in client.StreamEventsAsync(cancellationToken: ct)) { } }
            foreach (var body in new[] { "data: invalid\n\n", "data: " + new string('x', 1024 * 1024) })
            { server.Handler = _ => Task.FromResult(new Reply(200, body, headers)); await Throws<ChertApiException>(() => Consume()); }
            server.Handler = _ => Task.FromResult(new Reply(307, "", headers));
            var before = server.Requests.Count; await Throws<ChertApiException>(() => Consume()); Check(server.Requests.Count == before + 1);
            using var cancelled = new CancellationTokenSource(); cancelled.Cancel(); before = server.Requests.Count;
            await Throws<OperationCanceledException>(() => Consume(cancelled.Token)); Check(server.Requests.Count == before);
            server.Handler = _ => Task.FromResult(new Reply(200, "data: {}\n\n" + new string(' ', 100), headers, SlowBody: true));
            using var inflight = new CancellationTokenSource(50);
            await Throws<OperationCanceledException>(() => Consume(inflight.Token));
            await foreach (var frame in client.StreamEventsAsync()) break;
            server.Handler = _ => Task.FromResult(new Reply(200, "data: {}", headers));
            var count = 0; await foreach (var frame in client.StreamEventsAsync()) count++; Check(count == 0);
        });
        await Run("SSE counts CRLF bytes and keeps frame boundaries independent", async () =>
        {
            const int limit = 1024 * 1024;
            async Task<int> Consume()
            {
                var count = 0;
                await foreach (var frame in client.StreamEventsAsync()) count++;
                return count;
            }
            server.Handler = _ => Task.FromResult(new Reply(200, string.Concat(Enumerable.Repeat(":\r\n", 400000)) + "data:{}\r\n\r\n", headers));
            Check((await Throws<ChertApiException>(async () => { await Consume(); })).Code == "event_frame_too_large");
            // Include both bytes of the final delimiter in the exact wire bound.
            var exact = ":" + new string('x', limit - 14) + "\r\ndata:{}\r\n\r\n";
            Check(Encoding.UTF8.GetByteCount(exact) == limit);
            server.Handler = _ => Task.FromResult(new Reply(200, exact + exact, headers));
            Check(await Consume() == 2);
            var preceded = "data:{}\r\n\r\n" + exact;
            foreach (var split in new[] { 10, preceded.Length - 1 })
            {
                server.Handler = _ => Task.FromResult(new Reply(200, preceded, headers, SplitAt: split));
                Check(await Consume() == 2);
            }
            server.Handler = _ => Task.FromResult(new Reply(200, ":x" + exact[1..], headers));
            Check((await Throws<ChertApiException>(async () => { await Consume(); })).Code == "event_frame_too_large");
            server.Handler = _ => Task.FromResult(new Reply(200, ":x" + exact[1..], headers, SplitAt: limit));
            Check((await Throws<ChertApiException>(async () => { await Consume(); })).Code == "event_frame_too_large");
        });
        await Run("SSE oversized message and close fail before first yield including split final LF", async () =>
        {
            const int limit = 1024 * 1024;
            foreach (var name in new[] { "message", "close" })
            {
                var suffix = "\r\nevent:" + name + "\r\ndata:{}\r\n\r\n";
                var body = ":" + new string('x', limit - suffix.Length) + suffix;
                Check(Encoding.UTF8.GetByteCount(body) == limit + 1);
                foreach (int? split in new int?[] { null, limit })
                {
                    server.Handler = _ => Task.FromResult(new Reply(200, body, headers, SplitAt: split));
                    await using var frames = client.StreamEventsAsync().GetAsyncEnumerator();
                    var delivered = 0;
                    var error = await Throws<ChertApiException>(async () =>
                    {
                        if (await frames.MoveNextAsync()) delivered++;
                    });
                    Check(error.Code == "event_frame_too_large" && delivered == 0);
                }
            }
        });
        await Run("SSE pending bare CR flushes at EOF without dispatching an incomplete frame", async () =>
        {
            foreach (var body in new[] { "data:{}\r\r", "data:{}\r\rdata:{}\r\r", "data:{}\r" })
            {
                server.Handler = _ => Task.FromResult(new Reply(200, body, headers));
                var count = 0;
                await foreach (var frame in client.StreamEventsAsync()) count++;
                Check(count == (body == "data:{}\r" ? 0 : body == "data:{}\r\r" ? 1 : 2));
            }
        });
        await Run("webhook exact raw bytes timestamp hex constant time verification", () =>
        {
            var body = Encoding.UTF8.GetBytes(" {\"text\":\"é🌅\"}\n");
            string Sign(long time) => "v1," + time + "," + Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes("secret"), Encoding.UTF8.GetBytes(time + ".").Concat(body).ToArray()));
            var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds(); var signature = Sign(now);
            Check(ChertWebhook.Verify(body, signature, "secret"));
            Check(!ChertWebhook.Verify(body, signature, "wrong") && !ChertWebhook.Verify(body[..^1], signature, "secret"));
            foreach (var invalid in new[] { Sign(now - 305), Sign(now + 305), signature + "\n", "v2" + signature[2..], "v1,999999999999999999999999,00", signature[..^1] + "g" }) Check(!ChertWebhook.Verify(body, invalid, "secret"));
            return Task.CompletedTask;
        });
    }
}
