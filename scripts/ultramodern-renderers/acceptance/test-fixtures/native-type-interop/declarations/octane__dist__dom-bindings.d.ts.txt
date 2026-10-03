import type { createBindingClassGroup } from './dom-binding-classes.js';
import type { __createBindingSignals } from './dom-binding-signals.js';
import type { __createBindingStyles, BindingStyleSnapshot } from './dom-binding-styles.js';
import type { __createBindingProjections, BindingProjectionGroup } from './dom-binding-projections.js';
import type { __createBindingControls } from './dom-binding-controls.js';
import type { BindingMountTarget, BindingRange, CompiledBindingProgram } from './dom-binding-program.js';
/** A synchronous, immutable view of an existing application-owned source. */
export interface BindingSource<Props> {
    /** Return the current snapshot, never a promise or other thenable. */
    getSnapshot(): Props;
    /** Notify after publication; return cleanup even when notifying during subscription. */
    subscribe(notify: () => void): () => void;
}
export interface BindingOptions {
    /** The application owns the lifetime of these externally rendered nodes. */
    signal?: AbortSignal;
    /** Restore owned inline style properties on cleanup if no external writer changed them. */
    restoreStyles?: boolean;
}
export interface BindingHandle {
    /** Publish current properties now, including inside an outer source batch. */
    refresh(): void;
    /** Release ownership; structural DOM is preserved unless removal is explicitly requested. */
    dispose(options?: {
        preserveDOM?: boolean;
    }): void;
}
/**
 * Preserve normal rendering while leaving this attribute with its external owner.
 * The compiler recognizes this marker in an opted-in static view's attributes.
 */
export declare function unbound<T>(value: T): T;
/**
 * Adopt a compiler-proven native view without loading a renderer.
 * Octane lowers this intrinsic in a compiled .tsrx/.tsx activation module.
 */
export declare function adoptBindings<Props>(_root: Element | BindingRange, _view: (props: Props) => unknown, _source: BindingSource<NoInfer<Props>>, _options?: BindingOptions): BindingHandle;
/** Construct a compiler-proven fragment at an application-owned insertion point. */
export declare function mountBindings<Props>(_target: BindingMountTarget, _view: (props: Props) => unknown, _source: BindingSource<NoInfer<Props>>, _options?: BindingOptions): BindingHandle;
/** @internal Structural artifacts carry their own statically imported mounting entry. */
export declare function __mountBindings<Props>(target: BindingMountTarget, descriptor: CompiledBindingProgram<Props>, source: BindingSource<Props>, options?: BindingOptions): BindingHandle;
/** @internal Element-only preorder; null children explicitly leave descendants opaque. */
export type BindingNode = readonly [
    parent: number,
    tag: string,
    namespace: 0 | 1,
    children: number | null,
    openChildren?: true | null,
    text?: 1
];
/** @internal Names and numeric CSS units are resolved by the compiler. */
export type BindingOperation = readonly [
    node: number,
    kind: 'attr' | 'boolean' | 'aria' | 'class' | 'classToken' | 'classGroup' | 'styleProperty' | 'styleAttribute' | 'styleObject' | 'control' | 'url' | 'text',
    name: string,
    unitlessOrGroup?: boolean | number
];
/** @internal Whole styles carry canonical snapshots; scalar channels remain strings. */
export type BindingValue = string | null | BindingStyleSnapshot;
/** @internal No application function is invoked to discover the DOM topology. */
export interface CompiledBindings<Props> {
    readonly id: string;
    /** Compiler-proven single native host, with no descendant ownership. */
    readonly handoff?: 'host';
    /** Targets carry compiler-issued addresses when unbound siblings may change. */
    readonly addressed?: true;
    readonly nodes: readonly BindingNode[];
    readonly bindings: readonly BindingOperation[];
    readonly createClassGroup?: typeof createBindingClassGroup;
    readonly connectSignal?: typeof __createBindingSignals;
    readonly signalIndices?: readonly number[];
    readonly connectStyle?: typeof __createBindingStyles;
    readonly styleIndices?: readonly number[];
    readonly connectProjection?: typeof __createBindingProjections;
    readonly projectionGroups?: readonly BindingProjectionGroup[];
    readonly createControls?: typeof __createBindingControls;
    project(props: Props): readonly unknown[];
}
/** @internal Shared channel ownership for compiled scalar and structural presentation. */
export declare function __claimBinding(node: Element, binding: BindingOperation): string;
/** @internal Release only a channel already claimed by the calling lifetime. */
export declare function __releaseBinding(node: Element, name: string): void;
declare function normalize(binding: BindingOperation, value: unknown): BindingValue;
declare function write(node: Element, binding: BindingOperation, value: string | null): void;
export { normalize as __normalizeBinding, write as __writeBinding };
/** @internal Optional native style restoration; the default scalar path does not allocate it. */
export declare function __createBindingStyleRestoration(node: Element, binding: BindingOperation): {
    write(value: string | null): void;
    dispose(preservePresentation?: boolean): void;
};
/** @internal Fixed-layout adopter and compatibility dispatch for earlier compiler output. */
export declare function __adoptBindings<Props>(root: Element | BindingRange, descriptor: CompiledBindings<Props> | CompiledBindingProgram<Props>, source: BindingSource<Props>, options?: BindingOptions): BindingHandle;
/**
 * @internal Compiler-selected adopter for fixed nodes whose every channel is a
 * fixed scalar. It shares node resolution, channel claims, legacy claim
 * publication, signal connections and native transition preview with
 * `__adoptBindings`, but retains none of the projection, control, class-group,
 * style-restoration, host-handoff or addressed-topology integrations.
 */
export declare function __adoptScalarBindings<Props>(root: Element, descriptor: CompiledBindings<Props>, source: BindingSource<Props>, options?: BindingOptions): BindingHandle;
