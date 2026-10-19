const auth = { Authorization: `Bearer ${process.env.BLUEREACHER_KEY}` };

export const send = (to: string, message: string, device_id: string) =>
  fetch('https://api.bluereacher.com/v1/messages', { method: 'POST', headers: auth, body: JSON.stringify({ to, message, send_mode: 'instant', device_id }) });
export const typing = (to: string) => fetch('https://api.bluereacher.com/v1/typing', { method: 'POST', headers: auth, body: JSON.stringify({ to }) });
