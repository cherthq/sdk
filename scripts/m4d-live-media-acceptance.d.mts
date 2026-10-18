export const PNG: Buffer;
export const CALLER_SOURCE: string;
export const REMOTE_PROGRAM: string;
export const REVIEWED_FILES: string[];
export const SOURCE_FILES: string[];
export type MediaPlan = {version:number;run:string;approved_guid:string;caller_sha256:string;reviewed_files:Array<{path:string;sha256:string}>;plan:string;prior_receipt_path:string;prior_receipt_sha256:string;bindings:Record<string,string|number>;png_sha256:string;png_bytes:number;attempted:boolean;passed:boolean;integration:string;sources:Array<{path:string;sha256:string}>};
export function preparePlan(priorPath:string,bindingsPath:string,run?:string):MediaPlan;
export function validateNativeBody(plan:MediaPlan,body:unknown):void;
export function createOneAttemptBroker(plan:MediaPlan,journalPath:string,execute:(args:{plan:MediaPlan;body:unknown;png:Buffer})=>Promise<unknown>):{attempt(body:unknown,uploadedBytes:Uint8Array):Promise<any>;close():void};
export function startReviewedLiveBroker(planPath:string,journalPath:string,reviewFlag:string,beforeDispatch:(context:{publicId:string;body:any})=>Promise<void>):Promise<{apiKey:string;signingSecret:string;nativeOrigin:string;sender:string;recipient:string;png:Buffer;bindUploadedPNG(bytes:Uint8Array,id:string):void;observe(guid:string):Promise<any>;close():void}>;
export function auditReviewedMediaBindings(priorReceiptPath:string):Promise<any>;

export function recordMediaReceipt(journalPath:string,update:Record<string,unknown>):{receiptPath:string;receiptSha256:string};

export const OPERATION_SOURCE_FILES: string[];
export type OperationPlan = Omit<MediaPlan,'version'> & {version:2;cloud_caller_sha256:string;cloud_context_sha256:string};
export function prepareOperationPlan(priorPath:string,bindingsPath:string,run?:string):OperationPlan;
export function operationPreflight(plan:OperationPlan):{ready:false;mode:string;method:string;path:string;blockers:string[]};
