import { LinqAPIV3 } from '@linqapp/sdk';

export const client = new LinqAPIV3({});
client.messages.retrieve('m1');
