import SendblueAPI from 'sendblue';

const client = new SendblueAPI({ apiKey: 'sb_hardcoded_SECRET_123', apiSecret: process.env.SENDBLUE_API_API_SECRET });

export async function notify(to: string) {
  await client.messages.send({ from_number: '+15550000001', number: to, content: 'hi' });
  return client.messages.getStatus({ handle: 'abc' });
}
