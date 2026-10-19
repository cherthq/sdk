const key = process.env.MISSBLUE_API_KEY;

export const send = (number_id: string, recipient: string, text: string) => fetch('https://api.missblue.dev/v1/messages', {
  method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: JSON.stringify({ number_id, recipient, text }),
});
export const numbers = () => fetch('https://api.missblue.dev/v1/numbers');
export const conversations = () => fetch('https://api.missblue.dev/v1/conversations');
