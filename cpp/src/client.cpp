#include <trychert/client.hpp>
#include <curl/curl.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <limits>
#include <memory>
#include <set>
#include <string_view>
#include <vector>

namespace trychert {
namespace {
constexpr std::size_t response_limit = 8 * 1024 * 1024;
using Url = std::unique_ptr<CURLU, decltype(&curl_url_cleanup)>;
using Easy = std::unique_ptr<CURL, decltype(&curl_easy_cleanup)>;
using Headers = std::unique_ptr<curl_slist, decltype(&curl_slist_free_all)>;

void initialize() {
    static const auto initialized = curl_global_init(CURL_GLOBAL_DEFAULT);
    if (initialized != CURLE_OK) throw std::runtime_error("Cannot initialize Chert HTTP transport");
    const auto* version = curl_version_info(CURLVERSION_NOW);
    if (!version || !(version->features & CURL_VERSION_ASYNCHDNS) || !(version->features & CURL_VERSION_THREADSAFE))
        throw std::runtime_error("Chert requires thread-safe libcurl with asynchronous DNS");
}
bool controls(std::string_view value) {
    return std::any_of(value.begin(), value.end(), [](unsigned char c) { return c <= 32 || c == 127; });
}
std::string part(CURLU* url, CURLUPart key) {
    char* raw = nullptr;
    if (curl_url_get(url, key, &raw, 0) != CURLUE_OK) return {};
    const std::unique_ptr<char, decltype(&curl_free)> result(raw, curl_free);
    return result.get();
}
void safe_path(std::string_view path) {
    if (controls(path) || path.find('\\') != path.npos || path.find('#') != path.npos)
        throw std::invalid_argument("Invalid Chert API path");
    for (std::size_t offset = 0; offset <= path.size();) {
        const auto end = path.find('/', offset);
        const auto segment = path.substr(offset, end == path.npos ? path.size() - offset : end - offset);
        for (std::size_t i = 0; i < segment.size(); ++i) {
            if (segment[i] == '%') {
                if (i + 2 >= segment.size() || !std::isxdigit(static_cast<unsigned char>(segment[i + 1]))
                    || !std::isxdigit(static_cast<unsigned char>(segment[i + 2])))
                    throw std::invalid_argument("Invalid Chert API escape");
                i += 2;
            }
        }
        int length = 0;
        const auto encoded = std::string(segment);
        const std::unique_ptr<char, decltype(&curl_free)> decoded(
            curl_easy_unescape(nullptr, encoded.c_str(), static_cast<int>(encoded.size()), &length), curl_free);
        if (!decoded) throw std::runtime_error("Cannot decode Chert API path");
        const auto value = std::string_view(decoded.get(), static_cast<std::size_t>(length));
        if (value == "." || value == ".." || controls(value) || value.find_first_of("/\\%?#") != value.npos)
            throw std::invalid_argument("Chert API path escapes its namespace");
        if (end == path.npos) break;
        offset = end + 1;
    }
}
bool finite_json(const Json& root) {
    std::vector<const Json*> pending{&root};
    while (!pending.empty()) {
        const auto& value = *pending.back();
        pending.pop_back();
        if (value.is_discarded() || value.is_binary()
            || (value.is_number_float() && !std::isfinite(value.get<double>()))) return false;
        if (value.is_structured()) for (const auto& child : value) pending.push_back(&child);
    }
    return true;
}
bool valid_utf8(const std::string& value) {
    try { static_cast<void>(Json(value).dump()); return true; }
    catch (const Json::exception&) { return false; }
}
// ECMAScript String.trim whitespace for consistent input validation.
// Encoding validation remains nlohmann/json's job; no Unicode normalization.
constexpr auto ecmascript_spaces = std::to_array<std::string_view>({
    "\t", "\n", "\v", "\f", "\r", " ", "\xc2\xa0", "\xe1\x9a\x80",
    "\xe2\x80\x80", "\xe2\x80\x81", "\xe2\x80\x82", "\xe2\x80\x83", "\xe2\x80\x84",
    "\xe2\x80\x85", "\xe2\x80\x86", "\xe2\x80\x87", "\xe2\x80\x88", "\xe2\x80\x89",
    "\xe2\x80\x8a", "\xe2\x80\xa8", "\xe2\x80\xa9", "\xe2\x80\xaf", "\xe2\x81\x9f",
    "\xe3\x80\x80", "\xef\xbb\xbf"});
bool blank_text(std::string_view value) {
    while (!value.empty()) {
        const auto found = std::find_if(ecmascript_spaces.begin(), ecmascript_spaces.end(),
            [value](auto space) { return value.starts_with(space); });
        if (found == ecmascript_spaces.end()) return false;
        value.remove_prefix(found->size());
    }
    return true;
}
// For valid UTF-8, matching a whole encoded space at either end is the same as
// decoding the first/last code point: lead bytes never occur as continuations.
bool untrimmed(std::string_view value) {
    return std::any_of(ecmascript_spaces.begin(), ecmascript_spaces.end(),
        [value](auto space) { return value.starts_with(space) || value.ends_with(space); });
}
bool canonical_phone(std::string_view value) {
    return value.size() >= 3 && value.size() <= 16 && value[0] == '+' && value[1] >= '1' && value[1] <= '9'
        && std::all_of(value.begin() + 2, value.end(), [](unsigned char c) { return c >= '0' && c <= '9'; });
}
bool public_id(std::string_view value) {
    return value.size() == 32 && std::all_of(value.begin(), value.end(), [](unsigned char c) {
        return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'); });
}
bool chat_id(std::string_view value) {
    return !value.empty() && value.size() <= 160 && std::all_of(value.begin(), value.end(), [](unsigned char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == ':' || c == '_' || c == '-'; });
}
bool reaction_chat_id(std::string_view value) {
    if (value.size() != 36) return false;
    for (std::size_t i = 0; i < value.size(); ++i) {
        const auto c = static_cast<unsigned char>(value[i]);
        if (i == 8 || i == 13 || i == 18 || i == 23) { if (c != '-') return false; }
        else if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) return false;
    }
    return true;
}
bool reaction_message_id(std::string_view value) {
    return !value.empty() && value.size() <= 160 && value != "." && value != ".."
        && std::all_of(value.begin(), value.end(), [](unsigned char c) {
            return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
                || c == ':' || c == '_' || c == '-' || c == '.'; });
}
bool reaction_key(std::string_view value) {
    return !value.empty() && value.size() <= 200 && value.front() != ' ' && value.back() != ' '
        && std::all_of(value.begin(), value.end(), [](unsigned char c) { return c >= 0x20 && c <= 0x7e; });
}
bool event_stream_content_type(const char* raw) {
    if (!raw) return false;
    const std::string_view value(raw);
    const auto media_type = value.substr(0, value.find(';'));
    constexpr std::string_view expected = "text/event-stream";
    return media_type.size() == expected.size()
        && std::equal(media_type.begin(), media_type.end(), expected.begin(), [](unsigned char a, char b) {
            return (a >= 'A' && a <= 'Z' ? a + ('a' - 'A') : a) == b;
        });
}
struct Response {
    std::string body;
    std::string trace;
    std::string request;
    std::string contract;
    std::size_t contract_count = 0;
    bool unified = false;
    std::size_t body_limit = response_limit;
    CURL* handle = nullptr;
    std::function<bool(const std::string&, const Json&)> stream;
    std::stop_token stop;
    std::string line, event, data;
    std::size_t frame_size = 0;
    bool after_cr = false, has_data = false, stopped = false;
    std::exception_ptr failure;

    void count_byte() {
        if (++frame_size > 1024 * 1024) throw ApiError(502, "event_frame_too_large", "");
    }
    bool consume(char c) {
        if (after_cr) {
            after_cr = false;
            // Delay dispatch until the complete CRLF delimiter is counted.
            // A non-LF belongs to the next line (or the next frame).
            if (c == '\n') { count_byte(); return consume_line(); }
            if (!consume_line()) return false;
        }
        count_byte();
        if (c == '\r') { after_cr = true; return true; }
        if (c == '\n') return consume_line();
        line += c;
        return true;
    }
    bool consume_line() {
        if (!valid_utf8(line)) throw ApiError(502, "invalid_event_stream", "");
        if (line.empty()) {
            if (has_data) {
                auto parsed = Json::parse(data, nullptr, false);
                if (parsed.is_discarded()) throw ApiError(502, "invalid_event_stream", "");
                if (!stream(event.empty() ? "message" : event, parsed)) { stopped = true; return false; }
            }
            event.clear(); data.clear(); has_data = false; frame_size = 0;
        } else if (line.front() != ':') {
            const auto colon = line.find(':');
            const auto field = line.substr(0, colon);
            auto value = colon == line.npos ? std::string{} : line.substr(colon + 1);
            if (value.starts_with(' ')) value.erase(0, 1);
            if (field == "event") event = std::move(value);
            if (field == "data") {
                if (has_data) data += '\n';
                data += value; has_data = true;
            }
        }
        line.clear();
        return true;
    }
};
int progress(void* context, curl_off_t, curl_off_t, curl_off_t, curl_off_t) noexcept {
    return static_cast<Response*>(context)->stop.stop_requested() ? 1 : 0;
}
std::size_t write_body(char* data, std::size_t size, std::size_t count, void* context) noexcept {
    try {
        auto& response = *static_cast<Response*>(context);
        auto& body = response.body;
        if (response.unified && (response.contract_count != 1 || response.contract != "chert-unified-v1"))
            throw ApiError(502, "unsupported_unified_backend", "");
        if (size != 0 && count > response_limit / size) return 0;
        const auto length = size * count;
        if (response.stream) {
            long status = 0;
            static_cast<void>(curl_easy_getinfo(response.handle, CURLINFO_RESPONSE_CODE, &status));
            if (status == 200) {
                char* content_type = nullptr;
                static_cast<void>(curl_easy_getinfo(response.handle, CURLINFO_CONTENT_TYPE, &content_type));
                if (!event_stream_content_type(content_type))
                    throw ApiError(502, "invalid_event_stream", "");
                for (std::size_t i = 0; i < length; ++i)
                    if (response.stop.stop_requested() || !response.consume(data[i])) return 0;
                return length;
            }
        }
        if (length > response.body_limit - body.size()) return 0;
        body.append(data, length);
        return length;
    } catch (...) { static_cast<Response*>(context)->failure = std::current_exception(); return 0; }
}
std::size_t write_header(char* data, std::size_t size, std::size_t count, void* context) noexcept {
    try {
        if (size != 0 && count > response_limit / size) return 0;
        const auto length = size * count;
        const auto header = std::string_view(data, length);
        auto& response = *static_cast<Response*>(context);
        if (header.starts_with("HTTP/")) {
            response.contract.clear();
            response.contract_count = 0;
        }
        const auto colon = header.find(':');
        if (colon == header.npos) return length;
        auto name = std::string(header.substr(0, colon));
        std::transform(name.begin(), name.end(), name.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        auto value = std::string(header.substr(colon + 1));
        const auto first = value.find_first_not_of(" \t");
        value = first == value.npos ? "" : value.substr(first);
        while (!value.empty() && (value.back() == '\r' || value.back() == '\n' || value.back() == ' ')) value.pop_back();
        if (name == "x-chert-contract") {
            ++response.contract_count;
            response.contract = value;
        }
        if (name == "x-trace-id") response.trace = value;
        if (name == "x-request-id") response.request = value;
        return length;
    } catch (...) { return 0; }
}
} // namespace

ApiError::ApiError(long status_value, std::string code_value, std::string id, Json raw)
    : std::runtime_error("Chert request failed; reconcile uncertain sends before retrying"),
      status(status_value), code(std::move(code_value)), request_id(std::move(id)), data(std::move(raw)) {}

detail::Transport::Transport(std::string base_url, std::string api_key, std::optional<std::string> scope,
                             std::chrono::milliseconds timeout, Scope scope_kind)
    : key_(std::move(api_key)), scope_(std::move(scope)), timeout_(timeout), scope_kind_(scope_kind) {
    initialize();
    if (timeout_.count() <= 0 || timeout_.count() > std::numeric_limits<long>::max())
        throw std::invalid_argument("Invalid Chert timeout");
    const auto valid_header = [](const std::string& value) {
        return !value.empty() && !controls(value);
    };
    if (!valid_header(key_) || (scope_ && !valid_header(*scope_)))
        throw std::invalid_argument("Explicit Chert credentials are required");
    if (base_url.size() > 16384 || controls(base_url) || base_url.find_first_of("\\?#") != base_url.npos)
        throw std::invalid_argument("Invalid Chert base URL");
    const Url url(curl_url(), curl_url_cleanup);
    if (!url || curl_url_set(url.get(), CURLUPART_URL, base_url.c_str(), CURLU_PATH_AS_IS) != CURLUE_OK)
        throw std::invalid_argument("Invalid Chert base URL");
    const auto scheme = part(url.get(), CURLUPART_SCHEME);
    const auto host = part(url.get(), CURLUPART_HOST);
    const auto loopback = host == "localhost" || host == "127.0.0.1" || host == "[::1]";
    if ((scheme != "https" && !(scheme == "http" && loopback)) || host.empty()
        || !part(url.get(), CURLUPART_USER).empty() || !part(url.get(), CURLUPART_PASSWORD).empty()
        || base_url.find('@') != base_url.npos)
        throw std::invalid_argument("Chert requires HTTPS or loopback HTTP without URL credentials");
    auto path = part(url.get(), CURLUPART_PATH);
    safe_path(path);
    if (path == "/") path = "/api/v1";
    while (!path.empty() && path.back() == '/') path.pop_back();
    path += '/';
    if (curl_url_set(url.get(), CURLUPART_PATH, path.c_str(), 0) != CURLUE_OK)
        throw std::invalid_argument("Invalid Chert base path");
    base_ = part(url.get(), CURLUPART_URL);
}

std::optional<Json> detail::Transport::request(const std::string& path, std::optional<Json> body, std::string method) const {
    return request_with_response(path, std::move(body), std::move(method)).data;
}

Client Client::connect(UnifiedSessionOptions options) {
    const auto& token = options.access_token;
    if (token.size() != 47 || !token.starts_with("chu_") || !reaction_chat_id(options.project_id)
        || !std::all_of(token.begin() + 4, token.end(), [](unsigned char c) {
            return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-';
        })) throw std::invalid_argument("A unified session token and project UUID are required");
    // Validate both caller-approved origins offline before any discovery request.
    const auto origin = [](const std::string& value) {
        const detail::Transport validate(value, "offline-validation", std::nullopt, std::chrono::seconds(15));
        const Url url(curl_url(), curl_url_cleanup);
        if (!url || curl_url_set(url.get(), CURLUPART_URL, value.c_str(), 0) != CURLUE_OK
            || part(url.get(), CURLUPART_PATH) != "/")
            throw std::invalid_argument("Unified services require root origins");
        auto result = part(url.get(), CURLUPART_URL);
        if (result.ends_with('/')) result.pop_back();
        return result;
    };
    const auto im = origin(options.imessage_base_url), ft = origin(options.facetime_base_url);
    try {
        detail::Transport discovery(im, "unused-discovery", std::nullopt, std::chrono::seconds(15));
        discovery.discovery_ = true;
        const auto envelope = discovery.request("/sdk/capabilities");
        if (!envelope) throw ApiError(502, "unsupported_unified_backend", "");
        const auto& data = envelope->at("data");
        const auto& auth = data.at("auth");
        const auto& services = data.at("services");
        const auto& scopes = data.at("scopes");
        if (data.at("contract") != "chert-unified" || !data.at("contract_version").is_number_integer()
            || data.at("contract_version") != 1 || auth.at("scheme") != "Bearer"
            || auth.at("token_prefix") != "chu_" || auth.at("audience") != "chert.unified-api:v1"
            || auth.at("login_url") != ft + "/api/v1/cli/logins"
            || services.at("imessage").at("base_url") != im + "/api/v1"
            || services.at("facetime").at("base_url") != ft + "/api/v1" || !scopes.is_array())
            throw ApiError(502, "unsupported_unified_backend", "");
        std::set<std::string> unique_scopes;
        for (const auto& scope : scopes)
            if (!scope.is_string() || !unique_scopes.insert(scope.get<std::string>()).second)
                throw ApiError(502, "unsupported_unified_backend", "");
        for (const auto* scope : {"imessage:events:read", "imessage:webhooks:manage", "imessage:messages:send",
                                 "facetime:calls:read", "facetime:calls:create", "facetime:calls:control"})
            if (std::find(scopes.begin(), scopes.end(), Json(scope)) == scopes.end())
                throw ApiError(502, "unsupported_unified_backend", "");
    } catch (const std::exception&) { throw ApiError(502, "unsupported_unified_backend", ""); }
    Client result({{im, token, std::nullopt}, {ft, token, options.project_id}});
    result.imessage.unified_ = true;
    result.facetime.unified_ = true;
    return result;
}

namespace {
std::string encode_query(const std::string& value) {
    if (value.size() > 16384 || !valid_utf8(value)) throw std::invalid_argument("Invalid event query");
    const std::unique_ptr<char, decltype(&curl_free)> encoded(
        curl_easy_escape(nullptr, value.data(), static_cast<int>(value.size())), curl_free);
    if (!encoded) throw std::runtime_error("Cannot encode event query");
    return encoded.get();
}
std::string resource_id(const std::string& id) {
    if (id.empty() || id.size() > 200 || id == "." || id == ".."
        || !std::all_of(id.begin(), id.end(), [](unsigned char c) {
            return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
                || c == '-' || c == '_' || c == '.';
        })) throw std::invalid_argument("Invalid event resource ID");
    return id;
}
Json required_json(std::optional<Json> value) {
    if (!value) throw ApiError(502, "invalid_response", "");
    return std::move(*value);
}
}
Json IMessageClient::list_events(const EventListOptions& options) const {
    std::string path = "/events?";
    const auto add = [&](const char* name, const std::optional<std::string>& value) {
        if (value) path += std::string(name) + "=" + encode_query(*value) + "&";
    };
    add("type", options.type); add("status", options.status); add("lead_id", options.lead_id);
    add("since", options.since); add("cursor", options.cursor);
    if (options.limit) {
        if (*options.limit < 1 || *options.limit > 200) throw std::invalid_argument("Event limit must be 1-200");
        path += "limit=" + std::to_string(*options.limit);
    }
    return required_json(request(path));
}
Json IMessageClient::get_event(const std::string& id) const {
    return required_json(request("/events/" + resource_id(id)));
}
Json IMessageClient::list_webhook_subscriptions() const {
    return required_json(request("/webhook-subscriptions"));
}
Json IMessageClient::get_webhook_subscription(const std::string& id) const {
    return required_json(request("/webhook-subscriptions/" + resource_id(id)));
}
Json IMessageClient::create_webhook_subscription(const CreateWebhookSubscription& input) const {
    Json body{{"url", input.url}};
    if (input.events) body["events"] = *input.events;
    if (input.version) body["version"] = *input.version;
    return required_json(request("/webhook-subscriptions", body, "POST"));
}
Json IMessageClient::update_webhook_subscription(const std::string& id, const UpdateWebhookSubscription& input) const {
    auto body = Json::object();
    if (input.url) body["url"] = *input.url;
    if (input.events) body["events"] = *input.events;
    if (input.version) body["version"] = *input.version;
    if (input.is_active) body["is_active"] = *input.is_active;
    return required_json(request("/webhook-subscriptions/" + resource_id(id), body, "PATCH"));
}
Json IMessageClient::delete_webhook_subscription(const std::string& id) const {
    return required_json(request("/webhook-subscriptions/" + resource_id(id), std::nullopt, "DELETE"));
}
void IMessageClient::stream_events(const std::function<bool(const MessagingStreamFrame&)>& callback,
                                  std::optional<std::string> since, std::stop_token stop) const {
    if (!callback) throw std::invalid_argument("Event callback is required");
    const auto path = "/events/stream" + (since ? "?since=" + encode_query(*since) : std::string{});
    static_cast<void>(request_with_response(path, std::nullopt, "GET", std::nullopt,
        [&](const std::string& event, const Json& data) { return callback({event, data}); }, stop));
}

QueuedTextReceipt IMessageClient::send_text(const std::string& phone, const std::string& text,
                                    std::optional<std::string> key) const {
    if (!canonical_phone(phone) || text.empty() || text.size() > 16384 || text.find('\0') != text.npos
        || !valid_utf8(text) || blank_text(text)) throw std::invalid_argument("Invalid strict plaintext input");
    if (key && (key->empty() || key->size() > 200 || key->find('\0') != key->npos || !valid_utf8(*key)
                || untrimmed(*key)))
        throw std::invalid_argument("Invalid strict text idempotency key");
    Json payload{{"phone", phone}, {"body", text}};
    if (key) payload["idempotency_key"] = *key;
    auto response = request_with_response("/send", std::move(payload), "POST");
    const auto& data = response.data;
    const auto status_ok = [&] {
        if (!data || !data->is_object() || !data->contains("status") || !data->at("status").is_string()) return false;
        const auto& status = data->at("status").get_ref<const std::string&>();
        return (response.status == 202 && status == "queued")
            || (response.status == 200 && (status == "sent" || status == "duplicate"));
    };
    if (!status_ok()
        || !data->contains("message_id") || !data->at("message_id").is_string() || !chat_id(data->at("message_id").get_ref<const std::string&>())
        || !data->contains("chat_id") || !data->at("chat_id").is_string() || !chat_id(data->at("chat_id").get_ref<const std::string&>()))
        throw ApiError(502, "unconfirmed_text_outcome", response.request_id, data.value_or(Json(nullptr)));
    return {true, data->at("message_id").get<std::string>(), data->at("chat_id").get<std::string>(),
            data->at("status").get<std::string>()};
}

ReactionReceipt IMessageClient::send_reaction(const std::string& input_chat, const std::string& message,
                                      const std::string& reaction, bool remove, std::optional<std::string> key) const {
    constexpr std::array<std::string_view, 6> kinds{"love", "like", "dislike", "laugh", "emphasize", "question"};
    if (!reaction_chat_id(input_chat) || !reaction_message_id(message)
        || std::find(kinds.begin(), kinds.end(), reaction) == kinds.end())
        throw std::invalid_argument("Invalid strict reaction input");
    auto chat = input_chat;
    std::transform(chat.begin(), chat.end(), chat.begin(), [](unsigned char c) {
        return static_cast<char>(c >= 'A' && c <= 'F' ? c - 'A' + 'a' : c); });
    std::string encoded;
    for (const char c : message) { if (c == ':') encoded += "%3A"; else encoded += c; }
    auto response = request_with_response("/chats/" + chat + "/messages/" + encoded + "/reactions",
        Json{{"reaction", reaction}, {"remove", remove}, {"part_index", 0}}, "POST", std::move(key));
    const auto& data = response.data;
    if (response.status != 202 || !data || !data->is_object() || data->size() != 4
        || !data->contains("operation_id") || !data->at("operation_id").is_string()
        || !public_id(data->at("operation_id").get_ref<const std::string&>())
        || !data->contains("chat_id") || data->at("chat_id") != chat
        || !data->contains("message_id") || data->at("message_id") != message
        || !data->contains("status") || data->at("status") != "acknowledged")
        throw ApiError(502, "unconfirmed_reaction_outcome", response.request_id, data.value_or(Json(nullptr)));
    return {data->at("operation_id").get<std::string>(), chat, message, "acknowledged"};
}

detail::Response detail::Transport::request_with_response(const std::string& path, std::optional<Json> body, std::string method,
                                                     std::optional<std::string> idempotency_key,
                                                     std::function<bool(const std::string&, const Json&)> stream,
                                                     std::stop_token stop) const {
    if (idempotency_key && !reaction_key(*idempotency_key))
        throw std::invalid_argument("Invalid reaction idempotency header");
    if (path.empty() || path.front() != '/' || path.starts_with("//") || path.size() > 16384)
        throw std::invalid_argument("Expected a bounded Chert-relative API path");
    safe_path(std::string_view(path).substr(0, path.find('?')));
    if (controls(path) || path.find_first_of("\\#") != path.npos)
        throw std::invalid_argument("Invalid Chert API path");
    if (method.empty()) method = body ? "POST" : "GET";
    if (method != "GET" && method != "POST" && method != "PUT" && method != "PATCH" && method != "DELETE" && method != "HEAD")
        throw std::invalid_argument("Invalid Chert request method");
    if (body && !finite_json(*body)) throw std::invalid_argument("Expected valid finite JSON");
    std::string payload;
    try { if (body) payload = body->dump(); }
    catch (const Json::exception&) { throw std::invalid_argument("Expected valid finite JSON"); }
    const auto url = base_ + path.substr(1);
    ::trychert::Response response;
    Headers headers(nullptr, curl_slist_free_all);
    const Easy handle(curl_easy_init(), curl_easy_cleanup);
    if (!handle) throw std::runtime_error("Cannot initialize Chert request");
    response.handle = handle.get();
    response.stream = std::move(stream);
    response.stop = stop;
    response.unified = unified_;
    response.body_limit = discovery_ ? 65536 : response_limit;
    const auto add_header = [&headers](const std::string& value) {
        auto* next = curl_slist_append(headers.get(), value.c_str());
        if (!next) throw std::runtime_error("Cannot allocate Chert headers");
        static_cast<void>(headers.release());
        headers.reset(next);
    };
    if (!discovery_) add_header("Authorization: Bearer " + key_);
    if (unified_) add_header("X-Chert-Contract: chert-unified-v1");
    add_header(response.stream ? "Accept: text/event-stream" : "Accept: application/json");
    // Avoid libcurl's Expect/417 retry path for large mutation bodies.
    add_header("Expect:");
    if (scope_) add_header((scope_kind_ == Scope::tenant ? "X-Chert-Tenant: " : "X-Chert-Project-Id: ") + *scope_);
    if (idempotency_key) add_header("Idempotency-Key: " + *idempotency_key);
    if (body) add_header("Content-Type: application/json");
    const auto set = [&handle](CURLoption option, auto value) {
        if (curl_easy_setopt(handle.get(), option, value) != CURLE_OK)
            throw std::runtime_error("Cannot configure Chert request");
    };
    set(CURLOPT_URL, url.c_str());
    set(CURLOPT_HTTPHEADER, headers.get());
    set(CURLOPT_CUSTOMREQUEST, method.c_str());
    if (method == "HEAD") set(CURLOPT_NOBODY, 1L);
    set(CURLOPT_FOLLOWLOCATION, 0L);
    set(CURLOPT_PROXY, "");
    set(CURLOPT_NETRC, static_cast<long>(CURL_NETRC_IGNORED));
    set(CURLOPT_HTTPAUTH, static_cast<long>(CURLAUTH_NONE));
    set(CURLOPT_HTTP_VERSION, static_cast<long>(CURL_HTTP_VERSION_1_1));
    set(CURLOPT_NOSIGNAL, 1L);
    set(CURLOPT_SSL_VERIFYPEER, 1L);
    set(CURLOPT_SSL_VERIFYHOST, 2L);
    set(CURLOPT_TIMEOUT_MS, static_cast<long>(timeout_.count()));
    set(CURLOPT_CONNECTTIMEOUT_MS, static_cast<long>(timeout_.count()));
    set(CURLOPT_WRITEFUNCTION, &write_body);
    set(CURLOPT_WRITEDATA, &response);
    set(CURLOPT_HEADERFUNCTION, &write_header);
    set(CURLOPT_HEADERDATA, &response);
    if (response.stream) {
        if (stop.stop_requested()) return {0, "", std::nullopt};
        set(CURLOPT_NOPROGRESS, 0L);
        set(CURLOPT_XFERINFOFUNCTION, &progress);
        set(CURLOPT_XFERINFODATA, &response);
    }
    if (body) {
        set(CURLOPT_POSTFIELDS, payload.c_str());
        set(CURLOPT_POSTFIELDSIZE_LARGE, static_cast<curl_off_t>(payload.size()));
    }
    const auto result = curl_easy_perform(handle.get());
    long status = 0;
    static_cast<void>(curl_easy_getinfo(handle.get(), CURLINFO_RESPONSE_CODE, &status));
    const auto id = response.trace.empty() ? response.request : response.trace;
    if (response.failure) std::rethrow_exception(response.failure);
    if (response.stream && (response.stopped || stop.stop_requested())) return {status, id, std::nullopt};
    if (result != CURLE_OK) throw ApiError(status, "outcome_unknown", id);
    if (unified_ && (response.contract_count != 1 || response.contract != "chert-unified-v1"))
        throw ApiError(502, "unsupported_unified_backend", id);
    if (response.stream && status == 200) {
        char* content_type = nullptr;
        static_cast<void>(curl_easy_getinfo(handle.get(), CURLINFO_CONTENT_TYPE, &content_type));
        if (!event_stream_content_type(content_type))
            throw ApiError(502, "invalid_event_stream", id);
        // A pending CR at successful EOF is a complete bare-CR delimiter.
        if (response.after_cr) static_cast<void>(response.consume_line());
        return {status, id, std::nullopt};
    }
    if (response.stream && status >= 200 && status < 300) throw ApiError(502, "invalid_event_stream", id);
    if (status == 204 || (method == "HEAD" && status >= 200 && status < 300)) return {status, id, std::nullopt};
    if (method == "HEAD") throw ApiError(status, "request_failed", id);
    const auto data = Json::parse(response.body, nullptr, false);
    if (data.is_discarded()) throw ApiError(status >= 400 ? status : 502, "invalid_response", id);
    if (status < 200 || status >= 300 || (data.is_object() && data.contains("success") && data["success"] == false)) {
        const auto& error = data.is_object() && data.contains("error") && data["error"].is_object() ? data["error"] : data;
        auto code = std::string("request_failed");
        if (error.is_object() && error.contains("code")) {
            if (error["code"].is_string()) code = error["code"].get<std::string>();
            else if (error["code"].is_number()) code = error["code"].dump();
        }
        throw ApiError(status >= 300 ? status : 502, code, id, data);
    }
    return {status, id, data};
}
} // namespace trychert
