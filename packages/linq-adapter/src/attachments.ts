import type { AttachmentCreateResponse, AttachmentCreateParams, AttachmentRetrieveResponse, SupportedContentType } from '@linqapp/sdk/resources/attachments';
const contentTypes = new Set<string>(['image/jpeg', 'image/png', 'image/gif', 'image/heic', 'image/heif', 'image/tiff', 'image/bmp', 'image/svg+xml', 'image/webp', 'image/x-icon', 'video/mp4', 'video/quicktime', 'video/mpeg', 'video/mpeg2', 'video/x-m4v', 'video/x-msvideo', 'video/3gpp', 'audio/mpeg', 'audio/mp3', 'audio/x-m4a', 'audio/mp4', 'audio/x-caf', 'audio/x-wav', 'audio/x-aiff', 'audio/aiff', 'audio/aac', 'audio/midi', 'audio/amr', 'application/pdf', 'application/vnd.apple.pkpass', 'text/plain', 'text/markdown', 'text/vcard', 'text/rtf', 'text/csv', 'text/html', 'text/calendar', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/x-iwork-pages-sffpages', 'application/x-iwork-numbers-sffnumbers', 'application/x-iwork-keynote-sffkey', 'application/epub+zip', 'text/xml', 'application/json', 'application/zip', 'application/x-gzip']);
// Validate calendar and clock components without converting away database precision.
function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) return false;
  const day = value.slice(0, 10), parsedDay = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(parsedDay) && new Date(parsedDay).toISOString().slice(0, 10) === day && Number.isFinite(Date.parse(value));
}

export function attachmentMetadata(raw: unknown, id: string, baseURL: string): AttachmentRetrieveResponse | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = (raw as Record<string, unknown>).attachment;
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;
  if (r.attachment_id !== id || typeof r.filename !== 'string' || !r.filename.trim()
    || typeof r.content_type !== 'string' || !contentTypes.has(r.content_type)
    || typeof r.size_bytes !== 'number' || !Number.isSafeInteger(r.size_bytes) || r.size_bytes <= 0
    || !timestamp(r.created_at) || (r.uploaded_at !== null && !timestamp(r.uploaded_at))) return null;
  if (Object.hasOwn(r, 'download_url') && !validDownloadURL(r.download_url, id, baseURL)) return null;
  return { ...(typeof r.download_url === 'string' ? { download_url: r.download_url } : {}), id, filename: r.filename, content_type: r.content_type as SupportedContentType, size_bytes: r.size_bytes,
    created_at: r.created_at, status: r.uploaded_at === null ? 'pending' : 'complete' };
}

const createTypes = new Set<string>(["image/jpeg", "image/png", "image/gif", "image/heic", "image/heif", "image/webp", "image/avif", "image/tiff", "image/bmp", "image/svg+xml", "video/mp4", "video/quicktime", "video/webm", "audio/mpeg", "audio/m4a", "audio/wav", "audio/aac", "audio/flac", "audio/aiff", "audio/x-aiff", "audio/x-caf", "application/pdf", "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/zip"]);
export function validAttachmentCreate(value: unknown): value is AttachmentCreateParams {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return Object.keys(r).every(key => ['filename', 'content_type', 'size_bytes'].includes(key))
    && typeof r.filename === 'string' && r.filename.trim().length > 0 && r.filename.length <= 255
    && typeof r.content_type === 'string' && contentTypes.has(r.content_type) && createTypes.has(r.content_type)
    && typeof r.size_bytes === 'number' && Number.isSafeInteger(r.size_bytes) && r.size_bytes > 0 && r.size_bytes <= 100 * 1024 * 1024;
}
export function createdAttachment(raw: unknown, input: AttachmentCreateParams, config: { baseURL: string; apiKey: string; tenant?: string }): AttachmentCreateResponse | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.attachment_id !== 'string' || !/^[a-f0-9]{48}$/.test(r.attachment_id)
    || r.http_method !== 'PUT' || !timestamp(r.expires_at) || Date.parse(r.expires_at) <= Date.now()
    || Date.parse(r.expires_at) > Date.now() + 16 * 60_000) return null;
  const base = new URL(config.baseURL);
  if (base.pathname === '/') base.pathname = '/api/v1';
  const prefix = base.pathname.replace(/\/+$/, '') + `/attachments/${r.attachment_id}`;
  try {
    const upload = new URL(String(r.upload_url));
    if (upload.origin !== base.origin || upload.username || upload.password || upload.hash
      || upload.pathname !== `${prefix}/upload` || upload.search
      || !validDownloadURL(r.download_url, r.attachment_id, config.baseURL)) return null;
  } catch { return null; }
  const headers = r.required_headers;
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return null;
  const h = headers as Record<string, unknown>;
  if (Object.keys(h).some(key => !['authorization', 'content-type'].includes(key))
    || h['content-type'] !== input.content_type
    || (h.authorization !== 'Bearer <your-signing-secret>' && h.authorization !== `Bearer ${config.apiKey}`)) return null;
  return { attachment_id: r.attachment_id, upload_url: r.upload_url as string, download_url: r.download_url as string,
    expires_at: r.expires_at, http_method: 'PUT', required_headers: { authorization: `Bearer ${config.apiKey}`,
      'content-type': input.content_type, ...(config.tenant ? { 'x-chert-tenant': config.tenant } : {}) } };
}

function validDownloadURL(value: unknown, id: string, baseURL: string): value is string {
  if (typeof value !== 'string') return false;
  try {
    const base = new URL(baseURL), url = new URL(value);
    if (base.pathname === '/') base.pathname = '/api/v1';
    if (url.origin !== base.origin || url.username || url.password || url.hash
      || url.pathname !== `${base.pathname.replace(/\/+$/, '')}/attachments/${id}/download`) return false;
    const query = url.searchParams;
    return [...query].length === 2 && query.getAll('tenant').length === 1 && query.getAll('signature').length === 1
      && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(query.get('tenant') ?? '')
      && /^[a-f0-9]{64}$/.test(query.get('signature') ?? '');
  } catch { return false; }
}
