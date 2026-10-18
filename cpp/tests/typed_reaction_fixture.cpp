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
void output(const chert::Json& value) { std::cout << value.dump() << '\n'; }
}
int main(int argc, char** argv) {
    if (argc != 3 || std::string_view(argv[1]) != "--typed-reaction-fixture" || !origin(argv[2])) return 2;
    try {
        constexpr std::size_t maximum = 16 * 1024;
        auto bytes = std::string();
        char character = 0;
        while (std::cin.get(character)) {
            if (bytes.size() >= maximum) return 2;
            bytes.push_back(character);
        }
        if (!std::cin.eof()) return 2;
        const auto body = chert::Json::parse(bytes, nullptr, false);
        if (!body.is_object() || (body.size() != 5 && body.size() != 6)) return 2;
        for (const auto& [key, value] : body.items()) {
            if (key == "remove") { if (!value.is_boolean()) return 2; }
            else if ((key != "api_key" && key != "chat_id" && key != "message_id" && key != "reaction" && key != "idempotency_key") || !value.is_string()) return 2;
        }
        for (const auto* key : {"api_key", "chat_id", "message_id", "reaction", "remove"}) if (!body.contains(key)) return 2;
        auto key = std::optional<std::string>{};
        if (body.contains("idempotency_key")) key = body.at("idempotency_key").get<std::string>();
        const chert::Client client(argv[2], body.at("api_key").get<std::string>(), std::nullopt, std::chrono::seconds(5));
        const auto receipt = client.send_reaction(body.at("chat_id").get<std::string>(), body.at("message_id").get<std::string>(),
            body.at("reaction").get<std::string>(), body.at("remove").get<bool>(), std::move(key));
        output({{"operation_id", receipt.operation_id}, {"message_id", receipt.message_id}, {"chat_id", receipt.chat_id}, {"status", receipt.status}});
        return 0;
    } catch (const chert::ApiError& error) {
        chert::Json result{{"ok", false}, {"status", error.status}, {"code", error.code == "4103" ? "4103" : "request_failed"}};
        if (error.data.is_object()) {
            const auto operation = error.data.find("operation_id");
            if (operation != error.data.end() && operation->is_string() && public_id(operation->get_ref<const std::string&>())) result["operation_id"] = *operation;
        }
        output(result);
        return 0;
    } catch (...) { return 2; }
}
