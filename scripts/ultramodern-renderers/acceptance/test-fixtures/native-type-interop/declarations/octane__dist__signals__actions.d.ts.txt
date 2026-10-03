import { type ActionOperation, type ActionUncertain, type OptimisticOptions, type OptimisticSignal, type SignalAction, type SignalHandle } from './types.js';
export declare class ActionUncertainError extends Error {
    readonly operationId: string;
    readonly code = "OCTANE_ACTION_UNCERTAIN";
    constructor(operationId: string, options: {
        cause: unknown;
    });
}
export declare function optimistic$<T>(source$: SignalHandle<T>, options?: OptimisticOptions<T>): OptimisticSignal<T>;
export declare function action$<F extends (operation: ActionOperation, ...args: any[]) => any>(handler: F): SignalAction<F>;
export declare function action$<F extends (operation: ActionOperation, ...args: any[]) => any>(key: string, handler: F): SignalAction<F>;
export declare function isActionUncertain(value: unknown): value is ActionUncertain | ActionUncertainError;
