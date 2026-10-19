import { Spectrum } from 'spectrum-ts';

export const spectrum = new Spectrum();
export const bluebubbles = (host: string) => fetch(`${host}/api/v1/message/text?password=${process.env.BLUEBUBBLES_PASSWORD}`, { method: 'POST' });
export const messageblue = () => fetch('https://api.messageblue.ai/sendIndividualMessage', { method: 'POST' });
