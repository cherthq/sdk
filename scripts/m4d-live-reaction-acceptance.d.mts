export type ReactionClaim = {operationId:string;body:{origin:string;from:string;to:string;targetGuid:string;partIndex:0;reaction:'love'|'like';remove:boolean};fingerprint:string;body_sha256:string;plan_sha256:string};
export type ReactionPlan = {version:2|3;target_guid:string;receipt_path:string;run:string;[key:string]:unknown};
export function prepareReactionPlan(manifest:string,installation:string,nativeLoveExport:string,targetTextProofPath:string,run?:string):ReactionPlan;
export function loadReactionPlan(path:string):ReactionPlan;
export function reactionFingerprint(body:ReactionClaim['body']):string;
export const REACTION_FILES:string[];
export const REMOTE_REACTION_PROGRAM:string;
export type ReactionBroker={plan?:ReactionPlan;nativeOrigin:string;apiKey:string;signingSecret:string;sender:string;recipient:string;targetText:string;recordSDKAcceptance(value:{status:'accepted'}):void;observe(guid:string):Promise<{passed:true;receiptPath:string;receiptSha256:string}>;close():void};
export function startReviewedReactionBroker(planPath:string,journalPath:string,flag:'--live-one-linq-remove-love'|'--live-one-linq-like',verifyReservation:(claim:ReactionClaim)=>Promise<boolean>):Promise<ReactionBroker>;
export function createReactionGateway(plan:unknown,journalPath:string,identity:unknown,verifyReservation:(claim:ReactionClaim)=>Promise<boolean>,execute:(payload:unknown)=>Promise<unknown>):Promise<ReactionBroker>;

export function prepareLikeReactionPlan(manifest:string,installation:string,love:string,proof:string,options:{reaction:'like';remove:false}|{reaction:'like';remove:true;priorLikeReceiptPath:string},run?:string):ReactionPlan;
