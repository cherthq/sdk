# Starter video agent

A voice agent with a face, for FaceTime Video calls through Chert. It is the voice
starter plus one camera track: an animated face drawn in `face.mjs`. Node 22.23.2
or later, Node 24 or Node 26 is required.

## Run it

1. Install it:
   ```sh
   npm install
   ```
2. Create your private env file, then replace each `YOUR_` placeholder in it:
   ```sh
   cp .env.example .env.local && chmod 600 .env.local
   ```
   The three LiveKit values come from one LiveKit Cloud project (Settings, API
   keys). The OpenAI key needs Realtime access and credits. Set `AGENT_NAME` to a
   name no other team uses.
3. Terminal 1, your agent:
   ```sh
   npm start
   ```
4. Terminal 2, in this same folder:
   ```sh
   chert login     # once per computer
   chert dev
   ```
5. When `chert dev` says your agent is in a waiting room, make a **FaceTime Video**
   call to the line it shows. The agent greets you as soon as FaceTime is ready. A
   FaceTime Audio call works too, but the caller then only hears the agent.

A few seconds into each call `chert dev` says what the Mac is taking from your
agent: video and audio, audio only, or what is wrong.

## The greeting

The Mac ends a call that hears nothing from the agent within 10 seconds of
FaceTime being ready (`remote_audio_timeout`). When the Mac reports `bridge_ready`,
`chert dev` writes `"chert_bridge_ready": true` into the room metadata, and the
agent greets once (`greet.mjs`, the `greeting` line in `agent.mjs`). It never
greets just because the caller joined. Without the signal it does not greet,
and the caller speaks first.

## The one rule for video

The Mac that answers FaceTime takes audio from the **one** participant that
publishes an audio track, and shows video **only from that same participant**.

- This starter follows the rule: the agent publishes its own voice and its own camera track.
- Two participants publishing audio ends the call.
- Video from a participant that does not speak is not shown.

## Change the picture

Edit `drawFace` in `face.mjs`. It returns one RGBA frame, 640 by 360, 15 times a
second. Draw anything: an image, a chart, a game board.

## Use a realtime avatar instead

LiveKit has plugins for avatar services (Tavus, Beyond Presence, Anam and others).
The avatar joins the room as a third participant and publishes the voice and the
face together, which fits the rule above. LiveKit admits it to a Chert room.

```js
import * as bey from '@livekit/agents-plugin-bey';   // Beyond Presence; needs BEY_API_KEY

const avatar = new bey.AvatarSession({ avatarId: '...' });
await avatar.start(session, ctx.room);   // before session.start
```

The plugins and their options are listed at https://docs.livekit.io/agents/models/avatar/.

Remove the `VideoSource` code when you do this, and keep the agent's own audio
output off the room (the plugin does that), so that only the avatar speaks. Each
service needs its own account and API key. This path has not been tested on a
FaceTime call by Chert yet: watch the media line in `chert dev` on your first call.

## What it does not do

- It does not look at the caller's camera.
- The waiting room shows that the agent joined LiveKit. It does not verify the
  model key or the media path. The first call does.
- Never commit or share `.env.local`. LiveKit and model usage may cost money.
