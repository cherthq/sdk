#include <chert/client.hpp>
#include <chrono>
#include <iostream>
#include <string_view>

#define CHECK(value) do { if (!(value)) throw std::runtime_error("Strict text contract failed at line " + std::to_string(__LINE__)); } while (false)
template<class Callable> void invalid(Callable&& callable) {
    bool rejected = false;
    try { callable(); } catch (const std::invalid_argument&) { rejected = true; }
    CHECK(rejected);
}
void safe(const chert::ApiError& error) {
    CHECK(std::string_view(error.what()).find("private") == std::string_view::npos);
    CHECK(std::string_view(error.what()).find("fixture-secret") == std::string_view::npos);
}
int main(int argc, char** argv) {
    try {
        CHECK(argc == 2);
        const auto origin = std::string(argv[1]);
        const chert::Client client(origin, "fixture-secret", "fixture-tenant");
        for (const auto& phone : {"15550000002", "+05550000002", "+15550000002\n"})
            invalid([&] { static_cast<void>(client.send_text(phone, "hello")); });
        for (const auto& text : {std::string(), std::string(" \n\t"), std::string("\xc2\xa0"),
                 std::string("x\0y", 3), std::string("\xc0\xaf"), std::string("\xed\xa0\x80"), std::string(16385, 'x')})
            invalid([&] { static_cast<void>(client.send_text("+15550000002", text)); });
        for (const auto& key : {std::string(), std::string("x\0y", 3), std::string("\xff"), std::string(201, 'x'),
                 std::string(" key"), std::string("key\n"), std::string(" \n\t"), std::string("key\xe3\x80\x80"), std::string("\xef\xbb\xbfkey")})
            invalid([&] { static_cast<void>(client.send_text("+15550000002", "hello", key)); });
        auto receipt = client.send_text("+15550000002", "  exact / text  ", "key / \n inner");
        CHECK(receipt.success && receipt.message_id == "550e8400-e29b-41d4-a716-446655440000"
            && receipt.chat_id == "7c9e6679-7425-40de-944b-e07fc1f90ae7" && receipt.status == "queued");
        CHECK(client.send_text("+15550000002", "without-key").status == "queued");
        CHECK(client.send_text("+15550000002", std::string(16384, 'x'), std::string(200, 'k')).success);
        auto moons = std::string();
        auto unicode_key = std::string();
        for (int i = 0; i < 4096; ++i) moons += "🌙";
        for (int i = 0; i < 50; ++i) unicode_key += "🌙";
        invalid([&] { static_cast<void>(client.send_text("+15550000002", moons + "🌙")); });
        invalid([&] { static_cast<void>(client.send_text("+15550000002", "hello", unicode_key + "🌙")); });
        CHECK(client.send_text("+15550000002", moons, unicode_key).success);
        const auto sent = client.send_text("+15550000002", "sent200");
        CHECK(sent.success && sent.status == "sent" && sent.message_id == "550e8400-e29b-41d4-a716-446655440000");
        CHECK(client.send_text("+15550000002", "duplicate200").status == "duplicate");
        CHECK(client.send_text("+15550000002", "uppercase-id").message_id == std::string(36, 'A'));
        CHECK(client.send_text("+15550000002", "extra-field").status == "queued");
        for (const auto& mode : {"status200", "status201", "status204", "status206", "unsafe-chat", "empty-chat", "unsafe-id",
                 "long-id", "null-id", "numeric-chat", "sent-status", "null-receipt", "missing-field"}) {
            bool rejected = false;
            try { static_cast<void>(client.send_text("+15550000002", mode)); }
            catch (const chert::ApiError& error) {
                rejected = true; safe(error);
                CHECK(error.status == 502 && error.code == "unconfirmed_text_outcome" && error.request_id == "trace-text");
                if (std::string_view(mode) == "sent-status") CHECK(error.data.at("lead_id") == "6f1c2a5e-9b0d-4c3e-8a7f-1d2e3f4a5b6c");
            }
            CHECK(rejected);
        }
        for (const auto& mode : {"api-error", "redirect", "nonjson", "drop"}) {
            bool rejected = false;
            try { static_cast<void>(client.send_text("+15550000002", mode)); }
            catch (const chert::ApiError& error) {
                rejected = true; safe(error);
                if (std::string_view(mode) == "api-error") CHECK(error.code == "4103" && error.data.at("message_id") == std::string(32, 'b'));
                if (std::string_view(mode) == "redirect") CHECK(error.status == 307);
                if (std::string_view(mode) == "nonjson") CHECK(error.code == "invalid_response");
                if (std::string_view(mode) == "drop") CHECK(error.code == "outcome_unknown");
            }
            CHECK(rejected);
        }
        bool timed_out = false;
        try { static_cast<void>(chert::Client(origin, "fixture-secret", "fixture-tenant", std::chrono::milliseconds(30)).send_text("+15550000002", "slow")); }
        catch (const chert::ApiError& error) { safe(error); timed_out = error.code == "outcome_unknown"; }
        CHECK(timed_out);
        std::cout << "Strict text /send receipts/input bounds/one-attempt faults: PASS\n";
        return 0;
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
