#include <trychert/facetime.hpp>
#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <functional>
#include <limits>
#include <string_view>

namespace trychert {
namespace {
void require(bool value) {
    if (!value) throw std::invalid_argument("Invalid FaceTime input or response shape");
}
std::string uuid(std::string value) {
    require(value.size() == 36);
    for (std::size_t i = 0; i < value.size(); ++i) {
        auto& c = value[i];
        if (i == 8 || i == 13 || i == 18 || i == 23) require(c == '-');
        else {
            require((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'));
            if (c >= 'A' && c <= 'F') c = static_cast<char>(c - 'A' + 'a');
        }
    }
    return value;
}
void text(const std::string& value, std::size_t maximum, bool empty = false) {
    require((empty || !value.empty()) && value.size() <= maximum && value.find('\0') == value.npos);
    try { static_cast<void>(Json(value).dump()); }
    catch (const Json::exception&) { require(false); }
}
void key(const std::string& value) {
    require(value.size() >= 8 && value.size() <= 200 && value.front() != ' ' && value.back() != ' ');
    require(std::all_of(value.begin(), value.end(), [](unsigned char c) { return c >= 32 && c <= 126; }));
}
void direct_media_url(const std::string& value) {
    text(value, 2048);
    const bool secure = value.starts_with("wss://");
    require(secure || value.starts_with("ws://"));
    const auto rest = std::string_view(value).substr(secure ? 6 : 5);
    const auto authority = rest.substr(0, rest.find_first_of("/?"));
    require(!authority.empty() && value.find('#') == value.npos && authority.find('@') == authority.npos);
    require(std::all_of(value.begin(), value.end(), [](unsigned char c) { return c > 32 && c < 127; }));
    const auto host = authority.starts_with("[") ? authority.substr(0, authority.find(']') + 1)
                                                 : authority.substr(0, authority.find(':'));
    require(!host.empty() && host != "[" && (secure || host == "localhost" || host == "127.0.0.1" || host == "[::1]"));
}
template<class E, std::size_t N> std::string name(E value, const std::array<std::string_view, N>& names) {
    const auto index = static_cast<std::size_t>(value);
    require(index < N);
    return std::string(names[index]);
}
std::string query(Pagination page) {
    require(page.limit >= 1 && page.limit <= 100 && page.offset >= 0 && page.offset <= 9007199254740991LL);
    return "?limit=" + std::to_string(page.limit) + "&offset=" + std::to_string(page.offset);
}
std::string string(const Json& value, const char* field) {
    return value.at(field).get<std::string>();
}
std::optional<std::string> nullable_string(const Json& value, const char* field) {
    const auto& item = value.at(field);
    return item.is_null() ? std::nullopt : std::optional(item.get<std::string>());
}
std::int64_t integer(const Json& value) {
    require(value.is_number_integer());
    if (value.is_number_unsigned()) require(value.get<std::uint64_t>() <= 9007199254740991ULL);
    const auto number = value.get<std::int64_t>();
    require(number >= 0 && number <= 9007199254740991LL);
    return number;
}
Call call(const Json& value) {
    return {uuid(string(value, "id")), uuid(string(value, "project_id")), string(value, "direction"),
        string(value, "mode"), string(value, "status"),
        {value.at("media").at("audio").get<bool>(), value.at("media").at("video").get<bool>()},
        nullable_string(value, "line_id"), nullable_string(value, "worker_id"),
        nullable_string(value, "assistant_id"), nullable_string(value, "terminal_reason"), value,
        value.contains("screen_control") && value.at("screen_control").is_string()
            ? std::optional(value.at("screen_control").get<std::string>()) : std::nullopt};
}
Line line(const Json& value) {
    return {uuid(string(value, "id")), string(value, "display_name"), string(value, "status"),
        value.at("supports_audio").get<bool>(), value.at("supports_video").get<bool>(), value};
}
Worker worker(const Json& value) {
    return {uuid(string(value, "id")), string(value, "display_name"), string(value, "status"), value};
}
template<class Decode> auto decode(Result<Json> result, Decode parse, long expected = 200) {
    using T = decltype(parse(result.data));
    try {
        require(result.status == expected);
        return Result<T>{parse(result.data), result.request_id, result.status};
    } catch (const Json::exception&) {
        throw ApiError(502, "invalid_response", result.request_id, std::move(result.data));
    } catch (const std::invalid_argument&) {
        throw ApiError(502, "invalid_response", result.request_id, std::move(result.data));
    }
}
template<class Decode> auto page(const Json& value, Decode parse) {
    using T = decltype(parse(value));
    const auto limit = integer(value.at("limit"));
    require(limit >= 1 && limit <= 100 && value.at("items").is_array());
    Page<T> result{{}, integer(value.at("total")), static_cast<int>(limit), integer(value.at("offset"))};
    require(value.at("items").size() <= static_cast<std::size_t>(limit));
    for (const auto& item : value.at("items")) result.items.push_back(parse(item));
    return result;
}
Json create_body(const CreateCall& input) {
    const auto mode = name(input.mode, std::to_array<std::string_view>({"managed", "customer_managed"}));
    Json body{{"direction", "outbound"}, {"mode", mode},
        {"media", {{"audio", input.media.audio}, {"video", input.media.video}}},
        {"authorized_test_call", input.authorized_test_call}};
    if (input.line_id) body["line_id"] = uuid(*input.line_id);
    if (input.assistant_id) body["assistant_id"] = uuid(*input.assistant_id);
    require(input.mode == CallMode::managed ? input.assistant_id.has_value() && !input.room && !input.direct : !input.assistant_id);
    if (!input.recipients.empty()) {
        require(!input.destination && !input.destination_type && input.line_id && input.recipients.size() <= 31);
        body["recipients"] = Json::array();
        for (const auto& recipient : input.recipients) {
            text(recipient.value, 160);
            body["recipients"].push_back({{"type", name(recipient.type,
                std::to_array<std::string_view>({"phone_number", "email"}))}, {"value", recipient.value}});
        }
    } else {
        require(input.destination.has_value());
        const bool link = input.destination_type == DestinationType::facetime_link;
        text(*input.destination, link ? 4096 : 160);
        require(input.destination->size() >= 3);
        if (link) require(input.line_id && input.destination->starts_with("https://facetime.apple.com/join#")
            && input.destination->size() > std::string_view("https://facetime.apple.com/join#").size());
        body["destination"] = *input.destination;
        if (input.destination_type) body["destination_type"] = name(*input.destination_type,
            std::to_array<std::string_view>({"phone", "email", "apple_id", "facetime_link"}));
    }
    require(!(input.room && input.direct));
    if (input.mode == CallMode::customer_managed && !input.authorized_test_call) require(input.line_id && (input.room || input.direct));
    if (input.room) {
        require(input.mode == CallMode::customer_managed && input.line_id && input.media.audio && !input.authorized_test_call);
        text(input.room->livekit_url, 4096);
        text(input.room->participant_token, 32768);
        text(input.room->remote_participant_identity, 1024);
        body["livekit_url"] = input.room->livekit_url;
        body["participant_token"] = input.room->participant_token;
        body["remote_participant_identity"] = input.room->remote_participant_identity;
    }
    if (input.direct) {
        require(input.mode == CallMode::customer_managed && input.line_id && input.media.audio && !input.authorized_test_call);
        direct_media_url(input.direct->media_url);
        const auto& token = input.direct->media_token;
        require(token.size() >= 16 && token.size() <= 4096
            && std::all_of(token.begin(), token.end(), [](unsigned char c) { return c >= 32 && c <= 126; }));
        body["media_transport"] = "direct";
        body["media_url"] = input.direct->media_url;
        body["media_token"] = token;
        if (const auto& identity = input.direct->remote_participant_identity) {
            text(*identity, 1024);
            require(std::any_of(identity->begin(), identity->end(), [](unsigned char c) { return !std::isspace(c); }));
            body["remote_participant_identity"] = *identity;
        }
    }
    // Credential validity, destination canonicalization, ownership and capability
    // admission remain server decisions. Never retry a rejected/uncertain call.
    return body;
}
// JavaScript Number.isInteger(v) && 0 < v <= max.
std::optional<int> js_integer(const Json& owner, const char* field, int max) {
    if (!owner.is_object() || !owner.contains(field) || !owner.at(field).is_number()) return std::nullopt;
    const auto number = owner.at(field).get<double>();
    if (!std::isfinite(number) || number <= 0 || number > max || std::trunc(number) != number) return std::nullopt;
    return static_cast<int>(number);
}
std::optional<std::vector<std::string>> allowed_list(const Json& owner, const char* field,
                                                     std::initializer_list<std::string_view> allowed) {
    if (!owner.contains(field) || !owner.at(field).is_array()) return std::nullopt;
    std::vector<std::string> result;
    for (const auto& item : owner.at(field)) {
        if (!item.is_string()) return std::nullopt;
        const auto& value = item.get_ref<const std::string&>();
        if (std::find(allowed.begin(), allowed.end(), value) == allowed.end()) return std::nullopt;
        if (std::find(result.begin(), result.end(), value) == result.end()) result.push_back(value);
    }
    return result;
}
VideoCodec codec(const std::string& value) {
    require(value == "h264" || value == "vp8");
    return value == "h264" ? VideoCodec::h264 : VideoCodec::vp8;
}
bool digits(std::string_view value, std::size_t at, std::size_t count, int& out) {
    if (at + count > value.size()) return false;
    out = 0;
    for (std::size_t i = at; i < at + count; ++i) {
        if (value[i] < '0' || value[i] > '9') return false;
        out = out * 10 + (value[i] - '0');
    }
    return true;
}
// RFC 3339 date-time: YYYY-MM-DDTHH:MM:SS[.frac](Z|+HH:MM|-HH:MM), T/Z case-insensitive as in
// the reference SDK. Returns Unix milliseconds (fraction truncated, as JavaScript Date.parse).
std::optional<std::int64_t> rfc3339(std::string_view value) {
    int year, month, day, hour, minute, second, offset_hour = 0, offset_minute = 0;
    if (!digits(value, 0, 4, year) || value.size() < 20 || value[4] != '-' || !digits(value, 5, 2, month) || value[7] != '-'
        || !digits(value, 8, 2, day) || (value[10] != 'T' && value[10] != 't') || !digits(value, 11, 2, hour) || value[13] != ':'
        || !digits(value, 14, 2, minute) || value[16] != ':' || !digits(value, 17, 2, second)) return std::nullopt;
    std::size_t at = 19;
    std::int64_t millis = 0;
    if (value[at] == '.') {
        const auto start = ++at;
        while (at < value.size() && value[at] >= '0' && value[at] <= '9') {
            if (at - start < 3) millis = millis * 10 + (value[at] - '0');
            ++at;
        }
        if (at == start) return std::nullopt;
        for (auto n = at - start; n < 3; ++n) millis *= 10;
    }
    if (at == value.size()) return std::nullopt;
    int sign = 0;
    if (value[at] == 'Z' || value[at] == 'z') { if (at + 1 != value.size()) return std::nullopt; }
    else if ((value[at] != '+' && value[at] != '-') || at + 6 != value.size() || !digits(value, at + 1, 2, offset_hour)
             || value[at + 3] != ':' || !digits(value, at + 4, 2, offset_minute) || offset_hour > 23 || offset_minute > 59) return std::nullopt;
    else sign = value[at] == '+' ? 1 : -1;
    const bool leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    const int days[] = {31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) return std::nullopt;
    // Days since 1970-01-01 (proleptic Gregorian civil calendar).
    const std::int64_t y = month <= 2 ? year - 1 : year;
    const std::int64_t era = (y >= 0 ? y : y - 399) / 400, yoe = y - era * 400;
    const std::int64_t doy = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1;
    const std::int64_t epoch_days = era * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719468;
    const std::int64_t seconds = epoch_days * 86400 + hour * 3600 + minute * 60 + second - sign * (offset_hour * 3600 + offset_minute * 60);
    return seconds * 1000 + millis;
}
// Absolute HTTPS URL (HTTP only for loopback hosts) without user information or fragment.
bool media_endpoint(std::string_view url) {
    if (std::any_of(url.begin(), url.end(), [](unsigned char c) { return c <= 32 || c >= 127; })) return false;
    const auto separator = url.find("://");
    if (separator == url.npos) return false;
    std::string scheme(url.substr(0, separator));
    std::transform(scheme.begin(), scheme.end(), scheme.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    const auto rest = url.substr(separator + 3);
    const auto authority = rest.substr(0, rest.find_first_of("/?#"));
    const auto hash = url.find('#');
    if (authority.empty() || authority.find('@') != authority.npos || (hash != url.npos && hash + 1 < url.size())) return false;
    std::string host(authority.front() == '[' ? authority.substr(0, authority.find(']') + 1) : authority.substr(0, authority.find(':')));
    if (host.empty() || (host.front() == '[' && host.back() != ']')) return false;
    const auto port = authority.substr(host.size());
    if (!port.empty() && (port.front() != ':' || !std::all_of(port.begin() + 1, port.end(), [](char c) { return c >= '0' && c <= '9'; })))
        return false;
    std::transform(host.begin(), host.end(), host.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return scheme == "https" || (scheme == "http" && (host == "localhost" || host == "127.0.0.1" || host == "[::1]"));
}
const char* content_wire(MediaSessionContent content) {
    switch (content) {
        case MediaSessionContent::camera: return "camera";
        case MediaSessionContent::screen: return "screen";
        case MediaSessionContent::caller_screen: return "caller_screen";
    }
    throw std::invalid_argument("Invalid media session content");
}
MediaSessionGrant grant(const Json& value, MediaDirection direction, const std::optional<std::vector<VideoCodec>>& requested,
                        std::optional<MediaSessionContent> content) {
    require(value.is_object());
    // A requested content must be echoed exactly; a default request accepts no echo or camera (either direction).
    const bool echoed = value.contains("content");
    const auto echo = echoed && value.at("content").is_string() ? value.at("content").get<std::string>() : std::string();
    require(content ? echoed && echo == content_wire(*content) : !echoed || echo == "camera");
    const auto granted = content ? content : echoed ? std::optional(MediaSessionContent::camera) : std::nullopt;
    const auto wire = direction == MediaDirection::publish ? "publish" : "subscribe";
    const auto id = string(value, "session_id");
    require(string(value, "direction") == wire && id.size() == 36);
    require(std::all_of(id.begin(), id.end(), [](char c) {
        return c == '-' || (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'); }));
    MediaSessionGrant result{id, direction, string(value, "endpoint"), string(value, "token"),
        string(value, "connect_by"), string(value, "expires_at"), {}, {}, {}, granted};
    require(media_endpoint(result.endpoint) && !result.token.empty() && result.token.find_first_of("\r\n") == std::string::npos);
    const auto connect_by = rfc3339(result.connect_by), expires_at = rfc3339(result.expires_at);
    require(connect_by && expires_at && *connect_by <= *expires_at && value.at("ice_servers").is_array());
    for (const auto& item : value.at("ice_servers")) {
        require(item.is_object());
        IceServer server;
        const auto& urls = item.at("urls");
        if (urls.is_string()) server.urls.push_back(urls.get<std::string>());
        else {
            require(urls.is_array() && !urls.empty());
            for (const auto& url : urls) server.urls.push_back(url.get<std::string>());
        }
        // Optional fields must be absent or strings (JSON null rejects); credentialType is only "password".
        const auto optional = [&](const char* field) {
            return item.contains(field) ? std::optional(item.at(field).get<std::string>()) : std::nullopt;
        };
        server.username = optional("username");
        server.credential = optional("credential");
        server.credential_type = optional("credentialType");
        require(!server.credential_type || *server.credential_type == "password");
        result.ice_servers.push_back(std::move(server));
    }
    require(value.at("codecs").is_array() && !value.at("codecs").empty());
    for (const auto& item : value.at("codecs")) {
        const auto parsed = codec(item.get<std::string>());
        require(std::find(result.codecs.begin(), result.codecs.end(), parsed) == result.codecs.end());
        if (requested) require(std::find(requested->begin(), requested->end(), parsed) != requested->end());
        result.codecs.push_back(parsed);
    }
    const auto publish = direction == MediaDirection::publish;
    const auto& limits = value.at("limits");
    const auto width = js_integer(limits, "max_width", publish ? 1920 : 1280);
    const auto height = js_integer(limits, "max_height", publish ? 1080 : 720);
    const auto fps = js_integer(limits, "max_fps", granted == MediaSessionContent::screen ? 15 : 30);
    const auto bytes = js_integer(limits, "max_frame_bytes", max_frame_bytes);
    require(width && height && fps && bytes);
    result.limits = {*width, *height, *fps, *bytes};
    return result;
}
// Raw response data is never returned. Server error responses (parsed bodies) keep their
// status and an allowlisted code, else request_failed; local failures keep their code.
[[noreturn]] void sanitized(const ApiError& error) {
    static constexpr std::array<std::string_view, 30> safe = {"unauthorized", "forbidden", "cli_scope_denied",
        "billing_owner_required", "billing_unavailable", "project_required", "invalid_request", "cli_login_expired",
        "cli_login_not_found", "cli_login_forbidden", "slow_down", "cli_login_rate_limited", "cli_login_busy", "not_found",
        "conflict", "media_capability_unsupported", "media_session_conflict", "caller_screen_not_shared", "media_content_unsupported", "caller_screen_unsupported", "media_limit_exceeded", "call_not_active", "call_ended",
        "call_not_found", "media_session_expired", "media_transport_unavailable", "video_composition_unsupported",
        "composition_invalid", "composition_revision_conflict", "composition_base_unavailable"};
    auto request_id = error.request_id;
    if (error.data.is_object() && error.data.contains("request_id") && error.data["request_id"].is_string())
        request_id = error.data["request_id"].get<std::string>();
    const bool server = error.status >= 300 && !error.data.is_null();
    const bool allowed = std::find(safe.begin(), safe.end(), error.code) != safe.end();
    throw ApiError(error.status, server && !allowed ? "request_failed" : error.code, std::move(request_id));
}
} // namespace

FaceTimeClient::FaceTimeClient(FaceTimeOptions options)
    : Transport(std::move(options.base_url), std::move(options.api_key), uuid(options.project_id),
                options.timeout, detail::Scope::project), project_id_(uuid(std::move(options.project_id))) {}

Result<Json> FaceTimeClient::request(const std::string& path, std::optional<Json> body,
                                    std::string method, std::optional<std::string> idempotency_key) const {
    if (idempotency_key) key(*idempotency_key);
    detail::Response result;
    try { result = request_with_response(path, std::move(body), std::move(method), std::move(idempotency_key)); }
    catch (const ApiError& error) {
        // Control-plane request IDs are in the JSON envelope, not necessarily a header.
        auto id = error.request_id;
        if (error.data.is_object() && error.data.contains("request_id") && error.data["request_id"].is_string())
            id = error.data["request_id"].get<std::string>();
        throw ApiError(error.status, error.code, std::move(id), error.data);
    }
    if (!result.data || !result.data->is_object() || !result.data->contains("data")
        || result.data->contains("error") || !result.data->contains("request_id")
        || !result.data->at("request_id").is_string() || result.data->at("request_id").get_ref<const std::string&>().empty())
        throw ApiError(502, "invalid_response", result.request_id, result.data.value_or(Json(nullptr)));
    return {result.data->at("data"), result.data->at("request_id").get<std::string>(), result.status};
}
Result<Page<Call>> FaceTimeClient::list_calls(Pagination pagination) const {
    return decode(request("/calls" + query(pagination)), [&](const Json& data) {
        auto result = page(data, call);
        for (const auto& item : result.items) require(item.project_id == project_id_);
        return result;
    });
}
Result<Call> FaceTimeClient::get_call(const std::string& id) const {
    const auto expected = uuid(id);
    return decode(request("/calls/" + expected), [&](const Json& data) {
        auto result = call(data);
        require(result.id == expected && result.project_id == project_id_);
        return result;
    });
}
Result<Call> FaceTimeClient::create_call(const CreateCall& input, const std::string& idempotency_key) const {
    key(idempotency_key);
    return decode(request("/calls", create_body(input), "POST", idempotency_key), [&](const Json& data) {
        auto result = call(data);
        require(result.project_id == project_id_ && result.direction == "outbound"
            && result.mode == (input.mode == CallMode::managed ? "managed" : "customer_managed")
            && result.media.audio == input.media.audio && result.media.video == input.media.video);
        if (input.line_id) require(result.line_id && uuid(*result.line_id) == uuid(*input.line_id));
        return result;
    }, 201);
}
Result<Call> FaceTimeClient::act_on_call(const std::string& id, CallAction action,
    const std::string& idempotency_key, std::optional<std::string> reason) const {
    key(idempotency_key);
    auto body = Json::object();
    if (reason) { text(*reason, 160, true); body["reason"] = *reason; }
    const auto expected = uuid(id);
    return decode(request("/calls/" + expected + "/" + name(action,
        std::to_array<std::string_view>({"answer", "reject", "end"})), body, "POST", idempotency_key),
        [&](const Json& data) {
            auto result = call(data);
            require(result.id == expected && result.project_id == project_id_);
            return result;
        }, 202);
}
Result<CallEvents> FaceTimeClient::get_call_events(const std::string& id) const {
    const auto expected = uuid(id);
    return decode(request("/calls/" + expected + "/events"), [&](const Json& data) {
        CallEvents result{uuid(string(data, "call_id")), {}};
        require(result.call_id == expected && data.at("events").is_array());
        for (const auto& item : data.at("events")) {
            const auto& sequence = item.at("sequence");
            result.events.push_back({string(item, "id"), string(item, "type"), string(item, "at"),
                string(item, "source"), sequence.is_null() ? std::nullopt : std::optional(integer(sequence))});
        }
        return result;
    });
}
Result<Transcript> FaceTimeClient::get_transcript(const std::string& id) const {
    const auto expected = uuid(id);
    return decode(request("/calls/" + expected + "/transcript"), [&](const Json& data) {
        require(integer(data.at("schema_version")) == 1 && data.at("turns").is_array());
        Transcript result{uuid(string(data, "call_id")), 1, {}, string(data, "created_at")};
        require(result.call_id == expected);
        for (const auto& item : data.at("turns")) {
            const auto speaker = string(item, "speaker");
            require(speaker == "caller" || speaker == "agent");
            result.turns.push_back({string(item, "occurred_at"), speaker, string(item, "text")});
        }
        return result;
    });
}
Result<Page<Line>> FaceTimeClient::list_lines(Pagination pagination) const {
    return decode(request("/lines" + query(pagination)), [](const Json& data) { return page(data, line); });
}
Result<Page<Worker>> FaceTimeClient::list_workers(Pagination pagination) const {
    return decode(request("/workers" + query(pagination)), [](const Json& data) { return page(data, worker); });
}
Result<Line> FaceTimeClient::update_line(const std::string& id, const UpdateLine& input) const {
    auto body = Json::object();
    if (input.display_name) { text(*input.display_name, 120); body["display_name"] = *input.display_name; }
    if (input.assistant_id) body["default_assistant_id"] = *input.assistant_id ? Json(uuid(**input.assistant_id)) : Json(nullptr);
    if (input.integration_id) body["integration_id"] = *input.integration_id ? Json(uuid(**input.integration_id)) : Json(nullptr);
    if (input.inbound_policy) body["inbound_policy"] = name(*input.inbound_policy,
        std::to_array<std::string_view>({"auto_answer", "customer_decides", "agent_decides", "auto_reject"}));
    if (input.video_framing) body["video_framing"] = name(*input.video_framing, std::to_array<std::string_view>({"fit", "fill"}));
    if (input.connecting_screen_dismissal) body["connecting_screen_dismissal"] = name(*input.connecting_screen_dismissal,
        std::to_array<std::string_view>({"audio", "video"}));
    if (input.connecting_screen_appearance) body["connecting_screen_appearance"] = name(*input.connecting_screen_appearance,
        std::to_array<std::string_view>({"chert", "black"}));
    require(!body.empty());
    const auto expected = uuid(id);
    return decode(request("/lines/" + expected, body, "PATCH"), [&](const Json& data) {
        auto result = line(data); require(result.id == expected); return result;
    });
}
Result<MediaSessionGrant> FaceTimeClient::create_media_session(const std::string& call_id,
                                                               const CreateMediaSession& input) const {
    const auto id = uuid(call_id);
    require(input.direction == MediaDirection::publish || input.direction == MediaDirection::subscribe);
    Json body{{"direction", input.direction == MediaDirection::publish ? "publish" : "subscribe"}};
    if (input.codecs) {
        require(!input.codecs->empty());
        body["codecs"] = Json::array();
        for (const auto item : *input.codecs) {
            require(item == VideoCodec::h264 || item == VideoCodec::vp8);
            const auto name = item == VideoCodec::h264 ? "h264" : "vp8";
            require(std::find(body["codecs"].begin(), body["codecs"].end(), name) == body["codecs"].end());
            body["codecs"].push_back(name);
        }
    }
    if (input.content) {
        const auto content = *input.content;
        if (input.direction == MediaDirection::publish ? content != MediaSessionContent::camera && content != MediaSessionContent::screen
                                                       : content != MediaSessionContent::caller_screen)
            throw std::invalid_argument("content must be camera or screen for publish, or caller_screen for subscribe");
        body["content"] = content_wire(content);
    }
    detail::Response response;
    try { response = request_with_response("/calls/" + id + "/media-sessions", std::move(body), "POST"); }
    catch (const ApiError& error) { sanitized(error); }
    auto request_id = response.request_id;
    try {
        // Same envelope rules as request(), plus the exact 201 status.
        const auto& envelope = response.data;
        require(response.status == 201 && envelope && envelope->is_object() && envelope->contains("data") && !envelope->contains("error"));
        request_id = envelope->at("request_id").get<std::string>();
        require(!request_id.empty());
        return {grant(envelope->at("data"), input.direction, input.codecs, input.content), request_id, response.status};
    } catch (const std::exception&) {
        // Response data is withheld: an invalid grant may still carry a bearer token.
        throw ApiError(502, "invalid_response", request_id);
    }
}

namespace {
constexpr std::int64_t max_safe_integer = 9007199254740991LL;
bool unit(double n) { return std::isfinite(n) && n >= 0 && n <= 1; }
bool region_ok(const CompositionRegion& r) {
    return unit(r.x) && unit(r.y) && unit(r.width) && unit(r.height) && r.width > 0 && r.height > 0
        && r.x + r.width <= 1 + 1e-9 && r.y + r.height <= 1 + 1e-9;
}
bool layer_id(const std::string& id) {
    return !id.empty() && id.size() <= 32 && id[0] >= 'a' && id[0] <= 'z'
        && std::all_of(id.begin() + 1, id.end(), [](char c) { return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-'; });
}
const char* input_wire(LivingInputKind kind) {
    switch (kind) {
        case LivingInputKind::pointer: return "pointer";
        case LivingInputKind::keyboard: return "keyboard";
        case LivingInputKind::text: return "text";
    }
    throw std::invalid_argument("input must be a unique subset of pointer, keyboard, text.");
}
bool inputs_ok(const std::vector<LivingInputKind>& kinds) {
    for (std::size_t i = 0; i < kinds.size(); ++i) {
        if (kinds[i] != LivingInputKind::pointer && kinds[i] != LivingInputKind::keyboard && kinds[i] != LivingInputKind::text) return false;
        if (std::find(kinds.begin(), kinds.begin() + static_cast<std::ptrdiff_t>(i), kinds[i]) != kinds.begin() + static_cast<std::ptrdiff_t>(i)) return false;
    }
    return true;
}
// Plain JSON (finite numbers, no binary) within `max` nodes, depth 64 and `max` serialized bytes.
void plain_json(const Json& value, std::size_t max) {
    std::size_t nodes = 0;
    const std::function<bool(const Json&, int)> walk = [&](const Json& v, int depth) {
        if (depth > 64 || ++nodes > max) return false;
        if (v.is_array() || v.is_object()) return std::all_of(v.begin(), v.end(), [&](const Json& x) { return walk(x, depth + 1); });
        if (v.is_number_float()) return std::isfinite(v.get<double>());
        return v.is_null() || v.is_boolean() || v.is_number() || v.is_string();
    };
    bool ok = walk(value, 0);
    if (ok) {
        try { ok = value.dump().size() <= max; } catch (const Json::exception&) { ok = false; }
    }
    if (!ok) throw std::invalid_argument("initial_state must be plain JSON up to 64 KiB.");
}
// Integral values serialize as JSON integers, as JSON.stringify does.
Json number(double n) {
    return std::trunc(n) == n && std::fabs(n) <= static_cast<double>(max_safe_integer) ? Json(static_cast<std::int64_t>(n)) : Json(n);
}
Json call_video_body(const SetCallVideo& input) {
    const auto fail = [](const char* message) { throw std::invalid_argument(message); };
    std::vector<VideoLayerInput> shortcut;
    if (input.deployment_id && !input.layers)
        shortcut.emplace_back(PageLayerInput{"page", 1, *input.deployment_id, std::nullopt, std::nullopt, std::nullopt, input.input, input.initial_state});
    if (!input.deployment_id && !input.layers) fail("set_call_video needs a deployment ID or layers.");
    const auto& layers = input.layers ? *input.layers : shortcut;
    if (layers.empty() || layers.size() > composition_max_layers) fail("A composition has 1-2 layers.");
    if (input.revision && (*input.revision < 0 || *input.revision > max_safe_integer)) fail("revision must be a non-negative integer.");
    std::vector<std::string> ids;
    std::vector<int> zs;
    int bases = 0;
    Json out = Json::array();
    const PageLayerInput* bottom = nullptr;
    CompositionRegion bottom_region;
    CompositionBackground bottom_background = CompositionBackground::opaque;
    double bottom_opacity = 1;
    for (const auto& layer : layers) {
        const std::string id = std::visit([](const auto& l) { return l.id; }, layer);
        if (!layer_id(id) || std::find(ids.begin(), ids.end(), id) != ids.end())
            fail("Layer ids are unique, 1-32 chars: lowercase letter, then [a-z0-9_-].");
        ids.push_back(id);
        if (const auto* base = std::get_if<BaseLayerInput>(&layer)) {
            if (++bases > 1) fail("At most one base layer, always at z 0.");
            if (base->source != CompositionBaseKind::camera && base->source != CompositionBaseKind::managed) fail("A base source is camera or managed.");
            out.push_back({{"id", base->id}, {"z", 0}, {"source", {{"kind", base->source == CompositionBaseKind::camera ? "camera" : "managed"}}}});
            continue;
        }
        const auto& page = std::get<PageLayerInput>(layer);
        if (page.z < 1 || page.z > 64 || std::find(zs.begin(), zs.end(), page.z) != zs.end()) fail("Page layer z values are unique integers 1..64.");
        zs.push_back(page.z);
        const auto region = page.region.value_or(CompositionRegion{});
        if (!region_ok(region)) fail("region is normalized 0..1 and must stay inside the frame.");
        const auto background = page.background.value_or(CompositionBackground::opaque);
        if (background != CompositionBackground::opaque && background != CompositionBackground::transparent) fail("background is opaque or transparent.");
        const auto opacity = page.opacity.value_or(1.0);
        if (!unit(opacity)) fail("opacity must be 0..1.");
        if (page.input && !inputs_ok(*page.input)) fail("input must be a unique subset of pointer, keyboard, text.");
        if (page.initial_state) plain_json(*page.initial_state, 64 * 1024);
        if (page.deployment_id.empty() || page.deployment_id.size() > 128 || page.deployment_id.find("://") != std::string::npos)
            fail("Pages must be a ready deployment ID; native SDKs cannot deploy URL pages (deploy with the TypeScript SDK).");
        text(page.deployment_id, 128);
        Json body{{"id", page.id}, {"z", page.z}, {"page", {{"deployment_id", page.deployment_id}}},
            {"region", {{"x", number(region.x)}, {"y", number(region.y)}, {"width", number(region.width)}, {"height", number(region.height)}}},
            {"background", background == CompositionBackground::opaque ? "opaque" : "transparent"}, {"opacity", number(opacity)}};
        if (page.input) {
            body["input"] = Json::array();
            for (const auto kind : *page.input) body["input"].push_back(input_wire(kind));
        }
        if (page.initial_state) body["initial_state"] = *page.initial_state;
        if (!bottom || page.z < bottom->z) {
            bottom = &page;
            bottom_region = region;
            bottom_background = background;
            bottom_opacity = opacity;
        }
        out.push_back(std::move(body));
    }
    // Nothing below the bottom page: it must fill the frame without showing through.
    if (bases == 0 && (!(bottom_region == CompositionRegion{}) || bottom_background != CompositionBackground::opaque || bottom_opacity != 1))
        fail("Without a base, the bottom page layer must be opaque, full frame and opacity 1.");
    Json result{{"layers", std::move(out)}};
    if (input.revision) result["revision"] = *input.revision;
    return result;
}

// JavaScript Number.isInteger(v) && min <= v <= max, safe integers only.
std::optional<std::int64_t> js_int(const Json& owner, const char* field, std::int64_t min, std::int64_t max) {
    if (!owner.is_object() || !owner.contains(field) || !owner.at(field).is_number()) return std::nullopt;
    const auto n = owner.at(field).get<double>();
    if (!std::isfinite(n) || std::trunc(n) != n || n < static_cast<double>(min) || n > static_cast<double>(max)) return std::nullopt;
    return static_cast<std::int64_t>(n);
}
int even(const Json& owner, const char* field, int max) {
    const auto n = js_int(owner, field, 16, max);
    require(n && *n % 2 == 0);
    return static_cast<int>(*n);
}
int fps(const Json& owner) {
    const auto n = js_int(owner, "fps", 1, 30);
    require(n.has_value());
    return static_cast<int>(*n);
}
double unit_number(const Json& owner, const char* field) {
    require(owner.at(field).is_number());
    const auto n = owner.at(field).get<double>();
    require(unit(n));
    return n;
}
// Absent or null is nullopt; any other non-string is invalid.
std::optional<std::string> optional_string(const Json& owner, const char* field) {
    if (!owner.contains(field) || owner.at(field).is_null()) return std::nullopt;
    return owner.at(field).get<std::string>();
}
LivingSession living_session(const Json& s) {
    require(s.is_object() && s.at("viewport").is_object());
    const auto status = string(s, "status");
    static constexpr std::array<std::string_view, 6> statuses = {"starting", "ready", "live", "stopping", "stopped", "failed"};
    const auto found = std::find(statuses.begin(), statuses.end(), status);
    require(found != statuses.end());
    LivingSession result{string(s, "session_id"), string(s, "call_id"), string(s, "deployment_id"),
        static_cast<LivingSessionStatus>(found - statuses.begin()), {even(s.at("viewport"), "width", 1920), even(s.at("viewport"), "height", 1080)},
        fps(s), optional_string(s, "ready_at"), optional_string(s, "last_heartbeat_at"), optional_string(s, "error_code")};
    require(!result.session_id.empty());
    return result;
}
CallVideoComposition composition(const Json& c) {
    require(c.is_object());
    static constexpr std::array<std::string_view, 5> statuses = {"starting", "live", "stopping", "stopped", "failed"};
    const auto status = std::find(statuses.begin(), statuses.end(), string(c, "status"));
    const auto revision = js_int(c, "revision", 0, max_safe_integer);
    require(status != statuses.end() && revision && (c.at("error_code").is_null() || c.at("error_code").is_string()) && c.at("output").is_object());
    const auto& o = c.at("output");
    CallVideoComposition result{string(c, "composition_id"), string(c, "call_id"), *revision,
        static_cast<CompositionStatus>(status - statuses.begin()), {even(o, "width", 1920), even(o, "height", 1080), fps(o)}, {},
        nullable_string(c, "error_code")};
    require(!result.composition_id.empty() && !result.call_id.empty());
    const auto& layers = c.at("layers");
    require(layers.is_array() && layers.size() <= composition_max_layers);
    std::vector<std::string> ids;
    std::vector<std::int64_t> zs;
    bool has_base = false;
    for (const auto& layer : layers) {
        require(layer.is_object());
        const auto id = string(layer, "id");
        const auto z = js_int(layer, "z", 0, max_safe_integer);
        require(std::find(ids.begin(), ids.end(), id) == ids.end() && (!z || std::find(zs.begin(), zs.end(), *z) == zs.end()));
        ids.push_back(id);
        if (z) zs.push_back(*z);
        if (layer.contains("source")) {
            const auto& source = layer.at("source");
            const auto kind = source.is_object() && source.contains("kind") && source.at("kind").is_string() ? source.at("kind").get<std::string>() : std::string();
            require((kind == "camera" || kind == "managed") && !has_base && z == 0);
            has_base = true;
            BaseLayer base{id, kind == "camera" ? CompositionBaseKind::camera : CompositionBaseKind::managed, std::nullopt};
            if (layer.contains("publish")) {
                require(base.source == CompositionBaseKind::camera);
                base.publish = grant(layer.at("publish"), MediaDirection::publish, std::nullopt, MediaSessionContent::camera);
                require(result.output.fps <= base.publish->limits.max_fps);
            }
            result.layers.emplace_back(std::move(base));
            continue;
        }
        require(z && *z >= 1 && *z <= std::numeric_limits<int>::max() && layer.at("region").is_object() && layer.at("input").is_array());
        const auto& r = layer.at("region");
        const CompositionRegion region{unit_number(r, "x"), unit_number(r, "y"), unit_number(r, "width"), unit_number(r, "height")};
        const auto background = string(layer, "background");
        require(region_ok(region) && (background == "opaque" || background == "transparent"));
        const auto opacity = unit_number(layer, "opacity");
        std::vector<LivingInputKind> input;
        for (const auto& item : layer.at("input")) {
            const auto kind = item.get<std::string>();
            require(kind == "pointer" || kind == "keyboard" || kind == "text");
            input.push_back(kind == "pointer" ? LivingInputKind::pointer : kind == "keyboard" ? LivingInputKind::keyboard : LivingInputKind::text);
        }
        require(inputs_ok(input));
        auto session = living_session(layer.at("living_session"));
        require(session.call_id == result.call_id && session.fps <= result.output.fps);
        result.layers.emplace_back(PageLayer{id, static_cast<int>(*z), std::move(session), region,
            background == "opaque" ? CompositionBackground::opaque : CompositionBackground::transparent, opacity, std::move(input)});
    }
    return result;
}
} // namespace

Result<CallVideoComposition> FaceTimeClient::set_call_video(const std::string& call_id, const SetCallVideo& input,
                                                            const std::string& idempotency_key) const {
    auto body = call_video_body(input);
    key(idempotency_key);
    return call_video(call_id, std::move(body), "PUT", idempotency_key);
}
Result<CallVideoComposition> FaceTimeClient::get_call_video(const std::string& call_id) const {
    return call_video(call_id, std::nullopt, "GET", std::nullopt);
}
Result<CallVideoComposition> FaceTimeClient::clear_call_video(const std::string& call_id) const {
    return call_video(call_id, std::nullopt, "DELETE", std::nullopt);
}
Result<CallVideoComposition> FaceTimeClient::call_video(const std::string& call_id, std::optional<Json> body,
                                                        std::string method, std::optional<std::string> idempotency_key) const {
    const auto id = uuid(call_id);
    detail::Response response;
    try { response = request_with_response("/calls/" + id + "/video", std::move(body), std::move(method), std::move(idempotency_key)); }
    catch (const ApiError& error) { sanitized(error); }
    auto request_id = response.request_id;
    try {
        // Same envelope rules as request().
        const auto& envelope = response.data;
        require(envelope && envelope->is_object() && envelope->contains("data") && !envelope->contains("error"));
        request_id = envelope->at("request_id").get<std::string>();
        require(!request_id.empty());
        return {composition(envelope->at("data")), request_id, response.status};
    } catch (const std::exception&) {
        // Response data is withheld: an invalid composition may still carry a bearer token.
        throw ApiError(502, "invalid_response", request_id);
    }
}

std::optional<VideoCompositionCapability> parse_video_composition(const Json& input) {
    if (!input.is_object() || !input.contains("version") || !input.at("version").is_number() || input.at("version").get<double>() != 1
        || !input.contains("supported") || input.at("supported") != true || !input.contains("bases") || !input.at("bases").is_array()) return std::nullopt;
    const auto positive = [&](const char* field, double cap) -> std::optional<int> {
        if (!input.contains(field) || !input.at(field).is_number()) return std::nullopt;
        const auto n = input.at(field).get<double>();
        if (!std::isfinite(n) || n <= 0 || std::trunc(n) != n) return std::nullopt;
        return static_cast<int>(std::min(n, cap));
    };
    const auto layers = positive("max_layers", composition_max_layers), width = positive("max_width", 1920),
        height = positive("max_height", 1080), rate = positive("max_fps", 30);
    if (!layers || !width || !height || !rate) return std::nullopt;
    std::vector<CompositionBaseKind> bases;
    for (const auto& item : input.at("bases")) {
        if (!item.is_string() || (item != "camera" && item != "managed")) continue;
        const auto kind = item == "camera" ? CompositionBaseKind::camera : CompositionBaseKind::managed;
        if (std::find(bases.begin(), bases.end(), kind) == bases.end()) bases.push_back(kind);
    }
    const auto flag = [&](const char* field) { return input.contains(field) && input.at(field) == true; };
    return VideoCompositionCapability{1, true, *layers, std::move(bases), flag("page_alpha"), flag("regions"), *width, *height, *rate};
}
const PageLayer* composition_input_target(const CallVideoComposition& composition, double x, double y) {
    if (!unit(x) || !unit(y)) return nullptr;
    const PageLayer* top = nullptr;
    for (const auto& layer : composition.layers) {
        const auto* page = std::get_if<PageLayer>(&layer);
        if (!page || std::find(page->input.begin(), page->input.end(), LivingInputKind::pointer) == page->input.end()) continue;
        const auto& r = page->region;
        if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height && (!top || page->z > top->z)) top = page;
    }
    return top;
}

namespace {
// Unknown entries are ignored for forward compatibility; absent or empty means camera only.
std::vector<MediaContent> contents(const Json& section) {
    std::vector<MediaContent> result;
    if (section.contains("contents") && section.at("contents").is_array())
        for (const auto& item : section.at("contents")) {
            if (!item.is_string()) continue;
            const auto text = item.get<std::string>();
            if (text != "camera" && text != "screen") continue;
            const auto parsed = text == "camera" ? MediaContent::camera : MediaContent::screen;
            if (std::find(result.begin(), result.end(), parsed) == result.end()) result.push_back(parsed);
        }
    if (result.empty()) result.push_back(MediaContent::camera);
    return result;
}
} // namespace

MediaCapabilities parse_media_capabilities(const Json& input) {
    MediaCapabilities result;
    if (!input.is_object() || !input.contains("version") || !input.at("version").is_number()
        || input.at("version").get<double>() != 1.0) return result;
    const auto enabled = [&](const char* field) {
        return input.contains(field) && input.at(field).is_object() && input.at(field).contains("supported")
            && input.at(field).at("supported") == true;
    };
    if (enabled("custom_video")) {
        const auto& cv = input.at("custom_video");
        const auto transports = allowed_list(cv, "transports", {"whip", "livekit"});
        const auto codecs = allowed_list(cv, "codecs", {"h264", "vp8"});
        const auto width = js_integer(cv, "max_width", 1920), height = js_integer(cv, "max_height", 1080), fps = js_integer(cv, "max_fps", 30);
        if (transports && !transports->empty() && codecs && !codecs->empty() && width && height && fps) {
            CustomVideoCapability section{true, *transports, {}, *width, *height, *fps, contents(cv)};
            for (const auto& item : *codecs) section.codecs.push_back(codec(item));
            result.custom_video = std::move(section);
        }
    }
    if (enabled("inbound_caller_video")) {
        const auto& iv = input.at("inbound_caller_video");
        const auto transports = allowed_list(iv, "transports", {"whep", "livekit"});
        const auto width = js_integer(iv, "max_width", 1280), height = js_integer(iv, "max_height", 720), fps = js_integer(iv, "max_fps", 30);
        if (transports && !transports->empty() && width && height && fps)
            result.inbound_caller_video = InboundCallerVideoCapability{true, *transports, *width, *height, *fps, contents(iv)};
    }
    return result;
}

MediaFrameError::MediaFrameError(std::string code_value, const std::string& message)
    : std::invalid_argument(message), code(std::move(code_value)) {}

void check_frame_dimensions(int width, int height) {
    if (width % 2 || height % 2 || width < 16 || height < 16 || width > 1920 || height > 1080)
        throw MediaFrameError("invalid_frame", "Dimensions must be even integers between 16 and 1920x1080.");
}

VideoFrame copy_video_frame(const VideoFrameInit& input) {
    struct Layout { std::int64_t row_bytes, rows; };
    const std::int64_t w = input.width, h = input.height;
    std::vector<Layout> layout;
    switch (input.format) {
        case PixelFormat::rgba: case PixelFormat::bgra: layout = {{w * 4, h}}; break;
        case PixelFormat::i420: layout = {{w, h}, {w / 2, h / 2}, {w / 2, h / 2}}; break;
        case PixelFormat::nv12: layout = {{w, h}, {w, h / 2}}; break;
        default: throw MediaFrameError("invalid_frame", "Unsupported pixel format.");
    }
    check_frame_dimensions(input.width, input.height);
    if (input.timestamp_us < 0) throw MediaFrameError("invalid_frame", "timestamp_us must be non-negative.");
    if (input.duration_us && *input.duration_us <= 0) throw MediaFrameError("invalid_frame", "duration_us must be positive.");
    if (input.rotation != 0 && input.rotation != 90 && input.rotation != 180 && input.rotation != 270)
        throw MediaFrameError("invalid_frame", "Unsupported rotation.");
    if (input.color_space && *input.color_space != ColorSpace::bt709_limited && *input.color_space != ColorSpace::bt601_limited
        && *input.color_space != ColorSpace::srgb_full) throw MediaFrameError("invalid_frame", "Unsupported color space.");
    if (input.planes.size() != layout.size())
        throw MediaFrameError("invalid_frame", "Pixel format requires " + std::to_string(layout.size()) + " plane(s).");
    const bool yuv = input.format == PixelFormat::i420 || input.format == PixelFormat::nv12;
    VideoFrame result{input.format, input.width, input.height, {}, input.timestamp_us, input.duration_us, input.rotation,
        input.color_space.value_or(yuv ? ColorSpace::bt709_limited : ColorSpace::srgb_full)};
    std::int64_t total = 0;
    for (std::size_t i = 0; i < layout.size(); ++i) {
        const auto [row_bytes, rows] = layout[i];
        const auto& plane = input.planes[i];
        if (plane.stride < row_bytes || plane.stride > row_bytes + 256)
            throw MediaFrameError("invalid_frame", "Plane " + std::to_string(i) + " stride must be between "
                + std::to_string(row_bytes) + " and " + std::to_string(row_bytes + 256) + " bytes.");
        const auto needed = plane.stride * (rows - 1) + row_bytes;
        if (static_cast<std::int64_t>(plane.data.size()) < needed)
            throw MediaFrameError("invalid_frame", "Plane " + std::to_string(i) + " needs at least " + std::to_string(needed) + " bytes.");
        total += needed;
        if (total > max_frame_bytes) throw MediaFrameError("frame_too_large", "Frame exceeds 8 MiB.");
        const auto first = plane.data.begin();
        result.planes.push_back({std::vector<std::uint8_t>(first, first + static_cast<std::ptrdiff_t>(needed)), plane.stride});
    }
    return result;
}
} // namespace trychert
