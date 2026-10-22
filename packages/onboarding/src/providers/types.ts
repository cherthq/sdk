import type {ClaimPayload,Plan,Target} from '../core/types';
/** Implementations MUST honor a stable idempotencyKey, including after an uncertain transport result. */
export interface MessagingProvider {
 sendMessage(input:{to:string;from:string;text:string;idempotencyKey:string}):Promise<void>;
 requestFaceTime?(input:{to:string;from:string;sessionId:string;idempotencyKey:string}):Promise<'requested'|'busy'|'unavailable'>;
}
/** Provider must verify actual entitlement AND persist an idempotent allocation. Payment alone is insufficient. */
export interface AllocationProvider {allocate(input:{sessionId:string;userId:string;phone:string;plan:Plan;checkoutId:string;target:Target;idempotencyKey:string}):Promise<Omit<ClaimPayload,'sessionId'|'target'|'originAgent'|'resumeStrategy'|'userId'>>}
