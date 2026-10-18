export type LiveConfig = {
  approval: 'three-reviewed-imessage-only-sends' | 'one-reviewed-v4-imessage-only-send';
  from: string;
  to: string;
  run: string;
};
export function parseLiveConfig(value: unknown): LiveConfig;
export function adapterPlan(config: LiveConfig): string[];
export function dispatchM4D(args: { message: string; phoneLineId?: string }, config: LiveConfig): Promise<unknown>;
export function runLiveAdapters(clients: unknown, config: LiveConfig): Promise<unknown>;
