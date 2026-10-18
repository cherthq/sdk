// Dedicated synthetic loopback fixture only. Never accepts cloud/device origins.
#include <chert/client.hpp>
#include <algorithm>
#include <charconv>
#include <chrono>
#include <iostream>
#include <string_view>

namespace {
bool origin(std::string_view value) {
    constexpr std::string_view prefix = "http://127.0.0.1:";
    if (!value.starts_with(prefix)) return false;
    const auto port = value.substr(prefix.size());
    if (port.empty() || port.size() > 5 || port.front() == '0'
        || !std::all_of(port.begin(), port.end(), [](unsigned char c) { return c >= '0' && c <= '9'; })) return false;
    unsigned number = 0;
    const auto result = std::from_chars(port.data(), port.data() + port.size(), number);
    return result.ec == std::errc{} && result.ptr == port.data() + port.size() && number > 0 && number <= 65535;
}
bool public_id(const std::string& value) {
    return value.size() == 32 && std::all_of(value.begin(), value.end(), [](unsigned char c) {
        return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'); });
}
bool chat_id(const std::string& value) {
    return !value.empty() && value.size() <= 160 && std::all_of(value.begin(), value.end(), [](unsigned char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == ':' || c == '_' || c == '-'; });
}
void output(const chert::Json& value) { std::cout << value.dump() << '\n'; }
}
int main(int argc, char** argv) {
    if (argc != 3 || std::string_view(argv[1]) != "--typed-text-fixture" || !origin(argv[2])) return 2;
    try {
        constexpr std::size_t maximum = 128 * 1024;
        auto bytes = std::string();
        char character = 0;
        while (std::cin.get(character)) {
            if (bytes.size() >= maximum) return 2;
            bytes.push_back(character);
        }
        if (!std::cin.eof()) return 2;
        const auto body = chert::Json::parse(bytes, nullptr, false);
        if (!body.is_object() || (body.size() != 3 && body.size() != 4)) return 2;
        for (const auto& [key, value] : body.items()) {
            if ((key != "api_key" && key != "phone" && key != "text" && key != "idempotency_key") || !value.is_string()) return 2;
        }
        if (!body.contains("api_key") || !body.contains("phone") || !body.contains("text")
            || body.at("phone") != "+15550000002"
            || !body.at("text").get_ref<const std::string&>().starts_with("CHERT-TYPED-TEXT-")) return 2;
        auto key = std::optional<std::string>{};
        if (body.contains("idempotency_key")) key = body.at("idempotency_key").get<std::string>();
        const chert::Client client(argv[2], body.at("api_key").get<std::string>(), "fixture", std::chrono::seconds(5));
        const auto receipt = client.send_text(body.at("phone").get<std::string>(), body.at("text").get<std::string>(), std::move(key));
        output({{"success", receipt.success}, {"message_id", receipt.message_id}, {"chat_id", receipt.chat_id}, {"status", receipt.status}});
        return 0;
    } catch (const chert::ApiError& error) {
        chert::Json result{{"ok", false}, {"status", error.status}, {"code", error.code == "4103" ? "4103" : "request_failed"}};
        if (error.data.is_object()) {
            const auto message = error.data.find("message_id");
            if (message != error.data.end() && message->is_string() && public_id(message->get_ref<const std::string&>())) result["message_id"] = *message;
            const auto chat = error.data.find("chat_id");
            if (chat != error.data.end() && chat->is_string() && chat_id(chat->get_ref<const std::string&>())) result["chat_id"] = *chat;
        }
        output(result);
        return 0;
    } catch (...) { return 2; }
}
