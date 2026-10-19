export const react = (handle: string) => fetch('https://api.sendblue.com/api/send-reaction', {
  method: 'POST',
  body: JSON.stringify({ from_number: '+15550000001', message_handle: handle, reaction: 'love' }),
});
