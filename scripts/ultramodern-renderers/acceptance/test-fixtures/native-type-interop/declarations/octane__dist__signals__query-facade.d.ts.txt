import { skip, type QueryContext, type QueryLoadResult, type QueryOptions, type QuerySignal, type SignalOptions } from './types.js';
export declare function __queryAt<A, T>(site: string | undefined, select: () => A | typeof skip, load: (selection: A, context: QueryContext<T>) => QueryLoadResult<T>, options?: QueryOptions & SignalOptions): QuerySignal<T>;
export declare function query$<A, T>(select: () => A | typeof skip, load: (selection: A, context: QueryContext<T>) => QueryLoadResult<T>, options?: QueryOptions & SignalOptions): QuerySignal<T>;
