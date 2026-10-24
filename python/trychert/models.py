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


class CheckoutSession(TypedDict):
    url: str


class BillingCancellation(TypedDict):
    status: Literal["cancellation_requested"]
    message: str


class CouponValidation(TypedDict):
    code: str
    percent_off: float
    mode: Literal["live", "test"]
    monthly_total: float
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
