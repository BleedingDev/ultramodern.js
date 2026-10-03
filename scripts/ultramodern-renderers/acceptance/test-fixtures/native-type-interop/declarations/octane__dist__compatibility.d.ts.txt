import type { OctaneNode } from './runtime.js';
/** Migration wrapper. Octane deliberately does not replay renders or effects. */
export declare function StrictMode(props: {
    children?: OctaneNode;
}): OctaneNode;
/** Updates already share Octane's microtask batch. */
export declare function unstable_batchedUpdates<A extends unknown[], R>(callback: (...args: A) => R, ...args: A): R;
