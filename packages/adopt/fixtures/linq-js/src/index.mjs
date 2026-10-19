import Linq from '@linqapp/sdk';

const linq = new Linq({ apiKey: process.env.LINQ_API_V3_API_KEY });

export async function run(chatId) {
  await linq.chats.messages.send(chatId, { message: { parts: [{ type: 'text', value: 'hello' }] } });
  await linq.chats.typing.start(chatId);
  await linq.chats.create({ from: '+15550000001', to: ['+15550000002'], message: { parts: [] } });
  await linq.chats.participants.add(chatId, { handle: '+15550000003' });
}
