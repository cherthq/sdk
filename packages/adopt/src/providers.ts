export type Classification = 'drop_in' | 'native' | 'unsupported';
export type Outcome = { class: Classification; note: string };
export type Route = Outcome & { methods: string; path: string; host?: string; via?: string };
export type Method = Outcome & { op: string };

export type Provider = {
  id: string;
  name: string;
  adapter?: { package: string; version: string; kind: 'sdk' | 'fetch'; factory?: string; namedClients?: string[] };
  packages: string[];
  upstreamClients?: string[];
  otherPackages?: string[];
  hosts: string[];
  paths?: string[];
  routes: Route[];
  rawFallback: Outcome;
  methods: Method[];
  methodFallback?: Outcome;
  env: string[];
  keyPrefixes?: string[];
  webhook: Outcome & { keywords: string[]; fields?: Record<string, Classification> };
  blocked?: string;
};

const sendText = 'Use `new ChertClient({baseURL, apiKey}).sendText({phone, body})` from @cherthq/imessage (queued acceptance only, not delivery).';
const notMapped = (pkg: string): Outcome => ({ class: 'unsupported', note: `Not mapped by ${pkg}; the adapter rejects it with HTTP 501 before any Chert request.` });

export const CHERT_ENV = ['CHERT_BASE_URL', 'CHERT_API_KEY'];
export const CHERT_WEBHOOK_ENV = 'CHERT_WEBHOOK_SECRET';

// Legacy package names remain in the coverage table for workspace compatibility.
// New integrations install one SDK and import the equivalent adapter subpath.
export const sdkImport = (legacy: string) => legacy.replace('@cherthq/', '@trychert/sdk/');
export const SDK_VERSION = '0.1.0';

