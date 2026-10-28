# Set up Chert

This is the current setup page for the Chert SDKs. It covers installing the SDK,
getting credentials, and making a first read-only request. It also points to the
separate FaceTime agent CLI for putting a LiveKit voice or video agent on a line.
Coding agents can read the same material from [`llms.txt`](https://github.com/cherthq/sdk/blob/main/llms.txt) or run
`chert-sdk context`.

## Pick what you need

| You want to | Use |
| --- | --- |
| Send iMessages or read messaging events from your app | `@trychert/sdk` (npm) or `chert-sdk` (PyPI) with a Chert API key |
| Inspect or manage FaceTime lines, calls, assistants and webhooks from your app | `@trychert/sdk/facetime` or `chert-sdk` (PyPI) with a FaceTime project token |
| Sign in from a terminal and put your own LiveKit agent (voice or video) on a FaceTime line | The `chert` CLI from [`@trychert/facetime`](https://www.npmjs.com/package/@trychert/facetime) |
| Migrate from another iMessage provider SDK | `chert-sdk adopt` (ships in `@trychert/sdk`) |

The SDKs and the FaceTime agent CLI are separate packages with separate commands.
The SDK's `chert-sdk` CLI has no `login`, `onboard`, `new` or `dev` command.

## 1. Install

JavaScript / TypeScript (Node 22.12+, current Bun, or Deno 2):

```sh
npm install @trychert/sdk
# or: pnpm add @trychert/sdk
# or: bun add @trychert/sdk
```

Python 3.10+:

```sh
python -m pip install chert-sdk
# or: uv add chert-sdk
```

Rust, .NET, C++ and Go clients are source previews; build them from this
repository by following their language guides. They are not published packages.

## 2. Get credentials

Credentials are per service and are not interchangeable.

| Variable | Service | Where it comes from |
| --- | --- | --- |
| `CHERT_API_KEY` | iMessage | Your Chert messaging console |
| `CHERT_TENANT` | iMessage, optional | Your messaging console, when your account has tenants |
| `CHERT_FACETIME_TOKEN` | FaceTime | A project token from your Chert FaceTime project |
| `CHERT_PROJECT_ID` | FaceTime (required), iMessage (context only) | The project UUID shown with your FaceTime project |

Keep these out of source control and logs. Defaults are
`https://console.trychert.com` (iMessage) and `https://facetime.trychert.com`
(FaceTime). Override them only for self-hosting or tests, with `CHERT_BASE_URL`
and `CHERT_FACETIME_URL`.

The FaceTime agent CLI does not use these variables. `chert login` signs that
computer in through the browser and stores its own sign-in under `CHERT_HOME`
(default `~/.chert`).

## 3. Check your setup

```sh
npx --package=@trychert/sdk chert-sdk context
# or: bunx --package @trychert/sdk chert-sdk context
```

`context` prints JSON and exits 0 even when an account lookup fails (that
lookup reports an error code instead). It includes the SDK version, which variables are set (never their
values), your FaceTime identity and lines when a token and project are set, and
links to these docs. Add `--offline` to skip every request.

## 4. First requests

```ts
import { ChertSDK } from '@trychert/sdk';

const sdk = new ChertSDK({
  projectId: process.env.CHERT_PROJECT_ID!,
  imessage: { apiKey: process.env.CHERT_API_KEY! },
  facetime: { token: process.env.CHERT_FACETIME_TOKEN! },
});

const lines = await sdk.facetime.listLines(); // Read-only: your assigned lines.
// Send only to recipients who agreed to hear from you:
// await sdk.imessage.sendText({ phone: '+15555550123', body: 'Hello' });
```

```python
import os
from trychert import Chert, IMessageConfig, FaceTimeConfig

sdk = Chert(
    imessage=IMessageConfig(api_key=os.environ["CHERT_API_KEY"]),
    facetime=FaceTimeConfig(token=os.environ["CHERT_FACETIME_TOKEN"],
                            project_id=os.environ["CHERT_PROJECT_ID"]),
)
identity = sdk.facetime.whoami()
```

From the terminal:

```sh
npx --package=@trychert/sdk chert-sdk facetime lines
npx --package=@trychert/sdk chert-sdk imessage send --phone +15555550123 \
  --body "Hello" --idempotency-key order-1234-greeting --confirm
```

`imessage send` requires `--confirm` and a stable idempotency key you keep, so a
retry cannot send twice. A queued receipt means accepted, not delivered or read.

## Lines: existing and shared

- **Existing (dedicated) line:** a line already assigned to your project.
  `listLines()` and `chert-sdk facetime lines` show it with its status and media
  support (`supports_audio`, `supports_video`).
- **Shared line:** a line that several projects use in turn. Whether a project
  gets shared access, and when, is decided by Chert, not by the SDK. The SDK can
  show an assigned shared line but does not allocate one.

The SDK can read `billingStatus()` and start a checkout (`createCheckout`) with a
signed-in user session, but it does not allocate lines. Terminal billing
(`chert-sdk billing buy|switch|card|cancel`, `purchase`, `changePlan`) is a
draft the backend does not serve yet; it charges a saved card and returns a
Stripe-hosted URL whenever card entry or authentication is needed. `chert-sdk` commands only
inspect access. The `chert` agent CLI's `chert dev` claims your project's line
while it runs and can end at a time slot you set.

## Voice and video

FaceTime calls can carry audio and video; a call can also be audio-only.

- Calls have `media: { audio, video }`. Lines report `supports_audio` and
  `supports_video`, and call events include `remote_video_ready`,
  `remote_video_unavailable` and `caller_video_published`.
- **Managed calls** can request video, and assistants can show a video
  presentation (`video.mode`: `test_pattern` or `avatar`).
- **Your own LiveKit agent** (customer-managed calls, or the `chert` agent CLI)
  needs a FaceTime Video call and a camera track published by the agent that
  speaks to show video. `chert new my-agent --video` creates a starter that does.
- Requesting video does not guarantee it: check the line's `supports_video` and
  the call's `media_status`.

The SDK does not relay media itself; call media flows between FaceTime and
LiveKit. Custom video sources over WHIP/WHEP (`@trychert/sdk/media`: frame
validation, a bounded video source and signaling for your own WebRTC peer
connection), web frontends rendered as call video, and screen sharing (an agent
streaming its screen into a call, and receiving the caller's shared screen) are
in draft and not released: they are in the source tree but not in any published
package ([#17](https://github.com/cherthq/sdk/pull/17),
[#18](https://github.com/cherthq/sdk/pull/18),
[#25](https://github.com/cherthq/sdk/pull/25)).

## Put a LiveKit agent on a FaceTime line

Use the `chert` CLI from `@trychert/facetime` (currently a beta):

```sh
npm install -g @trychert/facetime@beta
chert login              # browser sign-in; chert login --device on a remote shell
chert new my-agent       # or --video for the video starter
# fill my-agent/.env.local with your LiveKit values and model key, then start the agent
chert doctor             # checks sign-in, LiveKit keys and line access
chert dev                # answers calls on your line until Ctrl+C
```

Run `chert --help` and `chert guide` for the full command list.

## Limits

- Of the SDKs, only `@trychert/sdk` (npm) and `chert-sdk` (PyPI) are published.
  The `chert` agent CLI (`@trychert/facetime`) is a published beta.
- Constructors make no requests, and nothing is retried automatically. Reconcile
  uncertain outcomes before retrying a call or send.
- Package availability does not prove a feature is enabled for your project.
  Check with read-only requests first.
- Provider adapters cover the subsets in [COMPATIBILITY.md](https://github.com/cherthq/sdk/blob/main/COMPATIBILITY.md).

More detail: [README](https://github.com/cherthq/sdk/blob/main/README.md), [FaceTime notes](https://github.com/cherthq/sdk/blob/main/docs/FACETIME.md),
[Python guide](https://github.com/cherthq/sdk/blob/main/python/README.md).
