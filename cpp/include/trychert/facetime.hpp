#pragma once
#include <trychert/transport.hpp>
#include <cstdint>
#include <span>
#include <vector>

namespace trychert {
struct FaceTimeOptions {
    std::string base_url = "https://facetime.trychert.com";
    std::string api_key;
    std::string project_id;
    std::chrono::milliseconds timeout = std::chrono::seconds(15);
};
template<class T> struct Result {
    T data;
    std::string request_id;
    long status;
};
struct Pagination { int limit = 50; std::int64_t offset = 0; };
template<class T> struct Page {
    std::vector<T> items;
    std::int64_t total;
    int limit;
    std::int64_t offset;
};
struct Media { bool audio = true; bool video = false; };
enum class CallMode { managed, customer_managed };
enum class DestinationType { phone, email, apple_id, facetime_link };
enum class RecipientType { phone_number, email };
struct Recipient { RecipientType type; std::string value; };
struct RoomCredentials {
    std::string livekit_url;
    std::string participant_token;
    std::string remote_participant_identity;
};
struct CreateCall {
    CallMode mode = CallMode::customer_managed;
    std::optional<std::string> line_id;
    std::optional<std::string> assistant_id;
    std::optional<std::string> destination;
    std::optional<DestinationType> destination_type;
    std::vector<Recipient> recipients;
    Media media;
    bool authorized_test_call = false;
    std::optional<RoomCredentials> room;
};
enum class CallAction { answer, reject, end };
// Response status strings are open to future server values; never infer readiness.
struct Call {
    std::string id, project_id, direction, mode, status;
    Media media;
    std::optional<std::string> line_id, worker_id, assistant_id, terminal_reason;
    Json fields; // Exact additional fields, including media_status and lifecycle evidence.
    // Read-only screen-control consent state ("none" | "requested" | "granted"); there are no control operations.
    std::optional<std::string> screen_control;
};
struct CallEvent {
    std::string id, type, at, source;
    std::optional<std::int64_t> sequence;
};
struct CallEvents { std::string call_id; std::vector<CallEvent> events; };
struct TranscriptTurn { std::string occurred_at, speaker, text; };
struct Transcript {
    std::string call_id;
    int schema_version;
    std::vector<TranscriptTurn> turns;
    std::string created_at;
};
struct Line {
    std::string id, display_name, status;
    bool supports_audio, supports_video;
    Json fields;
};
struct Worker { std::string id, display_name, status; Json fields; };
enum class InboundPolicy { auto_answer, customer_decides, agent_decides, auto_reject };
enum class VideoFraming { fit, fill };
enum class ConnectingScreenDismissal { audio, video };
enum class ConnectingScreenAppearance { chert, black };
struct UpdateLine {
    std::optional<std::string> display_name;
    // Outer optional = omit; inner nullopt = explicitly clear the assignment.
    std::optional<std::optional<std::string>> assistant_id, integration_id;
    std::optional<InboundPolicy> inbound_policy;
    std::optional<VideoFraming> video_framing;
    std::optional<ConnectingScreenDismissal> connecting_screen_dismissal;
    std::optional<ConnectingScreenAppearance> connecting_screen_appearance;
};

// Custom media v1 is video-only. Endpoints are opaque: hand endpoint + token to a
// standard WHIP (RFC 9725) or experimental WHEP client; reuse the bearer on PATCH/DELETE.
enum class MediaDirection { publish, subscribe };
enum class VideoCodec { h264, vp8 };
// What a capability section can carry. `screen` on custom video means an agent can stream a
// screen (15 fps cap); on inbound caller video it means a `caller_screen` subscription is available.
enum class MediaContent { camera, screen };
// What a session carries. Publish: camera (default) or screen (capped at 15 fps). Subscribe:
// omit for the caller's video, or caller_screen for the caller's shared screen (only while sharing).
enum class MediaSessionContent { camera, screen, caller_screen };
struct CreateMediaSession {
    MediaDirection direction = MediaDirection::publish;
    // nullopt omits codecs; otherwise a non-empty ordered unique list.
    std::optional<std::vector<VideoCodec>> codecs;
    // nullopt omits content; publish allows camera/screen, subscribe allows only caller_screen.
    std::optional<MediaSessionContent> content = std::nullopt;
};
struct IceServer {
    std::vector<std::string> urls;
    std::optional<std::string> username, credential, credential_type;
};
struct MediaLimits { int max_width, max_height, max_fps, max_frame_bytes; };
// Session-bound bearer grant. Never log `token`; no stream operator is provided.
struct MediaSessionGrant {
    std::string session_id;
    MediaDirection direction;
    std::string endpoint, token;
    std::string connect_by, expires_at; // RFC 3339
    std::vector<IceServer> ice_servers;
    std::vector<VideoCodec> codecs;
    MediaLimits limits;
    std::optional<MediaSessionContent> content; // echo of the requested content; nullopt when absent
};
struct CustomVideoCapability {
    bool supported = true;
    std::vector<std::string> transports; // "whip" | "livekit"
    std::vector<VideoCodec> codecs;
    int max_width, max_height, max_fps;
    std::vector<MediaContent> contents{MediaContent::camera}; // what may be published; never empty
};
struct InboundCallerVideoCapability {
    bool supported = true;
    std::vector<std::string> transports; // "whep" | "livekit"
    int max_width, max_height, max_fps;
    std::vector<MediaContent> contents{MediaContent::camera}; // what may be received; never empty
};
// Absent sections are unsupported. Never infer support from supports_video.
struct MediaCapabilities {
    int version = 1;
    std::optional<CustomVideoCapability> custom_video;
    std::optional<InboundCallerVideoCapability> inbound_caller_video;
};
// Parses a raw `media_capabilities` value (for example
// `line.fields.value("media_capabilities", Json())`). Absent, malformed or
// unknown-version input is unsupported; a malformed section disables only itself.
[[nodiscard]] MediaCapabilities parse_media_capabilities(const Json& input);

enum class PixelFormat { i420, nv12, rgba, bgra };
enum class ColorSpace { bt709_limited, bt601_limited, srgb_full };
struct PlaneView { std::span<const std::uint8_t> data; int stride; };
struct VideoFrameInit {
    PixelFormat format;
    int width, height;
    std::vector<PlaneView> planes;
    std::int64_t timestamp_us; // Monotonic microseconds from the source clock.
    std::optional<std::int64_t> duration_us;
    int rotation = 0; // Clockwise degrees: 0, 90, 180 or 270.
    std::optional<ColorSpace> color_space; // Defaults: bt709-limited YUV, srgb-full RGB.
};
struct Plane { std::vector<std::uint8_t> data; int stride; };
struct VideoFrame {
    PixelFormat format;
    int width, height;
    std::vector<Plane> planes;
    std::int64_t timestamp_us;
    std::optional<std::int64_t> duration_us;
    int rotation;
    ColorSpace color_space;
};
inline constexpr int max_frame_bytes = 8 * 1024 * 1024;
class MediaFrameError final : public std::invalid_argument {
public:
    MediaFrameError(std::string code, const std::string& message);
    const std::string code; // "invalid_frame" | "frame_too_large"
};
void check_frame_dimensions(int width, int height);
// Validates and copies stride*(rows-1)+row_bytes bytes per plane; callers may reuse buffers.
[[nodiscard]] VideoFrame copy_video_frame(const VideoFrameInit& input);

class FaceTimeClient final : private detail::Transport {
    friend class Client;
public:
    explicit FaceTimeClient(FaceTimeOptions options);
    // Escape hatch for remaining customer control-plane routes. Unwraps the
    // FaceTime envelope, unlike IMessageClient::request. No auth/header overrides.
    [[nodiscard]] Result<Json> request(const std::string& path,
        std::optional<Json> body = std::nullopt, std::string method = {},
        std::optional<std::string> idempotency_key = std::nullopt) const;
    [[nodiscard]] Result<Page<Call>> list_calls(Pagination page = {}) const;
    [[nodiscard]] Result<Call> get_call(const std::string& id) const;
    [[nodiscard]] Result<Call> create_call(const CreateCall& input, const std::string& idempotency_key) const;
    // 202 is a queued command, not completion. Returns the current call snapshot.
    [[nodiscard]] Result<Call> act_on_call(const std::string& id, CallAction action,
        const std::string& idempotency_key, std::optional<std::string> reason = std::nullopt) const;
    [[nodiscard]] Result<CallEvents> get_call_events(const std::string& id) const;
    [[nodiscard]] Result<Transcript> get_transcript(const std::string& id) const;
    [[nodiscard]] Result<Page<Line>> list_lines(Pagination page = {}) const;
    [[nodiscard]] Result<Line> update_line(const std::string& id, const UpdateLine& input) const;
    [[nodiscard]] Result<Page<Worker>> list_workers(Pagination page = {}) const;
    // Mints one WHIP (publish) or experimental WHEP (subscribe) session for an
    // active call. Single attempt; an invalid grant throws ApiError "invalid_response".
    [[nodiscard]] Result<MediaSessionGrant> create_media_session(const std::string& call_id,
        const CreateMediaSession& input) const;
private:
    std::string project_id_;
};
} // namespace trychert
