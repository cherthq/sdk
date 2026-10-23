import { fileURLToPath } from 'node:url';
import { AutoSubscribe, cli, defineAgent, ServerOptions, voice } from '@livekit/agents';
import { realtime } from '@livekit/agents-plugin-openai';
import { greetOnBridgeReady } from './greet.mjs';

// Change these instructions to build your own agent. Keep replies conversational.
const instructions = `You are a friendly AI study partner speaking over FaceTime.
Help the caller understand a topic by asking one question at a time.
Keep each reply to one or two short sentences. Be clear that you are an AI.`;
// Said once, as soon as FaceTime is ready. Keep it short: it is the first thing the caller hears.
const greeting = 'Greet the caller in one short sentence: say you are an AI study partner and ask what they want to learn.';

export default defineAgent({
  entry: async ctx => {
    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);
    // Chert prepares a room before a caller exists. Join promptly so Chert can
    // find us, but wait before opening a paid model session. Doctor jobs may end
    // without a caller ever joining.
    const caller = await ctx.waitForParticipant();
    const session = new voice.AgentSession({
      llm: new realtime.RealtimeModel({ model: 'gpt-realtime', voice: 'marin' }),
    });
    ctx.addShutdownCallback(() => session.close());
    await session.start({
      room: ctx.room,
      agent: new voice.Agent({ instructions }),
      record: false,
      inputOptions: {
        participantIdentity: caller.identity,
        audioEnabled: true,
        videoEnabled: false,
        textEnabled: false,
        closeOnDisconnect: true,
        deleteRoomOnClose: false,
      },
      outputOptions: { audioEnabled: true, transcriptionEnabled: false },
    });
    // Greet once when chert dev reports that FaceTime is ready (bridge_ready in the
    // room metadata): the Mac ends the call if it hears nothing within 10 seconds
    // of that. Participant arrival alone is not readiness, so there is no greeting
    // on it. Without the signal there is no greeting, and the caller speaks first.
    const stopGreeting = greetOnBridgeReady(ctx.room, () => session.generateReply({ instructions: greeting }));
    ctx.addShutdownCallback(async () => stopGreeting());
  },
});

cli.runApp(new ServerOptions({
  agent: fileURLToPath(import.meta.url),
  agentName: process.env.AGENT_NAME || 'student-agent',
}));
