import type { DerivedCompute, DerivedOptions, DerivedSignal, SignalOptions } from './types.js';
export declare function __derivedAt<T>(site: string | undefined, compute: DerivedCompute<T>, options?: DerivedOptions & SignalOptions): DerivedSignal<T>;
export declare function derived$<T>(compute: DerivedCompute<T>, options?: DerivedOptions & SignalOptions): DerivedSignal<T>;
