#pragma once
#include <trychert/imessage.hpp>
#include <trychert/facetime.hpp>

namespace trychert {
struct Options { IMessageOptions imessage; FaceTimeOptions facetime; };
struct UnifiedSessionOptions {
    std::string access_token;
    std::string project_id;
    std::string imessage_base_url = "https://console.trychert.com";
    std::string facetime_base_url = "https://facetime.trychert.com";
};
class Client final {
public:
    // Opt-in proposed contract: unauthenticated discovery before using the token.
    [[nodiscard]] static Client connect(UnifiedSessionOptions options);
    explicit Client(Options options)
        : imessage(std::move(options.imessage)), facetime(std::move(options.facetime)) {}
    IMessageClient imessage;
    FaceTimeClient facetime;
};
} // namespace trychert
