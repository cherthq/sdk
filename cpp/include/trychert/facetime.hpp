#pragma once
#include <trychert/transport.hpp>
#include <cstdint>
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

class FaceTimeClient final : private detail::Transport {
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
private:
    std::string project_id_;
};
} // namespace trychert
