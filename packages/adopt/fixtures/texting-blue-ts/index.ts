const headers = { 'x-api-key': 'tb_live_abc123SECRET', 'content-type': 'application/json' };

export const send = (to: string, from: string, content: string) =>
  fetch('https://api.texting.blue/v1/messages/send', { method: 'POST', headers, body: JSON.stringify({ to, from, content }) });
export const history = () => fetch('https://api.texting.blue/v1/messages', { headers });
