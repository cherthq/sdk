#pragma once
#include <trychert/imessage.hpp>
#include <trychert/facetime.hpp>

namespace trychert {
struct Options { IMessageOptions imessage; FaceTimeOptions facetime; };
// There is deliberately no common token or project-to-tenant derivation.
class Client final {
public:
    explicit Client(Options options)
        : imessage(std::move(options.imessage)), facetime(std::move(options.facetime)) {}
    IMessageClient imessage;
    FaceTimeClient facetime;
};
} // namespace trychert
