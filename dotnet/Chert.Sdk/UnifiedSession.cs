using System.Text.Json;
using System.Text.RegularExpressions;

namespace TryChert;

/// <summary>Explicit opt-in to the proposed unified contract. The caller obtains the session through the CLI.</summary>
public sealed class UnifiedSessionOptions
{
    public required string AccessToken { get; init; }
    public required string ProjectId { get; init; }
    public string IMessageBaseUrl { get; init; } = "https://console.trychert.com";
    public string FaceTimeBaseUrl { get; init; } = "https://facetime.trychert.com";
    public TimeSpan Timeout { get; init; } = TimeSpan.FromSeconds(15);
    public override string ToString() => "UnifiedSessionOptions { redacted }";
}

public sealed class UnsupportedUnifiedBackendException : Exception
{
    public string Code => "unsupported_unified_backend";
    public UnsupportedUnifiedBackendException() : base("The configured services do not support the required unified contract.") { }
}

public sealed partial class ChertClient
{
    private ChertClient(IMessageClient messaging, FaceTimeClient faceTime)
        => (IMessage, FaceTime) = (messaging, faceTime);

    /// <summary>Discovers capabilities without credentials, then binds both channels to one caller-supplied session.</summary>
    public static async Task<ChertClient> ConnectAsync(UnifiedSessionOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        if (options.AccessToken is null || !Regex.IsMatch(options.AccessToken, @"\Achu_[A-Za-z0-9_-]{43}\z")
            || options.ProjectId is null || options.ProjectId.Length != 36 || !Guid.TryParseExact(options.ProjectId, "D", out _))
            throw new ArgumentException("A unified session token and project UUID are required");
        // Validate both caller-approved URLs before any network effects; descriptor URLs never select a destination.
        var messaging = ApprovedOrigin(options.IMessageBaseUrl, options.Timeout);
        var faceTime = ApprovedOrigin(options.FaceTimeBaseUrl, options.Timeout);
        var discoveryTimeout = options.Timeout < TimeSpan.FromSeconds(15) ? options.Timeout : TimeSpan.FromSeconds(15);
        using var discovery = new ChannelTransport(messaging, null, timeout: discoveryTimeout, maxResponseBytes: 65536, singleAttemptReads: true);
        try
        {
            var result = await discovery.RequestWithResponseAsync("/sdk/capabilities", null, HttpMethod.Get, null,
                cancellationToken, publicRequest: true).ConfigureAwait(false);
            if (result.Value is not { ValueKind: JsonValueKind.Object } envelope) throw new UnsupportedUnifiedBackendException();
            RequireUniqueFields(envelope);
            var data = envelope.GetProperty("data");
            var auth = data.GetProperty("auth");
            var services = data.GetProperty("services");
            if (data.GetProperty("contract").GetString() != "chert-unified"
                || data.GetProperty("contract_version").GetInt32() != 1
                || auth.GetProperty("scheme").GetString() != "Bearer"
                || auth.GetProperty("token_prefix").GetString() != "chu_"
                || auth.GetProperty("audience").GetString() != "chert.unified-api:v1"
                || auth.GetProperty("login_url").GetString() != faceTime + "/api/v1/cli/logins"
                || services.GetProperty("imessage").GetProperty("base_url").GetString() != messaging + "/api/v1"
                || services.GetProperty("facetime").GetProperty("base_url").GetString() != faceTime + "/api/v1")
                throw new UnsupportedUnifiedBackendException();
            var scopes = new HashSet<string>(StringComparer.Ordinal);
            foreach (var scope in data.GetProperty("scopes").EnumerateArray())
            {
                if (scope.ValueKind != JsonValueKind.String || !scopes.Add(scope.GetString()!))
                    throw new UnsupportedUnifiedBackendException();
            }
            string[] required = ["imessage:events:read", "imessage:webhooks:manage", "imessage:messages:send",
                "facetime:calls:read", "facetime:calls:create", "facetime:calls:control"];
            if (!required.All(scopes.Contains)) throw new UnsupportedUnifiedBackendException();
        }
        catch (Exception error) when (error is ChertApiException or JsonException or KeyNotFoundException or InvalidOperationException or FormatException)
        {
            throw new UnsupportedUnifiedBackendException();
        }
        cancellationToken.ThrowIfCancellationRequested();
        var messagingClient = new IMessageClient(new ChannelTransport(messaging, options.AccessToken,
            timeout: options.Timeout, unifiedContract: true));
        try
        {
            var faceTimeClient = new FaceTimeClient(new ChannelTransport(faceTime, options.AccessToken,
                timeout: options.Timeout, maxResponseBytes: 1024 * 1024, project: options.ProjectId, unifiedContract: true));
            return new ChertClient(messagingClient, faceTimeClient);
        }
        catch { messagingClient.Dispose(); throw; }
    }

    private static string ApprovedOrigin(string url, TimeSpan timeout)
    {
        using var validation = new ChannelTransport(url, null, timeout: timeout);
        var parsed = new Uri(url);
        if (parsed.AbsolutePath != "/") throw new ArgumentException("Unified service URLs must be origins without a path");
        return parsed.GetLeftPart(UriPartial.Authority);
    }
    private static void RequireUniqueFields(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in value.EnumerateObject())
            {
                if (!names.Add(property.Name)) throw new UnsupportedUnifiedBackendException();
                RequireUniqueFields(property.Value);
            }
        }
        else if (value.ValueKind == JsonValueKind.Array)
            foreach (var item in value.EnumerateArray()) RequireUniqueFields(item);
    }
}

internal sealed partial class ChannelTransport
{
    private void RequireContractEcho(HttpResponseMessage response)
    {
        if (unifiedContract && (!response.Headers.TryGetValues("X-Chert-Contract", out var values)
            || !values.SequenceEqual(new[] { "chert-unified-v1" }, StringComparer.Ordinal)))
            throw new UnsupportedUnifiedBackendException();
    }
}
