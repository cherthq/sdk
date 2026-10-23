#include <trychert/facetime.hpp>
#include <algorithm>
#include <array>
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
        nullable_string(value, "assistant_id"), nullable_string(value, "terminal_reason"), value};
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
} // namespace trychert
