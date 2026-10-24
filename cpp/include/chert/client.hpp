#pragma once
#include <trychert/imessage.hpp>
// Source compatibility for the unpublished iMessage-only SDK.
namespace chert {
using Json = trychert::Json;
using ApiError = trychert::ApiError;
using QueuedTextReceipt = trychert::QueuedTextReceipt;
using ReactionReceipt = trychert::ReactionReceipt;
using Client = trychert::IMessageClient;
} // namespace chert
