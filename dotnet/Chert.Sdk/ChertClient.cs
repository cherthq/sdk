using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace TryChert;

/// <summary>Explicit response data is available only through properties, never error formatting.</summary>
public sealed class ChertApiException : Exception
{
    public int Status { get; }
    public string Code { get; }
    public string? RequestId { get; }
    public JsonElement? ResponseData { get; }
    internal ChertApiException(int status, string code, string? requestId = null, JsonElement? data = null)
        : base("Chert request failed; reconcile uncertain operations before retrying")
        => (Status, Code, RequestId, ResponseData) = (status, code, requestId, data);
    public override string ToString() => $"Chert request failed ({Status}); reconcile uncertain operations before retrying";
}

/// <summary>Cloud reservation only; never physical sent/delivered/read proof.</summary>
public sealed record QueuedTextReceipt(bool Success, string MessageId, string ChatId, string Status)
{
    public override string ToString() => "QueuedTextReceipt { queued }";
}
/// <summary>Dispatch acknowledgement, not applied or current reaction state.</summary>
public sealed record ReactionReceipt(string OperationId, string ChatId, string MessageId, string Status)
{
    public override string ToString() => "ReactionReceipt { acknowledged }";
}

/// <summary>One-attempt transport. No redirects, ambient proxy, cookies, retries or provider fallback.</summary>
internal sealed partial class ChannelTransport : IDisposable
{
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);
    private readonly HttpClient http;
    private readonly string baseUrl;
    private readonly string basePath;
    private readonly string? key;
    private readonly string? tenant;
    private readonly string? project;
    private readonly bool unifiedContract;
    private readonly bool singleAttemptReads;
    private readonly TimeSpan deadline;
    private readonly int responseLimit;
    internal sealed record JsonResponse(int Status, string? RequestId, JsonElement? Value);

    internal ChannelTransport(string baseUrl, string? apiKey, string? tenant = null,
        TimeSpan? timeout = null, int maxResponseBytes = 8 * 1024 * 1024, string? project = null, bool unifiedContract = false, bool singleAttemptReads = false)
    {
        if (baseUrl is null || baseUrl.Length > 16384 || !ValidUnicode(baseUrl) || HasUnsafeUrlChars(baseUrl)
            || baseUrl.Contains('?') || baseUrl.Contains('#')) throw new ArgumentException("Invalid Chert base URL");
        var match = Regex.Match(baseUrl, @"\A(https?)://(\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+)(?::[0-9]+)?(/.*)?\z", RegexOptions.CultureInvariant);
        if (!match.Success || !Uri.TryCreate(baseUrl, UriKind.Absolute, out var parsed)
            || !string.IsNullOrEmpty(parsed.UserInfo) || (parsed.Scheme != "https" && !new[] { "localhost", "127.0.0.1", "[::1]" }.Contains(match.Groups[2].Value)))
            throw new ArgumentException("Use HTTPS or loopback HTTP without user information");
        var path = match.Groups[3].Success ? match.Groups[3].Value : "/";
        ValidateRequestPath(path, false);
        basePath = path.TrimEnd('/');
        if (basePath.Length == 0) basePath = "/api/v1";
        this.baseUrl = parsed.GetLeftPart(UriPartial.Authority) + basePath;
        key = apiKey is null ? null : Header(apiKey);
        this.tenant = tenant is null ? null : Header(tenant);
        this.project = project is null ? null : Header(project);
        this.unifiedContract = unifiedContract;
        this.singleAttemptReads = singleAttemptReads || unifiedContract;
        deadline = timeout ?? TimeSpan.FromSeconds(15);
        if (deadline <= TimeSpan.Zero || deadline.TotalMilliseconds > int.MaxValue || maxResponseBytes <= 0)
            throw new ArgumentException("Invalid timeout or response bound");
        responseLimit = maxResponseBytes;
        var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = false, UseProxy = false, UseCookies = false,
            AutomaticDecompression = DecompressionMethods.None, ConnectTimeout = deadline
        };
        http = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
    }
    public override string ToString() => "ChertClient { configured }";
    public void Dispose() => http.Dispose();

    /// <summary>Null body means omitted bytes; a JsonElement whose kind is Null sends JSON null.</summary>
    public async Task<JsonElement?> RequestAsync(string path, JsonElement? body = null, HttpMethod? method = null,
        CancellationToken cancellationToken = default)
        => (await RequestWithResponseAsync(path, body, method, null, cancellationToken).ConfigureAwait(false)).Value;

    public async Task<QueuedTextReceipt> SendTextAsync(string phone, string text, string? idempotencyKey = null,
        CancellationToken cancellationToken = default)
    {
        if (!Exact(phone, @"\+[1-9][0-9]{1,14}") || !ValidUnicode(text) || text.Contains('\0')
            || StrictUtf8.GetByteCount(text) > 16384 || text.All(EcmaWhitespace)) throw new ArgumentException("Invalid strict plaintext");
        if (idempotencyKey is not null && (!ValidUnicode(idempotencyKey) || idempotencyKey.Length == 0
            || idempotencyKey.Contains('\0') || StrictUtf8.GetByteCount(idempotencyKey) > 200)) throw new ArgumentException("Invalid idempotency key");
        var payload = new Dictionary<string, object?> { ["phone"] = phone, ["body"] = text };
        if (idempotencyKey is not null) payload["idempotency_key"] = idempotencyKey;
        var response = await RequestWithResponseAsync("/text-operations/v1", JsonSerializer.SerializeToElement(payload), HttpMethod.Post, null, cancellationToken).ConfigureAwait(false);
        var value = response.Value;
        if (response.Status != 202 || !Fields(value, "success", "message_id", "chat_id", "status")
            || value!.Value.GetProperty("success").ValueKind != JsonValueKind.True
            || String(value, "status") != "queued" || !Exact(String(value, "message_id"), "[a-f0-9]{32}")
            || !Exact(String(value, "chat_id"), "[A-Za-z0-9:_-]{1,160}"))
            throw new ChertApiException(502, "unconfirmed_text_outcome", response.RequestId, value);
        return new(true, String(value, "message_id")!, String(value, "chat_id")!, "queued");
    }

    public async Task<ReactionReceipt> SendReactionAsync(string chatId, string messageId, string reaction, bool remove = false,
        string? idempotencyKey = null, CancellationToken cancellationToken = default)
    {
        if (!Exact(chatId, "[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}")
            || !Exact(messageId, "[A-Za-z0-9:_.-]{1,160}") || messageId is "." or ".."
            || !new[] { "love", "like", "dislike", "laugh", "emphasize", "question" }.Contains(reaction)) throw new ArgumentException("Invalid reaction target or kind");
        if (idempotencyKey is not null && (idempotencyKey.Length is < 1 or > 200 || idempotencyKey[0] == ' '
            || idempotencyKey[^1] == ' ' || idempotencyKey.Any(c => c < 0x20 || c > 0x7e))) throw new ArgumentException("Invalid reaction key");
        var canonicalChat = chatId.ToLowerInvariant();
        var path = $"/chats/{canonicalChat}/messages/{Uri.EscapeDataString(messageId)}/reactions";
        var payload = JsonSerializer.SerializeToElement(new { reaction, remove, part_index = 0 });
        var response = await RequestWithResponseAsync(path, payload, HttpMethod.Post, idempotencyKey, cancellationToken).ConfigureAwait(false);
        var value = response.Value;
        if (response.Status != 202 || !Fields(value, "operation_id", "chat_id", "message_id", "status")
            || !Exact(String(value, "operation_id"), "[a-f0-9]{32}") || String(value, "chat_id") != canonicalChat
            || String(value, "message_id") != messageId || String(value, "status") != "acknowledged")
            throw new ChertApiException(502, "unconfirmed_reaction_outcome", response.RequestId, value);
        return new(String(value, "operation_id")!, canonicalChat, messageId, "acknowledged");
    }

    internal async Task<JsonResponse> RequestWithResponseAsync(string path, JsonElement? body, HttpMethod? method,
        string? idempotencyKey, CancellationToken cancellationToken, bool publicRequest = false, bool projectRequest = false)
    {
        ValidateRequestPath(path, true);
        if (!publicRequest && key is null) throw new ChertApiException(401, "unauthorized");
        if (projectRequest && project is null) throw new ChertApiException(400, "project_required");
        method ??= body.HasValue ? HttpMethod.Post : HttpMethod.Get;
        if (!new[] { "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS" }.Contains(method.Method)
            || (body.HasValue && (method == HttpMethod.Get || method == HttpMethod.Head))) throw new ArgumentException("Invalid request method/body");
        var url = new Uri(baseUrl + path);
        if (url.GetLeftPart(UriPartial.Authority) != new Uri(baseUrl).GetLeftPart(UriPartial.Authority)
            || !url.AbsolutePath.StartsWith(basePath + "/", StringComparison.Ordinal)) throw new ArgumentException("Escaping request path");
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        linked.CancelAfter(deadline);
        using var request = new HttpRequestMessage(method, url);
        if (unifiedContract) request.Headers.Add("X-Chert-Contract", "chert-unified-v1");
        if (!publicRequest) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (tenant is not null) request.Headers.Add("x-chert-tenant", tenant);
        if (projectRequest) request.Headers.Add("x-chert-project-id", project);
        if (idempotencyKey is not null) request.Headers.Add("Idempotency-Key", idempotencyKey);
        if (body.HasValue) request.Content = new StringContent(body.Value.GetRawText(), StrictUtf8, "application/json");
        // A zero-byte content object prevents SocketsHttpHandler replaying a bodyless request after a dropped reply.
        if (singleAttemptReads && request.Content is null) request.Content = new ByteArrayContent([]);
        try
        {
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, linked.Token).ConfigureAwait(false);
            RequireContractEcho(response);
            var status = (int)response.StatusCode;
            string? requestId = response.Headers.TryGetValues("x-request-id", out var ids) ? ids.FirstOrDefault() : null;
            if (requestId is not null && (requestId.Length > 1024 || requestId.Any(char.IsControl))) requestId = null;
            if (response.Content.Headers.ContentLength > responseLimit) throw new ChertApiException(status is >= 200 and < 300 ? 502 : status, "response_too_large", requestId);
            if (status == 204 || (response.IsSuccessStatusCode && method == HttpMethod.Head)) return new(status, requestId, null);
            using var stream = await response.Content.ReadAsStreamAsync(linked.Token).ConfigureAwait(false);
            using var bytes = new MemoryStream();
            var chunk = new byte[Math.Min(responseLimit, 16384)];
            while (true)
            {
                var count = await stream.ReadAsync(chunk, linked.Token).ConfigureAwait(false);
                if (count == 0) break;
                if (bytes.Length + count > responseLimit) throw new ChertApiException(status is >= 200 and < 300 ? 502 : status, "response_too_large", requestId);
                bytes.Write(chunk, 0, count);
            }
            JsonElement? value = null;
            try { using var document = JsonDocument.Parse(bytes.ToArray()); value = document.RootElement.Clone(); }
            catch (JsonException) { if (response.IsSuccessStatusCode) throw new ChertApiException(502, "invalid_json", requestId); }
            if (requestId is null && value is { ValueKind: JsonValueKind.Object } envelope
                && envelope.TryGetProperty("request_id", out var rid) && rid.ValueKind == JsonValueKind.String)
            {
                var candidate = rid.GetString();
                if (candidate is { Length: <= 1024 } && !candidate.Any(char.IsControl)) requestId = candidate;
            }
            if (!response.IsSuccessStatusCode)
            {
                var code = "http_error";
                if (value is { ValueKind: JsonValueKind.Object } root && root.TryGetProperty("error", out var error) && error.ValueKind == JsonValueKind.Object
                    && error.TryGetProperty("code", out var field))
                { if (field.ValueKind == JsonValueKind.String) code = field.GetString()!; else if (field.ValueKind == JsonValueKind.Number) code = field.GetRawText(); }
                throw new ChertApiException(status, code, requestId, value);
            }
            return new(status, requestId, value);
        }
        catch (OperationCanceledException)
        {
            if (cancellationToken.IsCancellationRequested) throw new OperationCanceledException("Chert request cancelled; reconcile uncertain operations", cancellationToken);
            throw new ChertApiException(0, "timeout");
        }
        catch (HttpRequestException) { throw new ChertApiException(0, "transport_error"); }
        catch (IOException) { throw new ChertApiException(0, "transport_error"); }
    }

    private static bool ValidUnicode(string? value)
    { if (value is null) return false; try { StrictUtf8.GetByteCount(value); return true; } catch (EncoderFallbackException) { return false; } }
    private static bool Exact(string? value, string pattern) => value is not null && Regex.IsMatch(value, @"\A(?:" + pattern + @")\z", RegexOptions.CultureInvariant);
    private static bool HasUnsafeUrlChars(string value) => value.Any(c => c <= 32 || c is >= (char)127 and <= (char)159 || c == '\\');
    private static string Header(string? value)
    { if (string.IsNullOrWhiteSpace(value) || value.Any(c => c < 32 || c > 126)) throw new ArgumentException("Invalid authentication header"); return value; }
    private static void ValidateRequestPath(string path, bool allowQuery)
    {
        if (path is null || path.Length > 8192 || !ValidUnicode(path) || !path.StartsWith('/') || path.StartsWith("//") || HasUnsafeUrlChars(path) || path.Contains('#') || (!allowQuery && path.Contains('?')))
            throw new ArgumentException("Invalid Chert-relative path");
        var split = path.Split('?', 2);
        foreach (var segment in split[0].Split('/'))
        {
            var decoded = Decode(segment, false);
            if (decoded is "." or ".." || decoded.IndexOfAny(new[] { '/', '\\', '%', '?', '#' }) >= 0 || HasUnsafeUrlChars(decoded)) throw new ArgumentException("Escaping path segment");
        }
        if (split.Length == 2) Decode(split[1], true);
    }
    private static string Decode(string value, bool query)
    {
        for (var i = 0; i < value.Length; i++) if (value[i] == '%')
        {
            if (i + 2 >= value.Length || !byte.TryParse(value.AsSpan(i + 1, 2), System.Globalization.NumberStyles.HexNumber, null, out var b)
                || b < (query ? 32 : 33) || b == 127 || (!query && b is (byte)'%' or (byte)'/' or (byte)'\\' or (byte)'?' or (byte)'#')) throw new ArgumentException("Invalid URL escape");
            i += 2;
        }
        return Uri.UnescapeDataString(value);
    }
    private static bool Fields(JsonElement? value, params string[] fields)
    {
        if (value is not { ValueKind: JsonValueKind.Object } objectValue) return false;
        var names = objectValue.EnumerateObject().Select(p => p.Name).ToArray();
        return names.Length == fields.Length && names.Distinct(StringComparer.Ordinal).Count() == fields.Length
            && fields.All(name => names.Contains(name, StringComparer.Ordinal));
    }
    private static string? String(JsonElement? value, string field)
        => value is { ValueKind: JsonValueKind.Object } objectValue && objectValue.TryGetProperty(field, out var property) && property.ValueKind == JsonValueKind.String ? property.GetString() : null;
    private static bool EcmaWhitespace(char c) => c is >= '\u0009' and <= '\u000d' or '\u0020' or '\u00a0' or '\u1680'
        or >= '\u2000' and <= '\u200a' or '\u2028' or '\u2029' or '\u202f' or '\u205f' or '\u3000' or '\ufeff';
}
