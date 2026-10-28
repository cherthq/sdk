/** FaceTime HTTP contracts; media frames and LiveKit subscriptions stay in the caller's runtime. */
export interface CallMedia { audio: boolean; video: boolean }
export type InboundPolicy = 'auto_answer' | 'customer_decides' | 'agent_decides' | 'auto_reject';
export interface LineUpdate {
  connecting_screen_dismissal?: 'audio' | 'video';
  connecting_screen_appearance?: 'chert' | 'black';
  video_framing?: 'fit' | 'fill';
  integration_id?: string | null;
  display_name?: string;
  default_assistant_id?: string | null;
  inbound_policy?: InboundPolicy;
}
export interface VideoCapabilities {
  audio?: boolean; video?: boolean; managed?: boolean;
  [key: string]: unknown;
}
export interface MediaReadiness {
  audio_ready?: boolean; video_ready?: boolean; avatar_capable?: boolean;
  [key: string]: unknown;
}
export interface ByorRoom {
  livekit_url: string; participant_token: string; remote_participant_identity: string;
}
/** Customer webhook body. Verify the configured signature before trusting it. */
export interface IncomingCallWebhook {
  event_id: string; type: 'call.incoming'; created_at: string;
  data: { call_id: string; line_id: string; media: CallMedia; from_handle_hash: string | null;
    occurred_at: string; from?: { type: 'phone_number' | 'email'; value: string } | null };
}
/** Return to the authenticated incoming webhook, not to the /answer endpoint. */
export type IncomingCallDecision = { action: 'decline' } | ({ action: 'accept' } & ByorRoom);
type CallDestination =
  | { destination: string; destination_type?: 'phone' | 'email' | 'apple_id' | 'facetime_link'; recipients?: never }
  | { destination?: never; destination_type?: never; line_id: string; recipients: { type: 'phone_number' | 'email'; value: string }[] };
export type CreateCall = CallDestination & { direction: 'outbound' } & (
  | { mode: 'managed'; assistant_id: string; line_id?: string;
      media: { audio: true; video: boolean } | { audio: boolean; video: true };
      livekit_url?: never; participant_token?: never; remote_participant_identity?: never }
  | ({ mode: 'customer_managed'; line_id: string; assistant_id?: never;
      media: { audio: true; video: boolean } } & ByorRoom)
);
export type CallStatus = 'queued' | 'incoming' | 'allocating' | 'agent_preparing' | 'answering' | 'dialing' | 'connecting' | 'active' | 'ending' | 'ended' | 'failed' | 'rejected';
/** Public normalized event types. Raw LiveKit track callbacks are not HTTP call events. */
export type CallEventType = 'incoming_registered' | 'allocated' | 'answer_requested' | 'reject_requested' | 'end_requested'
  | 'agent_preparing' | 'answered' | 'dialing' | 'connecting' | 'active' | 'ending' | 'bridge_ready' | 'agent_connected'
  | 'remote_video_ready' | 'remote_video_unavailable' | 'caller_video_published' | 'ended' | 'failed' | 'rejected' | 'cleanup_complete' | 'unknown';
export interface CallEvent { id: string; type: CallEventType; at: string; sequence: number | null; source: string }
export interface CallDetailEvent {
  id: string; event_type: CallEventType; sequence: number; source: string; created_at: string;
  /** Backend-owned event details; may contain sensitive call data. */
  payload: Record<string, unknown>;
}
export interface Call {
  id: string; project_id: string; direction: 'inbound' | 'outbound'; mode: 'managed' | 'customer_managed';
  media: CallMedia; status: CallStatus;
  media_status: { audio?: string; video?: string; [key: string]: unknown };
  line_id: string | null; worker_id: string | null; assistant_id: string | null;
  terminal_reason: string | null; started_at: string | null; ended_at: string | null; duration_seconds: number | null;
  video_framing?: 'fit' | 'fill'; connecting_screen_dismissal?: 'audio' | 'video';
  has_transcript?: boolean;
  /** Explicit custom-media capability; parse with parseMediaCapabilities. */
  media_capabilities?: unknown;
  [key: string]: unknown;
}
export interface CallDetail extends Call { facetime_call_events: CallDetailEvent[] }
export interface CallAction { reason?: string }
export type AssistantVideo = {
  quality?: 'low' | 'standard' | 'high'; framing?: 'fit' | 'fill' | 'portrait';
  background?: string | null; greeting_enabled?: boolean;
} & (
  | { mode: 'disabled' | 'test_pattern'; provider?: null; avatar_id?: null }
  | { mode: 'avatar'; provider: 'anam'; avatar_id: string }
);
/** Input configuration; fields with server defaults may be omitted. */
export interface AssistantConfig {
  schema_version?: 1; instructions: string; greeting?: string;
  openai: { provider: 'openai'; model: 'gpt-realtime-2.1' };
  voice: { provider: 'openai'; voice_id: 'marin' | 'cedar' };
  interruption: { enabled?: boolean; responsiveness?: number };
  tools?: { name: string; description: string; schema: Record<string, unknown> }[];
  escalation: { enabled?: boolean; reason_codes?: string[] };
  video: AssistantVideo; inbound_policy: InboundPolicy; media_defaults: CallMedia;
  default_line_id?: string | null;
  business_hours?: { timezone: string; weekly?: Record<string, { start: string; end: string }[]> } | null;
  maximum_call_duration_seconds?: number; safe_metadata?: Record<string, string | number | boolean>;
}
export interface CreateAssistant { name: string; description?: string | null; draft_config: AssistantConfig }
export interface UpdateAssistant {
  expected_draft_revision: number; name?: string; description?: string | null;
  status?: 'draft' | 'active' | 'paused' | 'archived'; draft_config?: AssistantConfig;
}
export interface Assistant {
  id: string; project_id: string; name: string; description: string | null;
  status: 'draft' | 'active' | 'paused' | 'archived'; draft_config: AssistantConfig;
  draft_revision: number; active_version_id: string | null; [key: string]: unknown;
}
