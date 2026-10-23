using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace TryChert;

/// <summary>FaceTime control plane, not a media relay. All operations are single-attempt.</summary>
public sealed class FaceTimeClient : IDisposable
{
    private readonly ChannelTransport transport;
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };
    public FaceTimeClient(FaceTimeOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        if (options.ProjectId is not null) Id(options.ProjectId);
        transport = new(options.BaseUrl, options.Token, timeout: options.Timeout,
            maxResponseBytes: options.MaxResponseBytes, project: options.ProjectId);
    }
    public void Dispose() => transport.Dispose();
    public override string ToString() => "FaceTimeClient { configured }";

    /// <summary>Project-authenticated escape hatch for version-specific routes; returns unwrapped data.</summary>
    public Task<JsonElement> RequestAsync(string path, JsonElement? body = null, HttpMethod? method = null,
        string? idempotencyKey = null, CancellationToken cancellationToken = default)
        => Send<JsonElement>(path, body, method, idempotencyKey, cancellationToken, expectedStatus: null, allowNull: true);

    public Task<Page<FaceTimeCall>> ListCallsAsync(int? limit = null, int? offset = null, CancellationToken cancellationToken = default)
        => Send<Page<FaceTimeCall>>(PagePath("/calls", limit, offset), cancellationToken: cancellationToken);
    public Task<FaceTimeCall> GetCallAsync(string callId, CancellationToken cancellationToken = default)
        => Send<FaceTimeCall>("/calls/" + Id(callId), cancellationToken: cancellationToken);
    public Task<CallEvents> GetCallEventsAsync(string callId, CancellationToken cancellationToken = default)
        => Send<CallEvents>("/calls/" + Id(callId) + "/events", cancellationToken: cancellationToken);
    public Task<CallTranscript> GetTranscriptAsync(string callId, CancellationToken cancellationToken = default)
        => Send<CallTranscript>("/calls/" + Id(callId) + "/transcript", cancellationToken: cancellationToken);
    public Task<Page<FaceTimeLine>> ListLinesAsync(int? limit = null, int? offset = null, CancellationToken cancellationToken = default)
        => Send<Page<FaceTimeLine>>(PagePath("/lines", limit, offset), cancellationToken: cancellationToken);
    public Task<Page<FaceTimeWorker>> ListWorkersAsync(int? limit = null, int? offset = null, CancellationToken cancellationToken = default)
        => Send<Page<FaceTimeWorker>>(PagePath("/workers", limit, offset), cancellationToken: cancellationToken);

    public Task<FaceTimeCall> CreateCallAsync(CreateCallRequest input, string idempotencyKey, CancellationToken cancellationToken = default)
    {
        ValidateCall(input);
        return Send<FaceTimeCall>("/calls", input, HttpMethod.Post, Key(idempotencyKey), cancellationToken, expectedStatus: 201);
    }
    public Task<FaceTimeCall> AnswerCallAsync(string callId, string idempotencyKey, string? reason = null, CancellationToken cancellationToken = default)
        => CallAction(callId, "answer", idempotencyKey, reason, cancellationToken);
    public Task<FaceTimeCall> RejectCallAsync(string callId, string idempotencyKey, string? reason = null, CancellationToken cancellationToken = default)
        => CallAction(callId, "reject", idempotencyKey, reason, cancellationToken);
    public Task<FaceTimeCall> EndCallAsync(string callId, string idempotencyKey, string? reason = null, CancellationToken cancellationToken = default)
        => CallAction(callId, "end", idempotencyKey, reason, cancellationToken);
    private Task<FaceTimeCall> CallAction(string id, string action, string key, string? reason, CancellationToken ct)
    {
        if (reason is { Length: > 160 }) throw new ArgumentException("Reason exceeds 160 characters");
        return Send<FaceTimeCall>($"/calls/{Id(id)}/{action}", new { reason }, HttpMethod.Post, Key(key), ct, expectedStatus: 202);
    }

    public Task<DeviceLogin> BeginLoginAsync(string deviceName, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(deviceName) || deviceName.Length > 80 || deviceName.Any(c => c < 32 || c > 126))
            throw new ArgumentException("Invalid device name");
        return Send<DeviceLogin>("/cli/logins", new { device_name = deviceName }, HttpMethod.Post,
            cancellationToken: cancellationToken, auth: Auth.Public, expectedStatus: 201);
    }
    /// <summary>One poll only. The caller controls polling intervals and stores any approved credential.</summary>
    public Task<LoginResult> PollLoginAsync(string deviceCode, CancellationToken cancellationToken = default)
    {
        if (deviceCode is null || !Regex.IsMatch(deviceCode, @"\Afdc_[A-Za-z0-9_-]{43}\z")) throw new ArgumentException("Invalid device code");
        return Send<LoginResult>("/cli/logins/token", new { device_code = deviceCode }, HttpMethod.Post,
            cancellationToken: cancellationToken, auth: Auth.Public, expectedStatus: null);
    }
    public Task<LoginInspection> InspectLoginAsync(string userCode, CancellationToken cancellationToken = default)
        => Send<LoginInspection>("/cli/logins/inspect", new { user_code = UserCode(userCode) }, HttpMethod.Post, cancellationToken: cancellationToken, auth: Auth.User);
    /// <summary>Only call after explicit human approval. This does not grant the caller new authority.</summary>
    public Task<LoginApproval> ApproveLoginAsync(string userCode, string projectId, CancellationToken cancellationToken = default)
        => Send<LoginApproval>("/cli/logins/approve", new { user_code = UserCode(userCode), project_id = Id(projectId) }, HttpMethod.Post, cancellationToken: cancellationToken, auth: Auth.User);
    public Task<FaceTimeIdentity> WhoAmIAsync(CancellationToken cancellationToken = default)
        => Send<FaceTimeIdentity>("/cli/whoami", cancellationToken: cancellationToken);
    public Task<Revocation> LogoutAsync(CancellationToken cancellationToken = default)
        => Send<Revocation>("/cli/logout", method: HttpMethod.Post, cancellationToken: cancellationToken, auth: Auth.User);
    public Task<CredentialList> ListCredentialsAsync(CancellationToken cancellationToken = default)
        => Send<CredentialList>("/cli/credentials", cancellationToken: cancellationToken);
    public Task<Revocation> RevokeCredentialAsync(string credentialId, CancellationToken cancellationToken = default)
        => Send<Revocation>("/cli/credentials/" + Id(credentialId), method: HttpMethod.Delete, cancellationToken: cancellationToken);

    // Connector management returns versioned objects; preserve server data without inventing readiness.
    public Task<JsonElement> ListConnectorsAsync(CancellationToken cancellationToken = default)
        => Send<JsonElement>("/connectors", cancellationToken: cancellationToken);
    public Task<ConnectorEnrollment> EnrollConnectorAsync(string lineId, string name, string environment,
        string? sessionMode = null, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Length > 100 || environment is not ("production" or "development")
            || sessionMode is not (null or "byor" or "create-room")) throw new ArgumentException("Invalid connector enrollment");
        return Send<ConnectorEnrollment>("/connectors", new { action = "enroll", line_id = Id(lineId), name, environment, session_mode = sessionMode },
            HttpMethod.Post, cancellationToken: cancellationToken);
    }
    public Task<JsonElement> ActivateConnectorAsync(string bindingId, string? expectedBindingId, long assignmentGeneration, CancellationToken cancellationToken = default)
    {
        if (assignmentGeneration < 0 || assignmentGeneration > 9007199254740991) throw new ArgumentException("Invalid assignment generation");
        // A dictionary keeps explicit null: this field is required by the server's compare-and-swap contract.
        return Send<JsonElement>("/connectors", new Dictionary<string, object?> { ["action"] = "activate", ["binding_id"] = Id(bindingId),
            ["expected_binding_id"] = expectedBindingId is null ? null : Id(expectedBindingId), ["assignment_generation"] = assignmentGeneration },
            HttpMethod.Post, cancellationToken: cancellationToken);
    }
    public Task<JsonElement> DrainConnectorAsync(string bindingId, CancellationToken cancellationToken = default)
        => Send<JsonElement>("/connectors", new { action = "drain", binding_id = Id(bindingId) }, HttpMethod.Post, cancellationToken: cancellationToken);
    public Task<JsonElement> RevokeConnectorAsync(string bindingId, CancellationToken cancellationToken = default)
        => Send<JsonElement>("/connectors", new { action = "revoke", binding_id = Id(bindingId) }, HttpMethod.Post, cancellationToken: cancellationToken);
    public Task<BillingCatalog> GetBillingCatalogAsync(CancellationToken cancellationToken = default)
        => Send<BillingCatalog>("/billing/catalog", cancellationToken: cancellationToken, auth: Auth.Public);
    public Task<Checkout?> GetCurrentCheckoutAsync(CancellationToken cancellationToken = default)
        => Send<Checkout?>("/billing/checkout", cancellationToken: cancellationToken, allowNull: true);
    public Task<Checkout> CreateCheckoutAsync(string planId, string catalogVersion, string idempotencyKey, CancellationToken cancellationToken = default)
    {
        if (planId != "shared" || catalogVersion != "2026-10-22") throw new ArgumentException("Unsupported billing plan or catalog version");
        return Send<Checkout>("/billing/checkout", new { plan_id = planId, catalog_version = catalogVersion }, HttpMethod.Post,
            Key(idempotencyKey), cancellationToken);
    }

    private enum Auth { Public, User, Project }
    private async Task<T> Send<T>(string path, object? body = null, HttpMethod? method = null, string? key = null,
        CancellationToken cancellationToken = default, Auth auth = Auth.Project, int? expectedStatus = 200, bool allowNull = false)
    {
        if (key is not null) Key(key);
        JsonElement? payload = body is null ? null : JsonSerializer.SerializeToElement(body, Json);
        var response = await transport.RequestWithResponseAsync(path, payload, method, key, cancellationToken,
            publicRequest: auth == Auth.Public, projectRequest: auth == Auth.Project).ConfigureAwait(false);
        try
        {
            if (expectedStatus.HasValue && response.Status != expectedStatus) throw new JsonException();
            if (response.Value is not { ValueKind: JsonValueKind.Object } envelope || !envelope.TryGetProperty("data", out var data)) throw new JsonException();
            UniqueProperties(envelope);
            if (data.ValueKind == JsonValueKind.Null && !allowNull) throw new JsonException();
            var result = data.Deserialize<T>(Json);
            if (result is null && !allowNull) throw new JsonException();
            if (result is LoginResult login && response.Status != (login.Status == "pending" ? 202 : 200)) throw new JsonException();
            return result!;
        }
        catch (JsonException) { throw new ChertApiException(502, "invalid_response", response.RequestId, response.Value); }
    }
    private static void UniqueProperties(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            var keys = new HashSet<string>(StringComparer.Ordinal);
            foreach (var p in value.EnumerateObject()) { if (!keys.Add(p.Name)) throw new JsonException(); UniqueProperties(p.Value); }
        }
        else if (value.ValueKind == JsonValueKind.Array) foreach (var item in value.EnumerateArray()) UniqueProperties(item);
    }
    private static string PagePath(string path, int? limit, int? offset)
    {
        if (limit is < 1 or > 100 || offset is < 0) throw new ArgumentException("Invalid pagination");
        var parts = new List<string>();
        if (limit.HasValue) parts.Add("limit=" + limit.Value.ToString(System.Globalization.CultureInfo.InvariantCulture));
        if (offset.HasValue) parts.Add("offset=" + offset.Value.ToString(System.Globalization.CultureInfo.InvariantCulture));
        return path + (parts.Count == 0 ? "" : "?" + string.Join('&', parts));
    }
    private static string Id(string id)
    {
        if (id is null || id.Length != 36 || !Guid.TryParseExact(id, "D", out _)) throw new ArgumentException("Expected a dashed UUID");
        return id;
    }
    private static string Key(string key)
    {
        if (key is null || key.Length is < 8 or > 200 || key.Trim() != key || key.Any(c => c < 32 || c > 126))
            throw new ArgumentException("Use a stable 8–200 character printable ASCII idempotency key");
        return key;
    }
    private static string UserCode(string code)
    {
        if (string.IsNullOrWhiteSpace(code) || code.Length > 100) throw new ArgumentException("Invalid user code");
        return code;
    }
    private static void ValidateCall(CreateCallRequest input)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (input.Mode is not ("managed" or "customer_managed") || input.Media is null || input.AdditionalData is { Count: > 0 })
            throw new ArgumentException("Invalid call mode or media");
        if (input.LineId is not null) Id(input.LineId);
        if (input.AssistantId is not null) Id(input.AssistantId);
        if ((input.Mode == "managed") != (input.AssistantId is not null)) throw new ArgumentException("Assistant does not match call mode");
        if (input.Recipients is not null)
        {
            if (input.Destination is not null || input.DestinationType is not null || input.LineId is null || input.Recipients.Length is < 1 or > 31)
                throw new ArgumentException("Invalid group destination");
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var recipient in input.Recipients)
            {
                if (recipient is null || string.IsNullOrEmpty(recipient.Value) || recipient.Value.Length > 160 || recipient.Value.Any(char.IsControl)
                    || recipient.Type is not ("phone_number" or "email")) throw new ArgumentException("Invalid group recipient");
                var value = recipient.Value.Trim();
                if (!(recipient.Type == "phone_number" ? Regex.IsMatch(value, @"\A\+[1-9][0-9]{7,14}\z") : Regex.IsMatch(value, @"\A[^\s@]+@[^\s@]+\.[^\s@]+\z"))
                    || !seen.Add(recipient.Type + ":" + (recipient.Type == "email" ? value.ToLowerInvariant() : value))) throw new ArgumentException("Invalid or duplicate group recipient");
            }
        }
        else if (input.DestinationType == "facetime_link")
        {
            if (input.LineId is null || input.Destination is null || input.Destination.Length > 4096
                || !Regex.IsMatch(input.Destination, @"\Ahttps://facetime\.apple\.com/join#[^\s\x00-\x1f\x7f]+\z")) throw new ArgumentException("Invalid FaceTime link");
        }
        else if (input.DestinationType is not (null or "phone" or "email" or "apple_id") || string.IsNullOrWhiteSpace(input.Destination)
            || input.Destination.Trim().Length is < 3 or > 160) throw new ArgumentException("Invalid destination");
        var credentials = new[] { input.LivekitUrl, input.ParticipantToken, input.RemoteParticipantIdentity };
        var any = credentials.Any(x => x is not null);
        if (input.Mode == "managed" && any) throw new ArgumentException("Managed calls cannot supply room credentials");
        if (input.Mode == "customer_managed" && (!input.AuthorizedTestCall || any)
            && (input.LineId is null || credentials.Any(string.IsNullOrWhiteSpace) || !input.Media.Audio || input.AuthorizedTestCall))
            throw new ArgumentException("BYOR requires a line, audio and all room credentials without test-call mode");
    }
}
