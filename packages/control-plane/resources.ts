/** Public project discovery, integration metadata and recorded transcripts. */
export interface ProjectMembership {
  role: 'owner' | 'admin' | 'member' | 'viewer';
  facetime_projects: {
    id: string; slug: string; name: string; website_domain: string; logo_data: string | null;
    created_at: string; updated_at: string;
  };
}
export interface Integration {
  id: string; project_id: string; name: string; endpoint_url: string; enabled: boolean;
  signing_enabled: boolean; payload_version: number; active_revision_id: string | null;
  /** null inherits project hosts; [] is an explicit empty override. */
  livekit_allowed_hosts: string[] | null; created_at: string; updated_at: string;
}
export interface CallTranscript {
  call_id: string; schema_version: 1;
  turns: { occurred_at: string; speaker: 'caller' | 'agent'; text: string }[];
  created_at: string;
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const nullableString = (v: unknown) => v === null || typeof v === 'string';
export function isProjectMemberships(v: unknown): v is ProjectMembership[] {
  return Array.isArray(v) && v.every(m => {
    if (!record(m) || typeof m.role !== 'string' || !['owner', 'admin', 'member', 'viewer'].includes(m.role)) return false;
    const p = m.facetime_projects;
    return record(p) && ['id', 'slug', 'name', 'website_domain', 'created_at', 'updated_at'].every(k => typeof p[k] === 'string')
      && nullableString(p.logo_data);
  });
}
export function isIntegrations(v: unknown): v is { items: Integration[] } {
  return record(v) && Array.isArray(v.items) && v.items.every(i => record(i)
    && ['id', 'project_id', 'name', 'endpoint_url', 'created_at', 'updated_at'].every(k => typeof i[k] === 'string')
    && typeof i.enabled === 'boolean' && typeof i.signing_enabled === 'boolean'
    && Number.isInteger(i.payload_version) && nullableString(i.active_revision_id)
    && (i.livekit_allowed_hosts === null || Array.isArray(i.livekit_allowed_hosts) && i.livekit_allowed_hosts.every(h => typeof h === 'string')));
}
export function isCallTranscript(v: unknown): v is CallTranscript {
  return record(v) && typeof v.call_id === 'string' && v.schema_version === 1 && typeof v.created_at === 'string'
    && Array.isArray(v.turns) && v.turns.every(t => record(t) && typeof t.occurred_at === 'string'
      && (t.speaker === 'caller' || t.speaker === 'agent') && typeof t.text === 'string');
}
