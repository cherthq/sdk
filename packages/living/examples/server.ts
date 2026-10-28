/** Developer backend: deploy the page, attach it to a call and drive it from your own events. Voice keeps working throughout. */
import { ChertControlPlane, livingSignatureVersion, parseLivingServices, verifyLivingServiceWebhook, type LivingServiceMessageWebhook } from '@cherthq/control-plane';

/** Deploy once per release (e.g. in CI), not per call. Reuse the key when retrying the same release. */
export async function deployOrderBoard(client: ChertControlPlane, release: string) {
  const service = await client.createLivingService({ name: 'Order board', entry_url: `https://app.example/board/${release}/`,
    viewport: { width: 1280, height: 720 }, fps: 30, input: ['pointer'] }, `order-board-${release}`);
  let deployment = service;
  for (const deadline = Date.now() + 120_000; deployment.status === 'pending' && Date.now() < deadline;) {
    await new Promise(r => setTimeout(r, 1000));
    deployment = await client.getLivingDeployment(service.service_id, service.deployment_id);
  }
  if (deployment.status !== 'ready') throw new Error(`Deployment not ready: ${deployment.error_code ?? deployment.status}`);
  return deployment.deployment_id;
}

/** Per call: attach the deployed page and drive it from your own events. Voice keeps working throughout. */
export async function showOrderBoard(client: ChertControlPlane, callId: string, deploymentId: string) {
  const call = await client.getCall(callId);
  if (!parseLivingServices(call.living_services)) throw new Error('Living services are not available for this call.');
  // One key per attach attempt: reusing it after a detach would replay the earlier session.
  const session = await client.attachLivingService(callId, { deployment_id: deploymentId, initial_state: { title: 'Your order', items: [] } }, `attach-${callId}-${crypto.randomUUID()}`);
  let revision = 0;
  return {
    update: (items: { name: string; done: boolean }[]) => client.setLivingState(callId, session.session_id, ++revision, { title: 'Your order', items }),
    note: (text: string) => client.sendLivingEvent(callId, session.session_id, 'note', text),
    stop: () => client.detachLivingService(callId, session.session_id),
  };
}

/** Receives page messages: verify the raw bytes, then de-duplicate on event_id (delivery is at-least-once). */
export async function onLivingMessage(request: Request, secrets: Map<number, string>, seen: Set<string>): Promise<Response> {
  const raw = new Uint8Array(await request.arrayBuffer());
  const secret = secrets.get(livingSignatureVersion(request.headers.get('X-Chert-Signature-Version')) ?? 0);
  if (!secret || !await verifyLivingServiceWebhook(raw, request.headers.get('X-Chert-Signature'), secret)) return new Response(null, { status: 401 });
  const event = JSON.parse(new TextDecoder().decode(raw)) as LivingServiceMessageWebhook;
  if (seen.has(event.event_id)) return new Response(null, { status: 200 });
  seen.add(event.event_id);
  if (event.data.message === 'order.confirmed') console.log('Caller confirmed order on call', event.data.call_id);
  return new Response(null, { status: 200 });
}
