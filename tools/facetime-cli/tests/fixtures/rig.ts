import { randomUUID } from 'node:crypto';
import { Connector } from '../../src/runtime/connector.js';
import { Availability, type Health } from '../../src/runtime/availability.js';
import { MemoryJournal } from '../../src/runtime/journal.js';
import { type Scope } from '../../src/protocol/v1.js';
import { ManualClock } from './clock.js';
import { FakeAgent } from './agent.js';
import { ControlPlane } from './control-plane.js';
export const TOKEN = 'SYNTHETIC_CONNECTOR_SECRET_SENTINEL';
export const RECOVERY = 'SYNTHETIC_RECOVERY_SECRET_SENTINEL';
export const HEALTH = 'SYNTHETIC_HEALTH_SECRET_SENTINEL';
export const baseScope: Scope = { project_id: 'project_1', line_id: 'line_1', binding_id: 'binding_1', binding_epoch: 1, instance_id: 'instance_1', connection_generation: 0 };
export function rig() {
  const clock = new ManualClock(); const authority = new ControlPlane(clock);
  authority.enroll(TOKEN, baseScope); authority.enroll(RECOVERY, baseScope, true); authority.activate(TOKEN, 0);
  const scope = authority.connect(TOKEN); const journal = new MemoryJournal(scope);
  const availability = new Availability(clock, HEALTH, { project: 'livekit_fake', name: 'agent', deployment: 'local' });
  const agent = new FakeAgent(clock); const connector = new Connector(scope, journal, agent, availability, clock);
  const result = { clock, authority, scope, journal, availability, agent, connector, sequence: 0, request: () => authority.register(TOKEN) };
  healthy(result); return result;
}
export function healthy(r: { clock: { wall(): number }; availability: Availability; sequence: number }, patch: Partial<Health> = {}): Health {
  const challenge = randomUUID(); r.availability.challenge(challenge);
  const observation: Health = { project: 'livekit_fake', name: 'agent', deployment: 'local', boot: 'boot_1', sequence: ++r.sequence,
    observed_at: r.clock.wall(), connected: true, draining: false, capacity: 1, challenge, ...patch };
  r.availability.observe(HEALTH, observation); return observation;
}
