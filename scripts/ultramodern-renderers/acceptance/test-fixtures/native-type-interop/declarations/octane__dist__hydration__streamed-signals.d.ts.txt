import { type NativeSignalManifest } from '../signals/native-read-seeds.js';
export type { NativeSignalManifest, NativeSignalReference } from '../signals/native-read-seeds.js';
import type { SignalOwnerIdentity } from '../signals/types.js';
import { type StreamedRendererDeliveryOptions } from './stream-delivery.js';
import { type StreamedRegionReceiver } from './stream-receiver.js';
import { type StreamedResultReceiver } from './stream-result-receiver.js';
export { installSignalDocumentLifecycle, type SignalDocumentLifecycleOptions, } from './document-lifecycle.js';
export interface StreamedSignalHydrationOptions extends StreamedRendererDeliveryOptions {
    readonly buildId: string;
    readonly documentId: string;
    /** Custom authority; pass it to hydrateRoot or use runWithSignalOwner in behavior callbacks. */
    readonly signalOwner?: SignalOwnerIdentity;
    /**
     * Full version 1 initial-response data only. Install once, before live access or stream
     * attachment. Only the document scope is initialized; instance snapshots stay
     * historical. A failed join retires newly initialized authority rather than
     * rolling state back. The caller supplies the matching build/document identity.
     */
    readonly initialSignals?: NativeSignalManifest;
    readonly target?: Record<string, unknown>;
}
export interface StreamedSignalResults {
    readonly signalOwner: SignalOwnerIdentity;
    readonly receiver: StreamedResultReceiver;
    dispose(): void;
    /** Permanently fence this document's old ingress without restoring its early mailbox. */
    suspend(): void;
}
export interface StreamedSignalHydration extends StreamedSignalResults {
    readonly receiver: StreamedRegionReceiver;
}
/**
 * Upgrade the server's pre-module mailboxes before behavior reads or hydration.
 * No component root is required. An optional hydrateRoot receives the returned
 * owner so its instance-local descriptors join the same server-authorized
 * selections without starting duplicate browser loaders.
 */
export declare function bootstrapStreamedSignalHydration(options: StreamedSignalHydrationOptions): StreamedSignalHydration;
/**
 * Upgrade the same pre-module mailboxes when the host owns DOM delivery.
 * Results join the existing signal owner synchronously, without region placement
 * support. Use bootstrapStreamedSignalHydration to register streamed HTML ranges.
 */
export declare function bootstrapStreamedSignalResults(options: StreamedSignalHydrationOptions): StreamedSignalResults;
