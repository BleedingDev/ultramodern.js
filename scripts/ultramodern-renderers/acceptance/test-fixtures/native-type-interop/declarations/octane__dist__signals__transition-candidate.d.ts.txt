import { type SignalActionFrame } from './transition-action.js';
export type { CandidatePreparation } from './transition-action.js';
export type SignalCandidateFrame = SignalActionFrame;
/** Enable native forwarding leases without creating a graph or frame. */
export declare function installNativeSignalActionExtension(): void;
