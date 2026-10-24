using System.Globalization;
using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace TryChert;

public sealed class EventListOptions
{
    public string? Type { get; init; }
    public string? Status { get; init; }
    public string? LeadId { get; init; }
    public string? Since { get; init; }
    public string? Cursor { get; init; }
    public int? Limit { get; init; }
    public override string ToString() => "EventListOptions { redacted }";
}
public sealed class CreateWebhookSubscription
{
    public required string Url { get; init; }
    public string[]? Events { get; init; }
    public string? Version { get; init; }
    public override string ToString() => "CreateWebhookSubscription { redacted }";
}
public sealed class UpdateWebhookSubscription
{
    public string? Url { get; init; }
    public string[]? Events { get; init; }
    public string? Version { get; init; }
    public bool? IsActive { get; init; }
    public override string ToString() => "UpdateWebhookSubscription { redacted }";
}
public sealed record MessagingStreamFrame(string Event, JsonElement Data)
{
    public override string ToString() => "MessagingStreamFrame { redacted }";
}

public sealed partial class IMessageClient
{
    private static readonly JsonSerializerOptions EventJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };
    /// <summary>Returns the event page JSON, including opaque next_cursor. Status filters webhook delivery, not recipient status.</summary>
    public Task<JsonElement?> ListEventsAsync(EventListOptions? options = null, CancellationToken cancellationToken = default)
    {
        options ??= new();
        if (options.Limit is < 1 or > 200) throw new ArgumentException("Event limit must be 1–200");
        var pairs = new Dictionary<string, string?> { ["type"] = options.Type, ["status"] = options.Status,
            ["lead_id"] = options.LeadId, ["since"] = options.Since, ["cursor"] = options.Cursor,
            ["limit"] = options.Limit?.ToString(CultureInfo.InvariantCulture) };
        return RequestAsync("/events?" + string.Join('&', pairs.Where(p => p.Value is not null)
            .Select(p => p.Key + "=" + Uri.EscapeDataString(p.Value!))), cancellationToken: cancellationToken);
    }
    public Task<JsonElement?> GetEventAsync(string rowId, CancellationToken cancellationToken = default)
        => RequestAsync("/events/" + EventResourceId(rowId), cancellationToken: cancellationToken);
    public Task<JsonElement?> ListWebhookSubscriptionsAsync(CancellationToken cancellationToken = default)
        => RequestAsync("/webhook-subscriptions", cancellationToken: cancellationToken);
    public Task<JsonElement?> GetWebhookSubscriptionAsync(string id, CancellationToken cancellationToken = default)
        => RequestAsync("/webhook-subscriptions/" + EventResourceId(id), cancellationToken: cancellationToken);
    public Task<JsonElement?> CreateWebhookSubscriptionAsync(CreateWebhookSubscription body, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(body);
        return RequestAsync("/webhook-subscriptions", JsonSerializer.SerializeToElement(body, EventJson), HttpMethod.Post, cancellationToken);
    }
    public Task<JsonElement?> UpdateWebhookSubscriptionAsync(string id, UpdateWebhookSubscription body, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(body);
        return RequestAsync("/webhook-subscriptions/" + EventResourceId(id), JsonSerializer.SerializeToElement(body, EventJson), HttpMethod.Patch, cancellationToken);
    }
    public Task<JsonElement?> DeleteWebhookSubscriptionAsync(string id, CancellationToken cancellationToken = default)
        => RequestAsync("/webhook-subscriptions/" + EventResourceId(id), method: HttpMethod.Delete, cancellationToken: cancellationToken);
    /// <summary>One connection only. Cancellation or disposing the enumerator closes it. No replay or reconnect.</summary>
    public IAsyncEnumerable<MessagingStreamFrame> StreamEventsAsync(string? since = null, CancellationToken cancellationToken = default)
        => transport.StreamEventsAsync(since, cancellationToken);
    private static string EventResourceId(string id)
    {
        if (id is null || !Regex.IsMatch(id, @"\A[A-Za-z0-9_-]+\z") || id.Length > 160)
            throw new ArgumentException("Invalid resource ID");
        return id;
    }
}

