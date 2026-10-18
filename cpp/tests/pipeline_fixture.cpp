// Explicit synthetic-key helper for the guarded local M4D pipeline only.
#include <chert/client.hpp>
#include <array>
#include <iostream>
#include <regex>
#include <string_view>

int main(int argc, char** argv) {
    if (argc != 3 || std::string_view(argv[1]) != "--one-reviewed-pipeline-send") return 2;
    try {
        const std::string origin(argv[2]);
        if (!std::regex_match(origin, std::regex(R"(^http://127\.0\.0\.1:([1-9][0-9]{0,4})$)"))) return 2;
        const auto port = std::stoul(origin.substr(origin.rfind(':') + 1));
        if (port > 65535) return 2;
        std::array<char, 16385> input{};
        std::cin.read(input.data(), static_cast<std::streamsize>(input.size()));
        const auto length = static_cast<std::size_t>(std::cin.gcount());
        if (length > 16384) return 2;
        const auto body = chert::Json::parse(input.data(), input.data() + length, nullptr, false);
        if (!body.is_object() || body.size() != 2 || !body.contains("phone") || !body.contains("body")
            || !body["phone"].is_string() || !body["body"].is_string()) return 2;
        if (!std::regex_match(body["phone"].get<std::string>(), std::regex(R"(^\+[1-9][0-9]{1,14}$)"))
            || !std::regex_match(body["body"].get<std::string>(), std::regex(
                R"(^CHERT-M4D-PIPELINE-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-cpp$)"))) return 2;
        const chert::Client client(origin, "fixture-local-key", {}, std::chrono::seconds(45));
        const auto result = client.request("/send", body, "POST");
        std::cout << chert::Json{{"ok", true}, {"data", result.value_or(nullptr)}}.dump() << '\n';
    } catch (const chert::ApiError& error) {
        std::cout << chert::Json{{"ok", false}, {"status", error.status}, {"code", error.code}, {"display", error.what()}}.dump() << '\n';
    } catch (const std::exception&) { return 2; }
}
