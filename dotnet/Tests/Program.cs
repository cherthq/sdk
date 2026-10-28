using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using TryChert;
using ChertClient = TryChert.IMessageClient;

static partial class Program
{
    const string PublicId = "0123456789abcdef0123456789abcdef";
    const string Chat = "11aa0000-0000-4000-8000-000000000001";
    static int cases;
    static JsonElement Json(object? value) => JsonSerializer.SerializeToElement(value);
    const string TextMessageId = "7f3c2a10-5b4e-4d6f-9a81-2c3d4e5f6a7b";
    static string TextReceipt(string status = "queued", string? messageId = TextMessageId) => JsonSerializer.Serialize(new { status, message_id = messageId, chat_id = Chat,
        lead_id = "3e1d9c22-8f4a-4b7e-a6c5-1d2e3f4a5b6c", lead_created = false, convo_id = "c0ffee00-1234-4abc-8def-0123456789ab", phone_line_id = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d" });
    static string ReactionReceipt(string message = "Observed:Ab.C-1", string chat = Chat) => JsonSerializer.Serialize(new { operation_id = PublicId, chat_id = chat, message_id = message, status = "acknowledged" });
    static void Check(bool ok, string label = "assertion") { if (!ok) throw new Exception(label); }
    static async Task<T> Throws<T>(Func<Task> body) where T : Exception
    { try { await body(); } catch (T error) { return error; } throw new Exception("Expected bounded failure"); }
    static async Task Run(string name, Func<Task> body) { await body(); cases++; Console.WriteLine("PASS " + name); }
    public static async Task Main()
    {
        await using var server = new Loopback();
        using var client = new ChertClient(server.Origin, "private-key", "tenant-fixture");
        await Run("construction has zero effects and formatting hides configuration", () =>
        { Check(server.Requests.Count == 0); Check(!client.ToString().Contains("private")); Check(!client.ToString().Contains(server.Origin)); return Task.CompletedTask; });
        await Run("generic auth, tenant, prefix, method and JSON body", async () =>
        {
            server.Handler = _ => Task.FromResult(new Reply(200, "{\"observed\":true}"));
            var result = await client.RequestAsync("/whoami"); Check(result?.GetProperty("observed").GetBoolean() == true);
            var request = server.Requests.Last(); Check(request.Target == "/api/v1/whoami" && request.Method == "GET");
            Check(request.Headers["authorization"] == "Bearer private-key" && request.Headers["x-chert-tenant"] == "tenant-fixture");
            Check(!request.Headers.ContainsKey("cookie"));
            await client.RequestAsync("/json", Json(null)); request = server.Requests.Last(); Check(request.Method == "POST" && request.Body == "null");
            using var prefix = new ChertClient(server.Origin + "/deployment", "key");
            await prefix.RequestAsync("/messages?limit=5&cursor=a%2Bb"); Check(server.Requests.Last().Target == "/deployment/messages?limit=5&cursor=a%2Bb");
        });
        await Run("null, no-content and HEAD stay distinct", async () =>
        {
            server.Handler = _ => Task.FromResult(new Reply(200, "null")); Check((await client.RequestAsync("/null"))?.ValueKind == JsonValueKind.Null);
            server.Handler = _ => Task.FromResult(new Reply(204, "")); Check(await client.RequestAsync("/empty") is null);
            server.Handler = _ => Task.FromResult(new Reply(200, "")); Check(await client.RequestAsync("/head", method: HttpMethod.Head) is null);
        });
        await Run("strict text rejects outer-whitespace key, keeps lossless Unicode key and exact queued receipt", async () =>
        {
            server.Handler = _ => Task.FromResult(new Reply(202, TextReceipt()));
            const string text = "  Café / 🌅\r\n  ";
            var rejectedBefore = server.Requests.Count;
            await Throws<ArgumentException>(() => client.SendTextAsync("+15550000002", text, " raw-key-🌅 "));
            Check(server.Requests.Count == rejectedBefore);
            const string key = "raw key-🌅\tinner";
            var receipt = await client.SendTextAsync("+15550000002", text, key); Check(receipt.Success && receipt.MessageId == TextMessageId && receipt.ChatId == Chat && receipt.Status == "queued");
            var wire = server.Requests.Last(); Check(wire.Target == "/api/v1/send" && wire.Method == "POST");
            using var payload = JsonDocument.Parse(wire.Body); var p = payload.RootElement;
            Check(p.EnumerateObject().Count() == 3 && p.GetProperty("phone").GetString() == "+15550000002" && p.GetProperty("body").GetString() == text && p.GetProperty("idempotency_key").GetString() == key);
            Check(!wire.Headers.ContainsKey("idempotency-key"));
        });
        await Run("strict text invalid arguments have zero requests", async () =>
        {
            var before = server.Requests.Count;
            foreach (var text in new[] { "", " \ufeff\r\n", "a\0b", "\ud800", new string('x', 16385) })
                await Throws<ArgumentException>(() => client.SendTextAsync("+15550000002", text));
            foreach (var phone in new[] { "15550000002", "+05550000002", "+15550000002\n" }) await Throws<ArgumentException>(() => client.SendTextAsync(phone, "x"));
            foreach (var key in new[] { "", "\ud800", "a\0b", new string('x', 201), " key", "key\n", " \t\ufeff\u3000" }) await Throws<ArgumentException>(() => client.SendTextAsync("+15550000002", "x", key));
            Check(server.Requests.Count == before);
        });
        await Run("ECMAScript blankness keeps NEL and separator as nonblank", async () =>
        {
            server.Handler = _ => Task.FromResult(new Reply(202, TextReceipt()));
            await client.SendTextAsync("+15550000002", "\u0085"); await client.SendTextAsync("+15550000002", "\u001c");
        });
        await Run("200 sent and duplicate text receipts are accepted with extra fields", async () =>
        {
            foreach (var status in new[] { "sent", "duplicate" })
            {
                server.Handler = _ => Task.FromResult(new Reply(200, TextReceipt(status)[..^1] + ",\"service\":\"iMessage\",\"delivered\":false}"));
                var receipt = await client.SendTextAsync("+15550000002", "x");
                Check(receipt.Success && receipt.Status == status && receipt.MessageId == TextMessageId && receipt.ChatId == Chat);
                Check(server.Requests.Last().Target == "/api/v1/send");
            }
        });
        await Run("malformed or wrong-status text acceptance stays unknown without retry", async () =>
        {
            foreach (var reply in new[] { new Reply(200, TextReceipt()), new Reply(202, TextReceipt("sent")), new Reply(202, TextReceipt("duplicate")), new Reply(201, TextReceipt()), new Reply(200, TextReceipt("delivered")),
                new Reply(202, TextReceipt(messageId: null)), new Reply(202, TextReceipt().Replace(TextMessageId, "bad id")), new Reply(202, TextReceipt().Replace(Chat, "")), new Reply(202, "{}"), new Reply(202, "[]") })
            {
                server.Handler = _ => Task.FromResult(reply); var before = server.Requests.Count;
                var error = await Throws<ChertApiException>(() => client.SendTextAsync("+15550000002", "x"));
                Check(error.Status == 502 && error.Code == "unconfirmed_text_outcome" && server.Requests.Count == before + 1);
            }
        });
        await Run("reaction exact public path case and printable header key", async () =>
        {
            server.Handler = _ => Task.FromResult(new Reply(202, ReactionReceipt()));
            var receipt = await client.SendReactionAsync(Chat.ToUpperInvariant(), "Observed:Ab.C-1", "like", true, "same key");
            var request = server.Requests.Last(); Check(request.Target == $"/api/v1/chats/{Chat}/messages/Observed%3AAb.C-1/reactions");
            Check(request.Headers["idempotency-key"] == "same key" && receipt.ChatId == Chat && receipt.MessageId == "Observed:Ab.C-1");
            using var body = JsonDocument.Parse(request.Body); var p = body.RootElement;
            Check(p.EnumerateObject().Count() == 3 && p.GetProperty("reaction").GetString() == "like" && p.GetProperty("remove").GetBoolean() && p.GetProperty("part_index").GetInt32() == 0);
        });
        await Run("all six standard reaction names accepted", async () =>
        {
            server.Handler = _ => Task.FromResult(new Reply(202, ReactionReceipt()));
            foreach (var reaction in new[] { "love", "like", "dislike", "laugh", "emphasize", "question" }) await client.SendReactionAsync(Chat, "Observed:Ab.C-1", reaction);
        });
        await Run("reaction validation rejects URI escapes custom kinds and bad header keys before HTTP", async () =>
        {
            var before = server.Requests.Count;
            foreach (var id in new[] { ".", "..", "foo/bar", "a%2fb", "x\n", new string('x', 161) }) await Throws<ArgumentException>(() => client.SendReactionAsync(Chat, id, "like"));
            await Throws<ArgumentException>(() => client.SendReactionAsync("{" + Chat + "}", "safe", "like"));
            await Throws<ArgumentException>(() => client.SendReactionAsync(Chat, "safe", "LIKE"));
            foreach (var key in new[] { "", " leading", "trailing ", "a\r\nb", "é", "a\u007f", new string('a', 201) }) await Throws<ArgumentException>(() => client.SendReactionAsync(Chat, "safe", "like", idempotencyKey: key));
            Check(server.Requests.Count == before);
        });
        await Run("reaction acknowledgement requires exact identity status and shape", async () =>
        {
            foreach (var reply in new[] { new Reply(200, ReactionReceipt()), new Reply(202, ReactionReceipt("observed:Ab.C-1")), new Reply(202, ReactionReceipt(chat: Chat.ToUpperInvariant())), new Reply(202, ReactionReceipt().Replace("acknowledged", "applied")), new Reply(202, ReactionReceipt()[..^1] + ",\"extra\":true}"), new Reply(202, "{\"operation_id\":\"" + PublicId + "\",\"chat_id\":\"" + Chat + "\",\"message_id\":\"Observed:Ab.C-1\",\"status\":\"acknowledged\",\"status\":\"acknowledged\"}") })
            {
                server.Handler = _ => Task.FromResult(reply); var before = server.Requests.Count;
                var error = await Throws<ChertApiException>(() => client.SendReactionAsync(Chat, "Observed:Ab.C-1", "like")); Check(error.Code == "unconfirmed_reaction_outcome" && server.Requests.Count == before + 1);
            }
        });
        await Run("path and base URL guards reject namespace escape and header injection", async () =>
        {
            var before = server.Requests.Count;
            foreach (var path in new[] { "https://foreign.invalid/x", "//foreign/x", "/../x", "/%2e%2e/x", "/%2Fx", "/%252f", "/a\\b", "/a#x", "/a?x=%0a", "/a?x=%" }) await Throws<ArgumentException>(() => client.RequestAsync(path));
            foreach (var origin in new[] { "http://foreign.invalid", "https://user:secret@host.invalid", "https://host.invalid/x/../y", "https://host.invalid?x=1", "https://host.invalid/#fragment", "http://127.1", "https://host.invalid:99999" })
                await Throws<ArgumentException>(() => { using var bad = new ChertClient(origin, "x"); return Task.CompletedTask; });
            await Throws<ArgumentException>(() => { using var bad = new ChertClient(server.Origin, "x\r\nInjected: yes"); return Task.CompletedTask; });
            Check(server.Requests.Count == before);
        });
        await Run("redirect is refused without a second authenticated request", async () =>
        {
            await using var sink = new Loopback(); server.Handler = _ => Task.FromResult(new Reply(307, "{}", Headers: new() { ["Location"] = sink.Origin + "/sink" }));
            var before = server.Requests.Count; var error = await Throws<ChertApiException>(() => client.SendTextAsync("+15550000002", "x")); Check(error.Status == 307 && sink.Requests.Count == 0 && server.Requests.Count == before + 1);
        });
        await Run("API error data explicit while formatting hides server secrets and IDs", async () =>
        {
            server.Handler = _ => Task.FromResult(new Reply(502, "{\"message_id\":\"" + PublicId + "\",\"error\":{\"code\":4103,\"message\":\"PRIVATE-TOKEN\",\"retryable\":false}}", Headers: new() { ["x-request-id"] = "request-fixture" }));
            var error = await Throws<ChertApiException>(() => client.SendTextAsync("+15550000002", "x"));
            Check(error.Status == 502 && error.Code == "4103" && error.RequestId == "request-fixture" && error.ResponseData?.GetProperty("message_id").GetString() == PublicId);
            Check(!error.ToString().Contains("PRIVATE") && !error.Message.Contains(PublicId) && error.InnerException is null);
        });
        await Run("advertised and streamed body limits are enforced", async () =>
        {
            using var limited = new ChertClient(server.Origin, "key", maxResponseBytes: 64);
            foreach (var reply in new[] { new Reply(200, "{}", AdvertisedLength: 1000), new Reply(200, new string('x', 1000), NoLength: true) })
            { server.Handler = _ => Task.FromResult(reply); var e = await Throws<ChertApiException>(() => limited.RequestAsync("/large")); Check(e.Code == "response_too_large"); }
        });
        await Run("invalid success JSON and truncated transport remain sanitized", async () =>
        {
            server.Handler = _ => Task.FromResult(new Reply(200, "not JSON PRIVATE")); Check((await Throws<ChertApiException>(() => client.RequestAsync("/bad-json"))).Code == "invalid_json");
            server.Handler = _ => Task.FromResult(new Reply(200, "{}", AdvertisedLength: 100)); var error = await Throws<ChertApiException>(() => client.RequestAsync("/truncated")); Check(error.Code == "transport_error" && !error.ToString().Contains(server.Origin));
        });
        await Run("lost reply after accepted request is never retried", async () =>
        {
            server.Handler = _ => Task.FromResult(new Reply(0, "", Drop: true)); var before = server.Requests.Count;
            var error = await Throws<ChertApiException>(() => client.SendTextAsync("+15550000002", "x")); Check(error.Code == "transport_error" && server.Requests.Count == before + 1);
        });
        await Run("pre-cancelled request has zero network effects", async () =>
        {
            using var cancel = new CancellationTokenSource(); cancel.Cancel(); var before = server.Requests.Count;
            await Throws<OperationCanceledException>(() => client.SendTextAsync("+15550000002", "x", cancellationToken: cancel.Token)); Check(server.Requests.Count == before);
        });
        await Run("inflight cancellation and total stream deadline never retry", async () =>
        {
            server.Handler = _ => Task.FromResult(new Reply(200, "{}", DelayMs: 300)); using var cancel = new CancellationTokenSource(50); var before = server.Requests.Count;
            await Throws<OperationCanceledException>(() => client.RequestAsync("/wait", cancellationToken: cancel.Token)); Check(server.Requests.Count == before + 1);
            using var shortClient = new ChertClient(server.Origin, "key", timeout: TimeSpan.FromMilliseconds(100));
            var error = await Throws<ChertApiException>(() => shortClient.RequestAsync("/timeout")); Check(error.Code == "timeout");
            server.Handler = _ => Task.FromResult(new Reply(200, new string('x', 50), SlowBody: true));
            error = await Throws<ChertApiException>(() => shortClient.RequestAsync("/slow-body")); Check(error.Code == "timeout");
        });
        await FaceTimeTests();
        await MessagingEventTests();
        await UnifiedSessionTests();
        await MediaTests();
        Console.WriteLine(JsonSerializer.Serialize(new { passed = true, cases, transport = "actual-loopback-http", externalRequests = 0 }));
    }
}
sealed record Captured(string Method, string Target, Dictionary<string, string> Headers, string Body);
sealed record Reply(int Status, string Body, Dictionary<string, string>? Headers = null, int DelayMs = 0, int? AdvertisedLength = null, bool NoLength = false, bool Drop = false, bool SlowBody = false, int? SplitAt = null, int LingerMs = 0);
sealed class Loopback : IAsyncDisposable
{
    readonly TcpListener listener = new(IPAddress.Loopback, 0);
    readonly CancellationTokenSource stop = new();
    readonly ConcurrentBag<Task> connections = new();
    readonly Task loop;
    public ConcurrentQueue<Captured> Requests { get; } = new();
    public Func<Captured, Task<Reply>> Handler { get; set; } = _ => Task.FromResult(new Reply(200, "{}"));
    public string Origin { get; }
    public Loopback() { listener.Start(); Origin = "http://127.0.0.1:" + ((IPEndPoint)listener.LocalEndpoint).Port; loop = Accept(); }
    async Task Accept()
    {
        while (!stop.IsCancellationRequested)
        {
            try { var client = await listener.AcceptTcpClientAsync(stop.Token); connections.Add(Serve(client)); }
            catch (OperationCanceledException) { break; }
        }
    }
    async Task Serve(TcpClient client)
    {
        using (client)
        {
            try
            {
                var stream = client.GetStream(); using var headerBytes = new MemoryStream(); var one = new byte[1];
                while (headerBytes.Length < 65536)
                {
                    if (await stream.ReadAsync(one, stop.Token) == 0) return; headerBytes.WriteByte(one[0]);
                    if (headerBytes.Length >= 4 && Encoding.ASCII.GetString(headerBytes.GetBuffer(), (int)headerBytes.Length - 4, 4) == "\r\n\r\n") break;
                }
                var lines = Encoding.ASCII.GetString(headerBytes.ToArray()).Split("\r\n"); var first = lines[0].Split(' ');
                var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (var line in lines.Skip(1)) { var colon = line.IndexOf(':'); if (colon > 0) headers[line[..colon].ToLowerInvariant()] = line[(colon + 1)..].Trim(); }
                var count = headers.TryGetValue("content-length", out var length) ? int.Parse(length) : 0; if (count > 100000) throw new Exception("Bounded synthetic request exceeded");
                var raw = new byte[count]; var written = 0; while (written < count) { var n = await stream.ReadAsync(raw.AsMemory(written), stop.Token); if (n == 0) return; written += n; }
                var request = new Captured(first[0], first[1], headers, Encoding.UTF8.GetString(raw)); Requests.Enqueue(request);
                var reply = await Handler(request); if (reply.Drop) return; if (reply.DelayMs > 0) await Task.Delay(reply.DelayMs, stop.Token);
                var body = Encoding.UTF8.GetBytes(reply.Body); var text = $"HTTP/1.1 {reply.Status} fixture\r\nConnection: close\r\n";
                if (reply.Headers?.ContainsKey("Content-Type") != true) text += "Content-Type: application/json\r\n";
                if (!reply.NoLength) text += "Content-Length: " + (reply.AdvertisedLength ?? body.Length) + "\r\n";
                if (reply.Headers is not null) foreach (var pair in reply.Headers) text += pair.Key + ": " + pair.Value + "\r\n";
                await stream.WriteAsync(Encoding.ASCII.GetBytes(text + "\r\n"), stop.Token);
                if (reply.SlowBody) foreach (var value in body) { await stream.WriteAsync(new[] { value }, stop.Token); await Task.Delay(25, stop.Token); }
                else if (reply.SplitAt is int split)
                {
                    await stream.WriteAsync(body.AsMemory(0, split), stop.Token);
                    await Task.Delay(50, stop.Token);
                    await stream.WriteAsync(body.AsMemory(split), stop.Token);
                }
                else await stream.WriteAsync(body, stop.Token);
                if (reply.LingerMs > 0) await Task.Delay(reply.LingerMs, stop.Token);
            }
            catch (Exception error) when (error is IOException or OperationCanceledException or SocketException) { }
        }
    }
    public async ValueTask DisposeAsync() { stop.Cancel(); listener.Stop(); await loop; await Task.WhenAll(connections); stop.Dispose(); }
}
