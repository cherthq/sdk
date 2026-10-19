import Blooio from "@blooio/sdk";
import type { MessageSendResponse } from "@blooio/sdk/resources/messages";

export class Notifier {
  private client = new Blooio({ apiKey: process.env.BLOOIO_API_KEY });

  send(to: string): Promise<MessageSendResponse> {
    return this.client.messages.send({ to, text: "hello" });
  }

  whoami() {
    return this.client.me.retrieve();
  }
}
