#include <trychert/imessage.hpp>
#include <curl/curl.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <limits>
#include <memory>
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
bool blank_text(std::string_view value) {
    // ECMAScript String.trim whitespace, matching the actual strict HTTP route.
    // Encoding validation remains nlohmann/json's job; no Unicode normalization.
    constexpr auto spaces = std::to_array<std::string_view>({
        "\t", "\n", "\v", "\f", "\r", " ", "\xc2\xa0", "\xe1\x9a\x80",
        "\xe2\x80\x80", "\xe2\x80\x81", "\xe2\x80\x82", "\xe2\x80\x83", "\xe2\x80\x84",
        "\xe2\x80\x85", "\xe2\x80\x86", "\xe2\x80\x87", "\xe2\x80\x88", "\xe2\x80\x89",
        "\xe2\x80\x8a", "\xe2\x80\xa8", "\xe2\x80\xa9", "\xe2\x80\xaf", "\xe2\x81\x9f",
        "\xe3\x80\x80", "\xef\xbb\xbf"});
    while (!value.empty()) {
        const auto found = std::find_if(spaces.begin(), spaces.end(), [value](auto space) { return value.starts_with(space); });
        if (found == spaces.end()) return false;
        value.remove_prefix(found->size());
    }
    return true;
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
struct Response {
    std::string body;
    std::string trace;
    std::string request;
};
std::size_t write_body(char* data, std::size_t size, std::size_t count, void* context) noexcept {
    try {
        auto& body = static_cast<Response*>(context)->body;
        if (size != 0 && count > response_limit / size) return 0;
        const auto length = size * count;
        if (length > response_limit - body.size()) return 0;
        body.append(data, length);
        return length;
    } catch (...) { return 0; }
}
std::size_t write_header(char* data, std::size_t size, std::size_t count, void* context) noexcept {
    try {
        if (size != 0 && count > response_limit / size) return 0;
        const auto length = size * count;
        const auto header = std::string_view(data, length);
        const auto colon = header.find(':');
        if (colon == header.npos) return length;
        auto name = std::string(header.substr(0, colon));
        std::transform(name.begin(), name.end(), name.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        auto value = std::string(header.substr(colon + 1));
        const auto first = value.find_first_not_of(" \t");
        value = first == value.npos ? "" : value.substr(first);
        while (!value.empty() && (value.back() == '\r' || value.back() == '\n' || value.back() == ' ')) value.pop_back();
        auto& response = *static_cast<Response*>(context);
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

QueuedTextReceipt IMessageClient::send_text(const std::string& phone, const std::string& text,
                                    std::optional<std::string> key) const {
    if (!canonical_phone(phone) || text.empty() || text.size() > 16384 || text.find('\0') != text.npos
        || !valid_utf8(text) || blank_text(text)) throw std::invalid_argument("Invalid strict plaintext input");
    if (key && (key->empty() || key->size() > 200 || key->find('\0') != key->npos || !valid_utf8(*key)))
        throw std::invalid_argument("Invalid strict text idempotency key");
    Json payload{{"phone", phone}, {"body", text}};
    if (key) payload["idempotency_key"] = *key;
    auto response = request_with_response("/text-operations/v1", std::move(payload), "POST");
    const auto& data = response.data;
    if (response.status != 202 || !data || !data->is_object() || data->size() != 4
        || !data->contains("success") || !data->at("success").is_boolean() || !data->at("success").get<bool>()
        || !data->contains("status") || data->at("status") != "queued"
        || !data->contains("message_id") || !data->at("message_id").is_string() || !public_id(data->at("message_id").get_ref<const std::string&>())
        || !data->contains("chat_id") || !data->at("chat_id").is_string() || !chat_id(data->at("chat_id").get_ref<const std::string&>()))
        throw ApiError(502, "unconfirmed_text_outcome", response.request_id, data.value_or(Json(nullptr)));
    return {true, data->at("message_id").get<std::string>(), data->at("chat_id").get<std::string>(), "queued"};
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
                                                     std::optional<std::string> idempotency_key) const {
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
    const auto add_header = [&headers](const std::string& value) {
        auto* next = curl_slist_append(headers.get(), value.c_str());
        if (!next) throw std::runtime_error("Cannot allocate Chert headers");
        static_cast<void>(headers.release());
        headers.reset(next);
    };
    add_header("Authorization: Bearer " + key_);
    add_header("Accept: application/json");
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
    if (body) {
        set(CURLOPT_POSTFIELDS, payload.c_str());
        set(CURLOPT_POSTFIELDSIZE_LARGE, static_cast<curl_off_t>(payload.size()));
    }
    const auto result = curl_easy_perform(handle.get());
    long status = 0;
    static_cast<void>(curl_easy_getinfo(handle.get(), CURLINFO_RESPONSE_CODE, &status));
    const auto id = response.trace.empty() ? response.request : response.trace;
    if (result != CURLE_OK) throw ApiError(status, "outcome_unknown", id);
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
