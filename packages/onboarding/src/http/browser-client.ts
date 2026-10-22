/** Kept dependency-free so the first-party server can serve a CSP-nonced script. */
export const browserClientSource = String.raw`(() => {
  'use strict';
  const data = JSON.parse(document.getElementById('onboarding-data').textContent);
  const base = '/onboarding/' + encodeURIComponent(data.sessionId);
  const el = id => document.getElementById(id);
  let state = data.state, selectedPlan = null, busy = false, stopped = false, passkeyMode = data.passkeyMode, checkoutStarted = false;
  const terminal = ['claimed', 'cancelled', 'expired', 'failed'];
  const message = (text, error = false) => { el('message').textContent = text; el('message').dataset.error = String(error); };
  const errors = {session_expired:'This setup has expired. Ask your agent to start again.', csrf_failed:'This page has expired. Reopen the secure setup link.', invalid_state:'Your setup has moved to another step. Refreshing…', session_near_expiry:'This setup is nearly expired. Ask your agent to restart before paying.',existing_passkey_required:'Use the passkey already associated with this number. Contact Chert for recovery.',payment_reconciliation_required:'Checkout has started. Contact Chert to cancel or reconcile payment safely.',rate_limited:'Too many attempts. Please wait before trying again.'};
  async function request(path, body) {
    const response = await fetch(base + path, {method: body === undefined ? 'GET' : 'POST', credentials:'same-origin', headers: body === undefined ? {} : {'Content-Type':'application/json','X-CSRF-Token':data.csrf}, ...(body === undefined ? {} : {body:JSON.stringify(body)})});
    const result = await response.json();
    if (!response.ok) {if(response.status===401||response.status===410) stopped=true;throw new Error(errors[result.error?.code] || 'That step could not finish. Please try again or ask your agent for help.');}
    return result.data;
  }
  function render(next) {
    state = next.state;
    if(next.checkoutStarted !== undefined) checkoutStarted = next.checkoutStarted;
    if(next.passkeyMode) passkeyMode=next.passkeyMode;
    el('register').hidden = passkeyMode === 'authenticate';
    el('authenticate').hidden = passkeyMode === 'register';
    el('passkeys').hidden = state !== 'passkey_pending';
    el('plans').hidden = !['plan_pending','payment_pending'].includes(state);
    el('cancel').hidden = checkoutStarted || terminal.includes(state) || state === 'ready' || state === 'provisioning';
    const copy = {
      contact_pending:['Chert is reaching out','Chert will message the number you approved. Keep this page open.'],
      phone_pending:['Check your messages','Reply to Chert with the verification code in its message. This proves that you control the number.'],
      passkey_pending:['Make this account yours','Your number is verified. Create a passkey on your device, or use an existing Chert passkey. Your device will ask you to approve.'],
      plan_pending:['Choose your connection','Choose the line that fits your agent. You will review and approve payment with Stripe.'],
      payment_pending:['Finish your payment','Continue to Stripe to review your subscription. We will wait for confirmed payment before setting up the line.'],
      provisioning:['Preparing your line','Payment is confirmed. Chert is checking your entitlement and line availability. Your agent will receive connection details when they are ready.'],
      ready:['Ready for your agent','Your line is ready. Return to the agent that started this setup; it can now finish connecting.'],
      claimed:['Your agent can take it from here','Connection details have been handed back to your agent. It will explain any remaining setup and availability requirements.'],
      cancelled:['Setup cancelled','This setup will not continue. Cancelling setup does not cancel an existing subscription or reverse a payment.'],
      expired:['This setup has expired','Ask your agent to start again. If you already paid, contact Chert before trying another checkout.'],
      failed:['This setup needs attention','Ask your agent or Chert for help. If you already paid, do not create another subscription.']
    };
    if(state==='passkey_pending' && passkeyMode==='authenticate') copy.passkey_pending=['Use your Chert passkey','This number is already linked to an account. Approve its existing passkey to continue. Contact Chert if you need account recovery.'];
    const current = copy[state] || ['Checking setup','Please keep this page open.'];
    el('heading').textContent = current[0]; el('description').textContent = current[1];
    const index = ['contact_pending','phone_pending'].includes(state) ? 0 : state === 'passkey_pending' ? 1 : ['plan_pending','payment_pending'].includes(state) ? 2 : 3;
    document.querySelectorAll('[data-step]').forEach((step,i) => {step.dataset.active=String(i <= index); if(i===index) step.setAttribute('aria-current','step'); else step.removeAttribute('aria-current');});
    if (next.plan) selectedPlan = next.plan;
    document.querySelectorAll('[data-plan]').forEach(button => {button.setAttribute('aria-pressed',String(button.dataset.plan === selectedPlan));button.disabled=busy||checkoutStarted;});
    el('checkout').disabled = !selectedPlan || busy;
    if (terminal.includes(state)) stopped = true;
  }
  function decode(value) {const binary = atob(value.replace(/-/g,'+').replace(/_/g,'/')); return Uint8Array.from(binary,c=>c.charCodeAt(0));}
  function encode(value) {return btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
  function optionsFromJSON(options, mode) {
    const result = {...options,challenge:decode(options.challenge)};
    if (mode === 'register') {result.user={...options.user,id:decode(options.user.id)}; result.excludeCredentials=(options.excludeCredentials || []).map(c=>({...c,id:decode(c.id)}));}
    else result.allowCredentials=(options.allowCredentials || []).map(c=>({...c,id:decode(c.id)}));
    return result;
  }
  function credentialJSON(credential, mode) {
    const response = credential.response;
    const result = {id:credential.id,rawId:encode(credential.rawId),type:credential.type,clientExtensionResults:credential.getClientExtensionResults(),authenticatorAttachment:credential.authenticatorAttachment || undefined,response:{clientDataJSON:encode(response.clientDataJSON)}};
    if(mode==='register') {result.response.attestationObject=encode(response.attestationObject);if(response.getTransports) result.response.transports=response.getTransports();}
    else {result.response.authenticatorData=encode(response.authenticatorData);result.response.signature=encode(response.signature);result.response.userHandle=response.userHandle ? encode(response.userHandle) : null;}
    return result;
  }
  async function action(fn) {
    if(busy) return; busy=true; message(''); document.querySelectorAll('button').forEach(b=>b.disabled=true);
    try {await fn();} catch(error) {message(error?.name==='NotAllowedError' ? 'Passkey approval was cancelled or timed out. You can try again.' : error?.message || 'Unable to complete this step.',true);}
    finally {busy=false; document.querySelectorAll('button').forEach(b=>b.disabled=false); render({state,plan:selectedPlan});}
  }
  async function passkey(mode) {
    if(!window.isSecureContext || !navigator.credentials || !window.PublicKeyCredential) throw new Error('Passkeys require a supported browser and a secure connection. Open this link in your regular browser.');
    const result=await request('/passkey/options',{mode});
    if(result.mode!==mode) throw new Error('The passkey request changed. Please reload this page.');
    const publicKey=optionsFromJSON(result.options,mode);
    const credential=mode==='register' ? await navigator.credentials.create({publicKey}) : await navigator.credentials.get({publicKey});
    if(!credential) throw new Error('No passkey was approved. Please try again.');
    await request('/passkey/verify',{mode,credential:credentialJSON(credential,mode)});
    render(await request('/status')); message('Passkey verified.');
  }
  el('register').addEventListener('click',()=>action(()=>passkey('register')));
  el('authenticate').addEventListener('click',()=>action(()=>passkey('authenticate')));
  document.querySelectorAll('[data-plan]').forEach(button=>button.addEventListener('click',()=>action(async()=>{const plan=button.dataset.plan; await request('/plan',{plan}); selectedPlan=plan; render(await request('/status'));})));
  el('checkout').addEventListener('click',()=>action(async()=>{if(!selectedPlan) return;const result=await request('/checkout',{});const url=new URL(result.url);if(url.protocol!=='https:' || url.hostname!=='checkout.stripe.com' || url.username || url.password) throw new Error('The payment link was not valid. Please contact Chert.');window.location.assign(url.href);}));
  el('cancel').addEventListener('click',()=>action(async()=>{if(!window.confirm('Cancel this setup? Existing subscriptions and completed payments are not cancelled.'))return;render(await request('/cancel',{}));}));
  render(data);
  async function poll() {if(stopped)return;try{render(await request('/status'));}catch(error){message(error.message,true);}if(!stopped)setTimeout(poll,3000);}
  setTimeout(poll,300);
})();`;
