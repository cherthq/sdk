"""Wire models for the inspected FaceTime control-plane contracts.

Annotations describe server data; they do not claim runtime schema validation.
"""
from typing import Literal, TypedDict, Union

Json = Union[None, bool, int, float, str, list["Json"], dict[str, "Json"]]


class Project(TypedDict):
    id: str
    name: str | None


class _Page(TypedDict):
    total: int
    limit: int
    offset: int


class DeviceLoginStart(TypedDict):
    device_code: str
    user_code: str
    verification_url: str
    verification_url_complete: str
    expires_in: int
    interval: int


class PendingLogin(TypedDict):
    status: Literal["pending"]


class ApprovedLogin(TypedDict):
    status: Literal["approved"]
    access_token: str
    email: str | None
    project: Project
    device_name: str
    expires_in: int


LoginResult = PendingLogin | ApprovedLogin


class _IdentityOptional(TypedDict, total=False):
    device_name: str
    expires_at: str


class Identity(_IdentityOptional):
    email: str | None
    project: Project
    role: str


class _LineOptional(TypedDict, total=False):
    masked_identity: str | None
    supports_audio: bool
    supports_video: bool


class Line(_LineOptional):
    id: str
    line_key: str
    display_name: str
    status: str
    worker_id: str | None


class Worker(TypedDict):
    id: str
    worker_key: str
    display_name: str
    status: str
    enabled: bool


class LinePage(_Page):
    items: list[Line]


class WorkerPage(_Page):
    items: list[Worker]


class Credential(TypedDict):
    id: str
    device_name: str
    token_prefix: str
    user_id: str
    email: str | None
    created_at: str
    last_used_at: str | None
    expires_at: str


class Credentials(TypedDict):
    credentials: list[Credential]


class _EnrollmentOptional(TypedDict, total=False):
    session_mode: Literal["byor", "create-room"]


class ConnectorEnrollment(_EnrollmentOptional):
    line_id: str
    name: str
    environment: Literal["production", "development"]


class ConnectorSecrets(TypedDict):
    connection: str
    recovery: str


class ConnectorReceipt(TypedDict):
    credentials: ConnectorSecrets


class BillingStatus(TypedDict):
    # Preserve the server's extensible entitlement object without inventing a schema.
    entitlement: dict[str, Json] | None
    needs_reconciliation: bool
    sales_enabled: bool | None
    shared_available: bool
    dedicated_available: bool


class BillingResult(TypedDict, total=False):
    """`active` carries the entitlement; `requires_payment_method`/`requires_action` carry a Stripe-hosted URL.

    `pending`: the provider accepted the operation but the entitlement is not committed yet; retry with the same key.
    """
    status: Literal["active", "pending", "requires_payment_method", "requires_action"]
    entitlement: dict[str, Json]
    url: str


class CheckoutSession(TypedDict):
    url: str


class BillingCancellation(TypedDict):
    status: Literal["cancellation_requested"]
    message: str


class _CouponValidationOptional(TypedDict, total=False):
    monthly_total: float


class CouponValidation(_CouponValidationOptional):
    code: str
    percent_off: float
    mode: Literal["live", "test"]
    currency: str


class Revoked(TypedDict):
    revoked: bool


class LoginInspection(TypedDict):
    device_name: str
    created_at: str
    expires_in: int


class LoginApproval(TypedDict):
    device_name: str
    project_id: str


class CallMedia(TypedDict):
    audio: bool
    video: bool


class ByorMedia(TypedDict):
    audio: Literal[True]
    video: bool


class VideoCallMedia(TypedDict):
    audio: bool
    video: Literal[True]


class ByorRoom(TypedDict):
    livekit_url: str
    participant_token: str
    remote_participant_identity: str


class CallRecipient(TypedDict):
    type: Literal['phone_number', 'email']
    value: str


class _DestinationOptional(TypedDict, total=False):
    destination_type: Literal['phone', 'email', 'apple_id', 'facetime_link']


class _Destination(_DestinationOptional):
    destination: str


class _Recipients(TypedDict):
    line_id: str
    recipients: list[CallRecipient]


class _ManagedCall(TypedDict):
    direction: Literal['outbound']
    mode: Literal['managed']
    assistant_id: str
    media: ByorMedia | VideoCallMedia


class _ManagedLine(TypedDict, total=False):
    line_id: str


class ManagedCallDestination(_ManagedCall, _Destination, _ManagedLine):
    pass


class ManagedCallRecipients(_ManagedCall, _Recipients):
    pass


class _ByorCall(ByorRoom):
    direction: Literal['outbound']
    mode: Literal['customer_managed']
    media: ByorMedia


class ByorCallDestination(_ByorCall, _Destination):
    line_id: str


class ByorCallRecipients(_ByorCall, _Recipients):
    pass


CreateCall = ManagedCallDestination | ManagedCallRecipients | ByorCallDestination | ByorCallRecipients
CallStatus = Literal['queued', 'incoming', 'allocating', 'agent_preparing', 'answering', 'dialing',
                     'connecting', 'active', 'ending', 'ended', 'failed', 'rejected']
CallEventType = Literal['incoming_registered', 'allocated', 'answer_requested', 'reject_requested',
                        'end_requested', 'agent_preparing', 'answered', 'dialing', 'connecting',
                        'active', 'ending', 'bridge_ready', 'agent_connected', 'remote_video_ready',
                        'remote_video_unavailable', 'caller_video_published', 'ended', 'failed',
                        'rejected', 'cleanup_complete',
                        # Draft call video composition lifecycle. Payload-free.
                        'call_video.live', 'call_video.updated', 'call_video.failed', 'call_video.stopped',
                        # Screen sharing. Payload-free: never screen content or coordinates.
                        'agent_screen_started', 'agent_screen_stopped', 'caller_screen_share_started',
                        'caller_screen_share_ended', 'screen_control_granted', 'screen_control_revoked', 'unknown']


class CallAction(TypedDict, total=False):
    reason: str


class CallEvent(TypedDict):
    id: str
    type: CallEventType
    at: str
    sequence: int | None
    source: str


class CallEvents(TypedDict):
    call_id: str
    events: list[CallEvent]


class CallDetailEvent(TypedDict):
    id: str
    event_type: CallEventType
    sequence: int
    source: str
    created_at: str
    payload: dict[str, Json]


class _CallOptional(TypedDict, total=False):
    video_framing: Literal['fit', 'fill']
    connecting_screen_dismissal: Literal['audio', 'video']
    has_transcript: bool
    # Read-only consent state for screen control. The public API exposes no control operations.
    screen_control: Literal['none', 'requested', 'granted']


class Call(_CallOptional):
    id: str
    project_id: str
    direction: Literal['inbound', 'outbound']
    mode: Literal['managed', 'customer_managed']
    media: CallMedia
    status: CallStatus
    media_status: dict[str, Json]
    line_id: str | None
    worker_id: str | None
    assistant_id: str | None
    terminal_reason: str | None
    started_at: str | None
    ended_at: str | None
    duration_seconds: float | None


class CallDetail(Call):
    facetime_call_events: list[CallDetailEvent]


class CallPage(_Page):
    items: list[Call]
