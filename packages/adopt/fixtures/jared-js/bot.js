exports.reply = (handle, message) => fetch('http://localhost:3005/message', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ body: { message }, recipient: { handle } }),
});
