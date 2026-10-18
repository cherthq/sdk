#include <chert/client.hpp>
#include <chrono>
#include <iostream>
#include <limits>
#include <string_view>

namespace {
void require(bool value) { if (!value) throw std::runtime_error("Chert SDK contract check failed"); }
template<class Callable> void invalid(Callable&& callable) {
    bool rejected = false;
    try { callable(); } catch (const std::invalid_argument&) { rejected = true; }
    require(rejected);
}
}
int main(int argc, char** argv) {
    try {
        require(argc == 2);
        const auto origin = std::string(argv[1]);
        const chert::Client client(origin + "/deployment/api/v1/", "fixture-secret", "fixture-tenant");
        for (const auto& base : {"http://public.invalid", "https://user:secret@host.invalid", "https://host.invalid?q=1",
                 "https://host.invalid#", "https://host.invalid/a/%2e%2e", "https://host.invalid/%2fprivate",
                 "https://host.invalid/a\\b", "https://host.invalid/\nprivate"})
            invalid([&] { static_cast<void>(chert::Client(base, "fixture-secret")); });
        invalid([&] { static_cast<void>(chert::Client(origin, "fixture-secret\r\nInjected: yes")); });
        invalid([&] { static_cast<void>(chert::Client(origin, "fixture-secret", "")); });
        invalid([&] { static_cast<void>(chert::Client(origin, "fixture-secret", {}, std::chrono::milliseconds(0))); });
        for (const auto& path : {"//evil.invalid/send", "/../escape", "/%2e%2e/escape", "/a/%2fescape", "/a/%5cescape",
                 "/a/%252e%252e", "/a/%00", "/a/%GG", "/a\\b", "/a#x", "relative", "/a\n"})
            invalid([&] { static_cast<void>(client.request(path)); });
        invalid([&] { static_cast<void>(client.request("/send", {}, "POST\r\nInjected: yes")); });
        invalid([&] { static_cast<void>(client.request("/send", chert::Json{{"value", std::numeric_limits<double>::infinity()}})); });
        invalid([&] { static_cast<void>(client.request("/send", chert::Json{{"value", std::numeric_limits<double>::quiet_NaN()}})); });
        invalid([&] { static_cast<void>(client.request("/send", chert::Json{{"value", std::string("\xff")}})); });

        require(client.request("/echo?limit=1")->at("method") == "GET");
        const auto sent = client.request("/echo", chert::Json{{"body", "hello"}, {"idempotency_key", "stable-key"}});
        require(sent->at("method") == "POST");
        require(sent->at("body").at("idempotency_key") == "stable-key");
        require(sent->at("authorization") == "Bearer fixture-secret");
        require(sent->at("tenant") == "fixture-tenant");
        const auto null_body = client.request("/echo", chert::Json(nullptr));
        require(null_body->at("method") == "POST" && null_body->at("raw") == "null");
        require(!client.request("/empty").has_value());
        require(client.request("/null")->is_null());
        require(!client.request("/head", {}, "HEAD").has_value());
        for (const auto& path : {"/error", "/logical", "/nonjson", "/badjson", "/redirect", "/large", "/drop"}) {
            bool rejected = false;
            try { static_cast<void>(client.request(path, chert::Json{{"body", "private-message"}})); }
            catch (const chert::ApiError& error) {
                rejected = true;
                require(std::string_view(error.what()).find("private") == std::string_view::npos);
                require(std::string_view(error.what()).find("fixture-secret") == std::string_view::npos);
                if (std::string_view(path) == "/error") {
                    require(error.status == 502 && error.code == "4103" && error.request_id == "trace-fixture");
                    require(error.data.at("error").at("message") == "private-message");
                }
                if (std::string_view(path) == "/logical") require(error.status == 502 && error.code == "denied");
                if (std::string_view(path) == "/redirect") require(error.status == 307);
                if (std::string_view(path) == "/large" || std::string_view(path) == "/drop") require(error.code == "outcome_unknown");
            }
            require(rejected);
        }
        const chert::Client short_timeout(origin, "fixture-secret", {}, std::chrono::milliseconds(75));
        bool timed_out = false;
        try { static_cast<void>(short_timeout.request("/slow", chert::Json{{"body", "private-message"}})); }
        catch (const chert::ApiError& error) { timed_out = error.code == "outcome_unknown"; }
        require(timed_out);
        bool expectation_failed = false;
        try { static_cast<void>(client.request("/expect", chert::Json{{"body", std::string(2 * 1024 * 1024, 'a')}})); }
        catch (const chert::ApiError& error) { expectation_failed = error.status == 417; }
        require(expectation_failed);
        std::cout << "C++ explicit transport, namespace, JSON, errors and one-attempt HTTP checks passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
