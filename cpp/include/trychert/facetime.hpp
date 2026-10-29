#pragma once
#include <trychert/transport.hpp>
#include <cstdint>
#include <span>
#include <variant>
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
struct DirectMedia {
    std::string media_url;
    std::string media_token;
    std::optional<std::string> remote_participant_identity;
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
    std::optional<DirectMedia> direct;
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

// Call video composition (draft, unreleased): the call's video as up to two layers, composed
// server-side and published through the call's single publish slot. A base layer (z 0) carries
// camera frames over a publish grant or a backend-managed source; page layers (z >= 1) are living
// sessions of ready deployments. Native SDKs do not deploy pages or drive page state/events/input.
inline constexpr std::size_t composition_max_layers = 2; // SDK v1 bound; the capability's max_layers is the backend limit
// camera: the response carries a publish grant for WHIP frames. managed: a backend-provided source,
// only where the video_composition capability lists it.
enum class CompositionBaseKind { camera, managed };
enum class CompositionBackground { opaque, transparent }; // transparent: premultiplied source-over
enum class LivingInputKind { pointer, keyboard, text };
enum class CompositionStatus { starting, live, stopping, stopped, failed };
enum class LivingSessionStatus { starting, ready, live, stopping, stopped, failed };
// Normalized to the output frame: 0..1, width/height > 0, and x+width, y+height <= 1.
struct CompositionRegion {
    double x = 0, y = 0, width = 1, height = 1;
    bool operator==(const CompositionRegion&) const = default;
};
struct BaseLayerInput { std::string id; CompositionBaseKind source = CompositionBaseKind::camera; };
// deployment_id names a ready living-service deployment: the call-video resource never loads a
// URL, and native SDKs cannot deploy one (deploy with the TypeScript SDK).
struct PageLayerInput {
    std::string id;
    int z = 1; // unique, 1..64; paints in ascending order above the base
    std::string deployment_id;
    std::optional<CompositionRegion> region;         // default: full frame
    std::optional<CompositionBackground> background; // default: opaque
    std::optional<double> opacity;                   // 0..1, default 1
    std::optional<std::vector<LivingInputKind>> input; // nullopt: non-interactive
    std::optional<Json> initial_state;               // plain JSON up to 64 KiB
};
using VideoLayerInput = std::variant<BaseLayerInput, PageLayerInput>;
// Set deployment_id (page shortcut: one opaque full-frame page layer, id "page", z 1) or layers.
// revision makes the PUT compare-and-set; it must equal the current revision.
struct SetCallVideo {
    std::optional<std::string> deployment_id;
    std::optional<std::vector<LivingInputKind>> input;
    std::optional<Json> initial_state;
    std::optional<std::vector<VideoLayerInput>> layers;
    std::optional<std::int64_t> revision;
};
struct LivingViewport { int width, height; };
// The living session rendering a page layer; effective viewport and fps.
struct LivingSession {
    std::string session_id, call_id, deployment_id;
    LivingSessionStatus status;
    LivingViewport viewport;
    int fps;
    std::optional<std::string> ready_at, last_heartbeat_at, error_code;
};
// Effective output: fps = min(base fps, grant limit); page layers render at or below it.
struct CompositionOutput { int width, height, fps; };
// Always at z 0. publish is a camera publish grant when the backend issues one; never log its token.
struct BaseLayer { std::string id; CompositionBaseKind source; std::optional<MediaSessionGrant> publish; };
struct PageLayer {
    std::string id;
    int z;
    LivingSession living_session;
    CompositionRegion region;
    CompositionBackground background;
    double opacity;
    std::vector<LivingInputKind> input;
};
using VideoLayer = std::variant<BaseLayer, PageLayer>;
struct CallVideoComposition {
    std::string composition_id, call_id;
    std::int64_t revision;
    CompositionStatus status;
    CompositionOutput output;
    std::vector<VideoLayer> layers;
    std::optional<std::string> error_code;
};
// Explicit, versioned video_composition capability. Never inferred from custom video or living services.
struct VideoCompositionCapability {
    int version = 1;
    bool supported = true;
    int max_layers;
    std::vector<CompositionBaseKind> bases;
    bool page_alpha, regions;
    int max_width, max_height, max_fps;
};
// Absent, malformed, unknown-version or unsupported input is nullopt. Unknown bases are ignored
// and larger limits clamp to SDK v1 bounds.
[[nodiscard]] std::optional<VideoCompositionCapability> parse_video_composition(const Json& input);
// The topmost page layer accepting pointer input under an output-frame point (x, y normalized
// 0..1), or nullptr. The backend maps output-frame coordinates into the page.
[[nodiscard]] const PageLayer* composition_input_target(const CallVideoComposition& composition, double x, double y);

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
    // Draft, unreleased: replaces the call's video with a server-side composition (PUT /calls/{id}/video).
    // Invalid input throws std::invalid_argument before any request; an invalid response throws
    // ApiError "invalid_response". Single attempt; never retried.
    [[nodiscard]] Result<CallVideoComposition> set_call_video(const std::string& call_id, const SetCallVideo& input,
        const std::string& idempotency_key) const;
    [[nodiscard]] Result<CallVideoComposition> get_call_video(const std::string& call_id) const;
    // Stops the composition and frees the publish slot.
    [[nodiscard]] Result<CallVideoComposition> clear_call_video(const std::string& call_id) const;
private:
    [[nodiscard]] Result<CallVideoComposition> call_video(const std::string& call_id, std::optional<Json> body,
        std::string method, std::optional<std::string> idempotency_key) const;
    std::string project_id_;
};
} // namespace trychert
