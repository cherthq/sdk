#include <trychert/client.hpp>
#include <cmath>
#include <cstdint>
#include <limits>
#include <functional>
#include <iostream>
#include <string>
#include <vector>

namespace {
void check(bool ok, const std::string& label = "Media contract failed") {
    if (!ok) throw std::runtime_error(label);
}
void invalid(const std::function<void()>& body) {
    try { body(); } catch (const std::invalid_argument&) { return; }
    check(false, "accepted invalid input");
}
std::string frame_code(const trychert::VideoFrameInit& input) {
    try { static_cast<void>(trychert::copy_video_frame(input)); }
    catch (const trychert::MediaFrameError& error) { return error.code; }
    return "accepted";
}
trychert::MediaCapabilities caps(const char* json) { return trychert::parse_media_capabilities(trychert::Json::parse(json)); }

void capabilities() {
    const auto full = caps(R"({"version":1,"custom_video":{"supported":true,"transports":["whip","livekit","whip"],"codecs":["vp8","h264","vp8"],"max_width":1920,"max_height":1080.0,"max_fps":30},"inbound_caller_video":{"supported":true,"transports":["whep"],"max_width":1280,"max_height":720,"max_fps":15}})");
    check(full.version == 1 && full.custom_video && full.inbound_caller_video, "full capabilities");
    check(full.custom_video->transports == std::vector<std::string>{"whip", "livekit"});
    check(full.custom_video->codecs == std::vector{trychert::VideoCodec::vp8, trychert::VideoCodec::h264});
    check(full.custom_video->max_width == 1920 && full.custom_video->max_height == 1080 && full.custom_video->max_fps == 30);
    check(full.inbound_caller_video->transports == std::vector<std::string>{"whep"} && full.inbound_caller_video->max_fps == 15);
    check(!trychert::parse_media_capabilities(trychert::Json()).custom_video, "absent");
    for (const auto* raw : {"null", "[]", "\"x\"", "{}", R"({"version":"1"})",
            R"({"version":2,"custom_video":{"supported":true,"transports":["whip"],"codecs":["h264"],"max_width":1,"max_height":1,"max_fps":1}})"}) {
        const auto parsed = caps(raw);
        check(parsed.version == 1 && !parsed.custom_video && !parsed.inbound_caller_video, raw);
    }
    const std::string ok_cv = R"({"supported":true,"transports":["whip"],"codecs":["h264"],"max_width":640,"max_height":360,"max_fps":30})";
    const std::string ok_iv = R"({"supported":true,"transports":["livekit"],"max_width":640,"max_height":360,"max_fps":30})";
    const auto section = [](const std::string& cv, const std::string& iv) {
        return trychert::parse_media_capabilities(trychert::Json::parse(R"({"version":1,"custom_video":)" + cv + R"(,"inbound_caller_video":)" + iv + "}"));
    };
    const auto replace = [](std::string value, const std::string& from, const std::string& to) {
        return value.replace(value.find(from), from.size(), to);
    };
    for (const auto& cv : {replace(ok_cv, "640", "1921"), replace(ok_cv, "360", "1081"), replace(ok_cv, "30}", "31}"),
            replace(ok_cv, "640", "0"), replace(ok_cv, "640", "1.5"), replace(ok_cv, "\"whip\"", "\"rtmp\""),
            replace(ok_cv, "[\"whip\"]", "[\"whip\",\"rtmp\"]"), replace(ok_cv, "[\"whip\"]", "[]"),
            replace(ok_cv, "\"h264\"", "\"av1\""), replace(ok_cv, "[\"h264\"]", "[]"), replace(ok_cv, "true", "\"true\""),
            replace(ok_cv, "true", "false"), std::string("[]"), std::string("null")}) {
        const auto parsed = section(cv, ok_iv);
        check(!parsed.custom_video && parsed.inbound_caller_video, cv);
    }
    for (const auto& iv : {replace(ok_iv, "640", "1281"), replace(ok_iv, "360", "721"), replace(ok_iv, "\"livekit\"", "\"whip\""),
            replace(ok_iv, "[\"livekit\"]", "\"whep\"")}) {
        const auto parsed = section(ok_cv, iv);
        check(parsed.custom_video && !parsed.inbound_caller_video, iv);
    }
    // Contents: unknown entries ignored, duplicates removed in order, absent/empty/non-list means camera.
    using trychert::MediaContent;
    const auto with_contents = [&](const std::string& value) {
        const auto cv = replace(ok_cv, "30}", "30" + value + "}"), iv = replace(ok_iv, "30}", "30" + value + "}");
        return section(cv, iv);
    };
    const auto mixed = with_contents(R"(,"contents":["screen","window","camera","screen"])");
    check(mixed.custom_video->contents == std::vector{MediaContent::screen, MediaContent::camera}, "contents order");
    check(mixed.inbound_caller_video->contents == std::vector{MediaContent::screen, MediaContent::camera}, "inbound contents");
    for (const std::string value : {"", R"(,"contents":[])", R"(,"contents":["window"])", R"(,"contents":"screen")", R"(,"contents":null)", R"(,"contents":[7])"}) {
        const auto parsed = with_contents(value);
        check(parsed.custom_video->contents == std::vector{MediaContent::camera}
            && parsed.inbound_caller_video->contents == std::vector{MediaContent::camera}, "default contents " + value);
    }
    // Generic video flags never imply support.
    const auto line = trychert::Json::parse(R"({"id":"l","supports_video":true})");
    check(!trychert::parse_media_capabilities(line.value("media_capabilities", trychert::Json())).custom_video);
}

void frames() {
    using trychert::PixelFormat;
    std::vector<std::uint8_t> y(256), u(64), v(64);
    const trychert::VideoFrameInit i420{PixelFormat::i420, 16, 16, {{y, 16}, {u, 8}, {v, 8}}, 0, std::nullopt, 0, std::nullopt};
    auto frame = trychert::copy_video_frame(i420);
    check(frame.color_space == trychert::ColorSpace::bt709_limited && frame.rotation == 0 && frame.planes.size() == 3, "i420");
    std::vector<std::uint8_t> source(100 * 20);
    source[0] = 7;
    frame = trychert::copy_video_frame({PixelFormat::rgba, 16, 20, {{source, 100}}, 5, std::nullopt, 270, std::nullopt});
    source[0] = 9;
    check(frame.planes[0].data.size() == 100 * 19 + 64 && frame.planes[0].data[0] == 7
        && frame.color_space == trychert::ColorSpace::srgb_full && frame.rotation == 270, "copy semantics");
    std::vector<std::uint8_t> luma(1920 * 1080), chroma(1920 * 540), large(7936 * 1080);
    frame = trychert::copy_video_frame({PixelFormat::nv12, 1920, 1080, {{luma, 1920}, {chroma, 1920}}, 1, std::nullopt, 0, trychert::ColorSpace::bt601_limited});
    check(frame.color_space == trychert::ColorSpace::bt601_limited, "nv12");
    check(frame_code({PixelFormat::bgra, 1920, 1080, {{std::span(large).first(7680 * 1080), 7680}}, 1, std::nullopt, 0, std::nullopt}) == "accepted", "max bgra");
    check(frame_code({PixelFormat::rgba, 1920, 1080, {{large, 7936}}, 1, std::nullopt, 0, std::nullopt}) == "frame_too_large", "8 MiB");
    std::vector<std::uint8_t> short_plane(63), padded(272 * 15 + 16);
    const std::vector<std::function<void(trychert::VideoFrameInit&)>> edits = {
        [](auto& f) { f.format = static_cast<PixelFormat>(9); }, [](auto& f) { f.width = 17; },
        [](auto& f) { f.width = 14; f.height = 14; }, [](auto& f) { f.width = 1922; }, [](auto& f) { f.height = 1082; },
        [](auto& f) { f.timestamp_us = -1; }, [](auto& f) { f.duration_us = 0; }, [](auto& f) { f.rotation = 45; },
        [](auto& f) { f.color_space = static_cast<trychert::ColorSpace>(9); }, [](auto& f) { f.planes.pop_back(); },
        [](auto& f) { f.planes[1].stride = 7; }, [](auto& f) { f.planes[0].stride = 16 + 257; },
        [&](auto& f) { f.planes[2].data = short_plane; }};
    for (const auto& edit : edits) {
        auto bad = i420;
        edit(bad);
        check(frame_code(bad) == "invalid_frame", "invalid frame accepted");
    }
    auto max_stride = i420;
    max_stride.planes[0] = {padded, 272};
    check(frame_code(max_stride) == "accepted", "max stride");
}

void screen_sessions(const std::function<trychert::FaceTimeClient(const std::string&)>& client, const std::string& call, int bad_cases) {
    using trychert::MediaDirection;
    using trychert::MediaSessionContent;
    const auto screen = client("screen").create_media_session(call, {MediaDirection::publish, std::nullopt, MediaSessionContent::screen}).data;
    check(screen.content == MediaSessionContent::screen && screen.limits.max_fps == 15, "screen grant");
    const auto caller = client("caller-screen").create_media_session(call, {MediaDirection::subscribe, std::nullopt, MediaSessionContent::caller_screen}).data;
    check(caller.content == MediaSessionContent::caller_screen, "caller screen grant");
    check(client("camera-echo-publish").create_media_session(call, {MediaDirection::publish, std::nullopt}).data.content
        == MediaSessionContent::camera, "publish camera echo");
    check(client("camera-echo-subscribe").create_media_session(call, {MediaDirection::subscribe, std::nullopt}).data.content
        == MediaSessionContent::camera, "subscribe camera echo");

    // Wrong combinations throw before any request (the fixture counts requests).
    const auto local = client("local");
    for (const auto& [direction, content] : std::vector<std::pair<MediaDirection, MediaSessionContent>>{
            {MediaDirection::publish, MediaSessionContent::caller_screen}, {MediaDirection::subscribe, MediaSessionContent::screen},
            {MediaDirection::subscribe, MediaSessionContent::camera}, {MediaDirection::publish, static_cast<MediaSessionContent>(9)}})
        invalid([&] { static_cast<void>(local.create_media_session(call, {direction, std::nullopt, content})); });

    const std::vector<trychert::CreateMediaSession> requests = {
        {MediaDirection::publish, std::nullopt, MediaSessionContent::screen}, {MediaDirection::publish, std::nullopt, MediaSessionContent::screen},
        {MediaDirection::publish, std::nullopt, MediaSessionContent::screen}, {MediaDirection::publish, std::nullopt, std::nullopt},
        {MediaDirection::subscribe, std::nullopt, std::nullopt}};
    check(static_cast<int>(requests.size()) == bad_cases, "screen bad case count");
    for (int i = 0; i < bad_cases; ++i) {
        try {
            static_cast<void>(client("screen-bad-" + std::to_string(i)).create_media_session(call, requests[i]));
            check(false, "accepted invalid screen grant " + std::to_string(i));
        } catch (const trychert::ApiError& error) { check(error.code == "invalid_response", "screen grant code " + std::to_string(i)); }
    }
    try {
        static_cast<void>(client("not-shared").create_media_session(call, {MediaDirection::subscribe, std::nullopt, MediaSessionContent::caller_screen}));
        check(false, "accepted caller_screen_not_shared");
    } catch (const trychert::ApiError& error) {
        check(error.status == 409 && error.code == "caller_screen_not_shared" && error.data.is_null()
            && std::string(error.what()).find("10.0.0.5") == std::string::npos, "caller_screen_not_shared");
    }
    for (const auto& [status, code] : {std::pair{409, "media_content_unsupported"}, std::pair{409, "caller_screen_unsupported"},
             std::pair{422, "media_limit_exceeded"}}) {
        try {
            static_cast<void>(client(code).create_media_session(call, {MediaDirection::publish, std::nullopt, MediaSessionContent::screen}));
            check(false, std::string("accepted ") + code);
        } catch (const trychert::ApiError& error) {
            check(error.status == status && error.code == code && error.data.is_null()
                && std::string(error.what()).find("10.0.0.5") == std::string::npos, code);
        }
    }
}

void call_video(const std::function<trychert::FaceTimeClient(const std::string&)>& client, const std::string& call,
                int bad_cases, int error_cases) {
    using namespace trychert;
    const auto page = client("video-page").set_call_video(call, {.deployment_id = "dep-url"}, "video-key-1");
    check(page.request_id == "trace" && page.data.output.fps == 30 && page.data.layers.size() == 1, "page shortcut");
    PageLayerInput captions{"captions", 1, "dep", CompositionRegion{0, 0.75, 1, 0.25}, CompositionBackground::transparent, 0.8,
        std::vector{LivingInputKind::pointer}, Json{{"lang", "en"}}};
    const auto layered = client("video-layered").set_call_video(call,
        {.layers = std::vector<VideoLayerInput>{BaseLayerInput{"base", CompositionBaseKind::camera}, captions}, .revision = 2}, "video-key-2").data;
    const auto* base = std::get_if<BaseLayer>(&layered.layers[0]);
    check(base && base->publish && base->publish->token == "session-bearer" && base->publish->limits.max_fps == 24, "camera base grant");
    static_cast<void>(client("video-get").get_call_video(call));
    static_cast<void>(client("video-clear").clear_call_video(call));
    // Input targets use output-frame coordinates; only the overlay's region accepts pointer input.
    const auto* target = composition_input_target(layered, 0.5, 0.9);
    check(target && target->id == "captions" && !composition_input_target(layered, 0.5, 0.74)
        && !composition_input_target(page.data, 0.5, 0.5), "input target");

    // Local rejections throw before any request (the fixture counts requests).
    // Unrepresentable here: z 1.5 (int) and a base at z != 0 (no z on BaseLayerInput).
    const auto local = client("local");
    const BaseLayerInput b{"base", CompositionBaseKind::camera};
    const PageLayerInput p{.id = "p", .z = 1, .deployment_id = "dep"};
    const auto with = [&](const std::function<void(PageLayerInput&)>& edit) { auto copy = p; edit(copy); return copy; };
    Json deep = 0;
    for (int i = 0; i < 70; ++i) deep = Json::array({deep});
    const auto layers = [](std::vector<VideoLayerInput> items) { return SetCallVideo{.layers = std::move(items)}; };
    const std::vector<SetCallVideo> cases = {
        layers({}), layers({b, p, with([](auto& l) { l.id = "q"; l.z = 2; })}),
        layers({b, BaseLayerInput{"b2", CompositionBaseKind::managed}}), layers({b, with([](auto& l) { l.id = "base"; })}),
        layers({b, with([](auto& l) { l.z = 0; })}), layers({b, with([](auto& l) { l.z = 65; })}),
        layers({b, with([](auto& l) { l.region = CompositionRegion{0.5, 0, 0.6, 1}; })}),
        layers({b, with([](auto& l) { l.region = CompositionRegion{0, 0, 0, 1}; })}),
        layers({b, with([](auto& l) { l.region = CompositionRegion{std::nan(""), 0, 1, 1}; })}),
        layers({b, with([](auto& l) { l.opacity = 1.2; })}),
        layers({b, with([](auto& l) { l.background = static_cast<CompositionBackground>(7); })}),
        layers({with([](auto& l) { l.background = CompositionBackground::transparent; })}), layers({with([](auto& l) { l.opacity = 0.5; })}),
        layers({with([](auto& l) { l.region = CompositionRegion{0, 0, 0.5, 1}; })}),
        layers({b, with([](auto& l) { l.input = std::vector{LivingInputKind::pointer, LivingInputKind::pointer}; })}),
        layers({b, with([](auto& l) { l.input = std::vector{static_cast<LivingInputKind>(9)}; })}),
        layers({BaseLayerInput{"base", static_cast<CompositionBaseKind>(5)}}), layers({with([](auto& l) { l.id = "Upper"; })}),
        layers({with([](auto& l) { l.deployment_id = ""; })}), layers({with([](auto& l) { l.deployment_id = std::string(129, 'd'); })}),
        layers({b, with([](auto& l) { l.initial_state = Json{{"blob", std::string(64 * 1024, 'x')}}; })}),
        layers({b, with([](auto& l) { l.initial_state = Json(std::numeric_limits<double>::infinity()); })}),
        SetCallVideo{.deployment_id = "dep", .initial_state = deep}, SetCallVideo{.deployment_id = "dep", .revision = -1},
        SetCallVideo{.deployment_id = ""}, SetCallVideo{},
        // URL pages need a deployment created with the TypeScript SDK first.
        SetCallVideo{.deployment_id = "https://agent.example/p"},
        layers({b, with([](auto& l) { l.deployment_id = "https://agent.example/p"; })})};
    for (std::size_t i = 0; i < cases.size(); ++i) {
        try {
            static_cast<void>(local.set_call_video(call, cases[i], "video-key-1"));
            check(false, "accepted invalid composition " + std::to_string(i));
        } catch (const std::invalid_argument& error) {
            if (i >= cases.size() - 2) check(std::string(error.what()).find("TypeScript SDK") != std::string::npos, "URL page message");
        }
    }
    invalid([&] { static_cast<void>(local.set_call_video(call, {.deployment_id = "dep"}, "short")); });
    invalid([&] { static_cast<void>(local.set_call_video("call", {.deployment_id = "dep"}, "video-key-1")); });
    static_cast<void>(client("video-edge").set_call_video(call,
        layers({b, with([](auto& l) { l.region = CompositionRegion{0.75, 0.75, 0.25, 0.25}; })}), "video-key-1"));

    for (int i = 0; i < bad_cases; ++i) {
        try {
            static_cast<void>(client("video-bad-" + std::to_string(i)).get_call_video(call));
            check(false, "accepted invalid composition response " + std::to_string(i));
        } catch (const ApiError& error) {
            check(error.code == "invalid_response" && error.data.is_null(), "composition code " + std::to_string(i));
        }
    }
    const auto managed = client("video-managed").get_call_video(call).data;
    check(std::get<BaseLayer>(managed.layers[0]).source == CompositionBaseKind::managed && !std::get<BaseLayer>(managed.layers[0]).publish, "managed base");

    const std::vector<std::pair<long, std::string>> expected = {{409, "video_composition_unsupported"}, {422, "composition_invalid"},
        {409, "composition_revision_conflict"}, {409, "composition_base_unavailable"}, {409, "media_session_conflict"},
        {409, "request_failed"}}; // unknown server code
    check(static_cast<int>(expected.size()) == error_cases, "composition error case count");
    for (int i = 0; i < error_cases; ++i) {
        try {
            static_cast<void>(client("video-error-" + std::to_string(i)).set_call_video(call, {.deployment_id = "dep"}, "video-key-1"));
            check(false, "accepted composition error");
        } catch (const ApiError& error) {
            check(error.status == expected[i].first && error.code == expected[i].second && error.data.is_null() && error.request_id == "r"
                && std::string(error.what()).find("192.0.2.5") == std::string::npos, "composition error " + expected[i].second);
        }
    }
}

void composition_capability() {
    using trychert::CompositionBaseKind;
    const auto cap = trychert::Json::parse(R"({"version":1,"supported":true,"max_layers":4,"bases":["camera","hologram","managed","camera",3],"page_alpha":true,"regions":true,"max_width":3840,"max_height":1080,"max_fps":60})");
    const auto parsed = trychert::parse_video_composition(cap);
    check(parsed && parsed->version == 1 && parsed->supported && parsed->max_layers == 2 && parsed->page_alpha && parsed->regions
        && parsed->bases == std::vector{CompositionBaseKind::camera, CompositionBaseKind::managed}
        && parsed->max_width == 1920 && parsed->max_height == 1080 && parsed->max_fps == 30, "composition capability");
    auto alpha = cap;
    alpha["page_alpha"] = "yes";
    check(!trychert::parse_video_composition(alpha)->page_alpha, "page_alpha strict");
    check(!trychert::parse_video_composition(trychert::Json()), "absent capability");
    for (const auto& [field, value] : std::vector<std::pair<const char*, trychert::Json>>{{"version", 2}, {"supported", false},
             {"max_layers", 0}, {"max_fps", 1.5}, {"bases", "camera"}}) {
        auto bad = cap;
        bad[field] = value;
        check(!trychert::parse_video_composition(bad), field);
    }
}

void sessions(const std::string& origin, int bad_cases, int error_cases, int accept_cases, int screen_bad_cases,
              int video_bad_cases, int video_error_cases) {
    const std::string project = "11111111-1111-4111-8111-111111111111", call = "22222222-2222-4222-8222-222222222222";
    const auto client = [&](const std::string& name) { return trychert::FaceTimeClient({origin + "/case/" + name, "ft-secret", project}); };
    using trychert::MediaDirection;
    const auto grant = client("publish").create_media_session(call, {MediaDirection::publish, std::nullopt});
    const auto& g = grant.data;
    check(grant.status == 201 && grant.request_id == "trace" && g.token == "grant-secret-token" && g.direction == MediaDirection::publish, "grant");
    check(g.endpoint == "https://signal.example/whip/s1" && g.session_id == "0f8fad5b-d9cb-469f-a165-70867728950e");
    check(g.connect_by == "2026-10-25T10:00:00Z" && g.codecs == std::vector{trychert::VideoCodec::h264, trychert::VideoCodec::vp8});
    check(g.limits.max_width == 1920 && g.limits.max_height == 1080 && g.limits.max_fps == 30 && g.limits.max_frame_bytes == 8388608);
    check(g.ice_servers.size() == 2 && g.ice_servers[0].urls == std::vector<std::string>{"stun:stun.example:3478"}
        && !g.ice_servers[0].username && g.ice_servers[1].credential == "c" && g.ice_servers[1].credential_type == "password", "ice");
    static_cast<void>(client("codecs").create_media_session(call, {MediaDirection::publish, std::vector{trychert::VideoCodec::vp8, trychert::VideoCodec::h264}}));
    check(client("subscribe").create_media_session(call, {MediaDirection::subscribe, std::nullopt}).data.limits.max_height == 720, "subscribe");

    // Local validation throws before any request (the fixture counts requests).
    const auto local = client("local");
    invalid([&] { static_cast<void>(local.create_media_session(call, {static_cast<MediaDirection>(7), std::nullopt})); });
    invalid([&] { static_cast<void>(local.create_media_session(call, {MediaDirection::publish, std::vector<trychert::VideoCodec>{}})); });
    invalid([&] { static_cast<void>(local.create_media_session(call, {MediaDirection::publish, std::vector{static_cast<trychert::VideoCodec>(9)}})); });
    invalid([&] { static_cast<void>(local.create_media_session(call, {MediaDirection::publish, std::vector{trychert::VideoCodec::h264, trychert::VideoCodec::h264}})); });
    invalid([&] { static_cast<void>(local.create_media_session("call", {MediaDirection::publish, std::nullopt})); });

    for (int i = 0; i < bad_cases; ++i) {
        const auto direction = i < 2 ? MediaDirection::subscribe : MediaDirection::publish;
        try {
            static_cast<void>(client("bad-" + std::to_string(i)).create_media_session(call, {direction, std::nullopt}));
            check(false, "accepted invalid grant " + std::to_string(i));
        } catch (const trychert::ApiError& error) {
            check(error.code == "invalid_response" && error.data.dump().find("grant-secret") == std::string::npos, "grant code " + std::to_string(i));
        }
    }
    try {
        static_cast<void>(client("outside").create_media_session(call, {MediaDirection::publish, std::vector{trychert::VideoCodec::vp8}}));
        check(false, "accepted codec outside request");
    } catch (const trychert::ApiError& error) { check(error.code == "invalid_response", "outside code"); }
    for (int i = 0; i < accept_cases; ++i) {
        const auto codecs = i == 0 ? std::optional(std::vector{trychert::VideoCodec::vp8, trychert::VideoCodec::h264}) : std::nullopt;
        static_cast<void>(client("accept-" + std::to_string(i)).create_media_session(call, {MediaDirection::publish, codecs}));
    }
    const std::vector<std::pair<long, std::string>> expected = {{401, "unauthorized"}, {401, "media_session_expired"}, {404, "call_not_found"},
        {409, "media_capability_unsupported"}, {409, "media_session_conflict"}, {409, "call_not_active"}, {410, "call_ended"},
        {503, "media_transport_unavailable"}, {418, "request_failed"}}; // unknown server code
    check(static_cast<int>(expected.size()) == error_cases, "error case count");
    for (int i = 0; i < error_cases; ++i) {
        try {
            static_cast<void>(client("error-" + std::to_string(i)).create_media_session(call, {MediaDirection::publish, std::nullopt}));
            check(false, "accepted error");
        } catch (const trychert::ApiError& error) {
            check(error.status == expected[i].first && error.code == expected[i].second
                && error.data.is_null() && error.request_id == "r"
                && std::string(error.what()).find("192.0.2.5") == std::string::npos, "error " + expected[i].second);
        }
    }
    screen_sessions(client, call, screen_bad_cases);
    call_video(client, call, video_bad_cases, video_error_cases);
}
} // namespace

int main(int argc, char** argv) {
    try {
        check(argc == 8);
        capabilities();
        composition_capability();
        frames();
        sessions(argv[1], std::stoi(argv[2]), std::stoi(argv[3]), std::stoi(argv[4]), std::stoi(argv[5]), std::stoi(argv[6]), std::stoi(argv[7]));
        std::cout << "Media capabilities, frames, session minting, grant validation and call video passed\n";
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
