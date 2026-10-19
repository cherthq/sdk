const API = 'https://api.contiguity.com/send';
const headers = { Authorization: `Token ${process.env.CONTIGUITY_TOKEN}` };

export const send = (to, message) => fetch(`${API}/imessage`, { method: 'POST', headers, body: JSON.stringify({ to, message }) });
export const typing = (to, from) => fetch(`${API}/imessage/typing`, { method: 'POST', headers, body: JSON.stringify({ to, from, action: 'start' }) });
export const react = body => fetch(`${API}/imessage/reactions`, { method: 'POST', headers, body: JSON.stringify(body) });
