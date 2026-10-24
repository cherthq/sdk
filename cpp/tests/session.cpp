#include <trychert/client.hpp>
#include <iostream>
void check(bool ok) { if (!ok) throw std::runtime_error("Session contract failed"); }
int main(int argc, char** argv) {
    try {
        check(argc == 4);
        const std::string mode(argv[3]);
        trychert::UnifiedSessionOptions options{"chu_" + std::string(43, 'a'),
            "11111111-1111-4111-8111-111111111111", argv[1], argv[2]};
        if (mode == "invalid-token") options.access_token = "legacy";
        if (mode == "invalid-project") options.project_id = "project";
        if (mode == "invalid-origin") options.facetime_base_url += "/foreign";
        if (mode.starts_with("invalid-")) {
            try { static_cast<void>(trychert::Client::connect(options)); check(false); }
            catch (const std::invalid_argument&) { return 0; }
        }
        if (mode.starts_with("discovery-")) {
            try { static_cast<void>(trychert::Client::connect(options)); check(false); }
            catch (const trychert::ApiError& e) { check(e.code == "unsupported_unified_backend"); return 0; }
        }
        const auto client = trychert::Client::connect(options);
        if (mode.starts_with("positive")) {
            check(client.imessage.list_events().at("count") == 0);
            const auto receipt = client.imessage.send_text("+15550000002", "Unified plaintext", "session-send-key");
            check(receipt.success && receipt.status == "queued" && receipt.message_id == std::string(32, 'a')
                && receipt.chat_id == "chat-1");
            check(client.facetime.request("/probe").data.at("ok") == true);
            int frames = 0;
            client.imessage.stream_events([&](const auto&) { ++frames; return false; });
            check(frames == 1);
        } else {
            int frames = 0;
            try {
                if (mode.starts_with("sse-"))
                    client.imessage.stream_events([&](const auto&) { ++frames; return true; });
                else if (mode.starts_with("ft-")) static_cast<void>(client.facetime.request("/probe"));
                else if (mode.starts_with("send-")) static_cast<void>(client.imessage.send_text("+15550000002", "Unified plaintext", "session-send-key"));
                else static_cast<void>(client.imessage.list_events());
                check(false);
            } catch (const trychert::ApiError& e) { check(e.code == "unsupported_unified_backend" && frames == 0); }
        }
    } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
