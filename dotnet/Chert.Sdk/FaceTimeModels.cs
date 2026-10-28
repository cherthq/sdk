using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace TryChert;

/// <summary>Models never format payloads or secrets. Unknown server fields remain explicitly accessible.</summary>
public abstract class FaceTimeModel : IJsonOnDeserialized
{
    [JsonExtensionData] public Dictionary<string, JsonElement>? AdditionalData { get; init; }
    public override string ToString() => GetType().Name + " { redacted }";
    void IJsonOnDeserialized.OnDeserialized()
    {
        foreach (var property in GetType().GetProperties())
        {
            var value = property.GetValue(this);
            if (Attribute.IsDefined(property, typeof(RequiredMemberAttribute)) && value is null)
                throw new JsonException("Required response field is null");
            if (value is Array items && items.Cast<object?>().Any(item => item is null))
                throw new JsonException("Null response array item");
        }
        Validate();
    }
    internal virtual void Validate() { }
}

public sealed class Page<T> : FaceTimeModel
{
    public required T[] Items { get; init; }
    public required int Total { get; init; }
    public required int Limit { get; init; }
    public required int Offset { get; init; }
    internal override void Validate()
    {
        if (Total < 0 || Limit is < 1 or > 100 || Offset < 0 || Items.Length > Limit || Items.Length > Total || Items.Any(x => x is null))
            throw new JsonException("Invalid page");
    }
}
public sealed class MediaOptions : FaceTimeModel
{
    public required bool Audio { get; init; }
    public required bool Video { get; init; }
}
/// <summary>Outbound call request. Room credentials are call-scoped, not project credentials.</summary>
public sealed class CreateCallRequest : FaceTimeModel
{
    public string Direction => "outbound";
    public required string Mode { get; init; }
    public string? LineId { get; init; }
    public string? AssistantId { get; init; }
    public string? Destination { get; init; }
    public string? DestinationType { get; init; }
    public CallRecipient[]? Recipients { get; init; }
    public required MediaOptions Media { get; init; }
    public bool AuthorizedTestCall { get; init; }
    public string? LivekitUrl { get; init; }
    public string? ParticipantToken { get; init; }
    public string? RemoteParticipantIdentity { get; init; }
}
public sealed class CallRecipient : FaceTimeModel
{
    public required string Type { get; init; }
    public required string Value { get; init; }
}
/// <summary>Observed states are independent; ready audio never implies ready video.</summary>
public sealed class CallMediaStatus : FaceTimeModel
{
    public string? Audio { get; init; }
    public string? Video { get; init; }
}
/// <summary>Server-observed state; accepting a request does not prove ringing or media readiness.</summary>
public sealed class FaceTimeCall : FaceTimeModel
{
    public required string Id { get; init; }
    public required string Status { get; init; }
    public string? ProjectId { get; init; }
    public string? Direction { get; init; }
    public string? Mode { get; init; }
    public MediaOptions? Media { get; init; }
    public string? LineId { get; init; }
    public string? WorkerId { get; init; }
    public string? AssistantId { get; init; }
    public CallMediaStatus? MediaStatus { get; init; }
    public string? TerminalReason { get; init; }
    public string? MaskedIdentity { get; init; }
    public string? CreatedAt { get; init; }
    public string? EndedAt { get; init; }
    public bool? HasTranscript { get; init; }
    /// <summary>Read-only screen-control consent state (<c>none</c>, <c>requested</c> or <c>granted</c>). No control operations exist.</summary>
    public string? ScreenControl { get; init; }
    public CallDetailEvent[]? FacetimeCallEvents { get; init; }
    /// <summary>Raw; parse with <see cref="TryChert.MediaCapabilities.Parse"/>. Never infer support from video flags.</summary>
    public JsonElement? MediaCapabilities { get; init; }
    internal override void Validate()
    {
        if (Id.Length != 36 || !Guid.TryParseExact(Id, "D", out _) || string.IsNullOrWhiteSpace(Status))
            throw new JsonException("Invalid call identity or status");
    }
}
public sealed class CallDetailEvent : FaceTimeModel
{
    public required string Id { get; init; }
    public required string EventType { get; init; }
    public string? OccurredAt { get; init; }
    public string? CreatedAt { get; init; }
    public long? WorkerSequence { get; init; }
    public long? Sequence { get; init; }
    public string? Source { get; init; }
    public JsonElement? Payload { get; init; }
}
public sealed class CallEvent : FaceTimeModel
{
    public required string Id { get; init; }
    public required string Type { get; init; }
    public required string At { get; init; }
    public long? Sequence { get; init; }
    public string? Source { get; init; }
}
public sealed class CallEvents : FaceTimeModel
{
    public required string CallId { get; init; }
    public required CallEvent[] Events { get; init; }
}
public sealed class TranscriptTurn : FaceTimeModel
{
    public required string OccurredAt { get; init; }
    public required string Speaker { get; init; }
    public required string Text { get; init; }
}
public sealed class CallTranscript : FaceTimeModel
{
    public required string CallId { get; init; }
    public required int SchemaVersion { get; init; }
    public required TranscriptTurn[] Turns { get; init; }
    public string? CreatedAt { get; init; }
}
public sealed class FaceTimeLine : FaceTimeModel
{
    public required string Id { get; init; }
    public required string Status { get; init; }
    public string? LineKey { get; init; }
    public string? DisplayName { get; init; }
    public string? WorkerId { get; init; }
    public string? InboundPolicy { get; init; }
    public string? DefaultAssistantId { get; init; }
    public string? MaskedIdentity { get; init; }
    public bool? SupportsAudio { get; init; }
    public bool? SupportsVideo { get; init; }
    /// <summary>Raw; parse with <see cref="TryChert.MediaCapabilities.Parse"/>. Never infer support from video flags.</summary>
    public JsonElement? MediaCapabilities { get; init; }
}
public sealed class FaceTimeWorker : FaceTimeModel
{
    public required string Id { get; init; }
    public required string Status { get; init; }
    public required bool Enabled { get; init; }
    public string? WorkerKey { get; init; }
    public string? DisplayName { get; init; }
    public string? LastHeartbeatAt { get; init; }
    /// <summary>Raw; parse with <see cref="TryChert.MediaCapabilities.Parse"/>. Never infer support from video flags.</summary>
    public JsonElement? MediaCapabilities { get; init; }
}
public sealed class ProjectIdentity : FaceTimeModel
{
    public required string Id { get; init; }
    public string? Name { get; init; }
}
public sealed class FaceTimeIdentity : FaceTimeModel
{
    public required ProjectIdentity Project { get; init; }
    public required string Role { get; init; }
    public string? Email { get; init; }
    public string? DeviceName { get; init; }
    public string? ExpiresAt { get; init; }
}
public sealed class DeviceLogin : FaceTimeModel
{
    public required string DeviceCode { get; init; }
    public required string UserCode { get; init; }
    public required string VerificationUrl { get; init; }
    public required string VerificationUrlComplete { get; init; }
    public required int ExpiresIn { get; init; }
    public required int Interval { get; init; }
}
public sealed class LoginResult : FaceTimeModel
{
    public required string Status { get; init; }
    public string? AccessToken { get; init; }
    public ProjectIdentity? Project { get; init; }
    public int? ExpiresIn { get; init; }
    public string? Email { get; init; }
    public string? DeviceName { get; init; }
    internal override void Validate()
    {
        if (Status is not ("pending" or "approved") || (Status == "approved" && (string.IsNullOrEmpty(AccessToken) || Project is null || ExpiresIn is null or <= 0)))
            throw new JsonException("Invalid login response");
    }
}
public sealed class LoginInspection : FaceTimeModel
{
    public required string DeviceName { get; init; }
    public required string CreatedAt { get; init; }
    public required int ExpiresIn { get; init; }
}
public sealed class LoginApproval : FaceTimeModel
{
    public required string DeviceName { get; init; }
    public required string ProjectId { get; init; }
}
public sealed class Revocation : FaceTimeModel { public required bool Revoked { get; init; } }
public sealed class CliCredential : FaceTimeModel
{
    public required string Id { get; init; }
    public required string DeviceName { get; init; }
    public required string TokenPrefix { get; init; }
    public required string UserId { get; init; }
    public required string ExpiresAt { get; init; }
    public string? Email { get; init; }
    public string? CreatedAt { get; init; }
    public string? LastUsedAt { get; init; }
}
public sealed class CredentialList : FaceTimeModel { public required CliCredential[] Credentials { get; init; } }
public sealed class ConnectorSecrets : FaceTimeModel
{
    public required string Connection { get; init; }
    public required string Recovery { get; init; }
}
public sealed class ConnectorEnrollment : FaceTimeModel { public required ConnectorSecrets Credentials { get; init; } }
public sealed class BillingStatus : FaceTimeModel
{
    [JsonRequired] public BillingEntitlement? Entitlement { get; init; }
    public required bool NeedsReconciliation { get; init; }
    public required bool SalesEnabled { get; init; }
    public required bool SharedAvailable { get; init; }
    public required bool DedicatedAvailable { get; init; }
}
public sealed class BillingEntitlement : FaceTimeModel
{
    public required string ProjectId { get; init; }
    public required string Plan { get; init; }
    public required string Status { get; init; }
    public required string FulfillmentStatus { get; init; }
    public required string ValidFrom { get; init; }
    public required string ValidUntil { get; init; }
    public string? SubscriptionId { get; init; }
    public string? ProviderCustomerId { get; init; }
}
public sealed class BillingCheckout : FaceTimeModel
{
    public required string Url { get; init; }
}
public sealed class BillingCancellation : FaceTimeModel
{
    public required string Status { get; init; }
    public required string Message { get; init; }
}
public sealed class BillingCoupon : FaceTimeModel
{
    public required string Code { get; init; }
    public required decimal PercentOff { get; init; }
    public required string Mode { get; init; }
    public decimal? MonthlyTotal { get; init; }
    public required string Currency { get; init; }
}
