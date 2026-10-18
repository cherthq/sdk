export type SendblueReactionClaim = {
  operationId: string;
  body: {
    origin: string;
    from: string;
    to: string;
    targetGuid: string;
    partIndex: 0;
    reaction: "like";
    remove: false;
  };
  fingerprint: string;
  body_sha256: string;
  plan_sha256: string;
};
export type SendblueReactionPlan = {
  version: 1;
  target_guid: string;
  marker: string;
  receipt_path: string;
  run: string;
  event: Record<string, unknown>;
  [key: string]: unknown;
};
export type SendblueReactionBroker = {
  plan: SendblueReactionPlan;
  nativeOrigin: string;
  apiKey: string;
  signingSecret: string;
  sender: string;
  recipient: string;
  targetGuid: string;
  targetText: string;
  event: Record<string, unknown>;
  recordSDKAcceptance(value: {
    status: "OK";
    message: "Reaction request sent";
    message_handle: string;
    reaction: "like";
  }): void;
  observe(
    guid: string
  ): Promise<{ passed: true; receiptPath: string; receiptSha256: string }>;
  close(): void;
};
export function prepareSendblueReactionPlan(
  manifest: string,
  installation: string,
  receivedExport: string,
  run?: string
): SendblueReactionPlan;
export function startReviewedSendblueReactionBroker(
  planPath: string,
  journalPath: string,
  flag: "--live-one-sendblue-received-like",
  verifyReservation: (claim: SendblueReactionClaim) => Promise<boolean>,
  executor?: (payload: any) => Promise<any>
): Promise<SendblueReactionBroker>;
export const REMOTE_SENDBLUE_REACTION_PROGRAM: string;
