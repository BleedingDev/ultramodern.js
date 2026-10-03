declare const FORM_SUBMISSION_CAPTURE: unique symbol;
/** Opaque synchronous opt-in produced by captureFormSubmissions(). */
export interface FormSubmissionCapture {
    readonly [FORM_SUBMISSION_CAPTURE]: true;
}
/**
 * Explicitly connect parser-time commands to this behavior root before any
 * registration can adopt its DOM. Unconfigured nested roots reserve their own
 * scope and keep the ordinary two-argument native captureEvent contract.
 */
export declare function captureFormSubmissions(): FormSubmissionCapture;
export {};
