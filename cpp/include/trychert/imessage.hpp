#pragma once
#include <trychert/transport.hpp>

namespace trychert {
// Queue/dispatch receipts are not physical send, delivery or application proof.
struct QueuedTextReceipt {
    bool success;
    std::string message_id;
    std::string chat_id;
    std::string status;
};
struct ReactionReceipt {
    std::string operation_id;
    std::string chat_id;
    std::string message_id;
    std::string status;
};
struct IMessageOptions {
    std::string base_url = "https://console.trychert.com";
    std::string api_key;
    std::optional<std::string> tenant = std::nullopt;
    std::chrono::milliseconds timeout = std::chrono::seconds(15);
};
class IMessageClient final : private detail::Transport {
public:
    explicit IMessageClient(IMessageOptions options)
        : Transport(std::move(options.base_url), std::move(options.api_key),
                    std::move(options.tenant), options.timeout) {}
    IMessageClient(std::string base_url, std::string api_key,
                   std::optional<std::string> tenant = std::nullopt,
                   std::chrono::milliseconds timeout = std::chrono::seconds(15))
        : Transport(std::move(base_url), std::move(api_key), std::move(tenant), timeout) {}
    using Transport::request;
    [[nodiscard]] QueuedTextReceipt send_text(const std::string& phone, const std::string& text,
        std::optional<std::string> idempotency_key = std::nullopt) const;
    [[nodiscard]] ReactionReceipt send_reaction(const std::string& chat_id, const std::string& message_id,
        const std::string& reaction, bool remove = false,
        std::optional<std::string> idempotency_key = std::nullopt) const;
};
} // namespace trychert
