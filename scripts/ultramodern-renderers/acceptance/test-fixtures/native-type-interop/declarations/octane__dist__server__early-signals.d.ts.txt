export interface EarlySignalBootstrapOptions {
    readonly nonce?: string;
    /** Include native intent capture for independently activated widgets. */
    readonly independentHydration?: boolean;
    /** Capture native submissions only for forms naming a behavior with data-octane-capture-submit. */
    readonly formSubmissions?: boolean;
}
/**
 * Install the framework's renderer-free input and streaming mailboxes before
 * exposing interactive HTML. Envelope-owning hosts emit this once and pass
 * earlySignalBootstrap: 'external' to each fragment renderer. This does not
 * import, preload or activate client modules, nor install application policy.
 */
export declare function earlySignalBootstrapScript(options?: EarlySignalBootstrapOptions): string;
/** @internal Shared byte-identical bootstrap for buffered and streaming renderers. */
export declare function streamedSignalBootstrapJs(independentHydration?: boolean, formSubmissions?: boolean): string;
