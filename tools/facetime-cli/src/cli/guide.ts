/**
 * `chert guide`: the short handbook, as data. Each topic is a page that fits an 80-column terminal, so a developer can
 * set up a voice or video agent without leaving it.
 */
import { wrap } from '../dev/frame.js';
import { table } from './help.js';

type Block = { heading: string } | { text: string } | { steps: string[] } | { rows: [string, string][] };
export interface GuideTopic { name: string; title: string; summary: string; blocks: Block[] }

export const topics: readonly GuideTopic[] = [
  { name: 'start', title: 'how Chert puts your agent on FaceTime', summary: 'How it works and the setup, in one page', blocks: [
    { text: 'A Chert line is a FaceTime address answered by a Chert Mac. chert dev runs on your computer and connects your LiveKit agent to your project\'s line, so each FaceTime call to the line talks to your agent. Your agent keeps running where you run it.' },
    { heading: 'ONCE' },
    { rows: [['chert login', 'Approve this computer for your Chert project. It lasts 30 days'],
      ['chert new my-agent', 'A starter agent folder, voice (or --video), with .env.local ready; or any LiveKit agent that registers with a name'],
      ['.env.local', 'In the agent\'s folder: LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET from one LiveKit project, and AGENT_NAME']] },
    { heading: 'EACH SESSION' },
    { rows: [['terminal 1', 'Start your agent: npm start, python agent.py dev, or your own command'],
      ['terminal 2', 'In the agent\'s folder: chert doctor, then chert dev'],
      ['call', 'FaceTime the line: Audio for a voice agent, Video for a video agent'],
      ['Ctrl+C', 'In terminal 2 when you are done. It frees the line for the next team']] },
  ] },
  { name: 'agent', title: 'what your agent must do', summary: 'What your agent must do', blocks: [
    { steps: [
      'Register with a name: agentName in the Node SDK, agent_name in Python. Put the same name in AGENT_NAME in .env.local, and choose one no other team uses.',
      'Use the LiveKit project whose three LIVEKIT_ values are in .env.local.',
      'Join the room at once, then wait for the caller before opening a paid model session. chert dev keeps a room ready with your agent in it before any call.',
      'Greet the caller within 10 seconds of bridge_ready, or the call ends (remote_audio_timeout). At bridge_ready chert dev sets the room metadata to {"chert_bridge_ready":true,...} and prints "FaceTime is ready." Greet once on that, never because the caller joined: FaceTime may still be connecting. The examples do this in greet.mjs. Without the signal, do not greet.',
      'The caller joins the room as chert-bridge-<call id>.',
      'Publish exactly one unmuted audio track. A second participant publishing audio ends the call.',
      'After changing your agent, restart both terminals: a waiting room can still hold the old code.'] },
    { text: 'Working examples are in the CLI repository: examples/student-agent (voice) and examples/video-agent (video).' },
  ] },
  { name: 'video', title: 'video agents and avatars', summary: 'Video agents and avatars', blocks: [
    { steps: [
      'Call the line with FaceTime Video.',
      'Publish a camera track from the participant that speaks. The Mac takes audio from the one participant that publishes it, and video only from that same participant.',
      'With no video from your agent, the caller sees the line\'s default picture.',
      'A few seconds into each call, chert dev says what the Mac takes, for example: Video and audio are coming from "agent-AJ_x1y2".'] },
    { heading: 'AVATARS' },
    { text: 'An avatar service (Tavus, Beyond Presence, Anam and others) joins the room as a third participant and publishes both the voice and the face. That fits the rule above when your agent\'s own audio stays off the room, so only the avatar speaks. LiveKit\'s avatar plugins work this way: docs.livekit.io/agents/models/avatar. Each service needs its own account and key. Read the media line on your first call.' },
    { text: 'Example: examples/video-agent publishes an animated face drawn in face.mjs.' },
  ] },
  { name: 'line', title: 'sharing a line with other teams', summary: 'Sharing a line with other teams', blocks: [
    { steps: [
      'One line answers one call at a time, and one chert dev session holds it. Agree time slots with the other teams.',
      'Start your slot with chert dev --until HH:MM, or --minutes N. A minute before that time it warns you; at that time it releases the line by itself, after any call in progress ends. Other teams see who holds the line and until when.',
      'If another session holds the line, chert dev stops with line_in_use and names who holds it, and until when. chert doctor shows the same. During a call it stops with line_in_call: wait for the call to end.',
      'Without --until or --minutes, press Ctrl+C in the chert dev terminal at the end of your slot and wait for "Stopped. The line no longer routes to this agent." Closing the terminal frees it too; closing the laptop does not.',
      'A session that is no longer connected (a closed laptop, a crash, a stop whose release failed) is replaced without --takeover: run chert dev and it takes the line. Use --takeover only for a live holder who agrees, and only with no call in progress.'] },
  ] },
  { name: 'fix', title: 'when something goes wrong', summary: 'When something goes wrong', blocks: [
    { rows: [['login_required', 'Run chert login. A browser sign-in lasts 30 days.'],
      ['backend_request_forbidden', 'You need the owner or admin role on the project. Check chert whoami.'],
      ['line_in_use', 'Another session holds the line. Ask them to stop, or wait for your slot.'],
      ['line_in_call', 'A call is in progress on the line. Wait for the call to end, then run chert dev again.'],
      ['line_paused', 'Calls are paused on the line. A project admin presses Enable calls on the line in the console.'],
      ['shared_line_paused', 'Calls on a shared line are paused by Chert, not by your project: Chert enables the pool line when the pilot opens. Run chert onboard --status.'],
      ['shared_allocation_inactive', 'Your shared line allocation expired, was released or is not qualified now. Run chert onboard --status; after expiry, chert onboard requests a new one.'],
      ['line_not_customer_decides', 'A project admin sets Routing to "Your webhook" and Assistant to "Unassigned" on the line in the console.'],
      ['line_unacknowledged', 'The Mac has not confirmed the line yet. Wait 30 s and try again; if it stays, Anish checks the Mac in Chert MAU.'],
      ['line_offline, worker_unavailable', 'The Mac behind the line is not accepting calls. Anish checks it in Chert MAU. --force takes the line anyway; calls decline until the Mac is back.'],
      ['YOUR_ placeholders', 'Put your LiveKit values in .env.local.'],
      ['has not joined', 'Is your agent running? Does AGENT_NAME match the name it registers with, on the same LiveKit project?'],
      ['silent call', 'The Mac ends a call that hears nothing within 10 s of bridge_ready. Greet on the room signal (chert guide agent), and look in terminal 1 for model key or credit errors.'],
      ['no video', 'Call with FaceTime Video, and publish a camera track from the participant that speaks.'],
      ['call ends at once', 'Two participants publish audio. The Mac takes audio from exactly one: let only the agent speak.'],
      ['call never ends', 'Hang up on the phone. If the line stays busy, a project owner or admin ends the call in the console; the CLI cannot.'],
      ['clock', 'Calls declined over timing: set the date and time automatically.'],
      ['anything else', 'Run chert doctor. Each failed check says what to fix.']] },
  ] },
];

/** One topic as the terminal prints it, inside 80 columns. Without a name, the first page and the list of topics. */
export function guide(name = 'start'): string | undefined {
  const topic = topics.find(entry => entry.name === name);
  if (!topic) return undefined;
  const body = topic.blocks.flatMap((block, index) => {
    if ('heading' in block) return ['', block.heading];
    // A block directly under a heading starts on the next line; any other block is set off by a blank line.
    const gap = index && 'heading' in topic.blocks[index - 1]! ? [] : [''];
    if ('text' in block) return [...gap, ...wrap(block.text, 76).map(line => `  ${line}`)];
    if ('rows' in block) return [...gap, ...table(block.rows)];
    return [...gap, ...block.steps.flatMap((step, i) => wrap(step, 73).map((line, j) => `  ${j ? '   ' : `${i + 1}. `}${line}`))];
  });
  const more = topics.filter(entry => entry !== topic).map((entry): [string, string] => [entry.name === 'start' ? 'chert guide' : `chert guide ${entry.name}`, entry.summary]);
  return [`chert guide${name === 'start' ? '' : ` ${name}`}: ${topic.title}`, ...body, '', 'MORE', ...table(more), ''].join('\n');
}
