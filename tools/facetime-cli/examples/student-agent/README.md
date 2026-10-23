# Starter voice agent

A voice agent you can call on FaceTime through Chert. It is a standalone Node
application built on LiveKit Agents 1.8.0 and the OpenAI Realtime model. Node 22.23.2 or later, Node 24 or Node 26 is required.

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
4. Terminal 2, in this same folder, puts the agent on your FaceTime line:
   ```sh
   chert login     # once per computer
   chert dev
   ```
   `chert dev` reads the LiveKit values and `AGENT_NAME` from `.env.local`.
5. When `chert dev` says your agent is in a waiting room, make a **FaceTime Audio**
   call to the line it shows. The agent greets you as soon as FaceTime is ready.

`chert doctor` checks sign-in, keys, the line and the Mac behind it.
`chert doctor --agent NAME` also sends the agent a real test job.

## Change it

Edit `instructions` and `greeting` at the top of `agent.mjs`. Keep the greeting
to one short sentence. There is no automatic reload: end
the call, stop `chert dev` with Ctrl+C, restart `npm start`, then run `chert dev`
again. Otherwise a waiting room can still hold the old code.

## What it does and does not do

- It joins the room Chert prepares, waits for the caller, then opens one model
  session. Chert removes the room after the call.
- It greets once, when `chert dev` writes `"chert_bridge_ready": true` into the
  room metadata (`greet.mjs`): the Mac ends a call that hears nothing from the
  agent within 10 seconds of FaceTime being ready (`remote_audio_timeout`). It
  never greets just because the caller joined. Without the signal it does not
  greet, and you speak first.
- It publishes audio only. Video, avatars and outbound calls are not part of it.
- The waiting room shows that the agent joined LiveKit. It does not verify the
  model key or the media path. The first call does.
- Two credentials do different jobs. `chert login` lets this computer use your
  Chert project. `.env.local` lets the agent and `chert dev` use your LiveKit
  project, and the agent use the model. Never commit or share `.env.local`.
- LiveKit and model usage may cost money.

References: [LiveKit named dispatch](https://docs.livekit.io/agents/server/agent-dispatch/)
and the [OpenAI Realtime plugin](https://docs.livekit.io/agents/models/realtime/plugins/openai/).
