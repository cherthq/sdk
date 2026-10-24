#include <trychert/client.hpp>
#include <iostream>

int main(int argc, char** argv) {
    if (argc != 2) return 2;
    try {
        const auto project = std::string("11111111-1111-4111-8111-111111111111");
        const auto call = std::string("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
        const trychert::FaceTimeClient client({argv[1], "ftk_fixture", project});
        const auto require = [](bool value) { if (!value) throw std::runtime_error("Server contract failed"); };
        require(client.list_calls({3, 8}).data.offset == 8);
        require(client.get_call(call).data.id == call);
        trychert::CreateCall input;
        input.mode = trychert::CallMode::managed;
        input.assistant_id = project;
        input.destination = "+15550000002";
        require(client.create_call(input, "contract-key").status == 201);
        require(client.act_on_call(call, trychert::CallAction::end, "contract-end").status == 202);
        for (const auto& credential : {std::string("ftk_wrong"), std::string("ftk_readonly")}) {
            const trychert::FaceTimeClient denied({argv[1], credential, project});
            bool rejected = false;
            try { static_cast<void>(denied.create_call(input, "contract-denied")); }
            catch (const trychert::ApiError& e) { rejected = e.status == (credential == "ftk_wrong" ? 401 : 403) && !e.request_id.empty(); }
            require(rejected);
        }
        input.mode = trychert::CallMode::customer_managed; input.assistant_id.reset();
        input.line_id = "22222222-2222-4222-8222-222222222222";
        input.room = trychert::RoomCredentials{"wss://room.example.test", "invalid-jwt", "agent"};
        bool rejected = false;
        try { static_cast<void>(client.create_call(input, "contract-byor")); }
        catch (const trychert::ApiError& e) { rejected = e.status == 422; }
        require(rejected);
        std::cout << "Actual FaceTime routing, auth dispatch, schemas, envelopes and BYOR rejection passed\n";
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n'; return 1;
    }
}
