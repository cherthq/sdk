#pragma once

#include <chrono>
#include <functional>
#include <nlohmann/json.hpp>
#include <optional>
#include <stop_token>
#include <stdexcept>
#include <string>
#include <utility>

namespace trychert {
using Json = nlohmann::json;
class Client;

class ApiError final : public std::runtime_error {
public:
    ApiError(long status, std::string code, std::string request_id, Json data = nullptr);
    const long status;
    const std::string code;
    const std::string request_id;
    // Raw server data may contain customer content. Never log automatically.
    const Json data;
};

namespace detail {
enum class Scope { tenant, project };
struct Response {
    long status;
    std::string request_id;
    std::optional<Json> data;
};

// Shared mechanics, not shared credentials. Each channel owns its transport.
class Transport {
public:
    Transport(std::string base_url, std::string api_key,
              std::optional<std::string> scope,
              std::chrono::milliseconds timeout, Scope scope_kind = Scope::tenant);
    [[nodiscard]] std::optional<Json> request(const std::string& path,
        std::optional<Json> body = std::nullopt, std::string method = {}) const;
protected:
    [[nodiscard]] Response request_with_response(const std::string& path,
        std::optional<Json> body, std::string method,
        std::optional<std::string> idempotency_key = std::nullopt,
        std::function<bool(const std::string&, const Json&)> stream = {},
        std::stop_token stop = {}) const;
private:
    friend class ::trychert::Client;
    bool discovery_ = false;
    bool unified_ = false;
    std::string base_;
    std::string key_;
    std::optional<std::string> scope_;
    std::chrono::milliseconds timeout_;
    Scope scope_kind_;
};
} // namespace detail
} // namespace trychert
