import { describe, expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { renderOnboardingPage } from '../src/http/browser.js';
import { browserClientSource } from '../src/http/browser-client.js';

const page = (extra = {}) => renderOnboardingPage({sessionId:'session-one',agent:'Muse',targetLabel:'Personal agent',csrf:'csrf-token',state:'phone_pending',phoneVerified:false,passkeyRegistered:false,nonce:'test-nonce',...extra});
describe('first-party concierge browser', () => {
  test('escapes displayed context and embedded JSON without script termination', () => {
    const html=page({agent:'<img src=x onerror=alert(1)>',targetLabel:'"project" & tools',sessionId:'</script><script>bad()</script>',csrf:'</script>'});
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&quot;project&quot; &amp; tools');
    expect(html).toContain('\\u003c/script>');
    expect(html).not.toContain('<script>bad()');
    const raw=html.match(/id="onboarding-data"[^>]*>(.*?)<\/script>/s)![1]!;
    expect(JSON.parse(raw).sessionId).toBe('</script><script>bad()</script>');
  });
  test('applies CSP nonce to executable script and style; no external resources', () => {
    const html=page();
    expect(html.match(/nonce="test-nonce"/g)?.length).toBe(3);
    expect(html).not.toMatch(/<(?:script|link|img)[^>]+(?:src|href)=/i);
    expect(html).toContain('noindex,nofollow');
    expect(page({nonce:'" unsafe'})).toContain('nonce="&quot; unsafe"');
  });
  test('clearly prices plans and keeps payment user-initiated', () => {
    expect(page()).toContain('US$25 / month');
    expect(page()).toContain('US$250 / month');
    expect(page()).toContain('billed monthly per line');
    expect(browserClientSource).toContain("el('checkout').addEventListener('click'");
    expect(browserClientSource).toContain("request('/checkout',{})");
    expect(browserClientSource).toContain("url.hostname!=='checkout.stripe.com'");
    expect(browserClientSource).not.toContain('localStorage');
  });
  test('uses native user-presence credentials and includes CSRF on mutation', () => {
    expect(browserClientSource).toContain('navigator.credentials.create({publicKey})');
    expect(browserClientSource).toContain('navigator.credentials.get({publicKey})');
    expect(browserClientSource).toContain("'X-CSRF-Token':data.csrf");
    expect(browserClientSource).toContain('window.isSecureContext');
    expect(browserClientSource).toContain('attestationObject');
    expect(browserClientSource).toContain('authenticatorData');
    expect(browserClientSource).toContain('getClientExtensionResults()');
    expect(browserClientSource).toContain("credentials:'same-origin'");
    expect(() => new Function(browserClientSource)).not.toThrow();
  });
  test('exposes accessible state and clear limits instead of pretending setup succeeded', () => {
    const html=page();
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('prefers-reduced-motion:reduce');
    expect(browserClientSource).toContain('Reply to Chert with the verification code');
    expect(browserClientSource).toContain('Chert is checking your entitlement and line availability');
    expect(browserClientSource).toContain('Cancelling setup does not cancel an existing subscription');
  });
});

test('browser registration converts buffers to standard JSON and waits for explicit click', async () => {
  const listeners: Record<string, () => Promise<void>> = {};
  const elements = new Map<string, any>();
  const ids=['onboarding-data','message','passkeys','plans','cancel','heading','description','checkout','register','authenticate'];
  for(const id of ids) elements.set(id,{textContent:'',dataset:{},hidden:false,disabled:false,addEventListener:(_event:string,fn:()=>Promise<void>)=>{listeners[id]=fn;}});
  elements.get('onboarding-data').textContent=JSON.stringify({sessionId:'one',csrf:'csrf',state:'passkey_pending'});
  const requests: {url:string;body:any}[]=[];
  let nativeCalls=0;
  runInNewContext(browserClientSource, {
    document:{getElementById:(id:string)=>elements.get(id),querySelectorAll:()=>[]},
    window:{isSecureContext:true,PublicKeyCredential:class {}},
    navigator:{credentials:{create:async ({publicKey}:any)=>{nativeCalls++;expect(Array.from(publicKey.challenge)).toEqual([251,255]);return {id:'-_8',rawId:new Uint8Array([251,255]).buffer,type:'public-key',authenticatorAttachment:'platform',getClientExtensionResults:()=>({}),response:{clientDataJSON:new Uint8Array([251,255]).buffer,attestationObject:new Uint8Array([251,255]).buffer,getTransports:()=>['internal']}};}}},
    fetch:async (url:string,options:any)=>{const body=options.body?JSON.parse(options.body):undefined;requests.push({url,body});return {ok:true,json:async()=>({data:url.endsWith('/options')?{mode:'register',options:{challenge:'-_8',user:{id:'AQ',name:'account',displayName:'Account'},rp:{name:'Chert'}}}:url.endsWith('/status')?{state:'plan_pending'}:{}})};},
    atob,btoa,Uint8Array,URL,setTimeout:()=>0,
  });
  expect(nativeCalls).toBe(0);
  await listeners.register!();
  expect(nativeCalls).toBe(1);
  const verify=requests.find(r=>r.url.endsWith('/verify'))!;
  expect(verify.body.credential.rawId).toBe('-_8');
  expect(verify.body.credential.response.attestationObject).toBe('-_8');
  expect(verify.body.credential.response.transports).toEqual(['internal']);
  expect(requests.some(r=>r.url.endsWith('/checkout'))).toBe(false);
});
