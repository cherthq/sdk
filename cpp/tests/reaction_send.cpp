#include <chert/client.hpp>
#include <chrono>
#include <iostream>
#include <string_view>
#define CHECK(value) do { if (!(value)) throw std::runtime_error("Reaction contract failed at line " + std::to_string(__LINE__)); } while (false)
template<class Callable> void invalid(Callable&& callable) {
    bool rejected = false;
    try { callable(); } catch (const std::invalid_argument&) { rejected = true; }
    CHECK(rejected);
}
void sanitized(const chert::ApiError& error) {
    CHECK(std::string_view(error.what()).find("private") == std::string_view::npos);
    CHECK(std::string_view(error.what()).find("fixture-secret") == std::string_view::npos);
}
int main(int argc, char** argv) {
    try {
        CHECK(argc == 2);
        const std::string chat = "a1000000-0000-4000-8000-000000000001";
        const chert::Client client(argv[1], "fixture-secret", "fixture-tenant");
        for (const auto& id : {"chat-a", "../chat", "a1000000-0000-4000-8000-000000000001\n", "a1000000-0000-4000-8000-00000000000g"})
            invalid([&] { static_cast<void>(client.send_reaction(id, "message-a", "love")); });
        for (const auto& id : {std::string(), std::string("."), std::string(".."), std::string("a/b"), std::string("a?x"), std::string("a#x"), std::string("a%2f"), std::string("a\\b"), std::string("a\n"), std::string("é"), std::string(161, 'a')})
            invalid([&] { static_cast<void>(client.send_reaction(chat, id, "love")); });
        for (const auto& reaction : {"", "LOVE", "custom", "❤", "love\n"})
            invalid([&] { static_cast<void>(client.send_reaction(chat, "message-a", reaction)); });
        for (const auto& key : {std::string(), std::string(" leading"), std::string("trailing "), std::string("a\n"), std::string("a\t"), std::string("\x7f"), std::string("é"), std::string("a\0b", 3), std::string(201, 'k')})
            invalid([&] { static_cast<void>(client.send_reaction(chat, "message-a", "love", false, key)); });
        const auto result = client.send_reaction(chat, "message-a", "love");
        CHECK(result.operation_id == std::string(32, 'a') && result.chat_id == chat && result.message_id == "message-a" && result.status == "acknowledged");
        CHECK(client.send_reaction(chat, "message-b", "like", true, "unique reaction key").status == "acknowledged");
        CHECK(client.send_reaction("A1000000-0000-4000-8000-000000000001", "Message:exact_id.v1", "love", false, std::string(200, 'k')).chat_id.front() == 'a');
        for (const auto& reaction : {"love", "like", "dislike", "laugh", "emphasize", "question"})
            CHECK(client.send_reaction(chat, "standard-" + std::string(reaction), reaction).status == "acknowledged");
        for (const auto& mode : {"http200", "http201", "http204", "http206", "extra", "uuid-operation", "uppercase-operation", "wrong-chat", "wrong-case-chat", "wrong-message", "wrong-case-message", "applied", "missing", "null", "wrongtype", "empty-operation"}) {
            bool rejected = false;
            try { static_cast<void>(client.send_reaction(chat, mode, "love")); }
            catch (const chert::ApiError& error) {
                rejected = true; sanitized(error);
                CHECK(error.status == 502 && error.code == "unconfirmed_reaction_outcome" && error.request_id == "trace-reaction");
                if (std::string_view(mode) == "extra") CHECK(error.data.at("unexpected_field") == "private-response");
            }
            CHECK(rejected);
        }
        for (const auto& mode : {"api-error", "redirect", "nonjson", "drop"}) {
            bool rejected = false;
            try { static_cast<void>(client.send_reaction(chat, mode, "love")); }
            catch (const chert::ApiError& error) {
                rejected = true; sanitized(error);
                if (std::string_view(mode) == "api-error") CHECK(error.code == "4103" && error.data.at("operation_id") == std::string(32, 'b'));
                if (std::string_view(mode) == "redirect") CHECK(error.status == 307);
                if (std::string_view(mode) == "nonjson") CHECK(error.code == "invalid_response");
                if (std::string_view(mode) == "drop") CHECK(error.code == "outcome_unknown");
            }
            CHECK(rejected);
        }
        bool timed_out = false;
        try { static_cast<void>(chert::Client(argv[1], "fixture-secret", "fixture-tenant", std::chrono::milliseconds(30)).send_reaction(chat, "slow", "love")); }
        catch (const chert::ApiError& error) { sanitized(error); timed_out = error.code == "outcome_unknown"; }
        CHECK(timed_out);
        std::cout << "Typed reaction exact acknowledgement and one-attempt faults: PASS\n";
        return 0;
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
