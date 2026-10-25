/** Developer backend: deploy the page, attach it to a call and drive it from your own events. Voice keeps working throughout. */
import { ChertControlPlane, parseLivingCapabilities } from '@cherthq/control-plane';

export async function showOrderBoard(client: ChertControlPlane, callId: string) {
  const call = await client.getCall(callId);
  if (!parseLivingCapabilities(call.living_capabilities).living_services) throw new Error('Living services are not available for this call.');
  const service = await client.createLivingService({ name: 'Order board', entry_url: 'https://app.example/board/v1/', viewport: { width: 1280, height: 720 }, fps: 30, input: ['pointer'] });
  let deployment = service;
  while (deployment.status === 'pending') {
    await new Promise(r => setTimeout(r, 1000));
    deployment = await client.getLivingDeployment(service.service_id, service.deployment_id);
  }
  if (deployment.status !== 'ready') throw new Error(`Deployment failed: ${deployment.error_code}`);
  const session = await client.attachLivingService(callId, { deployment_id: deployment.deployment_id, initial_state: { title: 'Your order', items: [] } }, `attach-${callId}`);
  let revision = 0;
  return {
    update: (items: { name: string; done: boolean }[]) => client.setLivingState(callId, session.session_id, ++revision, { title: 'Your order', items }),
    note: (text: string) => client.sendLivingEvent(callId, session.session_id, 'note', text),
    stop: () => client.detachLivingService(callId, session.session_id),
  };
}

/** Receives page messages. Verify the webhook signature with your configured secret before calling this. */
export function onLivingMessage(event: import('@cherthq/control-plane').LivingServiceMessageWebhook, seen: Set<string>) {
  if (seen.has(event.event_id)) return;   // at-least-once delivery
  seen.add(event.event_id);
  if (event.data.message === 'order.confirmed') console.log('Caller confirmed order on call', event.data.call_id);
}
