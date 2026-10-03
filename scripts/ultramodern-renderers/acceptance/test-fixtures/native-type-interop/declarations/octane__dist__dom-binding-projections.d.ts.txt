import { type BindingOperation, type BindingValue } from './dom-bindings.js';
import type { BindingPreparedValue } from './dom-binding-signals.js';
export type BindingProjectionGroup = readonly (readonly [index: number, field: string])[];
export interface BindingProjectionConnection {
    readonly group: BindingProjectionGroup;
    read(compute: unknown): BindingValue[];
    get(): BindingValue[];
    preview(compute: unknown): BindingPreparedValue<BindingValue[]>;
    writeStyle(index: number, value: BindingValue): void;
    dispose(preservePresentation?: boolean): void;
}
/** Optional, view-owned projections share a read and prepare every field before any write. */
export declare function __createBindingProjections(): {
    connect(group: BindingProjectionGroup, bindings: readonly BindingOperation[], nodes: readonly Node[], notify: () => void, restoreStyles?: boolean): BindingProjectionConnection;
};
