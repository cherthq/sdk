"""Explicit, independent iMessage and FaceTime clients; no implicit provisioning."""
from dataclasses import dataclass, field

from chert import ChertClient, ChertAPIError, QueuedTextReceipt, ReactionReceipt, DEFAULT_IMESSAGE_URL
from chert.events import (MessagingEvent, RecordedMessagingEvent, MessagingEventPage,
                          MessagingStreamFrame, WebhookSubscription, CreateWebhookSubscription,
                          UpdateWebhookSubscription, WebhookSubscriptions, WebhookSubscriptionResponse,
                          CreatedWebhookSubscriptionResponse, DeletedWebhookSubscription, verify_webhook)
from .control_plane import ChertControlPlane, ChertControlPlaneError, DEFAULT_FACETIME_URL
from .media import (MediaCapabilities, CustomVideoCapability, InboundCallerVideoCapability, MediaSessionGrant,
                    MediaSessionLimits, IceServer, MediaFrameError, VideoFrame, VideoPlane,
                    copy_video_frame, parse_media_capabilities)
from .composition import (COMPOSITION_MAX_LAYERS, CallVideoComposition, VideoCompositionCapability,
                          composition_input_target, parse_video_composition)
from .session import UnsupportedUnifiedBackend, UNIFIED_CONTRACT, UNIFIED_SCOPES, discover, _ContractOpener


@dataclass(frozen=True)
class IMessageConfig:
    base_url: str = DEFAULT_IMESSAGE_URL
    api_key: str = field(default="", repr=False)
    tenant: str | None = None


@dataclass(frozen=True)
class FaceTimeConfig:
    base_url: str = DEFAULT_FACETIME_URL
    token: str | None = field(default=None, repr=False)
    project_id: str | None = None


class Chert:
    """Independent legacy channels, or opt in to a discovered unified session."""

    @classmethod
    def connect(cls, access_token: str, project_id: str, *,
                imessage_base_url: str = DEFAULT_IMESSAGE_URL,
                facetime_base_url: str = DEFAULT_FACETIME_URL) -> "Chert":
        """Proposed unified-v1 contract; discovery must succeed before token use."""
        imessage, facetime = discover(access_token, project_id, imessage_base_url, facetime_base_url)
        client = cls(imessage=IMessageConfig(base_url=imessage, api_key=access_token),
                     facetime=FaceTimeConfig(base_url=facetime, token=access_token, project_id=project_id))
        client.imessage._opener = _ContractOpener(client.imessage._opener, imessage)
        client.facetime._opener = _ContractOpener(client.facetime._opener, facetime)
        return client

    def __init__(self, *, imessage: IMessageConfig | None = None,
                 facetime: FaceTimeConfig | None = None):
        self.imessage = (ChertClient(imessage.base_url, imessage.api_key, imessage.tenant)
                         if imessage is not None else None)
        self.facetime = (ChertControlPlane(facetime.base_url, token=facetime.token,
                                          project_id=facetime.project_id)
                         if facetime is not None else None)


__all__ = ["Chert", "IMessageConfig", "FaceTimeConfig", "ChertClient", "ChertAPIError",
           "UnsupportedUnifiedBackend", "UNIFIED_CONTRACT", "UNIFIED_SCOPES",
           "QueuedTextReceipt", "ReactionReceipt", "ChertControlPlane", "ChertControlPlaneError",
           "MessagingEvent", "RecordedMessagingEvent", "MessagingEventPage", "MessagingStreamFrame",
           "WebhookSubscription", "CreateWebhookSubscription", "UpdateWebhookSubscription",
           "WebhookSubscriptions", "WebhookSubscriptionResponse", "CreatedWebhookSubscriptionResponse",
           "DeletedWebhookSubscription", "verify_webhook",
           "MediaCapabilities", "CustomVideoCapability", "InboundCallerVideoCapability", "MediaSessionGrant",
           "MediaSessionLimits", "IceServer", "MediaFrameError", "VideoFrame", "VideoPlane",
           "copy_video_frame", "parse_media_capabilities",
           "COMPOSITION_MAX_LAYERS", "CallVideoComposition", "VideoCompositionCapability",
           "composition_input_target", "parse_video_composition"]
