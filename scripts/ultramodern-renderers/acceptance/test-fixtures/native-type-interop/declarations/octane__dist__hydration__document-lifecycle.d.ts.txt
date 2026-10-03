import type { SignalOwner } from '../signals/types.js';
import type { IndependentHydrateLifecycle } from './independent-island.js';
import type { StreamedSignalResults } from './streamed-signals.js';
export interface SignalDocumentLifecycleOptions {
    readonly document: Document;
    readonly buildId: string;
    readonly documentId: string;
    readonly signalOwner?: SignalOwner;
    readonly streamedHydration?: Pick<StreamedSignalResults, 'suspend'>;
    readonly independentHydration?: IndependentHydrateLifecycle;
    /** Host-owned identity carrier. Null, mismatch, or failure retires persisted state. */
    readonly readIdentity?: () => {
        readonly buildId: string;
        readonly documentId: string;
    } | null;
    readonly onMismatch?: () => void;
}
/** Optional feature-local lifetime for one executing document, never an account manager. */
export declare function installSignalDocumentLifecycle(options: SignalDocumentLifecycleOptions): {
    signalOwner: SignalOwner;
    whenActive(): Promise<boolean>;
    dispose: () => void;
};
