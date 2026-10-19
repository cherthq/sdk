const BASE = 'https://api.blooio.com/v4';
const headers = { Authorization: `Bearer ${process.env.BLOOIO_API_KEY}` };

export const send = (to: string) => fetch(`${BASE}/messages`, { method: 'POST', headers, body: JSON.stringify({ from: '+15550000001', to, text: 'hi' }) });
export const status = (chat: string, id: string) => fetch(`${BASE}/chats/${chat}/messages/${id}/status`, { headers });
export const react = (chat: string, id: string) => fetch(`${BASE}/chats/${chat}/messages/${id}/reactions`, { method: 'POST', headers });
export const groups = () => fetch('https://api.blooio.com/v4/groups', { method: 'POST', headers });
