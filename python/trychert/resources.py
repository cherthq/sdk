"""Public discovery, integration metadata and recorded transcript contracts."""
from typing import Literal, TypedDict


class ProjectInfo(TypedDict):
    id: str
    slug: str
    name: str
    website_domain: str
    logo_data: str | None
    created_at: str
    updated_at: str


class ProjectMembership(TypedDict):
    role: Literal['owner', 'admin', 'member', 'viewer']
    facetime_projects: ProjectInfo


class Integration(TypedDict):
    id: str
    project_id: str
    name: str
    endpoint_url: str
    enabled: bool
    signing_enabled: bool
    payload_version: int
    active_revision_id: str | None
    livekit_allowed_hosts: list[str] | None
    created_at: str
    updated_at: str


class Integrations(TypedDict):
    items: list[Integration]


class TranscriptTurn(TypedDict):
    occurred_at: str
    speaker: Literal['caller', 'agent']
    text: str


class CallTranscript(TypedDict):
    call_id: str
    schema_version: Literal[1]
    turns: list[TranscriptTurn]
    created_at: str


def _strings(value: dict, keys: tuple[str, ...]) -> bool:
    return all(isinstance(value.get(key), str) for key in keys)


def _nullable_string(value: object) -> bool:
    return value is None or isinstance(value, str)


def _project_memberships(value: object) -> bool:
    if not isinstance(value, list):
        return False
    for membership in value:
        if not isinstance(membership, dict) or membership.get('role') not in ('owner', 'admin', 'member', 'viewer'):
            return False
        project = membership.get('facetime_projects')
        if (not isinstance(project, dict) or not _strings(project, ('id', 'slug', 'name', 'website_domain', 'created_at', 'updated_at'))
                or 'logo_data' not in project or not _nullable_string(project['logo_data'])):
            return False
    return True


def _integrations(value: object) -> bool:
    if not isinstance(value, dict) or not isinstance(value.get('items'), list):
        return False
    for item in value['items']:
        if (not isinstance(item, dict) or not _strings(item, ('id', 'project_id', 'name', 'endpoint_url', 'created_at', 'updated_at'))
                or type(item.get('enabled')) is not bool or type(item.get('signing_enabled')) is not bool
                or type(item.get('payload_version')) is not int or 'active_revision_id' not in item
                or not _nullable_string(item['active_revision_id']) or 'livekit_allowed_hosts' not in item):
            return False
        hosts = item['livekit_allowed_hosts']
        if hosts is not None and (not isinstance(hosts, list) or not all(isinstance(host, str) for host in hosts)):
            return False
    return True


def _call_transcript(value: object, call_id: str) -> bool:
    return (isinstance(value, dict) and value.get('call_id') == call_id
            and type(value.get('schema_version')) is int and value['schema_version'] == 1
            and isinstance(value.get('created_at'), str) and isinstance(value.get('turns'), list)
            and all(isinstance(turn, dict) and _strings(turn, ('occurred_at', 'text'))
                    and turn.get('speaker') in ('caller', 'agent') for turn in value['turns']))
