#include <trychert/client.hpp>
#include <iostream>
#include <string_view>

namespace {
constexpr auto project = "11111111-1111-4111-8111-111111111111";
constexpr auto call_id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
constexpr auto line_id = "22222222-2222-4222-8222-222222222222";
void check(bool value) { if (!value) throw std::runtime_error("Unified contract failed"); }
template<class F> void invalid(F f) {
    try { f(); } catch (const std::invalid_argument&) { return; }
    throw std::runtime_error("Expected local validation failure");
}
template<class F> void failure(F f, const std::string& code, long status = 502, bool envelope_id = true) {
    try { f(); }
    catch (const trychert::ApiError& e) {
        check(e.code == code && e.status == status);
        if (envelope_id) check(e.request_id == "body-request-id");
        check(std::string_view(e.what()).find("private") == std::string_view::npos);
        check(std::string_view(e.what()).find("secret") == std::string_view::npos);
        return;
    }
    throw std::runtime_error("Expected sanitized API failure");
}
}
int main(int argc, char** argv) {
    try {
        check(argc == 3);
        const trychert::IMessageOptions im_defaults{.api_key = "im-secret", .tenant = "im-tenant"};
        const trychert::FaceTimeOptions ft_defaults{.api_key = "ft-secret", .project_id = project};
        check(im_defaults.base_url == "https://console.trychert.com");
        check(ft_defaults.base_url == "https://facetime.trychert.com");
        // Construction with omitted URLs is offline; do not contact production.
        const trychert::Client defaults({im_defaults, ft_defaults});
        const std::string im_origin(argv[1]), ft_origin(argv[2]);
        for (const auto* suffix : {"", "/", "/api/v1", "/api/v1/", "/custom/api/v1/"}) {
            auto im = im_defaults;
            auto ft = ft_defaults;
            im.base_url = im_origin + suffix;
            ft.base_url = ft_origin + suffix;
            const trychert::Client overridden({im, ft});
            check(overridden.imessage.send_text("+15550000002", "separate transport", "text-key").status == "queued");
            check(overridden.facetime.list_lines({1, 9}).data.items[0].supports_video);
        }
        const trychert::Client client({{im_origin, "im-secret", "im-tenant"},
            {ft_origin + "/deployment/api/v1", "ft-secret", project}});
        const auto scenario = [&](const std::string& name) {
            return trychert::FaceTimeClient({ft_origin + "/case/" + name, "ft-secret", project});
        };
        check(client.imessage.send_text("+15550000002", "separate transport", "text-key").status == "queued");
        const auto calls = client.facetime.list_calls({2, 7});
        check(calls.status == 200 && calls.request_id == "body-request-id");
        check(calls.data.total == 19 && calls.data.offset == 7 && calls.data.limit == 2 && calls.data.items.size() == 1);
        check(calls.data.items[0].status == "future_status" && !calls.data.items[0].terminal_reason);
        const auto call = client.facetime.get_call("AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE");
        check(call.data.id == call_id && call.data.media.audio && !call.data.media.video);
        check(call.data.fields.at("future_extension").at("nested").at(0) == "preserved");
        check(client.facetime.list_lines({1, 9}).data.items[0].supports_video);
        check(client.facetime.list_workers({100, 3}).data.items[0].status == "offline");
        const auto events = client.facetime.get_call_events(call_id).data.events;
        check(events.size() == 2 && !events[0].sequence && events[1].sequence == 42 && events[1].source == "service");
        const auto transcript = client.facetime.get_transcript(call_id).data;
        check(transcript.schema_version == 1 && transcript.turns.size() == 2);
        check(transcript.turns[0].speaker == "caller" && transcript.turns[1].text == "héllo");
        trychert::CreateCall input;
        input.line_id = line_id;
        input.destination = "+15550000002";
        input.destination_type = trychert::DestinationType::phone;
        input.room = trychert::RoomCredentials{"wss://room.example.test", "private-room-token", "agent-identity"};
        check(client.facetime.create_call(input, "call-key").data.id == call_id);
        input.media.video = true;
        check(client.facetime.create_call(input, std::string(200, 'k')).data.media.video);
        input.room.reset(); input.mode = trychert::CallMode::managed; input.assistant_id = project;
        check(client.facetime.create_call(input, "managed-key").data.mode == "managed");
        input.destination.reset(); input.destination_type.reset();
        input.recipients = {{trychert::RecipientType::email, "a@example.test"},
                            {trychert::RecipientType::phone_number, "+15550000002"}};
        check(client.facetime.create_call(input, "group-key").data.id == call_id);
        input.recipients.clear(); input.destination = "https://facetime.apple.com/join#a";
        input.destination_type = trychert::DestinationType::facetime_link;
        check(client.facetime.create_call(input, "link-key").data.id == call_id);
        for (const auto action : {trychert::CallAction::answer, trychert::CallAction::reject, trychert::CallAction::end})
            check(client.facetime.act_on_call(call_id, action, "action-key", "reason").status == 202);
        trychert::UpdateLine patch;
        patch.display_name = "New line";
        patch.assistant_id.emplace(std::nullopt);
        patch.integration_id.emplace(project);
        patch.inbound_policy = trychert::InboundPolicy::customer_decides;
        patch.video_framing = trychert::VideoFraming::fill;
        patch.connecting_screen_dismissal = trychert::ConnectingScreenDismissal::video;
        patch.connecting_screen_appearance = trychert::ConnectingScreenAppearance::black;
        check(client.facetime.update_line(line_id, patch).data.display_name == "New line");
        check(client.facetime.request("/raw", trychert::Json(nullptr)).data.is_null());
        for (const auto* method : {"GET", "PUT", "PATCH", "DELETE"})
            check(client.facetime.request("/raw", {}, method).data.at("method") == method);

        // All invalid calls below must fail before HTTP; the server verifies counts.
        for (const auto* bad : {"", "../escape", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeeg", "a?b"}) {
            invalid([&] { static_cast<void>(client.facetime.get_call(bad)); });
            invalid([&] { static_cast<void>(trychert::FaceTimeClient({ft_origin, "ft-secret", bad})); });
        }
        for (const auto* bad : {"", " ", "http://public.invalid", "https://u:p@example.test", "https://example.test/#x"}) {
            invalid([&] { static_cast<void>(trychert::FaceTimeClient({bad, "ft-secret", project})); });
            invalid([&] { static_cast<void>(trychert::IMessageClient(trychert::IMessageOptions{bad, "im-secret", "im-tenant"})); });
        }
        invalid([&] { static_cast<void>(trychert::FaceTimeClient({ft_origin, "ft-secret\r\nInjected:x", project})); });
        for (const auto page : {trychert::Pagination{0, 0}, {101, 0}, {1, -1}, {1, 9007199254740992LL}})
            invalid([&] { static_cast<void>(client.facetime.list_calls(page)); });
        for (const auto& bad : {std::string("short"), std::string(201, 'k'), std::string(" leading-key"),
                               std::string("trailing-key "), std::string("inject\r\nkey"), std::string("nonascii-é")})
            invalid([&] { static_cast<void>(client.facetime.create_call(input, bad)); });
        invalid([&] { static_cast<void>(client.facetime.update_line(line_id, {})); });
        invalid([&] { static_cast<void>(client.facetime.act_on_call(call_id, static_cast<trychert::CallAction>(99), "action-key")); });
        invalid([&] { static_cast<void>(client.facetime.act_on_call(call_id, trychert::CallAction::end, "action-key", std::string(161, 'x'))); });
        for (int variant = 0; variant < 10; ++variant) {
            auto bad = input;
            switch (variant) {
                case 0: bad.assistant_id.reset(); break;
                case 1: bad.destination.reset(); break;
                case 2: bad.line_id.reset(); break; // FaceTime link requires a line.
                case 3: bad.mode = static_cast<trychert::CallMode>(42); break;
                case 4: bad.destination_type = static_cast<trychert::DestinationType>(42); break;
                case 5: bad.recipients = {{trychert::RecipientType::email, "a@example.test"}}; break;
                case 6: bad.mode = trychert::CallMode::customer_managed; break; // assistant forbidden
                case 7: bad.destination = "https://other.example/join#a"; break;
                case 8: bad.destination = std::string("bad\0destination", 15); break;
                case 9: bad.room = trychert::RoomCredentials{"wss://x", "token", "identity"}; break;
            }
            invalid([&] { static_cast<void>(client.facetime.create_call(bad, "invalid-key")); });
        }
        for (const auto* path : {"//host/", "/../escape", "/%2fescape", "/%252e", "/a#b", "/a\n"})
            invalid([&] { static_cast<void>(client.facetime.request(path)); });

        for (const auto* name : {"wrong-id", "wrong-project", "missing-field", "bad-bool", "null-data", "wrong-status"})
            failure([&] { static_cast<void>(scenario(name).get_call(call_id)); }, "invalid_response");
        for (const auto* name : {"bad-page", "float-page", "huge-page", "negative-page", "object-items"})
            failure([&] { static_cast<void>(scenario(name).list_calls()); }, "invalid_response");
        failure([&] { static_cast<void>(scenario("bad-event").get_call_events(call_id)); }, "invalid_response");
        failure([&] { static_cast<void>(scenario("bad-transcript").get_transcript(call_id)); }, "invalid_response");
        failure([&] { static_cast<void>(scenario("wrong-id").update_line(line_id, patch)); }, "invalid_response");
        failure([&] { static_cast<void>(scenario("wrong-status").create_call(input, "call-key")); }, "invalid_response");
        failure([&] { static_cast<void>(scenario("wrong-status").act_on_call(call_id, trychert::CallAction::end, "action-key")); }, "invalid_response");
        for (const auto* name : {"missing-envelope", "missing-request-id", "error-envelope", "empty", "html"})
            failure([&] { static_cast<void>(scenario(name).request("/raw")); }, "invalid_response", 502, false);
        for (const auto status : {401, 403, 404, 409, 422, 429, 503})
            failure([&] { static_cast<void>(scenario("error-" + std::to_string(status)).request("/raw", trychert::Json::object())); }, "server_code", status);
        failure([&] { static_cast<void>(scenario("redirect").request("/raw", trychert::Json::object())); }, "request_failed", 307, false);
        failure([&] { static_cast<void>(scenario("drop").request("/raw", trychert::Json::object())); }, "outcome_unknown", 0, false);
        failure([&] { static_cast<void>(scenario("large").request("/raw", trychert::Json::object())); }, "outcome_unknown", 200, false);
        const trychert::FaceTimeClient timeout({ft_origin + "/case/slow", "ft-secret", project, std::chrono::milliseconds(50)});
        failure([&] { static_cast<void>(timeout.request("/raw", trychert::Json::object())); }, "outcome_unknown", 0, false);
        std::cout << "Unified channels, typed contracts, validation and fault paths passed\n";
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n'; return 1;
    }
}
