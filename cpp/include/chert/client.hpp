#pragma once

#include <chrono>
#include <nlohmann/json.hpp>
#include <optional>
#include <stdexcept>
#include <string>

namespace chert {
using Json = nlohmann::json;

class ApiError final : public std::runtime_error {
public:
    ApiError(long status, std::string code, std::string request_id, Json data = nullptr);
    const long status;
    const std::string code;
    const std::string request_id;
    // Raw server data may contain customer content; inspect deliberately, never log automatically.
    const Json data;
};

// Cloud operation identity only; queued is not native send/delivery proof.
struct QueuedTextReceipt {
    bool success;
    std::string message_id;
    std::string chat_id;
    std::string status;
};

// Public cloud dispatch identity only; acknowledgement is not application proof.
struct ReactionReceipt {
    std::string operation_id;
    std::string chat_id;
    std::string message_id;
    std::string status;
};

class Client final {
public:
    Client(std::string base_url, std::string api_key,
           std::optional<std::string> tenant = std::nullopt,
           std::chrono::milliseconds timeout = std::chrono::seconds(15));
    [[nodiscard]] std::optional<Json> request(const std::string& path,
        std::optional<Json> body = std::nullopt, std::string method = {}) const;
    [[nodiscard]] QueuedTextReceipt send_text(const std::string& phone, const std::string& text,
        std::optional<std::string> idempotency_key = std::nullopt) const;
    [[nodiscard]] ReactionReceipt send_reaction(const std::string& chat_id, const std::string& message_id,
        const std::string& reaction, bool remove = false,
        std::optional<std::string> idempotency_key = std::nullopt) const;
private:
    struct RequestResult {
        long status;
        std::string request_id;
        std::optional<Json> data;
    };
    [[nodiscard]] RequestResult request_with_response(const std::string& path,
        std::optional<Json> body, std::string method,
        std::optional<std::string> idempotency_key = std::nullopt) const;
    std::string base_;
    std::string key_;
    std::optional<std::string> tenant_;
    std::chrono::milliseconds timeout_;
};
} // namespace chert
