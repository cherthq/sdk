// Synthetic-key CLI for the actual Chert-route loopback fixture, never an installed tool.
#include <chert/client.hpp>
#include <iostream>

int main(int argc, char** argv) {
    if (argc != 3) return 2;
    try {
        const chert::Client client(argv[1], argv[2], "fixture-tenant");
        const auto data = client.request("/phone-numbers");
        std::cout << chert::Json{{"ok", true}, {"data", data.value_or(nullptr)}}.dump() << '\n';
    } catch (const chert::ApiError& error) {
        std::cout << chert::Json{{"ok", false}, {"status", error.status}, {"code", error.code}, {"display", error.what()}}.dump() << '\n';
    } catch (const std::exception&) { return 1; }
}
