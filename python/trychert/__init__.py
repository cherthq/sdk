"""Explicit, independent iMessage and FaceTime clients; no implicit provisioning."""
from dataclasses import dataclass, field

from chert import ChertClient, ChertAPIError, QueuedTextReceipt, ReactionReceipt, DEFAULT_IMESSAGE_URL
from .control_plane import ChertControlPlane, ChertControlPlaneError, DEFAULT_FACETIME_URL


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
    """Configure either channel explicitly. Credentials never cross channels."""

    def __init__(self, *, imessage: IMessageConfig | None = None,
                 facetime: FaceTimeConfig | None = None):
        self.imessage = (ChertClient(imessage.base_url, imessage.api_key, imessage.tenant)
                         if imessage is not None else None)
        self.facetime = (ChertControlPlane(facetime.base_url, token=facetime.token,
                                          project_id=facetime.project_id)
                         if facetime is not None else None)


__all__ = ["Chert", "IMessageConfig", "FaceTimeConfig", "ChertClient", "ChertAPIError",
           "QueuedTextReceipt", "ReactionReceipt", "ChertControlPlane", "ChertControlPlaneError"]
