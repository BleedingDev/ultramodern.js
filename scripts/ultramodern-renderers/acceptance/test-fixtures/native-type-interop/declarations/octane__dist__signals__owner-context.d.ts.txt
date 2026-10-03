import type { SignalOwner, SignalOwnerEnvironment } from './types.js';
declare let installedEnvironment: SignalOwnerEnvironment | undefined;
declare let synchronousOwner: SignalOwner | null;
/** @internal Live capability guards; reading them never installs a default owner. */
export { installedEnvironment as activeSignalOwnerEnvironment, synchronousOwner as activeSynchronousSignalOwner, };
/** Install a concurrency-safe owner carrier without importing the signal engine. */
export declare function installSignalOwnerEnvironment(environment: SignalOwnerEnvironment): () => void;
export declare function currentSignalOwner(): SignalOwner | null;
/** @internal Distinguish an active owner frame from the lazy document fallback. */
export declare function currentExplicitSignalOwner(): SignalOwner | null;
/** @internal Client renderer installs its lazy document owner, never a last-root owner. */
export declare function installDefaultSignalOwner(current: () => SignalOwner | null): () => void;
/** Enter an owner for a synchronous declaration, read, write, or callback. */
export declare function runWithSignalOwner<T>(owner: SignalOwner, callback: () => T): T;
/** @internal Synchronous SSR entry without retaining a callback frame per component. */
export declare function enterSynchronousSignalOwner(owner: SignalOwner): SignalOwner | null | undefined;
/** @internal Pair with a successful synchronous entry in a finally block. */
export declare function restoreSynchronousSignalOwner(previous: SignalOwner | null): void;
export declare function captureSignalOwner(owner: SignalOwner): <T>(callback: () => T) => T;
/** Retire renderer-created identity state without linking the renderer to the engine. */
export declare function retireSignalOwnerIdentity(owner: SignalOwner): void;
export declare function installSignalOwnerRetirement(retire: (owner: SignalOwner) => void): () => void;
