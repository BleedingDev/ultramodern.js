export interface BindingClassGroup {
    /** Preparation can be discarded without changing the DOM or its receipts. */
    prepare(value: string): {
        commit(): void;
    };
    /** An uncommitted adoption leaves the historical SSR contribution intact. */
    dispose(preservePresentation?: boolean): void;
}
export declare function __bindingClassReceipt(baseline: unknown, groups: readonly unknown[]): string;
/**
 * Adopt the server's historical contribution, not a possibly newer client value.
 * Baseline and sibling groups each retain their own contribution to shared atoms.
 * The surrounding binding runtime owns channel exclusion and subscription lifetime.
 */
export declare function createBindingClassGroup(node: Element, name: string, index: number, initialReceipt?: string): BindingClassGroup;
