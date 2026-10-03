import { type __adoptBindings, type __adoptScalarBindings, __createBindingStyleRestoration, type BindingHandle, type BindingOperation, type BindingOptions, type BindingSource, type BindingValue, type CompiledBindings } from './dom-bindings.js';
import { type BindingKey } from './dom-binding-protocol.js';
import { type BindingHandoff } from './dom-binding-handoff.js';
import type { createBindingClassGroup, BindingClassGroup } from './dom-binding-classes.js';
import type { __createBindingSignals, BindingSignalConnection } from './dom-binding-signals.js';
import type { __createBindingStyles } from './dom-binding-styles.js';
import type { __createBindingProjections, BindingProjectionConnection, BindingProjectionGroup } from './dom-binding-projections.js';
import type { __createBindingControls, BindingControlLease, BindingControlPrepared } from './dom-binding-controls.js';
import type { BindingControlPreview } from './signals/control-binding.js';
import { type NativeTransitionNotify, type NativeTransitionPresentation } from './signals/read-protocol.js';
export { __methodDep } from './method-dep.js';
/** @internal A compiler-proven logical preorder. Regions consume one paired range. */
export type BindingProgramNode = readonly [
    parent: number,
    kind: 'element',
    tag: string,
    namespace: 0 | 1,
    children: number | null,
    nativeControlContent?: 'value'
] | readonly [parent: number, kind: 'text', text: string] | readonly [parent: number, kind: 'region', site: string];
export interface BindingRange {
    readonly start: Comment;
    readonly end: Comment;
}
export interface BindingMountTarget {
    readonly parent: Node;
    readonly before?: Node | null;
}
export interface BindingActivationContext {
    readonly signal: AbortSignal;
    getEnvironment(): readonly unknown[];
}
export type BindingAdapter = {
    readonly node: number;
    readonly kind: 'event';
    readonly name: string;
    readonly capture?: true;
    read(environment: readonly unknown[]): unknown;
} | {
    readonly node: number;
    readonly kind: 'ref';
    readonly stable?: true;
    dependencies?(environment: readonly unknown[]): readonly unknown[];
    read(environment: readonly unknown[]): unknown;
};
type BindingActivationCleanup = (() => void) & {
    prepare?(environment: readonly unknown[]): () => void;
};
/** @internal Native adapters are installed once for an authored fragment lifetime. */
export declare function __activateBindingAdapters(nodes: readonly Node[], context: BindingActivationContext, definitions: readonly BindingAdapter[]): BindingActivationCleanup;
export type BindingInitializer = BindingOperation | readonly [
    node: number,
    kind: 'value' | 'checked' | 'defaultValue' | 'defaultChecked' | 'selected' | 'classGroupInitial',
    name: string
];
/** @internal Generated expressions take the lexical environment, never a renderer scope. */
export interface BindingFragment {
    readonly createHandoff?: typeof __createStructuralBindingHandoff;
    /** Compiler proof that the authored scoped view has a fixed native hydration boundary. */
    readonly handoff?: boolean | 'structural';
    readonly closedProps?: readonly string[];
    readonly conditionalRest?: true;
    readonly restSites?: readonly {
        readonly site: number;
        readonly node: number;
        readonly spread: number;
        readonly keys: readonly string[];
    }[];
    readonly html: string;
    readonly ns?: 0 | 1;
    readonly nodes: readonly BindingProgramNode[];
    readonly bindings: readonly BindingOperation[];
    readonly createClassGroup?: typeof createBindingClassGroup;
    readonly signalIndices?: readonly number[];
    readonly styleIndices?: readonly number[];
    readonly projectionGroups?: readonly BindingProjectionGroup[];
    project(environment: readonly unknown[]): readonly unknown[];
    readonly regions: readonly BindingRegion[];
    readonly constructible?: false;
    readonly constructionError?: string;
    readonly initializers?: readonly BindingInitializer[];
    initialize?(environment: readonly unknown[]): readonly unknown[];
    activate?(nodes: readonly Node[], context: BindingActivationContext): void | BindingActivationCleanup;
}
declare const bindingSlot: unique symbol;
/** @internal Only the compiler supplies a hoisted fragment and its lexical values. */
export interface BindingSlot {
    readonly [bindingSlot]: true;
    readonly id: string;
    readonly fragment: BindingFragment;
    readonly environment: readonly unknown[];
    readonly site?: number;
}
/** @internal A child presentation slot is data, never an application render callback. */
export declare function __bindingSlot(id: string, fragment: BindingFragment, environment: readonly unknown[], site?: number): BindingSlot;
export type BindingRegion = {
    readonly node: number;
} & ({
    readonly kind: 'if';
    select(environment: readonly unknown[]): number;
    readonly arms: readonly BindingFragment[];
    readonly armRange?: true;
} | {
    readonly kind: 'for';
    items(environment: readonly unknown[]): Iterable<unknown>;
    key(item: unknown, index: number, environment: readonly unknown[]): BindingKey;
    readonly item: BindingFragment;
    readonly empty?: BindingFragment;
} | {
    readonly kind: 'view';
    readonly view: Pick<CompiledBindingProgram<unknown>, 'id' | 'root' | 'prepareProps'>;
    props(environment: readonly unknown[]): unknown;
} | {
    readonly kind: 'slot';
    read(environment: readonly unknown[]): unknown;
} | {
    readonly kind: 'text';
    readonly signal?: true;
    readonly generic?: true;
    read(environment: readonly unknown[]): unknown;
} | {
    readonly kind: 'opaque';
});
/** @internal Imported only by query artifacts which contain structural presentation. */
export interface CompiledBindingProgram<Props> {
    readonly id: string;
    readonly root: BindingFragment;
    prepareProps?(props: Props): readonly unknown[];
    readonly scalar?: CompiledBindings<Props>;
    readonly adoptScalar?: typeof __adoptBindings | typeof __adoptScalarBindings;
    readonly connectSignal?: typeof __createBindingSignals;
    readonly connectStyle?: typeof __createBindingStyles;
    readonly connectProjection?: typeof __createBindingProjections;
    readonly createControls?: typeof __createBindingControls;
    readonly list?: BindingListCapability;
    readonly hostOperations?: BindingProgramHostOperations;
    readonly initialOperations?: BindingProgramInitializers;
    readonly adopt: typeof __adoptLeanBindingProgram<Props> & {
        readonly list?: BindingListCapability;
        readonly hostOperations?: BindingProgramHostOperations;
    };
    readonly mount: typeof __mountBindingProgram<Props>;
}
interface RegionInstance {
    definition: BindingRegion;
    range: BindingRange;
    site: string;
    arm: number;
    child: FragmentInstance | null;
    items: Map<string, FragmentInstance> | null;
    text: Text | null;
    signal?: BindingSignalConnection;
    signalPlan?: RegionPlan;
    signalFrame?: number;
    unresolvedSlot?: boolean;
    slot?: string;
}
interface FragmentInstance {
    id: string;
    definition: BindingFragment;
    range: BindingRange;
    nodes: Node[];
    regions: RegionInstance[];
    owned: Array<readonly [Element, string]>;
    previous: Array<BindingValue | undefined>;
    groups: Map<number, BindingClassGroup>;
    styles?: Map<number, ReturnType<typeof __createBindingStyleRestoration>>;
    signals?: Map<number, BindingSignalConnection>;
    projections?: Map<number, BindingProjectionConnection>;
    controls?: Map<number, BindingControlLease>;
    signalPlan?: FragmentPlan;
    signalFrame?: number;
    environment: readonly unknown[];
    fresh: boolean;
    disposed: boolean;
    activated: boolean;
    controller?: AbortController;
    cleanup?: BindingActivationCleanup;
    updateAdapters?: () => void;
}
interface FragmentPlan {
    instance: FragmentInstance;
    environment: readonly unknown[];
    values: BindingValue[];
    initial: Array<string | boolean | readonly string[] | null> | null;
    regions: RegionPlan[];
    groups: Map<number, {
        commit(): void;
    }>;
    controls?: Map<number, BindingControlPrepared>;
    adapters?: () => void;
}
interface RegionPlan {
    instance: RegionInstance;
    arm: number;
    child: FragmentPlan | null;
    items: Map<string, FragmentPlan> | null;
    text: string | null;
    slot?: string;
}
interface Transaction {
    disposed: boolean;
    all: Set<FragmentInstance>;
    candidates: Set<FragmentInstance>;
    focused: Element | null;
    contentEditable: boolean;
    restoreStyles: boolean;
    preservePresentation?: boolean;
    signals?: ReturnType<typeof __createBindingSignals>;
    styles?: ReturnType<typeof __createBindingStyles>;
    projections?: ReturnType<typeof __createBindingProjections>;
    controls?: ReturnType<typeof __createBindingControls>;
    hostOperations?: BindingProgramHostOperations;
    initialOperations?: BindingProgramInitializers;
    list?: BindingListCapability;
    notifySignal?(prepare: () => () => void): void;
    preparing?: boolean;
    frame: number;
    published?: () => void;
    preview?: BindingPreview;
    consumer?: NativeTransitionNotify;
}
interface BindingPreview {
    receipts: NativeTransitionPresentation[];
    controls: BindingControlPreview[];
    fragments: Set<FragmentInstance>;
    signals: Map<FragmentInstance, Map<number, BindingSignalConnection>>;
    projections: Map<FragmentInstance, Map<number, BindingProjectionConnection>>;
    text: Map<RegionInstance, BindingSignalConnection>;
    disposals: Array<() => void>;
}
/** @internal Imported only by an artifact carrying the structural takeover proof. */
export declare function __createStructuralBindingHandoff(instance: FragmentInstance, transaction: Transaction, dispose: (disposal?: {
    preserveDOM?: boolean;
}, publish?: () => void) => void, ready: () => boolean): BindingHandoff;
declare function initialValues(instance: FragmentInstance, environment: readonly unknown[]): Array<string | boolean | readonly string[] | null> | null;
declare function initializeProperties(plan: FragmentPlan, afterChildren: boolean, transaction: Transaction): void;
declare function publishControls(plan: FragmentPlan, transaction: Transaction): void;
/** @internal The current compiler supplies every capability used by its program. */
export declare function __adoptLeanBindingProgram<Props>(root: Element | BindingRange, descriptor: CompiledBindingProgram<Props>, source: BindingSource<Props>, options?: BindingOptions): BindingHandle;
/** @internal Construct only compiler-proven native fragments, never application builders. */
export declare function __mountLeanBindingProgram<Props>(target: BindingMountTarget, descriptor: CompiledBindingProgram<Props>, source: BindingSource<Props>, options?: BindingOptions): BindingHandle;
/** @internal A compiler-selected capability; list-free programs never reference it. */
export declare const __bindingList: {
    adopt: typeof adoptList;
    prepare: typeof prepareList;
    commit: typeof commitList;
};
type BindingListCapability = typeof __bindingList;
/** @internal Selected only for controls, grouped projections/classes, or native initialization. */
export declare const __bindingProgramHostOperations: {
    claimControl: typeof claimProgramControl;
    project: typeof projectHostValues;
    initial: typeof initialValues;
    groups: typeof prepareHostGroups;
    initialize: typeof initializeProperties;
    publish: typeof publishControls;
    releaseControls: typeof releaseHostControls;
    releaseProjections: typeof releaseHostProjections;
};
type BindingProgramHostOperations = typeof __bindingProgramHostOperations;
/** @internal Fresh native values do not require control or projection ownership. */
export declare const __bindingProgramInitializers: {
    initial: typeof initialValues;
    initialize: typeof initializeProperties;
};
type BindingProgramInitializers = typeof __bindingProgramInitializers;
export declare const __adoptBindingProgram: (<Props>(root: Element | BindingRange, descriptor: CompiledBindingProgram<Props>, source: BindingSource<Props>, options?: BindingOptions) => BindingHandle) & {
    list: {
        adopt: typeof adoptList;
        prepare: typeof prepareList;
        commit: typeof commitList;
    };
    hostOperations: {
        claimControl: typeof claimProgramControl;
        project: typeof projectHostValues;
        initial: typeof initialValues;
        groups: typeof prepareHostGroups;
        initialize: typeof initializeProperties;
        publish: typeof publishControls;
        releaseControls: typeof releaseHostControls;
        releaseProjections: typeof releaseHostProjections;
    };
};
/** @internal Compatibility entry for artifacts emitted before capability selection. */
export declare function __mountBindingProgram<Props>(target: BindingMountTarget, descriptor: CompiledBindingProgram<Props>, source: BindingSource<Props>, options?: BindingOptions): BindingHandle;
declare function adoptList(region: RegionInstance, id: string, transaction: Transaction): void;
declare function prepareList(instance: FragmentInstance, region: RegionInstance, candidate: RegionPlan, environment: readonly unknown[], document: Document, transaction: Transaction): void;
declare function commitList(plan: RegionPlan, id: string, transaction: Transaction): void;
declare function claimProgramControl(instance: FragmentInstance, index: number, node: Element, transaction: Transaction): void;
declare function projectHostValues(values: readonly unknown[], instance: FragmentInstance, transaction: Transaction): readonly unknown[];
declare function prepareHostGroups(plan: FragmentPlan): void;
declare function releaseHostControls(instance: FragmentInstance, attempt: (callback: () => void) => void): void;
declare function releaseHostProjections(instance: FragmentInstance, transaction: Transaction, attempt: (callback: () => void) => void): void;
/** @internal Compatibility for artifacts which selected lists but not host operations. */
export declare const __adoptSelectedBindingProgram: (<Props>(root: Element | BindingRange, descriptor: CompiledBindingProgram<Props>, source: BindingSource<Props>, options?: BindingOptions) => BindingHandle) & {
    hostOperations: {
        claimControl: typeof claimProgramControl;
        project: typeof projectHostValues;
        initial: typeof initialValues;
        groups: typeof prepareHostGroups;
        initialize: typeof initializeProperties;
        publish: typeof publishControls;
        releaseControls: typeof releaseHostControls;
        releaseProjections: typeof releaseHostProjections;
    };
};
/** @internal Compatibility for artifacts which selected lists but not host operations. */
export declare function __mountSelectedBindingProgram<Props>(target: BindingMountTarget, descriptor: CompiledBindingProgram<Props>, source: BindingSource<Props>, options?: BindingOptions): BindingHandle;
