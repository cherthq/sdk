#include <trychert/client.hpp>
#include <cstdlib>
#include <iostream>

std::string required(const char* name) {
    const auto* value = std::getenv(name);
    if (!value || !*value) throw std::invalid_argument("Missing explicit channel configuration");
    return value;
}
int main(int argc, char**) {
    // Default is an offline construction smoke test, with no network I/O.
    if (argc == 1) {
        const trychert::Client client({{.api_key = "not-a-credential"},
            {.api_key = "separate-not-a-credential", .project_id = "11111111-1111-4111-8111-111111111111"}});
        std::cout << "trychert constructed; no requests sent\n";
        return 0;
    }
    try {
        trychert::Options options{
            {.api_key = required("CHERT_IMESSAGE_KEY")},
            {.api_key = required("CHERT_FACETIME_KEY"), .project_id = required("CHERT_FACETIME_PROJECT")}};
        if (const auto* value = std::getenv("CHERT_IMESSAGE_TENANT")) options.imessage.tenant = value;
        if (const auto* value = std::getenv("CHERT_IMESSAGE_URL")) options.imessage.base_url = value;
        if (const auto* value = std::getenv("CHERT_FACETIME_URL")) options.facetime.base_url = value;
        const trychert::Client client(std::move(options));
        // Read-only. No calls or messages are initiated by this example.
        std::cout << "FaceTime lines: " << client.facetime.list_lines().data.total << '\n';
        static_cast<void>(client.imessage.request("/whoami"));
    } catch (const trychert::ApiError& error) {
        // Do not log raw error.data, response bodies, credentials or transcripts.
        std::cerr << "Request failed with status " << error.status << '\n';
        return 1;
    } catch (const std::exception&) {
        std::cerr << "Configuration or transport initialization failed\n";
        return 1;
    }
}
