#include <trychert/imessage.hpp>
#include <iostream>
#include <thread>

void check(bool ok) { if (!ok) throw std::runtime_error("Event contract failed"); }
int main(int argc, char** argv) {
    try {
        check(argc == 2);
        const trychert::IMessageClient client(argv[1], "secret", "tenant");
        trychert::EventListOptions query;
        query.type = "message.received"; query.status = "delivered"; query.lead_id = "lead";
        query.since = "opaque +/é"; query.cursor = "a&b"; query.limit = 200;
        check(client.list_events(query).at("count") == 0);
        check(client.get_event("row-1").at("id") == "row-1");
        check(client.list_webhook_subscriptions().at("subscriptions").empty());
        check(client.get_webhook_subscription("sub-1").contains("subscription"));
        trychert::CreateWebhookSubscription create;
        create.url = "https://example.com/hook";
        check(client.create_webhook_subscription(create).at("subscription").at("secret") == "once");
        trychert::UpdateWebhookSubscription update;
        update.is_active = false; update.events = std::vector<std::string>{};
        check(client.update_webhook_subscription("sub-1", update).contains("subscription"));
        check(client.delete_webhook_subscription("sub-1").at("deleted") == true);
        for (const int limit : {0, 201}) {
            query.limit = limit;
            try { static_cast<void>(client.list_events(query)); check(false); }
            catch (const std::invalid_argument&) {}
        }
        for (const auto* id : {"", "..", "a/b", "%2f", "x?y"}) {
            try { static_cast<void>(client.get_event(id)); check(false); }
            catch (const std::invalid_argument&) {}
        }
        int frames = 0;
        client.stream_events([&](const auto& frame) {
            ++frames;
            if (frames == 1) check(frame.event == "message" && frame.data.at("text") == "héllo");
            if (frames == 2) check(frame.event == "error" && frame.data.at("code") == "preview");
            if (frames == 3) check(frame.event == "close" && frame.data.at("since") == "opaque");
            return true;
        }, "opaque +/é");
        check(frames == 3);
        for (const auto* event : {"message", "close"}) {
            for (const int delta : {-1, 0, 1}) {
                frames = 0;
                try {
                    client.stream_events([&](const auto& frame) {
                        ++frames; check(frame.event == event); return true;
                    }, std::string("boundary-") + event + ":" + std::to_string(delta));
                    check(delta <= 0 && frames == 1);
                } catch (const trychert::ApiError& e) {
                    check(delta == 1 && frames == 0 && e.code == "event_frame_too_large");
                }
            }
        }
        for (const auto* kind : {"consecutive", "bare-cr-eof"}) {
            frames = 0;
            client.stream_events([&](const auto&) { ++frames; return true; }, kind);
            check(frames == (std::string(kind) == "consecutive" ? 2 : 1));
        }
        for (const auto* kind : {"mixed-case", "mixed-case-empty"}) {
            frames = 0;
            client.stream_events([&](const auto&) { ++frames; return true; }, kind);
            check(frames == (std::string(kind) == "mixed-case" ? 3 : 0));
        }
        for (const auto* kind : {"comments-large", "wrong-type", "wrong-type-empty"}) {
            frames = 0;
            try {
                client.stream_events([&](const auto&) { ++frames; return true; }, kind);
                check(false);
            } catch (const trychert::ApiError& e) {
                check(e.code == (std::string(kind) == "comments-large" ? "event_frame_too_large" : "invalid_event_stream"));
            }
            check(frames == 0);
        }
        frames = 0;
        client.stream_events([&](const auto&) { ++frames; return false; }, "stop");
        check(frames == 1);
        for (const auto* kind : {"large", "invalid", "utf8", "redirect", "denied"}) {
            try { client.stream_events([](const auto&) { return true; }, kind); check(false); }
            catch (const trychert::ApiError&) {}
        }
        std::stop_source stopped;
        stopped.request_stop();
        client.stream_events([](const auto&) { return true; }, "pre-cancel", stopped.get_token());
        std::stop_source cancel;
        std::jthread timer([&] { std::this_thread::sleep_for(std::chrono::milliseconds(100)); cancel.request_stop(); });
        client.stream_events([](const auto&) { return true; }, "idle", cancel.get_token());
        try {
            client.stream_events([](const auto&) -> bool { throw std::logic_error("callback"); }, "throw");
            check(false);
        } catch (const std::logic_error& e) { check(std::string(e.what()) == "callback"); }
        std::cout << "Event contracts passed\n";
    } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
