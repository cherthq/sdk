import type {ClaimPayload,Plan,Target} from '../core/types';
export interface OnboardingContactContext {sessionId:string;originAgent:string;target:Target}
/** Implementations MUST honor a stable idempotencyKey, including after an uncertain transport result. */
export interface MessagingProvider {
 sendMessage(input:{to:string;from:string;text:string;idempotencyKey:string;context?:OnboardingContactContext}):Promise<void>;
 requestFaceTime?(input:{to:string;from:string;sessionId:string;idempotencyKey:string;context?:OnboardingContactContext}):Promise<'requested'|'busy'|'unavailable'>;
}
/** Provider must verify actual entitlement AND persist an idempotent allocation. Payment alone is insufficient. */
export interface AllocationProvider {allocate(input:{sessionId:string;userId:string;phone:string;plan:Plan;checkoutId:string;target:Target;idempotencyKey:string}):Promise<Omit<ClaimPayload,'sessionId'|'target'|'originAgent'|'resumeStrategy'|'userId'>>}
