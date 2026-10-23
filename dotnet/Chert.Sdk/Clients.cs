using System.Text.Json;

namespace TryChert;

/// <summary>Explicit messaging-service credentials; never reused for FaceTime.</summary>
public sealed class IMessageOptions
{
    public string BaseUrl { get; init; } = "https://console.trychert.com/api/v1";
    public required string ApiKey { get; init; }
    public string? Tenant { get; init; }
    public TimeSpan Timeout { get; init; } = TimeSpan.FromSeconds(15);
    public int MaxResponseBytes { get; init; } = 8 * 1024 * 1024;
    public override string ToString() => "IMessageOptions { redacted }";
}

/// <summary>Explicit FaceTime credentials and project; not an iMessage tenant or key.</summary>
public sealed class FaceTimeOptions
{
    public string BaseUrl { get; init; } = "https://facetime.trychert.com/api/v1";
    public string? Token { get; init; }
    public string? ProjectId { get; init; }
    public TimeSpan Timeout { get; init; } = TimeSpan.FromSeconds(15);
    public int MaxResponseBytes { get; init; } = 1024 * 1024;
    public override string ToString() => "FaceTimeOptions { redacted }";
}

/// <summary>Owns independently configured channels. Construction performs no network requests.</summary>
public sealed class ChertClient : IDisposable
{
    public IMessageClient? IMessage { get; }
    public FaceTimeClient? FaceTime { get; }
    public ChertClient(IMessageOptions? iMessage = null, FaceTimeOptions? faceTime = null)
    {
        if (iMessage is null && faceTime is null) throw new ArgumentException("Configure at least one channel");
        IMessage = iMessage is null ? null : new IMessageClient(iMessage);
        try { FaceTime = faceTime is null ? null : new FaceTimeClient(faceTime); }
        catch { IMessage?.Dispose(); throw; }
    }
    public void Dispose() { IMessage?.Dispose(); FaceTime?.Dispose(); }
    public override string ToString() => "ChertClient { configured }";
}

/// <summary>Single-attempt iMessage requests and strict cloud acceptance receipts.</summary>
public sealed class IMessageClient : IDisposable
{
    private readonly ChannelTransport transport;
    public IMessageClient(IMessageOptions options) : this(options.BaseUrl, options.ApiKey, options.Tenant, options.Timeout, options.MaxResponseBytes) { }
    public IMessageClient(string baseUrl, string apiKey, string? tenant = null,
        TimeSpan? timeout = null, int maxResponseBytes = 8 * 1024 * 1024)
    {
        ArgumentNullException.ThrowIfNull(apiKey);
        transport = new(baseUrl, apiKey, tenant, timeout, maxResponseBytes);
    }
    public Task<JsonElement?> RequestAsync(string path, JsonElement? body = null, HttpMethod? method = null,
        CancellationToken cancellationToken = default) => transport.RequestAsync(path, body, method, cancellationToken);
    public Task<QueuedTextReceipt> SendTextAsync(string phone, string text, string? idempotencyKey = null,
        CancellationToken cancellationToken = default) => transport.SendTextAsync(phone, text, idempotencyKey, cancellationToken);
    public Task<ReactionReceipt> SendReactionAsync(string chatId, string messageId, string reaction, bool remove = false,
        string? idempotencyKey = null, CancellationToken cancellationToken = default)
        => transport.SendReactionAsync(chatId, messageId, reaction, remove, idempotencyKey, cancellationToken);
    public void Dispose() => transport.Dispose();
    public override string ToString() => "IMessageClient { configured }";
}
