import express from 'express';

const app = express();
app.post('/webhooks/sendblue', (req, res) => {
  console.log(req.body.message_handle, req.body.from_number, req.body.date_sent);
  res.sendStatus(200);
});
