#include <trychert/facetime.hpp>
#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
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
    require(input.mode == CallMode::managed ? input.assistant_id.has_value() && !input.room : !input.assistant_id);
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
    if (input.mode == CallMode::customer_managed && !input.authorized_test_call) require(input.line_id && input.room);
    if (input.room) {
        require(input.mode == CallMode::customer_managed && input.line_id && input.media.audio && !input.authorized_test_call);
        text(input.room->livekit_url, 4096);
        text(input.room->participant_token, 32768);
        text(input.room->remote_participant_identity, 1024);
        body["livekit_url"] = input.room->livekit_url;
        body["participant_token"] = input.room->participant_token;
        body["remote_participant_identity"] = input.room->remote_participant_identity;
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
    catch (const ApiError& error) {
        // Raw response data is never returned. Server error responses (parsed bodies) keep their
        // status and an allowlisted code, else request_failed; local failures keep their code.
        static constexpr std::array<std::string_view, 23> safe = {"unauthorized", "forbidden", "cli_scope_denied",
            "billing_owner_required", "billing_unavailable", "project_required", "invalid_request", "cli_login_expired",
            "cli_login_not_found", "cli_login_forbidden", "slow_down", "cli_login_rate_limited", "cli_login_busy", "not_found",
            "conflict", "media_capability_unsupported", "media_session_conflict", "caller_screen_not_shared", "call_not_active", "call_ended",
            "call_not_found", "media_session_expired", "media_transport_unavailable"};
        auto request_id = error.request_id;
        if (error.data.is_object() && error.data.contains("request_id") && error.data["request_id"].is_string())
            request_id = error.data["request_id"].get<std::string>();
        const bool server = error.status >= 300 && !error.data.is_null();
        const bool allowed = std::find(safe.begin(), safe.end(), error.code) != safe.end();
        throw ApiError(error.status, server && !allowed ? "request_failed" : error.code, std::move(request_id));
    }
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