export const PROVIDERS: Provider[] = [
  {
    id: 'blooio', name: 'Blooio SDK 0.0.2',
    adapter: { package: '@cherthq/blooio-adapter', version: '0.1.0', kind: 'sdk', namedClients: ['Blooio'] },
    packages: ['@blooio/sdk'], upstreamClients: ['Blooio'], otherPackages: ['blooio'],
    hosts: ['backend.blooio.com'],
    routes: [{ methods: 'POST', path: '/v1/api/messages', class: 'native', note: `Raw legacy HTTP is not intercepted (the adapter wraps @blooio/sdk). ${sendText}` }],
    rawFallback: { class: 'unsupported', note: 'Raw legacy Blooio HTTP is not intercepted; @cherthq/blooio-adapter wraps the @blooio/sdk client only.' },
    methods: [
      { op: 'messages.send', class: 'drop_in', note: 'Canonical E.164 `to` and lossless text up to 16 KiB only; attachments/metadata reject. Chert line policy picks the sender.' },
      { op: 'messages.retrieve', class: 'drop_in', note: 'Tenant-scoped recorded read; requires a Chert message ID.' },
      { op: 'messages.getStatus', class: 'drop_in', note: 'Recorded lifecycle only; queued never becomes delivered.' },
      { op: 'me.retrieve', class: 'drop_in', note: 'Returns only `{valid}`; no billing/devices/credentials.' },
      { op: 'withOptions', class: 'drop_in', note: 'Keeps the Chert connection.' },
      { op: 'messages.cancel', class: 'unsupported', note: 'Message cancellation is rejected before any Chert request.' },
    ],
    methodFallback: notMapped('@cherthq/blooio-adapter'),
    env: ['BLOOIO_'],
    webhook: { keywords: ['blooio'], class: 'unsupported', note: 'Blooio webhooks are not implemented; Chert events are not Blooio payloads.' },
  },
  {
    id: 'blooio-v4', name: 'Blooio HTTP v4',
    adapter: { package: '@cherthq/blooio-v4-adapter', version: '0.1.0', kind: 'fetch', factory: 'createBlooioV4Fetch' },
    packages: [], hosts: ['api.blooio.com'],
    routes: [
      { methods: 'POST', path: '/v4/messages', class: 'drop_in', note: 'Explicit E.164 `from`/`to` and text; one owned PNG/JPEG subset. Protocol/no-fallback fields reject.' },
      { methods: 'POST', path: '/v4/chats/{}/messages/{}/reactions', class: 'unsupported', note: 'Reactions rejected: applied-result contract not established.' },
      { methods: 'POST|GET', path: '/v4/chats/{}/messages', class: 'drop_in', note: 'Existing Chert chat ID only (vendor chat IDs are not migrated); recorded history subset.' },
      { methods: 'GET', path: '/v4/chats/{}/messages/{}', class: 'drop_in', note: 'Recorded-message subset, not full Message metadata.' },
      { methods: 'GET', path: '/v4/chats/{}/messages/{}/status', class: 'drop_in', note: 'Recorded lifecycle only; no delivery/read inference.' },
      { methods: 'POST|DELETE', path: '/v4/chats/{}/typing', class: 'drop_in', note: 'Pinned one-to-one Chert chat; control acknowledgement only.' },
      { methods: 'GET', path: '/v4/chats/{}', class: 'drop_in', note: 'Owned direct-chat contact subset.' },
      { methods: 'GET', path: '/v4/contacts/{}', class: 'drop_in', note: 'Owned DM contact `id`/nullable `name` only.' },
      { methods: 'GET', path: '/v4/channels', class: 'drop_in', note: 'Unfiltered assigned-line inventory; filters/limits/cursors reject.' },
      { methods: 'GET', path: '/v4/channels/{}', class: 'drop_in', note: 'Assigned UUID/phone identity only.' },
      { methods: 'GET|PATCH|DELETE', path: '/v4/webhooks/{}', class: 'drop_in', note: 'Existing qualified Chert subscriptions only.' },
      { methods: '*', path: '/v4/webhooks', class: 'unsupported', note: 'Webhook creation/listing/rotation/replay is unsupported.' },
    ],
    rawFallback: notMapped('@cherthq/blooio-v4-adapter'),
    methods: [],
    env: ['BLOOIO_'],
    webhook: { keywords: ['blooio'], class: 'unsupported', note: 'v4 payload mapping is not provided; consume Chert webhook events and deduplicate by event ID.' },
  },
  {
    id: 'linq', name: 'Linq 0.78',
    adapter: { package: '@cherthq/linq-adapter', version: '0.1.0', kind: 'sdk', namedClients: [] },
    packages: ['@linqapp/sdk'], upstreamClients: ['LinqAPIV3'], otherPackages: ['linqapp'],
    hosts: ['api.linqapp.com'], routes: [],
    rawFallback: { class: 'unsupported', note: 'Raw Linq HTTP is not intercepted; move the call to the @linqapp/sdk client and use @cherthq/linq-adapter.' },
    methods: [
      { op: 'chats.messages.send', class: 'drop_in', note: 'Existing Chert chat ID; one unmodified text part, or one uploaded attachment in a DM.' },
      { op: 'chats.messages.list', class: 'drop_in', note: 'Metadata-complete recorded cursor subset; incomplete pages fail 502.' },
      { op: 'chats.typing.start', class: 'drop_in', note: 'Direct-chat acknowledgement subset.' },
      { op: 'chats.typing.stop', class: 'drop_in', note: 'Direct-chat acknowledgement subset.' },
      { op: 'chats.markAsRead', class: 'drop_in', note: 'Application acknowledgement, not a received read receipt.' },
      { op: 'messages.retrieve', class: 'drop_in', note: 'Metadata-complete recorded retrieval.' },
      { op: 'messages.addReaction', class: 'drop_in', note: 'Six standard part-zero reactions; custom emoji/stickers/nonzero parts reject.' },
      { op: 'phonenumbers.list', class: 'drop_in', note: 'Deprecated assigned-number list: actual `id`/`number` only.' },
      { op: 'attachments.create', class: 'drop_in', note: 'Registration only; caller PUTs bytes to the returned URL.' },
      { op: 'attachments.retrieve', class: 'drop_in', note: 'Metadata subset; IDs are Chert IDs.' },
      { op: 'webhooks.unwrap', class: 'drop_in', note: 'Standard Webhooks verification only; does not convert Chert callbacks into Linq events.' },
      { op: 'withOptions', class: 'drop_in', note: 'Keeps the Chert connection.' },
      { op: 'chats.create', class: 'native', note: `Linq chat creation is rejected (required chat health/participant metadata is unavailable). ${sendText}` },
      { op: 'phoneNumbers.list', class: 'unsupported', note: 'Modern reputation endpoint rejected: required provider reputation data is unavailable.' },
    ],
    methodFallback: notMapped('@cherthq/linq-adapter'),
    env: ['LINQ_'],
    webhook: { keywords: ['linq'], class: 'unsupported', note: 'Registration and payload mapping are unsupported; `webhooks.unwrap` only verifies signatures. Consume Chert events and deduplicate by event ID.' },
  },
  {
    id: 'sendblue', name: 'Sendblue 3.20',
    adapter: { package: '@cherthq/sendblue-adapter', version: '0.0.0', kind: 'sdk', namedClients: ['SendblueAPI'] },
    packages: ['sendblue'], upstreamClients: ['SendblueAPI'], otherPackages: ['sendblue'],
    hosts: ['api.sendblue.co', 'api.sendblue.com'],
    routes: [
      { methods: 'POST', path: '/api/send-reaction', class: 'drop_in', via: 'createSendblueReactionFetch(chertOptions)', note: 'Six standard reactions on received iMessages; needs matching Chert backend support.' },
      { methods: 'POST', path: '/api/send-message', class: 'native', note: `Raw HTTP is not intercepted (the adapter wraps the sendblue SDK). ${sendText}` },
    ],
    rawFallback: { class: 'unsupported', note: 'Raw Sendblue HTTP is not intercepted; move the call to the sendblue SDK client and use @cherthq/sendblue-adapter.' },
    methods: [
      { op: 'messages.send', class: 'drop_in', note: 'Explicit tenant-assigned `from_number`; text or one HTTPS media_url. Callbacks/send_style/reply fields reject.' },
      { op: 'messages.getStatus', class: 'drop_in', note: 'Recorded status subset.' },
      { op: 'messages.retrieve', class: 'drop_in', note: 'Recorded scalar subset plus one owned media URL.' },
      { op: 'messages.list', class: 'drop_in', note: 'Tenant-wide strict text/media offset subset.' },
      { op: 'typingIndicators.send', class: 'drop_in', note: 'Explicit sender/recipient start/stop; duration rejected.' },
      { op: 'withOptions', class: 'drop_in', note: 'Keeps the Chert connection.' },
    ],
    methodFallback: notMapped('@cherthq/sendblue-adapter'),
    env: ['SENDBLUE_'],
    webhook: {
      keywords: ['sendblue'], class: 'native',
      note: 'Replace Sendblue signature checks with `unwrapChert(rawBody, headers, {secret})` from @cherthq/sendblue-adapter (single-part inbound plaintext only; deduplicate by eventId).',
      fields: {
        message_handle: 'drop_in', from_number: 'drop_in', is_outbound: 'drop_in',
        to_number: 'unsupported', date_sent: 'unsupported', date_updated: 'unsupported', account_email: 'unsupported',
        send_style: 'unsupported', media_url: 'unsupported', sender_email: 'unsupported', seat_id: 'unsupported', thread_originator: 'unsupported',
      },
    },
  },
  {
    id: 'loopmessage', name: 'LoopMessage HTTP',
    adapter: { package: '@cherthq/loopmessage-adapter', version: '0.1.0', kind: 'fetch', factory: 'createLoopMessageFetch' },
    packages: [], otherPackages: ['loopmessage'], hosts: ['a.loopmessage.com', 'server.loopmessage.com'],
    routes: [
      { host: 'a.loopmessage.com', methods: 'POST', path: '/api/v1/message/send/', class: 'drop_in', note: 'Exactly `{contact, text, channel:"imessage"}`; reactions, attachments, sender IDs and options reject.' },
      { host: 'a.loopmessage.com', methods: 'GET', path: '/api/v1/message/status/{}/', class: 'drop_in', note: 'Recorded status subset; 32-hex Chert message IDs only.' },
    ],
    rawFallback: { class: 'unsupported', note: 'Not mapped by @cherthq/loopmessage-adapter (only https://a.loopmessage.com send/status); rejects with 501 before dispatch.' },
    methods: [],
    env: ['LOOPMESSAGE_', 'LOOP_MESSAGE_'],
    webhook: { keywords: ['loopmessage', 'loop-message'], class: 'unsupported', note: 'LoopMessage webhooks are unsupported; consume Chert events and deduplicate by event ID.' },
  },
  {
    id: 'missblue', name: 'MissBlue HTTP',
    adapter: { package: '@cherthq/missblue-adapter', version: '0.1.0', kind: 'fetch', factory: 'createMissBlueFetch' },
    packages: [], otherPackages: ['missblue'], hosts: ['api.missblue.dev'],
    routes: [
      { methods: 'POST', path: '/v1/messages', class: 'drop_in', note: 'Exactly `{number_id, recipient, text}`. Source-line UUID binding is not atomic; unsuitable where frozen line identity is required.' },
      { methods: 'GET', path: '/v1/messages/{}', class: 'drop_in', note: 'Recorded outbound plaintext; Chert public message IDs only.' },
      { methods: 'GET', path: '/v1/numbers', class: 'drop_in', note: 'Owned iMessage inventory only.' },
      { methods: 'POST', path: '/v1/typing', class: 'drop_in', note: 'Exactly `{chat_id, active}` for an owned Chert chat.' },
    ],
    rawFallback: notMapped('@cherthq/missblue-adapter'),
    methods: [],
    env: ['MISSBLUE_', 'MISS_BLUE_'],
    webhook: { keywords: ['missblue', 'miss-blue'], class: 'unsupported', note: 'MissBlue callbacks/webhooks are unsupported; consume Chert events and deduplicate by event ID.' },
  },
  {
    id: 'texting-blue', name: 'Texting Blue',
    adapter: { package: '@cherthq/texting-blue-adapter', version: '0.1.0', kind: 'fetch', factory: 'createTextingBlueFetch' },
    packages: [], hosts: ['api.texting.blue'],
    routes: [
      { methods: 'POST', path: '/v1/messages/send', class: 'drop_in', note: 'Exactly `{to, from, content}` with distinct E.164 numbers; `media_url` (even null) rejects.' },
      { methods: 'GET', path: '/v1/messages', class: 'unsupported', note: 'Rejected: Chert records lack the sender phone and `delivered_at` clock the response requires.' },
      { methods: 'GET', path: '/v1/messages/{}', class: 'unsupported', note: 'Rejected: Chert records lack the sender phone and `delivered_at` clock the response requires.' },
    ],
    rawFallback: notMapped('@cherthq/texting-blue-adapter'),
    methods: [], env: [], keyPrefixes: ['tb_live_'],
    webhook: { keywords: ['texting-blue', 'textingblue'], class: 'unsupported', note: 'Texting Blue webhooks and signature verification are unsupported; consume Chert events and deduplicate by event ID.' },
  },
  {
    id: 'contiguity', name: 'Contiguity iMessage',
    adapter: { package: '@cherthq/contiguity-adapter', version: '0.1.0', kind: 'fetch', factory: 'createContiguityFetch' },
    packages: [], hosts: ['api.contiguity.com'],
    routes: [
      { methods: 'POST', path: '/send/imessage', class: 'drop_in', note: 'Keys `{to, from?, message}` only; fallback/attachments/effect/fast_track and markdown-style text reject. Chert never falls back to SMS/RCS.' },
      { methods: 'POST', path: '/send/imessage/typing', class: 'drop_in', note: 'Exactly `{to, from, action}` with explicit E.164 `from`.' },
      { methods: 'POST', path: '/send/imessage/reactions', class: 'unsupported', note: 'Rejected: targets the latest message matching content, which Chert cannot resolve to an owned message ID.' },
    ],
    rawFallback: notMapped('@cherthq/contiguity-adapter'),
    methods: [], env: [],
    webhook: { keywords: ['contiguity'], class: 'unsupported', note: 'Contiguity webhooks are unsupported; consume Chert events and deduplicate by event ID.' },
  },
  {
    id: 'bluereacher', name: 'Blue Reacher',
    adapter: { package: '@cherthq/bluereacher-adapter', version: '0.1.0', kind: 'fetch', factory: 'createBlueReacherFetch' },
    packages: [], hosts: ['api.bluereacher.com'],
    routes: [
      { methods: 'POST', path: '/v1/messages', class: 'drop_in', note: 'Exactly `{to, message, send_mode:"instant", device_id}` with an owned Chert line UUID; drip (the provider default), auto-balanced lines and media reject.' },
      { methods: '*', path: '/v1/typing', class: 'unsupported', note: 'Rejected: auto-expiring typing windows cannot be represented by Chert start/stop typing.' },
    ],
    rawFallback: notMapped('@cherthq/bluereacher-adapter'),
    methods: [], env: [], keyPrefixes: ['brk_live_', 'brk_test_'],
    webhook: { keywords: ['bluereacher', 'blue-reacher'], class: 'unsupported', note: 'Blue Reacher webhooks are unsupported; consume Chert events and deduplicate by event ID.' },
  },
  {
    id: 'jared', name: 'Jared (self-hosted)',
    adapter: { package: '@cherthq/jared-adapter', version: '0.1.0', kind: 'fetch', factory: 'createJaredFetch' },
    packages: [], hosts: ['localhost:3005', '127.0.0.1:3005'],
    routes: [{ methods: 'POST', path: '/message', class: 'drop_in', via: "createJaredFetch({origin: 'http://localhost:3005', chert})", note: 'Exactly `{body:{message}, recipient:{handle}}` to an E.164 phone; email/group handles and attachments reject.' }],
    rawFallback: notMapped('@cherthq/jared-adapter'),
    methods: [], env: [],
    webhook: { keywords: ['jared'], class: 'unsupported', note: 'Jared outbound webhooks, routes and plugins are not part of the adapter.' },
  },
  {
    id: 'photon', name: 'Photon / Spectrum',
    packages: ['spectrum-ts', '@spectrum-ts/*', '@photon-ai/*'], hosts: [], routes: [], methods: [],
    rawFallback: { class: 'unsupported', note: 'No drop-in adapter.' },
    env: ['PHOTON_', 'SPECTRUM_'],
    webhook: { keywords: ['photon', 'spectrum'], class: 'unsupported', note: 'No drop-in adapter.' },
    blocked: 'Unsupported for drop-in: Photon message records need native facts Chert queue receipts cannot supply, and Chert is not Photon gRPC compatible (Chert SDK docs/PROVIDER_RESEARCH.md).',
  },
  {
    id: 'bluebubbles', name: 'BlueBubbles',
    packages: ['bluebubbles*', '@bluebubbles/*'], otherPackages: ['bluebubbles', 'imessage-rs'], hosts: [],
    paths: ['/api/v1/message/text', '/api/v1/message/query', '/api/v1/server/info'], routes: [], methods: [],
    rawFallback: { class: 'unsupported', note: 'No drop-in adapter.' },
    env: ['BLUEBUBBLES_', 'BB_SERVER_'],
    webhook: { keywords: ['bluebubbles'], class: 'unsupported', note: 'No drop-in adapter.' },
    blocked: 'Unsupported for drop-in: BlueBubbles reads need native message metadata Chert does not expose, and sends need a completed send result (Chert SDK docs/PROVIDER_RESEARCH.md).',
  },
  ...([
    ['messageblue', 'MessageBlue', ['api.messageblue.ai'], 'success means native completion with Apple GUIDs; typing auto-expires'],
    ['inkbox', 'Inkbox', ['inkbox.ai'], 'identity/router/assignment facts Chert does not have'],
    ['claw-messenger', 'Claw Messenger', ['claw-messenger.onrender.com'], 'sends are WebSocket-only with fallback by default'],
    ['sendimessage', 'SendiMessage', ['api.sendimessage.com'], 'SMS fallback cannot be disabled'],
    ['tuco', 'Tuco AI', ['app.tuco.ai'], 'lead/workspace multi-channel model'],
    ['textlink', 'TextLink / Blububl', ['textlinksms.com'], 'send contract is an SMS API with implicit routing'],
    ['beeper', 'Beeper Desktop API', ['localhost:23373'], 'opaque multi-network chat IDs with no owned-chat mapping'],
  ] as const).map(([id, name, hosts, reason]): Provider => ({
    id, name, packages: [], hosts: [...hosts], routes: [], methods: [], env: [],
    rawFallback: { class: 'unsupported', note: 'No drop-in adapter.' },
    webhook: { keywords: [], class: 'unsupported', note: 'No drop-in adapter.' },
    blocked: `Unsupported for drop-in: ${reason} (Chert SDK docs/PROVIDER_RESEARCH.md).`,
  })),
];

export const PROVIDER_IDS = PROVIDERS.filter(p => p.adapter).map(p => p.id);
