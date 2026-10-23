import { randomUUID } from 'node:crypto';
import { AuthenticatedHook, projectFingerprint } from '../adapters/livekit-hook.js';
import { Availability } from '../runtime/availability.js';
import { systemClock } from '../runtime/deadline.js';
import { credentialsPresent, type RoomConfig } from './config.js';
import { observation, pending, statePermissions, writerLocked } from './state.js';
import { inspectHosted } from './backend.js';
import { CLIError } from './errors.js';
export function healthContext(config: RoomConfig, secret: string) {
  const expected = { ...config.agent, project: projectFingerprint(config.livekit.url) };
  const credential = randomUUID();
  return { expected, credential, hook: new AuthenticatedHook(config.hook.origin, secret, expected),
    availability: new Availability(systemClock, credential, expected) };
}
export function status(config: RoomConfig) {
  const permissions = statePermissions(config.state_dir);
  return { mode: 'create-room', legacy_config: config.schema_version === 1, configuration: 'valid', runtime: process.version, transport: config.transport.mode,
    agent: config.agent, livekit_endpoint: config.livekit.url, hook_origin: config.hook.origin,
    state: { permissions, writer_locked: writerLocked(config.state_dir), pending: pending(config.state_dir) },
    observation: observation(config.state_dir), authorization: 'unverified',
    limitation: 'Read-only local state. No server authorization, media or FaceTime readiness is established.' };
}
export async function check(config: RoomConfig, env: NodeJS.ProcessEnv) {
  let state: unknown;
  try { state = { permissions: statePermissions(config.state_dir), writer_locked: writerLocked(config.state_dir), pending: pending(config.state_dir) }; }
  catch (error) { state = { code: error instanceof CLIError ? error.code : 'state_unreadable' }; }
  const present = credentialsPresent(config, env);
  let health = 'agent_availability_unknown';
  if (env[config.hook.secret_env]) {
    const context = healthContext(config, env[config.hook.secret_env]!);
    await context.hook.refresh(context.availability, context.credential); health = context.availability.check();
  }
  return { mode: 'create-room', legacy_config: config.schema_version === 1, runtime: { version: process.version, supported: true }, configuration: 'valid',
    credentials: { presence: present ? 'present' : 'missing_or_invalid', verified_livekit_access: false },
    state, health: { code: health, observed_at: Date.now(), action: health === 'available' ? 'Authenticated local sample; each call still requires exact readiness.' : health === 'agent_unavailable' ? 'Start the configured agent separately, then check again. Admission remains disabled.' : 'Verify the same-host hook, injected secret, expected boot/target and fresh worker health. Admission remains disabled.' },
    authorization: config.transport.mode === 'hosted-v1' ? await inspectHosted(config, env) : { status: config.transport.mode === 'unconfigured' ? 'backend_unconfigured' : 'unverified', action: 'Enroll explicitly; check does not connect or activate a binding.' },
    admission_enabled: false, limitation: 'Partial local diagnostics; no resource allocation and no media or FaceTime qualification.' };
}
