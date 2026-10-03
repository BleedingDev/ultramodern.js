export declare const FORM_SUBMISSION_ATTR = "data-octane-capture-submit";
export declare const EARLY_FORM_SUBMISSIONS_KEY = "__octaneEarlyFormSubmissions";
export declare const EARLY_FORM_SUBMISSIONS_LIMIT = 256;
export declare const EARLY_FORM_SUBMISSIONS_TIMEOUT_MS = 30000;
/** Detached arguments accepted by the parser-time native submit listener. */
export interface CapturedFormSubmission {
    readonly fields: readonly (readonly [string, string | File])[];
    readonly form: {
        readonly id: string;
        readonly action: string;
        readonly method: string;
        readonly enctype: string;
        readonly target: string;
        readonly noValidate: boolean;
    };
    readonly submitter: {
        readonly id: string;
        readonly name: string;
        readonly value: string;
        readonly type: string;
        readonly formAction: string | null;
        readonly formMethod: string | null;
        readonly formEnctype: string | null;
        readonly formTarget: string | null;
        readonly formNoValidate: boolean;
    } | null;
}
/** @internal DOM references route custody; only snapshot is a public payload. */
export interface EarlyFormSubmissionRecord {
    readonly event: Event;
    readonly form: HTMLFormElement;
    readonly key: string;
    readonly parent: Element | null;
    readonly boundary: Element | null;
    readonly boundaryId: string | null;
    readonly boundaryWhen: string | null;
    readonly boundaryEvents: string | null;
    readonly sequence: number;
    /** A claimed owner's routing authority remains current through native activation. */
    valid?: () => boolean;
    /** Routing or application capture invalidated this command, without releasing its form. */
    discarded?: true;
    /** Undefined while capture is reserved, or after the owner extracts its payload. */
    snapshot: CapturedFormSubmission | undefined;
}
/** @internal Parser-owned ingress continues while behavior owners are absent. */
export interface EarlyFormSubmissionMailbox {
    readonly version: 1;
    readonly q: EarlyFormSubmissionRecord[];
    receive?: (record: EarlyFormSubmissionRecord) => boolean;
    activate?: (record: EarlyFormSubmissionRecord) => void;
    overflow?: boolean;
    captures(form: HTMLFormElement): boolean;
    has(event: Event): boolean;
    flush(): void;
    release(form?: HTMLFormElement): void;
    stop(): void;
}
/** @internal Read only the parser protocol, without initializing client capture. */
export declare function getEarlyFormSubmissionMailbox(ownerDocument: Document): EarlyFormSubmissionMailbox | undefined;
/** @internal An accepted command cannot follow a moved or repurposed form. */
export declare function isEarlyFormSubmissionCurrent(record: EarlyFormSubmissionRecord, ownerDocument: Document): boolean;
/** @internal Native form association also covers controls outside their form. */
export declare function formSubmissionControl(target: Element): HTMLButtonElement | HTMLInputElement | null;
/** @internal Let validation and native submit occur instead of replaying a click. */
export declare function isEarlyFormSubmitActivation(event: Event): boolean;
