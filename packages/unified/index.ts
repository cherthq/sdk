import { ChertClient, type ChertClientOptions } from '@cherthq/imessage';
import { ChertControlPlane, type ClientOptions } from '@cherthq/control-plane';

export interface ChertSDKOptions {
  /** Shared application context; service credentials remain explicitly separate. */
  projectId: string;
  imessage: ChertClientOptions;
  facetime: Omit<ClientOptions, 'projectId'>;
}

/** One project context, two existing transports. No credential conversion or provisioning. */
export class ChertSDK {
  readonly projectId: string;
  readonly imessage: ChertClient;
  readonly facetime: ChertControlPlane;
  constructor(options: ChertSDKOptions) {
    if (!options.projectId.trim()) throw new TypeError('An explicit projectId is required');
    this.projectId = options.projectId;
    this.imessage = new ChertClient(options.imessage);
    this.facetime = new ChertControlPlane({ ...options.facetime, projectId: options.projectId });
  }
}
