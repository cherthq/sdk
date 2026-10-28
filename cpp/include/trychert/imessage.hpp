#pragma once
#include <trychert/transport.hpp>
#include <vector>

namespace trychert {
struct EventListOptions {
    std::optional<std::string> type, status, lead_id, since, cursor;
    std::optional<int> limit;
};
struct CreateWebhookSubscription {
    std::string url;
    std::optional<std::vector<std::string>> events;
    std::optional<std::string> version;
};
struct UpdateWebhookSubscription {
    std::optional<std::string> url;
    std::optional<std::vector<std::string>> events;
    std::optional<std::string> version;
    std::optional<bool> is_active;
};
struct MessagingStreamFrame { std::string event; Json data; };
// Acceptance receipt only. status is "queued", "sent" (CRM dispatched it to a line) or
// "duplicate" (the line's duplicate check already had this message; message_id is a new record);
// none is delivery proof. success is the SDK's acceptance flag.
struct QueuedTextReceipt {
    bool success;
    std::string message_id;
    std::string chat_id;
    std::string status; // "queued" | "sent" | "duplicate"
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
    friend class Client;
public:
    explicit IMessageClient(IMessageOptions options)
        : Transport(std::move(options.base_url), std::move(options.api_key),
                    std::move(options.tenant), options.timeout) {}
    IMessageClient(std::string base_url, std::string api_key,
                   std::optional<std::string> tenant = std::nullopt,
                   std::chrono::milliseconds timeout = std::chrono::seconds(15))
        : Transport(std::move(base_url), std::move(api_key), std::move(tenant), timeout) {}
    using Transport::request;
    // JSON results retain the public route envelopes and additive fields.
    [[nodiscard]] Json list_events(const EventListOptions& options = {}) const;
    [[nodiscard]] Json get_event(const std::string& row_id) const;
    [[nodiscard]] Json list_webhook_subscriptions() const;
    [[nodiscard]] Json get_webhook_subscription(const std::string& id) const;
    [[nodiscard]] Json create_webhook_subscription(const CreateWebhookSubscription& input) const;
    [[nodiscard]] Json update_webhook_subscription(const std::string& id, const UpdateWebhookSubscription& input) const;
    [[nodiscard]] Json delete_webhook_subscription(const std::string& id) const;
    // Synchronous single connection. False or stop_requested closes it normally.
    void stream_events(const std::function<bool(const MessagingStreamFrame&)>& callback,
        std::optional<std::string> since = std::nullopt, std::stop_token stop = {}) const;
    [[nodiscard]] QueuedTextReceipt send_text(const std::string& phone, const std::string& text,
        std::optional<std::string> idempotency_key = std::nullopt) const;
    [[nodiscard]] ReactionReceipt send_reaction(const std::string& chat_id, const std::string& message_id,
        const std::string& reaction, bool remove = false,
        std::optional<std::string> idempotency_key = std::nullopt) const;
};
} // namespace trychert
