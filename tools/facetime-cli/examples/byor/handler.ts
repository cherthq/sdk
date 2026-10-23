import type { ByorHandler } from '@trychert/facetime/byor';
import { sessions } from './sessions.js';

// This is application glue, not an HTTP receiver. The npm package supplies Chert
// authentication, deadlines, duplicate coalescing, decisions and durable delivery.
const handler: ByorHandler = {
  version: 1,
  health: () => sessions.health(),
  prepare: (call, context) => sessions.claim(call, context),
  lifecycle: (call, event) => sessions.deliver(call.operation_id, event),
  recover: (call, context) => sessions.recover(call.operation_id, context),
};
export default handler;