/// <summary>Verify exact raw bytes before parsing JSON. This does not prevent replay within the timestamp window.</summary>
public static class ChertWebhook
{
    public static bool Verify(ReadOnlySpan<byte> rawBody, string signature, string secret)
    {
        if (signature is null || string.IsNullOrEmpty(secret)) return false;
        var match = Regex.Match(signature, @"\Av1,([0-9]+),([a-fA-F0-9]{64})\z");
        if (!match.Success || !long.TryParse(match.Groups[1].Value, out var timestamp)
            || Math.Abs((decimal)DateTimeOffset.UtcNow.ToUnixTimeSeconds() - timestamp) > 300) return false;
        using var hmac = IncrementalHash.CreateHMAC(HashAlgorithmName.SHA256, Encoding.UTF8.GetBytes(secret));
        hmac.AppendData(Encoding.UTF8.GetBytes(match.Groups[1].Value + "."));
        hmac.AppendData(rawBody);
        return CryptographicOperations.FixedTimeEquals(hmac.GetHashAndReset(), Convert.FromHexString(match.Groups[2].Value));
    }
}

internal sealed partial class ChannelTransport
{
    internal async IAsyncEnumerable<MessagingStreamFrame> StreamEventsAsync(string? since,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var path = "/events/stream" + (since is null ? "" : "?since=" + Uri.EscapeDataString(since));
        ValidateRequestPath(path, true);
        cancellationToken.ThrowIfCancellationRequested();
        using var request = new HttpRequestMessage(HttpMethod.Get, baseUrl + path);
        if (singleAttemptReads) request.Content = new ByteArrayContent([]);
        if (unifiedContract) request.Headers.Add("X-Chert-Contract", "chert-unified-v1");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
        if (tenant is not null) request.Headers.Add("x-chert-tenant", tenant);
        using var headersTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        headersTimeout.CancelAfter(deadline);
        using var response = await OpenEventStream(request, headersTimeout.Token, cancellationToken).ConfigureAwait(false);
        RequireContractEcho(response);
        if (!response.IsSuccessStatusCode || !string.Equals(response.Content.Headers.ContentType?.MediaType, "text/event-stream", StringComparison.OrdinalIgnoreCase))
            throw new ChertApiException(response.IsSuccessStatusCode ? 502 : (int)response.StatusCode, "stream_unavailable");
        using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        using var line = new MemoryStream();
        var buffer = new byte[4096];
        var data = new List<string>();
        var eventName = "message";
        var size = 0;
        var afterCr = false;
        while (true)
        {
            int count;
            try { count = await stream.ReadAsync(buffer, cancellationToken).ConfigureAwait(false); }
            catch (IOException) { throw new ChertApiException(0, "transport_error"); }
            if (count == 0 && !afterCr) yield break; // Incomplete frames are never dispatched.
            // At EOF, process a pending bare CR once without inventing another byte.
            for (var i = 0; i < count || (count == 0 && afterCr); i++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var b = count == 0 ? -1 : buffer[i];
                if (afterCr)
                {
                    afterCr = false;
                    if (b == 10)
                    {
                        if (++size > 1024 * 1024) throw new ChertApiException(502, "event_frame_too_large");
                    }
                    else if (count != 0) i--; // Process this byte only after the pending line.
                }
                else
                {
                    if (++size > 1024 * 1024) throw new ChertApiException(502, "event_frame_too_large");
                    // Defer the line until its optional LF is counted, before any frame yield.
                    if (b == 13) { afterCr = true; continue; }
                    if (b != 10) { line.WriteByte((byte)b); continue; }
                }
                string current;
                try { current = StrictUtf8.GetString(line.GetBuffer(), 0, (int)line.Length); }
                catch (DecoderFallbackException) { throw new ChertApiException(502, "invalid_event_stream"); }
                line.SetLength(0);
                if (current.Length == 0)
                {
                    if (data.Count > 0)
                    {
                        JsonElement value;
                        try { using var json = JsonDocument.Parse(string.Join('\n', data)); value = json.RootElement.Clone(); }
                        catch (JsonException) { throw new ChertApiException(502, "invalid_event_stream"); }
                        yield return new(eventName, value);
                        if (eventName == "close") yield break;
                    }
                    data.Clear(); eventName = "message"; size = 0;
                    continue;
                }
                if (current.StartsWith(':')) continue;
                var colon = current.IndexOf(':');
                var field = colon < 0 ? current : current[..colon];
                var text = colon < 0 ? "" : current[(colon + 1)..];
                if (text.StartsWith(' ')) text = text[1..];
                if (field == "data") data.Add(text);
                else if (field == "event") eventName = text.Length == 0 ? "message" : text;
            }
        }
    }
    private async Task<HttpResponseMessage> OpenEventStream(HttpRequestMessage request, CancellationToken timeout, CancellationToken caller)
    {
        try { return await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout).ConfigureAwait(false); }
        catch (OperationCanceledException) when (!caller.IsCancellationRequested) { throw new ChertApiException(0, "timeout"); }
        catch (HttpRequestException) { throw new ChertApiException(0, "transport_error"); }
    }
}
