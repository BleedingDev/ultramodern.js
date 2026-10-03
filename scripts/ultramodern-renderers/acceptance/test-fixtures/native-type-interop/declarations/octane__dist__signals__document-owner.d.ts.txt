import type { SignalOwner, SignalOwnerIdentity } from './types.js';
/** @internal Actual document capability, shared with an optional renderer. */
export declare let signalDocumentEnabled: boolean;
export declare let streamedSignalOwnerActivator: ((owner: SignalOwner) => void) | undefined;
/** @internal Shared document identity for state-only and component consumers. */
export declare function documentSignalOwner(container: Node): SignalOwnerIdentity;
/** @internal Compiler capability for global signals without a rendering engine. */
export declare function enableSignalDocument(abi?: number): void;
/** @internal Instance activation is optional; global results need no component root. */
export declare function installStreamedSignalOwnerActivator(activate: (owner: SignalOwner) => void): () => void;
