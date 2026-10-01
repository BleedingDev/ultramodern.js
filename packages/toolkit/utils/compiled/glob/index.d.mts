import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import { win32, posix } from 'node:path';
import { Stats, Dirent } from 'node:fs';

/**
 * Escape all magic characters in a glob pattern.
 *
 * If the {@link MinimatchOptions.windowsPathsNoEscape}
 * option is used, then characters are escaped by wrapping in `[]`, because
 * a magic character wrapped in a character class can only be satisfied by
 * that exact character.  In this mode, `\` is _not_ escaped, because it is
 * not interpreted as a magic character, but instead as a path separator.
 *
 * If the {@link MinimatchOptions.magicalBraces} option is used,
 * then braces (`{` and `}`) will be escaped.
 */
declare const escape: (s: string, { windowsPathsNoEscape, magicalBraces, }?: Pick<MinimatchOptions, "windowsPathsNoEscape" | "magicalBraces">) => string;

/**
 * Un-escape a string that has been escaped with {@link escape}.
 *
 * If the {@link MinimatchOptions.windowsPathsNoEscape} option is used, then
 * square-bracket escapes are removed, but not backslash escapes.
 *
 * For example, it will turn the string `'[*]'` into `*`, but it will not
 * turn `'\\*'` into `'*'`, because `\` is a path separator in
 * `windowsPathsNoEscape` mode.
 *
 * When `windowsPathsNoEscape` is not set, then both square-bracket escapes and
 * backslash escapes are removed.
 *
 * Slashes (and backslashes in `windowsPathsNoEscape` mode) cannot be escaped
 * or unescaped.
 *
 * When `magicalBraces` is not set, escapes of braces (`{` and `}`) will not be
 * unescaped.
 */
declare const unescape: (s: string, { windowsPathsNoEscape, magicalBraces, }?: Pick<MinimatchOptions, "windowsPathsNoEscape" | "magicalBraces">) => string;

type Platform = 'aix' | 'android' | 'darwin' | 'freebsd' | 'haiku' | 'linux' | 'openbsd' | 'sunos' | 'win32' | 'cygwin' | 'netbsd';
interface MinimatchOptions {
    /** do not expand `{x,y}` style braces */
    nobrace?: boolean;
    /** do not treat patterns starting with `#` as a comment */
    nocomment?: boolean;
    /** do not treat patterns starting with `!` as a negation */
    nonegate?: boolean;
    /** print LOTS of debugging output */
    debug?: boolean;
    /** treat `**` the same as `*` */
    noglobstar?: boolean;
    /** do not expand extglobs like `+(a|b)` */
    noext?: boolean;
    /** return the pattern if nothing matches */
    nonull?: boolean;
    /** treat `\\` as a path separator, not an escape character */
    windowsPathsNoEscape?: boolean;
    /**
     * inverse of {@link MinimatchOptions.windowsPathsNoEscape}
     * @deprecated
     */
    allowWindowsEscape?: boolean;
    /**
     * Compare a partial path to a pattern. As long as the parts
     * of the path that are present are not contradicted by the
     * pattern, it will be treated as a match. This is useful in
     * applications where you're walking through a folder structure,
     * and don't yet have the full path, but want to ensure that you
     * do not walk down paths that can never be a match.
     */
    partial?: boolean;
    /** allow matches that start with `.` even if the pattern does not */
    dot?: boolean;
    /** ignore case */
    nocase?: boolean;
    /** ignore case only in wildcard patterns */
    nocaseMagicOnly?: boolean;
    /** consider braces to be "magic" for the purpose of `hasMagic` */
    magicalBraces?: boolean;
    /**
     * If set, then patterns without slashes will be matched
     * against the basename of the path if it contains slashes.
     * For example, `a?b` would match the path `/xyz/123/acb`, but
     * not `/xyz/acb/123`.
     */
    matchBase?: boolean;
    /** invert the results of negated matches */
    flipNegate?: boolean;
    /** do not collapse multiple `/` into a single `/` */
    preserveMultipleSlashes?: boolean;
    /**
     * A number indicating the level of optimization that should be done
     * to the pattern prior to parsing and using it for matches.
     */
    optimizationLevel?: number;
    /** operating system platform */
    platform?: Platform;
    /**
     * When a pattern starts with a UNC path or drive letter, and in
     * `nocase:true` mode, do not convert the root portions of the
     * pattern into a case-insensitive regular expression, and instead
     * leave them as strings.
     *
     * This is the default when the platform is `win32` and
     * `nocase:true` is set.
     */
    windowsNoMagicRoot?: boolean;
    /**
     * max number of `{...}` patterns to expand. Default 100_000.
     */
    braceExpandMax?: number;
    /**
     * Max number of non-adjacent `**` patterns to recursively walk down.
     *
     * The default of 200 is almost certainly high enough for most purposes,
     * and can handle absurdly excessive patterns.
     */
    maxGlobstarRecursion?: number;
    /**
     * Max depth to traverse for nested extglobs like `*(a|b|c)`
     *
     * Default is 2, which is quite low, but any higher value
     * swiftly results in punishing performance impacts. Note
     * that this is *not*  relevant when the globstar types can
     * be safely coalesced into a single set.
     *
     * For example, `*(a|@(b|c)|d)` would be flattened into
     * `*(a|b|c|d)`. Thus, many common extglobs will retain good
     * performance and  never hit this limit, even if they are
     * excessively deep and complicated.
     *
     * If the limit is hit, then the extglob characters are simply
     * not parsed, and the pattern effectively switches into
     * `noextglob: true` mode for the contents of that nested
     * sub-pattern. This will typically _not_ result in a match,
     * but is considered a valid trade-off for security and
     * performance.
     */
    maxExtglobRecursion?: number;
}
declare const GLOBSTAR: unique symbol;
type MMRegExp = RegExp & {
    _src?: string;
    _glob?: string;
};
type ParseReturnFiltered = string | MMRegExp | typeof GLOBSTAR;
type ParseReturn = ParseReturnFiltered | false;
declare class Minimatch {
    #private;
    options: MinimatchOptions;
    set: ParseReturnFiltered[][];
    pattern: string;
    windowsPathsNoEscape: boolean;
    nonegate: boolean;
    negate: boolean;
    comment: boolean;
    empty: boolean;
    preserveMultipleSlashes: boolean;
    partial: boolean;
    globSet: string[];
    globParts: string[][];
    nocase: boolean;
    isWindows: boolean;
    platform: Platform;
    windowsNoMagicRoot: boolean;
    maxGlobstarRecursion: number;
    regexp: false | null | MMRegExp;
    constructor(pattern: string, options?: MinimatchOptions);
    hasMagic(): boolean;
    debug(..._: unknown[]): void;
    make(): void;
    preprocess(globParts: string[][]): string[][];
    adjascentGlobstarOptimize(globParts: string[][]): string[][];
    levelOneOptimize(globParts: string[][]): string[][];
    levelTwoFileOptimize(parts: string | string[]): string[];
    firstPhasePreProcess(globParts: string[][]): string[][];
    secondPhasePreProcess(globParts: string[][]): string[][];
    partsMatch(a: string[], b: string[], emptyGSMatch?: boolean): false | string[];
    parseNegate(): void;
    matchOne(file: string[], pattern: ParseReturn[], partial?: boolean): boolean;
    braceExpand(): string[];
    parse(pattern: string): ParseReturn;
    makeRe(): false | MMRegExp;
    slashSplit(p: string): string[];
    match(f: string, partial?: boolean): boolean;
    static defaults(def: MinimatchOptions): typeof Minimatch;
}

/**
 * Same as StringDecoder, but exposing the `lastNeed` flag on the type
 */
type SD = StringDecoder & {
    lastNeed: boolean;
};

declare const EOF: unique symbol;
declare const MAYBE_EMIT_END: unique symbol;
declare const EMITTED_END: unique symbol;
declare const EMITTING_END: unique symbol;
declare const EMITTED_ERROR: unique symbol;
declare const CLOSED: unique symbol;
declare const READ: unique symbol;
declare const FLUSH: unique symbol;
declare const FLUSHCHUNK: unique symbol;
declare const ENCODING: unique symbol;
declare const DECODER: unique symbol;
declare const FLOWING: unique symbol;
declare const PAUSED: unique symbol;
declare const RESUME: unique symbol;
declare const BUFFER: unique symbol;
declare const PIPES: unique symbol;
declare const BUFFERLENGTH: unique symbol;
declare const BUFFERPUSH: unique symbol;
declare const BUFFERSHIFT: unique symbol;
declare const OBJECTMODE: unique symbol;
declare const DESTROYED: unique symbol;
declare const ERROR: unique symbol;
declare const EMITDATA: unique symbol;
declare const EMITEND: unique symbol;
declare const EMITEND2: unique symbol;
declare const ASYNC: unique symbol;
declare const ABORT: unique symbol;
declare const ABORTED: unique symbol;
declare const SIGNAL: unique symbol;
declare const DATALISTENERS: unique symbol;
declare const DISCARDED: unique symbol;
/**
 * Options that may be passed to stream.pipe()
 */
interface PipeOptions {
    /**
     * end the destination stream when the source stream ends
     */
    end?: boolean;
    /**
     * proxy errors from the source stream to the destination stream
     */
    proxyErrors?: boolean;
}
/**
 * Internal class representing a pipe to a destination stream.
 *
 * @internal
 */
declare class Pipe<T extends unknown> {
    src: Minipass<T>;
    dest: Minipass<any, T>;
    opts: PipeOptions;
    ondrain: () => any;
    constructor(src: Minipass<T>, dest: Minipass.Writable, opts: PipeOptions);
    unpipe(): void;
    proxyErrors(_er: any): void;
    end(): void;
}
declare namespace Minipass {
    /**
     * Encoding used to create a stream that outputs strings rather than
     * Buffer objects.
     */
    export type Encoding = BufferEncoding | 'buffer' | null;
    /**
     * Any stream that Minipass can pipe into
     */
    export type Writable = Minipass<any, any, any> | NodeJS.WriteStream | (NodeJS.WriteStream & {
        fd: number;
    }) | (EventEmitter & {
        end(): any;
        write(chunk: any, ...args: any[]): any;
    });
    /**
     * Any stream that can be read from
     */
    export type Readable = Minipass<any, any, any> | NodeJS.ReadStream | (NodeJS.ReadStream & {
        fd: number;
    }) | (EventEmitter & {
        pause(): any;
        resume(): any;
        pipe(...destArgs: any[]): any;
    });
    /**
     * Utility type that can be iterated sync or async
     */
    export type DualIterable<T> = Iterable<T> & AsyncIterable<T>;
    type EventArguments = Record<string | symbol, unknown[]>;
    /**
     * The listing of events that a Minipass class can emit.
     * Extend this when extending the Minipass class, and pass as
     * the third template argument.  The key is the name of the event,
     * and the value is the argument list.
     *
     * Any undeclared events will still be allowed, but the handler will get
     * arguments as `unknown[]`.
     */
    export interface Events<RType extends any = Buffer> extends EventArguments {
        readable: [];
        data: [chunk: RType];
        error: [er: unknown];
        abort: [reason: unknown];
        drain: [];
        resume: [];
        end: [];
        finish: [];
        prefinish: [];
        close: [];
        [DESTROYED]: [er?: unknown];
        [ERROR]: [er: unknown];
    }
    /**
     * String or buffer-like data that can be joined and sliced
     */
    export type ContiguousData = Buffer | ArrayBufferLike | ArrayBufferView | string;
    export type BufferOrString = Buffer | string;
    /**
     * Options passed to the Minipass constructor.
     */
    export type SharedOptions = {
        /**
         * Defer all data emission and other events until the end of the
         * current tick, similar to Node core streams
         */
        async?: boolean;
        /**
         * A signal which will abort the stream
         */
        signal?: AbortSignal;
        /**
         * Output string encoding. Set to `null` or `'buffer'` (or omit) to
         * emit Buffer objects rather than strings.
         *
         * Conflicts with `objectMode`
         */
        encoding?: BufferEncoding | null | 'buffer';
        /**
         * Output data exactly as it was written, supporting non-buffer/string
         * data (such as arbitrary objects, falsey values, etc.)
         *
         * Conflicts with `encoding`
         */
        objectMode?: boolean;
    };
    /**
     * Options for a string encoded output
     */
    export type EncodingOptions = SharedOptions & {
        encoding: BufferEncoding;
        objectMode?: false;
    };
    /**
     * Options for contiguous data buffer output
     */
    export type BufferOptions = SharedOptions & {
        encoding?: null | 'buffer';
        objectMode?: false;
    };
    /**
     * Options for objectMode arbitrary output
     */
    export type ObjectModeOptions = SharedOptions & {
        objectMode: true;
        encoding?: null;
    };
    /**
     * Utility type to determine allowed options based on read type
     */
    export type Options<T> = ObjectModeOptions | (T extends string ? EncodingOptions : T extends Buffer ? BufferOptions : SharedOptions);
    export {};
}
/**
 * Main export, the Minipass class
 *
 * `RType` is the type of data emitted, defaults to Buffer
 *
 * `WType` is the type of data to be written, if RType is buffer or string,
 * then any {@link Minipass.ContiguousData} is allowed.
 *
 * `Events` is the set of event handler signatures that this object
 * will emit, see {@link Minipass.Events}
 */
declare class Minipass<RType extends unknown = Buffer, WType extends unknown = RType extends Minipass.BufferOrString ? Minipass.ContiguousData : RType, Events extends Minipass.Events<RType> = Minipass.Events<RType>> extends EventEmitter implements Minipass.DualIterable<RType> {
    [FLOWING]: boolean;
    [PAUSED]: boolean;
    [PIPES]: Pipe<RType>[];
    [BUFFER]: RType[];
    [OBJECTMODE]: boolean;
    [ENCODING]: BufferEncoding | null;
    [ASYNC]: boolean;
    [DECODER]: SD | null;
    [EOF]: boolean;
    [EMITTED_END]: boolean;
    [EMITTING_END]: boolean;
    [CLOSED]: boolean;
    [EMITTED_ERROR]: unknown;
    [BUFFERLENGTH]: number;
    [DESTROYED]: boolean;
    [SIGNAL]?: AbortSignal;
    [ABORTED]: boolean;
    [DATALISTENERS]: number;
    [DISCARDED]: boolean;
    /**
     * true if the stream can be written
     */
    writable: boolean;
    /**
     * true if the stream can be read
     */
    readable: boolean;
    /**
     * If `RType` is Buffer, then options do not need to be provided.
     * Otherwise, an options object must be provided to specify either
     * {@link Minipass.SharedOptions.objectMode} or
     * {@link Minipass.SharedOptions.encoding}, as appropriate.
     */
    constructor(...args: [Minipass.ObjectModeOptions] | (RType extends Buffer ? [] | [Minipass.Options<RType>] : [Minipass.Options<RType>]));
    /**
     * The amount of data stored in the buffer waiting to be read.
     *
     * For Buffer strings, this will be the total byte length.
     * For string encoding streams, this will be the string character length,
     * according to JavaScript's `string.length` logic.
     * For objectMode streams, this is a count of the items waiting to be
     * emitted.
     */
    get bufferLength(): number;
    /**
     * The `BufferEncoding` currently in use, or `null`
     */
    get encoding(): BufferEncoding | null;
    /**
     * @deprecated - This is a read only property
     */
    set encoding(_enc: BufferEncoding | null);
    /**
     * @deprecated - Encoding may only be set at instantiation time
     */
    setEncoding(_enc: Minipass.Encoding): void;
    /**
     * True if this is an objectMode stream
     */
    get objectMode(): boolean;
    /**
     * @deprecated - This is a read-only property
     */
    set objectMode(_om: boolean);
    /**
     * true if this is an async stream
     */
    get ['async'](): boolean;
    /**
     * Set to true to make this stream async.
     *
     * Once set, it cannot be unset, as this would potentially cause incorrect
     * behavior.  Ie, a sync stream can be made async, but an async stream
     * cannot be safely made sync.
     */
    set ['async'](a: boolean);
    [ABORT](): void;
    /**
     * True if the stream has been aborted.
     */
    get aborted(): boolean;
    /**
     * No-op setter. Stream aborted status is set via the AbortSignal provided
     * in the constructor options.
     */
    set aborted(_: boolean);
    /**
     * Write data into the stream
     *
     * If the chunk written is a string, and encoding is not specified, then
     * `utf8` will be assumed. If the stream encoding matches the encoding of
     * a written string, and the state of the string decoder allows it, then
     * the string will be passed through to either the output or the internal
     * buffer without any processing. Otherwise, it will be turned into a
     * Buffer object for processing into the desired encoding.
     *
     * If provided, `cb` function is called immediately before return for
     * sync streams, or on next tick for async streams, because for this
     * base class, a chunk is considered "processed" once it is accepted
     * and either emitted or buffered. That is, the callback does not indicate
     * that the chunk has been eventually emitted, though of course child
     * classes can override this function to do whatever processing is required
     * and call `super.write(...)` only once processing is completed.
     */
    write(chunk: WType, cb?: () => void): boolean;
    write(chunk: WType, encoding?: Minipass.Encoding, cb?: () => void): boolean;
    /**
     * Low-level explicit read method.
     *
     * In objectMode, the argument is ignored, and one item is returned if
     * available.
     *
     * `n` is the number of bytes (or in the case of encoding streams,
     * characters) to consume. If `n` is not provided, then the entire buffer
     * is returned, or `null` is returned if no data is available.
     *
     * If `n` is greater that the amount of data in the internal buffer,
     * then `null` is returned.
     */
    read(n?: number | null): RType | null;
    [READ](n: number | null, chunk: RType): RType;
    /**
     * End the stream, optionally providing a final write.
     *
     * See {@link Minipass#write} for argument descriptions
     */
    end(cb?: () => void): this;
    end(chunk: WType, cb?: () => void): this;
    end(chunk: WType, encoding?: Minipass.Encoding, cb?: () => void): this;
    [RESUME](): void;
    /**
     * Resume the stream if it is currently in a paused state
     *
     * If called when there are no pipe destinations or `data` event listeners,
     * this will place the stream in a "discarded" state, where all data will
     * be thrown away. The discarded state is removed if a pipe destination or
     * data handler is added, if pause() is called, or if any synchronous or
     * asynchronous iteration is started.
     */
    resume(): void;
    /**
     * Pause the stream
     */
    pause(): void;
    /**
     * true if the stream has been forcibly destroyed
     */
    get destroyed(): boolean;
    /**
     * true if the stream is currently in a flowing state, meaning that
     * any writes will be immediately emitted.
     */
    get flowing(): boolean;
    /**
     * true if the stream is currently in a paused state
     */
    get paused(): boolean;
    [BUFFERPUSH](chunk: RType): void;
    [BUFFERSHIFT](): RType;
    [FLUSH](noDrain?: boolean): void;
    [FLUSHCHUNK](chunk: RType): boolean;
    /**
     * Pipe all data emitted by this stream into the destination provided.
     *
     * Triggers the flow of data.
     */
    pipe<W extends Minipass.Writable>(dest: W, opts?: PipeOptions): W;
    /**
     * Fully unhook a piped destination stream.
     *
     * If the destination stream was the only consumer of this stream (ie,
     * there are no other piped destinations or `'data'` event listeners)
     * then the flow of data will stop until there is another consumer or
     * {@link Minipass#resume} is explicitly called.
     */
    unpipe<W extends Minipass.Writable>(dest: W): void;
    /**
     * Alias for {@link Minipass#on}
     */
    addListener<Event extends keyof Events>(ev: Event, handler: (...args: Events[Event]) => any): this;
    /**
     * Mostly identical to `EventEmitter.on`, with the following
     * behavior differences to prevent data loss and unnecessary hangs:
     *
     * - Adding a 'data' event handler will trigger the flow of data
     *
     * - Adding a 'readable' event handler when there is data waiting to be read
     *   will cause 'readable' to be emitted immediately.
     *
     * - Adding an 'endish' event handler ('end', 'finish', etc.) which has
     *   already passed will cause the event to be emitted immediately and all
     *   handlers removed.
     *
     * - Adding an 'error' event handler after an error has been emitted will
     *   cause the event to be re-emitted immediately with the error previously
     *   raised.
     */
    on<Event extends keyof Events>(ev: Event, handler: (...args: Events[Event]) => any): this;
    /**
     * Alias for {@link Minipass#off}
     */
    removeListener<Event extends keyof Events>(ev: Event, handler: (...args: Events[Event]) => any): this;
    /**
     * Mostly identical to `EventEmitter.off`
     *
     * If a 'data' event handler is removed, and it was the last consumer
     * (ie, there are no pipe destinations or other 'data' event listeners),
     * then the flow of data will stop until there is another consumer or
     * {@link Minipass#resume} is explicitly called.
     */
    off<Event extends keyof Events>(ev: Event, handler: (...args: Events[Event]) => any): this;
    /**
     * Mostly identical to `EventEmitter.removeAllListeners`
     *
     * If all 'data' event handlers are removed, and they were the last consumer
     * (ie, there are no pipe destinations), then the flow of data will stop
     * until there is another consumer or {@link Minipass#resume} is explicitly
     * called.
     */
    removeAllListeners<Event extends keyof Events>(ev?: Event): this;
    /**
     * true if the 'end' event has been emitted
     */
    get emittedEnd(): boolean;
    [MAYBE_EMIT_END](): void;
    /**
     * Mostly identical to `EventEmitter.emit`, with the following
     * behavior differences to prevent data loss and unnecessary hangs:
     *
     * If the stream has been destroyed, and the event is something other
     * than 'close' or 'error', then `false` is returned and no handlers
     * are called.
     *
     * If the event is 'end', and has already been emitted, then the event
     * is ignored. If the stream is in a paused or non-flowing state, then
     * the event will be deferred until data flow resumes. If the stream is
     * async, then handlers will be called on the next tick rather than
     * immediately.
     *
     * If the event is 'close', and 'end' has not yet been emitted, then
     * the event will be deferred until after 'end' is emitted.
     *
     * If the event is 'error', and an AbortSignal was provided for the stream,
     * and there are no listeners, then the event is ignored, matching the
     * behavior of node core streams in the presense of an AbortSignal.
     *
     * If the event is 'finish' or 'prefinish', then all listeners will be
     * removed after emitting the event, to prevent double-firing.
     */
    emit<Event extends keyof Events>(ev: Event, ...args: Events[Event]): boolean;
    [EMITDATA](data: RType): boolean;
    [EMITEND](): boolean;
    [EMITEND2](): boolean;
    /**
     * Return a Promise that resolves to an array of all emitted data once
     * the stream ends.
     */
    collect(): Promise<RType[] & {
        dataLength: number;
    }>;
    /**
     * Return a Promise that resolves to the concatenation of all emitted data
     * once the stream ends.
     *
     * Not allowed on objectMode streams.
     */
    concat(): Promise<RType>;
    /**
     * Return a void Promise that resolves once the stream ends.
     */
    promise(): Promise<void>;
    /**
     * Asynchronous `for await of` iteration.
     *
     * This will continue emitting all chunks until the stream terminates.
     */
    [Symbol.asyncIterator](): AsyncGenerator<RType, void, void>;
    /**
     * Synchronous `for of` iteration.
     *
     * The iteration will terminate when the internal buffer runs out, even
     * if the stream has not yet terminated.
     */
    [Symbol.iterator](): Generator<RType, void, void>;
    /**
     * Destroy a stream, preventing it from being used for any further purpose.
     *
     * If the stream has a `close()` method, then it will be called on
     * destruction.
     *
     * After destruction, any attempt to write data, read data, or emit most
     * events will be ignored.
     *
     * If an error argument is provided, then it will be emitted in an
     * 'error' event.
     */
    destroy(er?: unknown): this;
    /**
     * Alias for {@link isStream}
     *
     * Former export location, maintained for backwards compatibility.
     *
     * @deprecated
     */
    static get isStream(): (s: any) => s is Minipass<any, any, any> | NodeJS.ReadStream | NodeJS.WriteStream | (EventEmitter<any> & {
        end(): any;
        write(chunk: any, ...args: any[]): any;
    }) | (EventEmitter<any> & {
        pause(): any;
        resume(): any;
        pipe(...destArgs: any[]): any;
    }) | (NodeJS.ReadStream & {
        fd: number;
    }) | (NodeJS.WriteStream & {
        fd: number;
    });
}

/**
 * this provides the default Perf object source, either the
 * `performance` global, or the `Date` constructor.
 *
 * it can be passed in via configuration to override it
 * for a single LRU object.
 */
type Perf = {
    now: () => number;
};

/**
 * @module LRUCache
 */

declare const TYPE: unique symbol;
type Index = number & {
    [TYPE]: 'LRUCache Index';
};
type UintArray = Uint8Array | Uint16Array | Uint32Array;
type NumberArray = UintArray | number[];
declare class ZeroArray extends Array<number> {
    constructor(size: number);
}

type StackLike = Stack | Index[];
declare class Stack {
    #private;
    heap: NumberArray;
    length: number;
    static create(max: number): StackLike;
    constructor(max: number, HeapCls: {
        new (n: number): NumberArray;
    });
    push(n: Index): void;
    pop(): Index;
}
/**
 * Promise representing an in-progress {@link LRUCache#fetch} call
 */
type BackgroundFetch<V> = Promise<V | undefined> & {
    __returned: BackgroundFetch<V> | undefined;
    __abortController: AbortController;
    __staleWhileFetching: V | undefined;
};
declare namespace LRUCache {
    /**
     * An integer greater than 0, reflecting the calculated size of items
     */
    type Size = number;
    /**
     * Integer greater than 0, representing some number of milliseconds, or the
     * time at which a TTL started counting from.
     */
    type Milliseconds = number;
    /**
     * An integer greater than 0, reflecting a number of items
     */
    type Count = number;
    /**
     * The reason why an item was removed from the cache, passed
     * to the {@link Disposer} methods.
     *
     * - `evict`: The item was evicted because it is the least recently used,
     *   and the cache is full.
     * - `set`: A new value was set, overwriting the old value being disposed.
     * - `delete`: The item was explicitly deleted, either by calling
     *   {@link LRUCache#delete}, {@link LRUCache#clear}, or
     *   {@link LRUCache#set} with an undefined value.
     * - `expire`: The item was removed due to exceeding its TTL.
     * - `fetch`: A {@link OptionsBase#fetchMethod} operation returned
     *   `undefined` or was aborted, causing the item to be deleted.
     */
    type DisposeReason = 'evict' | 'set' | 'delete' | 'expire' | 'fetch';
    /**
     * A method called upon item removal, passed as the
     * {@link OptionsBase.dispose} and/or
     * {@link OptionsBase.disposeAfter} options.
     */
    type Disposer<K, V> = (value: V, key: K, reason: DisposeReason) => void;
    /**
     * The reason why an item was added to the cache, passed
     * to the {@link Inserter} methods.
     *
     * - `add`: the item was not found in the cache, and was added
     * - `update`: the item was in the cache, with the same value provided
     * - `replace`: the item was in the cache, and replaced
     */
    type InsertReason = 'add' | 'update' | 'replace';
    /**
     * A method called upon item insertion, passed as the
     * {@link OptionsBase.insert}
     */
    type Inserter<K, V> = (value: V, key: K, reason: InsertReason) => void;
    /**
     * A function that returns the effective calculated size
     * of an entry in the cache.
     */
    type SizeCalculator<K, V> = (value: V, key: K) => Size;
    /**
     * Options provided to the
     * {@link OptionsBase.fetchMethod} function.
     */
    interface FetcherOptions<K, V, FC = unknown> {
        signal: AbortSignal;
        options: FetcherFetchOptions<K, V, FC>;
        /**
         * Object provided in the {@link FetchOptions.context} option to
         * {@link LRUCache#fetch}
         */
        context: FC;
    }
    /**
     * Occasionally, it may be useful to track the internal behavior of the
     * cache, particularly for logging, debugging, or for behavior within the
     * `fetchMethod`. To do this, you can pass a `status` object to the
     * {@link LRUCache#fetch}, {@link LRUCache#get}, {@link LRUCache#set},
     * {@link LRUCache#memo}, and {@link LRUCache#has} methods.
     *
     * The `status` option should be a plain JavaScript object. The following
     * fields will be set on it appropriately, depending on the situation.
     *
     * These objects are also the context objects passed to listeners on the
     * `lru-cache:metrics` diagnostic channel, and the `lru-cache` tracing
     * channels, in platforms that support them.
     */
    interface Status<K, V, FC = unknown> {
        /**
         * The operation being performed
         */
        op?: 'get' | 'set' | 'memo' | 'fetch' | 'delete' | 'has' | 'peek';
        /**
         * The status of a set() operation.
         *
         * - add: the item was not found in the cache, and was added
         * - update: the item was in the cache, with the same value provided
         * - replace: the item was in the cache, and replaced
         * - miss: the item was not added to the cache for some reason
         */
        set?: 'add' | 'update' | 'replace' | 'miss' | 'deleted';
        /**
         * The status of a delete() operation.
         */
        delete?: LRUCache.DisposeReason;
        /**
         * The result of a peek() operation
         *
         * - hit: the item was found and returned
         * - stale: the item is in the cache, but past its ttl and not returned
         * - miss: item not in the cache
         */
        peek?: 'hit' | 'miss' | 'stale';
        /**
         * The status of a memo() operation.
         *
         * - 'hit': the item was found in the cache and returned
         * - 'miss': the `memoMethod` function was called
         */
        memo?: 'hit' | 'miss';
        /**
         * The `context` option provided to a memo or fetch operation
         *
         * In practice, of course, this will be the same type as the `FC`
         * fetch context param used to instantiate the LRUCache, but the
         * convolutions of threading that through would get quite complicated,
         * and preclude forcing/forbidding the passing of a `context` param
         * where it is/isn't expected, which is more valuable for error
         * prevention.
         */
        context?: unknown;
        /**
         * the ttl stored for the item, or undefined if ttls are not used.
         */
        ttl?: Milliseconds;
        /**
         * the start time for the item, or undefined if ttls are not used.
         */
        start?: Milliseconds;
        /**
         * The timestamp used for TTL calculation
         */
        now?: Milliseconds;
        /**
         * the remaining ttl for the item, or undefined if ttls are not used.
         */
        remainingTTL?: Milliseconds;
        /**
         * The calculated size for the item, if sizes are used.
         */
        entrySize?: Size;
        /**
         * The total calculated size of the cache, if sizes are used.
         */
        totalCalculatedSize?: Size;
        /**
         * A flag indicating that the item was not stored, due to exceeding the
         * {@link OptionsBase.maxEntrySize}
         */
        maxEntrySizeExceeded?: true;
        /**
         * The key that was set or retrieved
         */
        key?: K;
        /**
         * The value that was set
         */
        value?: V;
        /**
         * The old value, specified in the case of `set:'replace'`
         */
        oldValue?: V;
        /**
         * The results of a {@link LRUCache#has} operation
         *
         * - hit: the item was found in the cache
         * - stale: the item was found in the cache, but is stale
         * - miss: the item was not found in the cache
         */
        has?: 'hit' | 'stale' | 'miss';
        /**
         * The status of a {@link LRUCache#fetch} operation.
         * Note that this can change as the underlying fetch() moves through
         * various states.
         *
         * - inflight: there is another fetch() for this key which is in process
         * - get: there is no {@link OptionsBase.fetchMethod}, so
         *   {@link LRUCache#get} was called.
         * - miss: the item is not in cache, and will be fetched.
         * - hit: the item is in the cache, and was resolved immediately.
         * - stale: the item is in the cache, but stale.
         * - refresh: the item is in the cache, and not stale, but
         *   {@link FetchOptions.forceRefresh} was specified.
         */
        fetch?: 'get' | 'inflight' | 'miss' | 'hit' | 'stale' | 'refresh';
        /**
         * `forceRefresh` option was used for either a fetch or memo operation
         */
        forceRefresh?: boolean;
        /**
         * The {@link OptionsBase.fetchMethod} was called
         */
        fetchDispatched?: true;
        /**
         * The cached value was updated after a successful call to
         * {@link OptionsBase.fetchMethod}
         */
        fetchUpdated?: true;
        /**
         * The reason for a fetch() rejection.  Either the error raised by the
         * {@link OptionsBase.fetchMethod}, or the reason for an
         * AbortSignal.
         */
        fetchError?: Error;
        /**
         * The fetch received an abort signal
         */
        fetchAborted?: true;
        /**
         * The abort signal received was ignored, and the fetch was allowed to
         * continue in the background.
         */
        fetchAbortIgnored?: true;
        /**
         * The fetchMethod promise resolved successfully
         */
        fetchResolved?: true;
        /**
         * The fetchMethod promise was rejected
         */
        fetchRejected?: true;
        /**
         * The status of a {@link LRUCache#get} operation.
         *
         * - fetching: The item is currently being fetched.  If a previous value
         *   is present and allowed, that will be returned.
         * - stale: The item is in the cache, and is stale. If it was returned,
         *   then the `returnedStale` flag will be set.
         * - stale-fetching: The value is being fetched in the background, but is
         *   currently stale. If the stale value was returned, then the
         *   `returnedStale` flag will be set.
         * - hit: the item is in the cache
         * - miss: the item is not in the cache
         */
        get?: 'stale' | 'hit' | 'miss' | 'fetching' | 'stale-fetching';
        /**
         * A fetch or get operation returned a stale value.
         */
        returnedStale?: true;
        /**
         * A tracingChannel trace was started for this operation
         */
        trace?: boolean;
        /**
         * A reference to the cache instance associated with this operation
         */
        cache?: LRUCache<K & {}, V & {}, FC>;
    }
    /**
     * options which override the options set in the LRUCache constructor
     * when calling {@link LRUCache#fetch}.
     *
     * This is the union of {@link GetOptions} and {@link SetOptions}, plus
     * {@link OptionsBase.noDeleteOnFetchRejection},
     * {@link OptionsBase.allowStaleOnFetchRejection},
     * {@link FetchOptions.forceRefresh}, and
     * {@link FetcherOptions.context}
     *
     * Any of these may be modified in the {@link OptionsBase.fetchMethod}
     * function, but the {@link GetOptions} fields will of course have no
     * effect, as the {@link LRUCache#get} call already happened by the time
     * the fetchMethod is called.
     */
    interface FetcherFetchOptions<K, V, FC = unknown> extends Pick<OptionsBase<K, V, FC>, 'allowStale' | 'updateAgeOnGet' | 'noDeleteOnStaleGet' | 'sizeCalculation' | 'ttl' | 'noDisposeOnSet' | 'noUpdateTTL' | 'noDeleteOnFetchRejection' | 'allowStaleOnFetchRejection' | 'ignoreFetchAbort' | 'allowStaleOnFetchAbort'> {
        status?: Status<K, V, FC>;
        size?: Size;
    }
    /**
     * Options that may be passed to the {@link LRUCache#fetch} method.
     */
    interface FetchOptions<K, V, FC> extends FetcherFetchOptions<K, V, FC> {
        /**
         * Set to true to force a re-load of the existing data, even if it
         * is not yet stale.
         */
        forceRefresh?: boolean;
        /**
         * Context provided to the {@link OptionsBase.fetchMethod} as
         * the {@link FetcherOptions.context} param.
         *
         * If the FC type is specified as unknown (the default),
         * undefined or void, then this is optional.  Otherwise, it will
         * be required.
         */
        context?: FC;
        signal?: AbortSignal;
        status?: Status<K, V, FC>;
    }
    /**
     * Options provided to {@link LRUCache#fetch} when the FC type is something
     * other than `unknown`, `undefined`, or `void`
     */
    interface FetchOptionsWithContext<K, V, FC> extends FetchOptions<K, V, FC> {
        context: FC;
    }
    /**
     * Options provided to {@link LRUCache#fetch} when the FC type is
     * `undefined` or `void`
     */
    interface FetchOptionsNoContext<K, V, FC extends undefined | void = undefined> extends FetchOptions<K, V, FC> {
        context?: FC;
    }
    interface MemoOptions<K, V, FC = unknown> extends Pick<OptionsBase<K, V, FC>, 'allowStale' | 'updateAgeOnGet' | 'noDeleteOnStaleGet' | 'sizeCalculation' | 'ttl' | 'noDisposeOnSet' | 'noUpdateTTL' | 'noDeleteOnFetchRejection' | 'allowStaleOnFetchRejection' | 'ignoreFetchAbort' | 'allowStaleOnFetchAbort'> {
        /**
         * Set to true to force a re-load of the existing data, even if it
         * is not yet stale.
         */
        forceRefresh?: boolean;
        /**
         * Context provided to the {@link OptionsBase.memoMethod} as
         * the {@link MemoizerOptions.context} param.
         *
         * If the FC type is specified as unknown (the default),
         * undefined or void, then this is optional.  Otherwise, it will
         * be required.
         */
        context?: FC;
        status?: Status<K, V, FC>;
    }
    /**
     * Options provided to {@link LRUCache#memo} when the FC type is something
     * other than `unknown`, `undefined`, or `void`
     */
    interface MemoOptionsWithContext<K, V, FC> extends MemoOptions<K, V, FC> {
        context: FC;
    }
    /**
     * Options provided to {@link LRUCache#memo} when the FC type is
     * `undefined` or `void`
     */
    interface MemoOptionsNoContext<K, V, FC extends undefined | void = undefined> extends MemoOptions<K, V, FC> {
        context?: FC;
    }
    /**
     * Options provided to the
     * {@link OptionsBase.memoMethod} function.
     */
    interface MemoizerOptions<K, V, FC = unknown> {
        options: MemoizerMemoOptions<K, V, FC>;
        /**
         * Object provided in the {@link MemoOptions.context} option to
         * {@link LRUCache#memo}
         */
        context: FC;
    }
    /**
     * options which override the options set in the LRUCache constructor
     * when calling {@link LRUCache#memo}.
     *
     * This is the union of {@link GetOptions} and {@link SetOptions}, plus
     * {@link MemoOptions.forceRefresh}, and
     * {@link MemoOptions.context}
     *
     * Any of these may be modified in the {@link OptionsBase.memoMethod}
     * function, but the {@link GetOptions} fields will of course have no
     * effect, as the {@link LRUCache#get} call already happened by the time
     * the memoMethod is called.
     */
    interface MemoizerMemoOptions<K, V, FC = unknown> extends Pick<OptionsBase<K, V, FC>, 'allowStale' | 'updateAgeOnGet' | 'noDeleteOnStaleGet' | 'sizeCalculation' | 'ttl' | 'noDisposeOnSet' | 'noUpdateTTL'> {
        status?: Status<K, V, FC>;
        size?: Size;
        start?: Milliseconds;
    }
    /**
     * Options that may be passed to the {@link LRUCache#has} method.
     */
    interface HasOptions<K, V, FC> extends Pick<OptionsBase<K, V, FC>, 'updateAgeOnHas'> {
        status?: Status<K, V, FC>;
    }
    /**
     * Options that may be passed to the {@link LRUCache#get} method.
     */
    interface GetOptions<K, V, FC> extends Pick<OptionsBase<K, V, FC>, 'allowStale' | 'updateAgeOnGet' | 'noDeleteOnStaleGet'> {
        status?: Status<K, V, FC>;
    }
    /**
     * Options that may be passed to the {@link LRUCache#peek} method.
     */
    interface PeekOptions<K, V, FC> extends Pick<OptionsBase<K, V, FC>, 'allowStale'> {
        status?: Status<K, V, FC>;
    }
    /**
     * Options that may be passed to the {@link LRUCache#set} method.
     */
    interface SetOptions<K, V, FC> extends Pick<OptionsBase<K, V, FC>, 'sizeCalculation' | 'ttl' | 'noDisposeOnSet' | 'noUpdateTTL'> {
        /**
         * If size tracking is enabled, then setting an explicit size
         * in the {@link LRUCache#set} call will prevent calling the
         * {@link OptionsBase.sizeCalculation} function.
         */
        size?: Size;
        /**
         * If TTL tracking is enabled, then setting an explicit start
         * time in the {@link LRUCache#set} call will override the
         * default time from `performance.now()` or `Date.now()`.
         *
         * Note that it must be a valid value for whichever time-tracking
         * method is in use.
         */
        start?: Milliseconds;
        status?: Status<K, V, FC>;
    }
    /**
     * The type signature for the {@link OptionsBase.fetchMethod} option.
     */
    type Fetcher<K, V, FC = unknown> = (key: K, staleValue: V | undefined, options: FetcherOptions<K, V, FC>) => Promise<V | undefined | void> | V | undefined | void;
    /**
     * the type signature for the {@link OptionsBase.memoMethod} option.
     */
    type Memoizer<K, V, FC = unknown> = (key: K, staleValue: V | undefined, options: MemoizerOptions<K, V, FC>) => V;
    /**
     * Options which may be passed to the {@link LRUCache} constructor.
     *
     * Most of these may be overridden in the various options that use
     * them.
     *
     * Despite all being technically optional, the constructor requires that
     * a cache is at minimum limited by one or more of {@link OptionsBase.max},
     * {@link OptionsBase.ttl}, or {@link OptionsBase.maxSize}.
     *
     * If {@link OptionsBase.ttl} is used alone, then it is strongly advised
     * (and in fact required by the type definitions here) that the cache
     * also set {@link OptionsBase.ttlAutopurge}, to prevent potentially
     * unbounded storage.
     *
     * All options are also available on the {@link LRUCache} instance, making
     * it safe to pass an LRUCache instance as the options argumemnt to
     * make another empty cache of the same type.
     *
     * Some options are marked as read-only, because changing them after
     * instantiation is not safe. Changing any of the other options will of
     * course only have an effect on subsequent method calls.
     */
    interface OptionsBase<K, V, FC> {
        /**
         * The maximum number of items to store in the cache before evicting
         * old entries. This is read-only on the {@link LRUCache} instance,
         * and may not be overridden.
         *
         * If set, then storage space will be pre-allocated at construction
         * time, and the cache will perform significantly faster.
         *
         * Note that significantly fewer items may be stored, if
         * {@link OptionsBase.maxSize} and/or {@link OptionsBase.ttl} are also
         * set.
         *
         * **It is strongly recommended to set a `max` to prevent unbounded growth
         * of the cache.**
         */
        max?: Count;
        /**
         * Max time in milliseconds for items to live in cache before they are
         * considered stale.  Note that stale items are NOT preemptively removed by
         * default, and MAY live in the cache, contributing to its LRU max, long
         * after they have expired, unless {@link OptionsBase.ttlAutopurge} is
         * set.
         *
         * If set to `0` (the default value), then that means "do not track
         * TTL", not "expire immediately".
         *
         * Also, as this cache is optimized for LRU/MRU operations, some of
         * the staleness/TTL checks will reduce performance, as they will incur
         * overhead by deleting items.
         *
         * This is not primarily a TTL cache, and does not make strong TTL
         * guarantees. There is no pre-emptive pruning of expired items, but you
         * _may_ set a TTL on the cache, and it will treat expired items as missing
         * when they are fetched, and delete them.
         *
         * Optional, but must be a non-negative integer in ms if specified.
         *
         * This may be overridden by passing an options object to `cache.set()`.
         *
         * At least one of `max`, `maxSize`, or `TTL` is required. This must be a
         * positive integer if set.
         *
         * Even if ttl tracking is enabled, **it is strongly recommended to set a
         * `max` to prevent unbounded growth of the cache.**
         *
         * If ttl tracking is enabled, and `max` and `maxSize` are not set,
         * and `ttlAutopurge` is not set, then a warning will be emitted
         * cautioning about the potential for unbounded memory consumption.
         * (The TypeScript definitions will also discourage this.)
         */
        ttl?: Milliseconds;
        /**
         * Minimum amount of time in ms in which to check for staleness.
         * Defaults to 1, which means that the current time is checked
         * at most once per millisecond.
         *
         * Set to 0 to check the current time every time staleness is tested.
         * (This reduces performance, and is theoretically unnecessary.)
         *
         * Setting this to a higher value will improve performance somewhat
         * while using ttl tracking, albeit at the expense of keeping stale
         * items around a bit longer than their TTLs would indicate.
         *
         * @default 1
         */
        ttlResolution?: Milliseconds;
        /**
         * Preemptively remove stale items from the cache.
         *
         * Note that this may *significantly* degrade performance, especially if
         * the cache is storing a large number of items. It is almost always best
         * to just leave the stale items in the cache, and let them fall out as new
         * items are added.
         *
         * Note that this means that {@link OptionsBase.allowStale} is a bit
         * pointless, as stale items will be deleted almost as soon as they
         * expire.
         *
         * Use with caution!
         */
        ttlAutopurge?: boolean;
        /**
         * When using time-expiring entries with `ttl`, setting this to `true` will
         * make each item's age reset to 0 whenever it is retrieved from cache with
         * {@link LRUCache#get}, causing it to not expire. (It can still fall out
         * of cache based on recency of use, of course.)
         *
         * Has no effect if {@link OptionsBase.ttl} is not set.
         *
         * This may be overridden by passing an options object to `cache.get()`.
         */
        updateAgeOnGet?: boolean;
        /**
         * When using time-expiring entries with `ttl`, setting this to `true` will
         * make each item's age reset to 0 whenever its presence in the cache is
         * checked with {@link LRUCache#has}, causing it to not expire. (It can
         * still fall out of cache based on recency of use, of course.)
         *
         * Has no effect if {@link OptionsBase.ttl} is not set.
         */
        updateAgeOnHas?: boolean;
        /**
         * Allow {@link LRUCache#get} and {@link LRUCache#fetch} calls to return
         * stale data, if available.
         *
         * By default, if you set `ttl`, stale items will only be deleted from the
         * cache when you `get(key)`. That is, it's not preemptively pruning items,
         * unless {@link OptionsBase.ttlAutopurge} is set.
         *
         * If you set `allowStale:true`, it'll return the stale value *as well as*
         * deleting it. If you don't set this, then it'll return `undefined` when
         * you try to get a stale entry.
         *
         * Note that when a stale entry is fetched, _even if it is returned due to
         * `allowStale` being set_, it is removed from the cache immediately. You
         * can suppress this behavior by setting
         * {@link OptionsBase.noDeleteOnStaleGet}, either in the constructor, or in
         * the options provided to {@link LRUCache#get}.
         *
         * This may be overridden by passing an options object to `cache.get()`.
         * The `cache.has()` method will always return `false` for stale items.
         *
         * Only relevant if a ttl is set.
         */
        allowStale?: boolean;
        /**
         * Function that is called on items when they are dropped from the
         * cache, as `dispose(value, key, reason)`.
         *
         * This can be handy if you want to close file descriptors or do
         * other cleanup tasks when items are no longer stored in the cache.
         *
         * **NOTE**: It is called _before_ the item has been fully removed
         * from the cache, so if you want to put it right back in, you need
         * to wait until the next tick. If you try to add it back in during
         * the `dispose()` function call, it will break things in subtle and
         * weird ways.
         *
         * Unlike several other options, this may _not_ be overridden by
         * passing an option to `set()`, for performance reasons.
         *
         * The `reason` will be one of the following strings, corresponding
         * to the reason for the item's deletion:
         *
         * - `evict` Item was evicted to make space for a new addition
         * - `set` Item was overwritten by a new value
         * - `expire` Item expired its TTL
         * - `fetch` Item was deleted due to a failed or aborted fetch, or a
         *   fetchMethod returning `undefined.
         * - `delete` Item was removed by explicit `cache.delete(key)`,
         *   `cache.clear()`, or `cache.set(key, undefined)`.
         */
        dispose?: Disposer<K, V>;
        /**
         * Function that is called when new items are inserted into the cache,
         * as `onInsert(value, key, reason)`.
         *
         * This can be useful if you need to perform actions when an item is
         * added, such as logging or tracking insertions.
         *
         * Unlike some other options, this may _not_ be overridden by passing
         * an option to `set()`, for performance and consistency reasons.
         */
        onInsert?: Inserter<K, V>;
        /**
         * The same as {@link OptionsBase.dispose}, but called *after* the entry
         * is completely removed and the cache is once again in a clean state.
         *
         * It is safe to add an item right back into the cache at this point.
         * However, note that it is *very* easy to inadvertently create infinite
         * recursion this way.
         */
        disposeAfter?: Disposer<K, V>;
        /**
         * Set to true to suppress calling the
         * {@link OptionsBase.dispose} function if the entry key is
         * still accessible within the cache.
         *
         * This may be overridden by passing an options object to
         * {@link LRUCache#set}.
         *
         * Only relevant if `dispose` or `disposeAfter` are set.
         */
        noDisposeOnSet?: boolean;
        /**
         * Boolean flag to tell the cache to not update the TTL when setting a new
         * value for an existing key (ie, when updating a value rather than
         * inserting a new value).  Note that the TTL value is _always_ set (if
         * provided) when adding a new entry into the cache.
         *
         * Has no effect if a {@link OptionsBase.ttl} is not set.
         *
         * May be passed as an option to {@link LRUCache#set}.
         */
        noUpdateTTL?: boolean;
        /**
         * Set to a positive integer to track the sizes of items added to the
         * cache, and automatically evict items in order to stay below this size.
         * Note that this may result in fewer than `max` items being stored.
         *
         * Attempting to add an item to the cache whose calculated size is greater
         * that this amount will be a no-op. The item will not be cached, and no
         * other items will be evicted.
         *
         * Optional, must be a positive integer if provided.
         *
         * Sets `maxEntrySize` to the same value, unless a different value is
         * provided for `maxEntrySize`.
         *
         * At least one of `max`, `maxSize`, or `TTL` is required. This must be a
         * positive integer if set.
         *
         * Even if size tracking is enabled, **it is strongly recommended to set a
         * `max` to prevent unbounded growth of the cache.**
         *
         * Note also that size tracking can negatively impact performance,
         * though for most cases, only minimally.
         */
        maxSize?: Size;
        /**
         * The effective size for background fetch promises.
         *
         * This has no effect unless `maxSize` and `sizeCalculation` are used,
         * and a {@link LRUCache.OptionsBase.fetchMethod} is provided to
         * support {@link LRUCache#fetch}.
         *
         * If a stale value is present in the cache, then the effective size of
         * the background fetch is the size of the stale item it will eventually
         * replace. If not, then this value is used as its effective size.
         *
         * @default 1
         */
        backgroundFetchSize?: number;
        /**
         * The maximum allowed size for any single item in the cache.
         *
         * If a larger item is passed to {@link LRUCache#set} or returned by a
         * {@link OptionsBase.fetchMethod} or {@link OptionsBase.memoMethod}, then
         * it will not be stored in the cache.
         *
         * Attempting to add an item whose calculated size is greater than
         * this amount will not cache the item or evict any old items, but
         * WILL delete an existing value if one is already present.
         *
         * Optional, must be a positive integer if provided. Defaults to
         * the value of `maxSize` if provided.
         */
        maxEntrySize?: Size;
        /**
         * A function that returns a number indicating the item's size.
         *
         * Requires {@link OptionsBase.maxSize} to be set.
         *
         * If not provided, and {@link OptionsBase.maxSize} or
         * {@link OptionsBase.maxEntrySize} are set, then all
         * {@link LRUCache#set} calls **must** provide an explicit
         * {@link SetOptions.size} or sizeCalculation param.
         */
        sizeCalculation?: SizeCalculator<K, V>;
        /**
         * Method that provides the implementation for {@link LRUCache#fetch}
         *
         * ```ts
         * fetchMethod(key, staleValue, { signal, options, context })
         * ```
         *
         * If `fetchMethod` is not provided, then `cache.fetch(key)` is equivalent
         * to `Promise.resolve(cache.get(key))`.
         *
         * If at any time, `signal.aborted` is set to `true`, or if the
         * `signal.onabort` method is called, or if it emits an `'abort'` event
         * which you can listen to with `addEventListener`, then that means that
         * the fetch should be abandoned. This may be passed along to async
         * functions aware of AbortController/AbortSignal behavior.
         *
         * The `fetchMethod` should **only** return `undefined` or a Promise
         * resolving to `undefined` if the AbortController signaled an `abort`
         * event. In all other cases, it should return or resolve to a value
         * suitable for adding to the cache.
         *
         * The `options` object is a union of the options that may be provided to
         * `set()` and `get()`. If they are modified, then that will result in
         * modifying the settings to `cache.set()` when the value is resolved, and
         * in the case of
         * {@link OptionsBase.noDeleteOnFetchRejection} and
         * {@link OptionsBase.allowStaleOnFetchRejection}, the handling of
         * `fetchMethod` failures.
         *
         * For example, a DNS cache may update the TTL based on the value returned
         * from a remote DNS server by changing `options.ttl` in the `fetchMethod`.
         */
        fetchMethod?: Fetcher<K, V, FC>;
        /**
         * Method that provides the implementation for {@link LRUCache#memo}
         */
        memoMethod?: Memoizer<K, V, FC>;
        /**
         * Set to true to suppress the deletion of stale data when a
         * {@link OptionsBase.fetchMethod} returns a rejected promise.
         */
        noDeleteOnFetchRejection?: boolean;
        /**
         * Do not delete stale items when they are retrieved with
         * {@link LRUCache#get}.
         *
         * Note that the `get` return value will still be `undefined`
         * unless {@link OptionsBase.allowStale} is true.
         *
         * When using time-expiring entries with `ttl`, by default stale
         * items will be removed from the cache when the key is accessed
         * with `cache.get()`.
         *
         * Setting this option will cause stale items to remain in the cache, until
         * they are explicitly deleted with `cache.delete(key)`, or retrieved with
         * `noDeleteOnStaleGet` set to `false`.
         *
         * This may be overridden by passing an options object to `cache.get()`.
         *
         * Only relevant if a ttl is used.
         */
        noDeleteOnStaleGet?: boolean;
        /**
         * Set to true to allow returning stale data when a
         * {@link OptionsBase.fetchMethod} throws an error or returns a rejected
         * promise.
         *
         * This differs from using {@link OptionsBase.allowStale} in that stale
         * data will ONLY be returned in the case that the {@link LRUCache#fetch}
         * fails, not any other times.
         *
         * If a `fetchMethod` fails, and there is no stale value available, the
         * `fetch()` will resolve to `undefined`. Ie, all `fetchMethod` errors are
         * suppressed.
         *
         * Implies `noDeleteOnFetchRejection`.
         *
         * This may be set in calls to `fetch()`, or defaulted on the constructor,
         * or overridden by modifying the options object in the `fetchMethod`.
         */
        allowStaleOnFetchRejection?: boolean;
        /**
         * Set to true to return a stale value from the cache when the
         * `AbortSignal` passed to the {@link OptionsBase.fetchMethod} dispatches
         * an `'abort'` event, whether user-triggered, or due to internal cache
         * behavior.
         *
         * Unless {@link OptionsBase.ignoreFetchAbort} is also set, the underlying
         * {@link OptionsBase.fetchMethod} will still be considered canceled, and
         * any value it returns will be ignored and not cached.
         *
         * Caveat: since fetches are aborted when a new value is explicitly
         * set in the cache, this can lead to fetch returning a stale value,
         * since that was the fallback value _at the moment the `fetch()` was
         * initiated_, even though the new updated value is now present in
         * the cache.
         *
         * For example:
         *
         * ```ts
         * const cache = new LRUCache<string, any>({
         *   ttl: 100,
         *   fetchMethod: async (url, oldValue, { signal }) =>  {
         *     const res = await fetch(url, { signal })
         *     return await res.json()
         *   }
         * })
         * cache.set('https://example.com/', { some: 'data' })
         * // 100ms go by...
         * const result = cache.fetch('https://example.com/')
         * cache.set('https://example.com/', { other: 'thing' })
         * console.log(await result) // { some: 'data' }
         * console.log(cache.get('https://example.com/')) // { other: 'thing' }
         * ```
         */
        allowStaleOnFetchAbort?: boolean;
        /**
         * Set to true to ignore the `abort` event emitted by the `AbortSignal`
         * object passed to {@link OptionsBase.fetchMethod}, and still cache the
         * resulting resolution value, as long as it is not `undefined`.
         *
         * When used on its own, this means aborted {@link LRUCache#fetch} calls
         * are not immediately resolved or rejected when they are aborted, and
         * instead take the full time to await.
         *
         * When used with {@link OptionsBase.allowStaleOnFetchAbort}, aborted
         * {@link LRUCache#fetch} calls will resolve immediately to their stale
         * cached value or `undefined`, and will continue to process and eventually
         * update the cache when they resolve, as long as the resulting value is
         * not `undefined`, thus supporting a "return stale on timeout while
         * refreshing" mechanism by passing `AbortSignal.timeout(n)` as the signal.
         *
         * For example:
         *
         * ```ts
         * const c = new LRUCache({
         *   ttl: 100,
         *   ignoreFetchAbort: true,
         *   allowStaleOnFetchAbort: true,
         *   fetchMethod: async (key, oldValue, { signal }) => {
         *     // note: do NOT pass the signal to fetch()!
         *     // let's say this fetch can take a long time.
         *     const res = await fetch(`https://slow-backend-server/${key}`)
         *     return await res.json()
         *   },
         * })
         *
         * // this will return the stale value after 100ms, while still
         * // updating in the background for next time.
         * const val = await c.fetch('key', { signal: AbortSignal.timeout(100) })
         * ```
         *
         * **Note**: regardless of this setting, an `abort` event _is still
         * emitted on the `AbortSignal` object_, so may result in invalid results
         * when passed to other underlying APIs that use AbortSignals.
         *
         * This may be overridden in the {@link OptionsBase.fetchMethod} or the
         * call to {@link LRUCache#fetch}.
         */
        ignoreFetchAbort?: boolean;
        /**
         * In some cases, you may want to swap out the performance/Date object
         * used for TTL tracking. This should almost certainly NOT be done in
         * production environments!
         *
         * This value defaults to `global.performance` if it has a `now()` method,
         * or the `global.Date` object otherwise.
         */
        perf?: Perf;
    }
    interface OptionsMaxLimit<K, V, FC> extends OptionsBase<K, V, FC> {
        max: Count;
    }
    interface OptionsTTLLimit<K, V, FC> extends OptionsBase<K, V, FC> {
        ttl: Milliseconds;
        ttlAutopurge: boolean;
    }
    interface OptionsSizeLimit<K, V, FC> extends OptionsBase<K, V, FC> {
        maxSize: Size;
    }
    /**
     * The valid safe options for the {@link LRUCache} constructor
     */
    type Options<K, V, FC> = OptionsMaxLimit<K, V, FC> | OptionsSizeLimit<K, V, FC> | OptionsTTLLimit<K, V, FC>;
    /**
     * Entry objects used by {@link LRUCache#load} and {@link LRUCache#dump},
     * and returned by {@link LRUCache#info}.
     */
    interface Entry<V> {
        value: V;
        ttl?: Milliseconds;
        size?: Size;
        start?: Milliseconds;
    }
}
/**
 * Default export, the thing you're using this module to get.
 *
 * The `K` and `V` types define the key and value types, respectively. The
 * optional `FC` type defines the type of the `context` object passed to
 * `cache.fetch()` and `cache.memo()`.
 *
 * Keys and values **must not** be `null` or `undefined`.
 *
 * All properties from the options object (with the exception of `max`,
 * `maxSize`, `fetchMethod`, `memoMethod`, `dispose` and `disposeAfter`) are
 * added as normal public members. (The listed options are read-only getters.)
 *
 * Changing any of these will alter the defaults for subsequent method calls.
 */
declare class LRUCache<K extends {}, V extends {}, FC = unknown> {
    #private;
    /**
     * {@link LRUCache.OptionsBase.perf}
     */
    get perf(): Perf;
    /**
     * {@link LRUCache.OptionsBase.ttl}
     */
    ttl: LRUCache.Milliseconds;
    /**
     * {@link LRUCache.OptionsBase.ttlResolution}
     */
    ttlResolution: LRUCache.Milliseconds;
    /**
     * {@link LRUCache.OptionsBase.ttlAutopurge}
     */
    ttlAutopurge: boolean;
    /**
     * {@link LRUCache.OptionsBase.updateAgeOnGet}
     */
    updateAgeOnGet: boolean;
    /**
     * {@link LRUCache.OptionsBase.updateAgeOnHas}
     */
    updateAgeOnHas: boolean;
    /**
     * {@link LRUCache.OptionsBase.allowStale}
     */
    allowStale: boolean;
    /**
     * {@link LRUCache.OptionsBase.noDisposeOnSet}
     */
    noDisposeOnSet: boolean;
    /**
     * {@link LRUCache.OptionsBase.noUpdateTTL}
     */
    noUpdateTTL: boolean;
    /**
     * {@link LRUCache.OptionsBase.maxEntrySize}
     */
    maxEntrySize: LRUCache.Size;
    /**
     * {@link LRUCache.OptionsBase.sizeCalculation}
     */
    sizeCalculation?: LRUCache.SizeCalculator<K, V>;
    /**
     * {@link LRUCache.OptionsBase.noDeleteOnFetchRejection}
     */
    noDeleteOnFetchRejection: boolean;
    /**
     * {@link LRUCache.OptionsBase.noDeleteOnStaleGet}
     */
    noDeleteOnStaleGet: boolean;
    /**
     * {@link LRUCache.OptionsBase.allowStaleOnFetchAbort}
     */
    allowStaleOnFetchAbort: boolean;
    /**
     * {@link LRUCache.OptionsBase.allowStaleOnFetchRejection}
     */
    allowStaleOnFetchRejection: boolean;
    /**
     * {@link LRUCache.OptionsBase.ignoreFetchAbort}
     */
    ignoreFetchAbort: boolean;
    /** {@link LRUCache.OptionsBase.backgroundFetchSize} */
    backgroundFetchSize: number;
    /**
     * Do not call this method unless you need to inspect the
     * inner workings of the cache.  If anything returned by this
     * object is modified in any way, strange breakage may occur.
     *
     * These fields are private for a reason!
     *
     * @internal
     */
    static unsafeExposeInternals<K extends {}, V extends {}, FC extends unknown = unknown>(c: LRUCache<K, V, FC>): {
        starts: ZeroArray | undefined;
        ttls: ZeroArray | undefined;
        autopurgeTimers: (NodeJS.Timeout | undefined)[] | undefined;
        sizes: ZeroArray | undefined;
        keyMap: Map<K, number>;
        keyList: (K | undefined)[];
        valList: (V | BackgroundFetch<V> | undefined)[];
        next: NumberArray;
        prev: NumberArray;
        readonly head: Index;
        readonly tail: Index;
        free: StackLike;
        isBackgroundFetch: (p: unknown) => p is BackgroundFetch<V>;
        backgroundFetch: (k: K, index: number | undefined, options: LRUCache.FetchOptions<K, V, FC>, context: unknown) => BackgroundFetch<V>;
        moveToTail: (index: number) => void;
        indexes: (options?: {
            allowStale: boolean;
        }) => Generator<Index, void, unknown>;
        rindexes: (options?: {
            allowStale: boolean;
        }) => Generator<Index, void, unknown>;
        isStale: (index: number | undefined) => boolean;
    };
    /**
     * {@link LRUCache.OptionsBase.max} (read-only)
     */
    get max(): LRUCache.Count;
    /**
     * {@link LRUCache.OptionsBase.maxSize} (read-only)
     */
    get maxSize(): LRUCache.Count;
    /**
     * The total computed size of items in the cache (read-only)
     */
    get calculatedSize(): LRUCache.Size;
    /**
     * The number of items stored in the cache (read-only)
     */
    get size(): LRUCache.Count;
    /**
     * {@link LRUCache.OptionsBase.fetchMethod} (read-only)
     */
    get fetchMethod(): LRUCache.Fetcher<K, V, FC> | undefined;
    get memoMethod(): LRUCache.Memoizer<K, V, FC> | undefined;
    /**
     * {@link LRUCache.OptionsBase.dispose} (read-only)
     */
    get dispose(): LRUCache.Disposer<K, V> | undefined;
    /**
     * {@link LRUCache.OptionsBase.onInsert} (read-only)
     */
    get onInsert(): LRUCache.Inserter<K, V> | undefined;
    /**
     * {@link LRUCache.OptionsBase.disposeAfter} (read-only)
     */
    get disposeAfter(): LRUCache.Disposer<K, V> | undefined;
    constructor(options: LRUCache.Options<K, V, FC> | LRUCache<K, V, FC>);
    /**
     * Return the number of ms left in the item's TTL. If item is not in cache,
     * returns `0`. Returns `Infinity` if item is in cache without a defined TTL.
     */
    getRemainingTTL(key: K): number;
    /**
     * Return a generator yielding `[key, value]` pairs,
     * in order from most recently used to least recently used.
     */
    entries(): Generator<[K, V], void, unknown>;
    /**
     * Inverse order version of {@link LRUCache.entries}
     *
     * Return a generator yielding `[key, value]` pairs,
     * in order from least recently used to most recently used.
     */
    rentries(): Generator<(K | V)[], void, unknown>;
    /**
     * Return a generator yielding the keys in the cache,
     * in order from most recently used to least recently used.
     */
    keys(): Generator<K, void, unknown>;
    /**
     * Inverse order version of {@link LRUCache.keys}
     *
     * Return a generator yielding the keys in the cache,
     * in order from least recently used to most recently used.
     */
    rkeys(): Generator<K, void, unknown>;
    /**
     * Return a generator yielding the values in the cache,
     * in order from most recently used to least recently used.
     */
    values(): Generator<V, void, unknown>;
    /**
     * Inverse order version of {@link LRUCache.values}
     *
     * Return a generator yielding the values in the cache,
     * in order from least recently used to most recently used.
     */
    rvalues(): Generator<V | undefined, void, unknown>;
    /**
     * Iterating over the cache itself yields the same results as
     * {@link LRUCache.entries}
     */
    [Symbol.iterator](): Generator<[K, V], void, unknown>;
    /**
     * A String value that is used in the creation of the default string
     * description of an object. Called by the built-in method
     * `Object.prototype.toString`.
     */
    [Symbol.toStringTag]: string;
    /**
     * Find a value for which the supplied fn method returns a truthy value,
     * similar to `Array.find()`. fn is called as `fn(value, key, cache)`.
     */
    find(fn: (v: V, k: K, self: LRUCache<K, V, FC>) => boolean, getOptions?: LRUCache.GetOptions<K, V, FC>): V | undefined;
    /**
     * Call the supplied function on each item in the cache, in order from most
     * recently used to least recently used.
     *
     * `fn` is called as `fn(value, key, cache)`.
     *
     * If `thisp` is provided, function will be called in the `this`-context of
     * the provided object, or the cache if no `thisp` object is provided.
     *
     * Does not update age or recenty of use, or iterate over stale values.
     */
    forEach(fn: (v: V, k: K, self: LRUCache<K, V, FC>) => unknown, thisp?: unknown): void;
    /**
     * The same as {@link LRUCache.forEach} but items are iterated over in
     * reverse order.  (ie, less recently used items are iterated over first.)
     */
    rforEach(fn: (v: V, k: K, self: LRUCache<K, V, FC>) => unknown, thisp?: unknown): void;
    /**
     * Delete any stale entries. Returns true if anything was removed,
     * false otherwise.
     */
    purgeStale(): boolean;
    /**
     * Get the extended info about a given entry, to get its value, size, and
     * TTL info simultaneously. Returns `undefined` if the key is not present.
     *
     * Unlike {@link LRUCache#dump}, which is designed to be portable and survive
     * serialization, the `start` value is always the current timestamp, and the
     * `ttl` is a calculated remaining time to live (negative if expired).
     *
     * Always returns stale values, if their info is found in the cache, so be
     * sure to check for expirations (ie, a negative {@link LRUCache.Entry#ttl})
     * if relevant.
     */
    info(key: K): LRUCache.Entry<V> | undefined;
    /**
     * Return an array of [key, {@link LRUCache.Entry}] tuples which can be
     * passed to {@link LRUCache#load}.
     *
     * The `start` fields are calculated relative to a portable `Date.now()`
     * timestamp, even if `performance.now()` is available.
     *
     * Stale entries are always included in the `dump`, even if
     * {@link LRUCache.OptionsBase.allowStale} is false.
     *
     * Note: this returns an actual array, not a generator, so it can be more
     * easily passed around.
     */
    dump(): [K, LRUCache.Entry<V>][];
    /**
     * Reset the cache and load in the items in entries in the order listed.
     *
     * The shape of the resulting cache may be different if the same options are
     * not used in both caches.
     *
     * The `start` fields are assumed to be calculated relative to a portable
     * `Date.now()` timestamp, even if `performance.now()` is available.
     */
    load(arr: [K, LRUCache.Entry<V>][]): void;
    /**
     * Add a value to the cache.
     *
     * Note: if `undefined` is specified as a value, this is an alias for
     * {@link LRUCache#delete}
     *
     * Fields on the {@link LRUCache.SetOptions} options param will override
     * their corresponding values in the constructor options for the scope
     * of this single `set()` operation.
     *
     * If `start` is provided, then that will set the effective start
     * time for the TTL calculation. Note that this must be a previous
     * value of `performance.now()` if supported, or a previous value of
     * `Date.now()` if not.
     *
     * Options object may also include `size`, which will prevent
     * calling the `sizeCalculation` function and just use the specified
     * number if it is a positive integer, and `noDisposeOnSet` which
     * will prevent calling a `dispose` function in the case of
     * overwrites.
     *
     * If the `size` (or return value of `sizeCalculation`) for a given
     * entry is greater than `maxEntrySize`, then the item will not be
     * added to the cache.
     *
     * Will update the recency of the entry.
     *
     * If the value is `undefined`, then this is an alias for
     * `cache.delete(key)`. `undefined` is never stored in the cache.
     */
    set(k: K, v: V | undefined, setOptions?: LRUCache.SetOptions<K, V, FC>): this;
    /**
     * Evict the least recently used item, returning its value or
     * `undefined` if cache is empty.
     */
    pop(): V | undefined;
    /**
     * Check if a key is in the cache, without updating the recency of use.
     * Will return false if the item is stale, even though it is technically
     * in the cache.
     *
     * Check if a key is in the cache, without updating the recency of
     * use. Age is updated if {@link LRUCache.OptionsBase.updateAgeOnHas} is set
     * to `true` in either the options or the constructor.
     *
     * Will return `false` if the item is stale, even though it is technically in
     * the cache. The difference can be determined (if it matters) by using a
     * `status` argument, and inspecting the `has` field.
     *
     * Will not update item age unless
     * {@link LRUCache.OptionsBase.updateAgeOnHas} is set.
     */
    has(k: K, hasOptions?: LRUCache.HasOptions<K, V, FC>): boolean;
    /**
     * Like {@link LRUCache#get} but doesn't update recency or delete stale
     * items.
     *
     * Returns `undefined` if the item is stale, unless
     * {@link LRUCache.OptionsBase.allowStale} is set.
     */
    peek(k: K, peekOptions?: LRUCache.PeekOptions<K, V, FC>): V | undefined;
    /**
     * Make an asynchronous cached fetch using the
     * {@link LRUCache.OptionsBase.fetchMethod} function.
     *
     * If the value is in the cache and not stale, then the returned
     * Promise resolves to the value.
     *
     * If not in the cache, or beyond its TTL staleness, then
     * `fetchMethod(key, staleValue, { options, signal, context })` is
     * called, and the value returned will be added to the cache once
     * resolved.
     *
     * If called with `allowStale`, and an asynchronous fetch is
     * currently in progress to reload a stale value, then the former
     * stale value will be returned.
     *
     * If called with `forceRefresh`, then the cached item will be
     * re-fetched, even if it is not stale. However, if `allowStale` is also
     * set, then the old value will still be returned. This is useful
     * in cases where you want to force a reload of a cached value. If
     * a background fetch is already in progress, then `forceRefresh`
     * has no effect.
     *
     * If multiple fetches for the same key are issued, then they will all be
     * coalesced into a single call to fetchMethod.
     *
     * Note that this means that handling options such as
     * {@link LRUCache.OptionsBase.allowStaleOnFetchAbort},
     * {@link LRUCache.FetchOptions.signal},
     * and {@link LRUCache.OptionsBase.allowStaleOnFetchRejection} will be
     * determined by the FIRST fetch() call for a given key.
     *
     * This is a known (fixable) shortcoming which will be addresed on when
     * someone complains about it, as the fix would involve added complexity and
     * may not be worth the costs for this edge case.
     *
     * If {@link LRUCache.OptionsBase.fetchMethod} is not specified, then this is
     * effectively an alias for `Promise.resolve(cache.get(key))`.
     *
     * When the fetch method resolves to a value, if the fetch has not
     * been aborted due to deletion, eviction, or being overwritten,
     * then it is added to the cache using the options provided.
     *
     * If the key is evicted or deleted before the `fetchMethod`
     * resolves, then the AbortSignal passed to the `fetchMethod` will
     * receive an `abort` event, and the promise returned by `fetch()`
     * will reject with the reason for the abort.
     *
     * If a `signal` is passed to the `fetch()` call, then aborting the
     * signal will abort the fetch and cause the `fetch()` promise to
     * reject with the reason provided.
     *
     * **Setting `context`**
     *
     * If an `FC` type is set to a type other than `unknown`, `void`, or
     * `undefined` in the {@link LRUCache} constructor, then all
     * calls to `cache.fetch()` _must_ provide a `context` option. If
     * set to `undefined` or `void`, then calls to fetch _must not_
     * provide a `context` option.
     *
     * The `context` param allows you to provide arbitrary data that
     * might be relevant in the course of fetching the data. It is only
     * relevant for the course of a single `fetch()` operation, and
     * discarded afterwards.
     *
     * **Note: `fetch()` calls are inflight-unique**
     *
     * If you call `fetch()` multiple times with the same key value,
     * then every call after the first will resolve on the same
     * promise<sup>1</sup>,
     * _even if they have different settings that would otherwise change
     * the behavior of the fetch_, such as `noDeleteOnFetchRejection`
     * or `ignoreFetchAbort`.
     *
     * In most cases, this is not a problem (in fact, only fetching
     * something once is what you probably want, if you're caching in
     * the first place). If you are changing the fetch() options
     * dramatically between runs, there's a good chance that you might
     * be trying to fit divergent semantics into a single object, and
     * would be better off with multiple cache instances.
     *
     * **1**: Ie, they're not the "same Promise", but they resolve at
     * the same time, because they're both waiting on the same
     * underlying fetchMethod response.
     */
    fetch(k: K, fetchOptions: unknown extends FC ? LRUCache.FetchOptions<K, V, FC> : FC extends undefined | void ? LRUCache.FetchOptionsNoContext<K, V, FC> : LRUCache.FetchOptionsWithContext<K, V, FC>): Promise<undefined | V>;
    fetch(k: unknown extends FC ? K : FC extends undefined | void ? K : never, fetchOptions?: unknown extends FC ? LRUCache.FetchOptions<K, V, FC> : FC extends undefined | void ? LRUCache.FetchOptionsNoContext<K, V, FC> : never): Promise<undefined | V>;
    /**
     * In some cases, `cache.fetch()` may resolve to `undefined`, either because
     * a {@link LRUCache.OptionsBase#fetchMethod} was not provided (turning
     * `cache.fetch(k)` into just an async wrapper around `cache.get(k)`) or
     * because `ignoreFetchAbort` was specified (either to the constructor or
     * in the {@link LRUCache.FetchOptions}). Also, the
     * {@link LRUCache.OptionsBase.fetchMethod} may return `undefined` or `void`, making
     * the test even more complicated.
     *
     * Because inferring the cases where `undefined` might be returned are so
     * cumbersome, but testing for `undefined` can also be annoying, this method
     * can be used, which will reject if `this.fetch()` resolves to undefined.
     */
    forceFetch(k: K, fetchOptions: unknown extends FC ? LRUCache.FetchOptions<K, V, FC> : FC extends undefined | void ? LRUCache.FetchOptionsNoContext<K, V, FC> : LRUCache.FetchOptionsWithContext<K, V, FC>): Promise<V>;
    forceFetch(k: unknown extends FC ? K : FC extends undefined | void ? K : never, fetchOptions?: unknown extends FC ? LRUCache.FetchOptions<K, V, FC> : FC extends undefined | void ? LRUCache.FetchOptionsNoContext<K, V, FC> : never): Promise<V>;
    /**
     * If the key is found in the cache, then this is equivalent to
     * {@link LRUCache#get}. If not, in the cache, then calculate the value using
     * the {@link LRUCache.OptionsBase.memoMethod}, and add it to the cache.
     *
     * If an `FC` type is set to a type other than `unknown`, `void`, or
     * `undefined` in the LRUCache constructor, then all calls to `cache.memo()`
     * _must_ provide a `context` option. If set to `undefined` or `void`, then
     * calls to memo _must not_ provide a `context` option.
     *
     * The `context` param allows you to provide arbitrary data that might be
     * relevant in the course of fetching the data. It is only relevant for the
     * course of a single `memo()` operation, and discarded afterwards.
     */
    memo(k: K, memoOptions: unknown extends FC ? LRUCache.MemoOptions<K, V, FC> : FC extends undefined | void ? LRUCache.MemoOptionsNoContext<K, V, FC> : LRUCache.MemoOptionsWithContext<K, V, FC>): V;
    memo(k: unknown extends FC ? K : FC extends undefined | void ? K : never, memoOptions?: unknown extends FC ? LRUCache.MemoOptions<K, V, FC> : FC extends undefined | void ? LRUCache.MemoOptionsNoContext<K, V, FC> : never): V;
    /**
     * Return a value from the cache. Will update the recency of the cache
     * entry found.
     *
     * If the key is not found, get() will return `undefined`.
     */
    get(k: K, getOptions?: LRUCache.GetOptions<K, V, FC>): V | undefined;
    /**
     * Deletes a key out of the cache.
     *
     * Returns true if the key was deleted, false otherwise.
     */
    delete(k: K): boolean;
    /**
     * Clear the cache entirely, throwing away all values.
     */
    clear(): void;
}

/**
 * An object that will be used to override the default `fs`
 * methods.  Any methods that are not overridden will use Node's
 * built-in implementations.
 *
 * - lstatSync
 * - readdir (callback `withFileTypes` Dirent variant, used for
 *   readdirCB and most walks)
 * - readdirSync
 * - readlinkSync
 * - realpathSync
 * - promises: Object containing the following async methods:
 *   - lstat
 *   - readdir (Dirent variant only)
 *   - readlink
 *   - realpath
 */
interface FSOption {
    lstatSync?: (path: string) => Stats;
    readdir?: (path: string, options: {
        withFileTypes: true;
    }, cb: (er: NodeJS.ErrnoException | null, entries?: Dirent[]) => any) => void;
    readdirSync?: (path: string, options: {
        withFileTypes: true;
    }) => Dirent[];
    readlinkSync?: (path: string) => string;
    realpathSync?: (path: string) => string;
    promises?: {
        lstat?: (path: string) => Promise<Stats>;
        readdir?: (path: string, options: {
            withFileTypes: true;
        }) => Promise<Dirent[]>;
        readlink?: (path: string) => Promise<string>;
        realpath?: (path: string) => Promise<string>;
        [k: string]: any;
    };
    [k: string]: any;
}
interface FSValue {
    lstatSync: (path: string) => Stats;
    readdir: (path: string, options: {
        withFileTypes: true;
    }, cb: (er: NodeJS.ErrnoException | null, entries?: Dirent[]) => any) => void;
    readdirSync: (path: string, options: {
        withFileTypes: true;
    }) => Dirent[];
    readlinkSync: (path: string) => string;
    realpathSync: (path: string) => string;
    promises: {
        lstat: (path: string) => Promise<Stats>;
        readdir: (path: string, options: {
            withFileTypes: true;
        }) => Promise<Dirent[]>;
        readlink: (path: string) => Promise<string>;
        realpath: (path: string) => Promise<string>;
        [k: string]: any;
    };
    [k: string]: any;
}
type Type = 'Unknown' | 'FIFO' | 'CharacterDevice' | 'Directory' | 'BlockDevice' | 'File' | 'SymbolicLink' | 'Socket';
/**
 * Options that may be provided to the Path constructor
 */
interface PathOpts {
    fullpath?: string;
    relative?: string;
    relativePosix?: string;
    parent?: PathBase;
    /**
     * See {@link FSOption}
     */
    fs?: FSOption;
}
/**
 * an LRUCache for storing child entries.
 * @internal
 */
declare class ChildrenCache extends LRUCache<PathBase, Children> {
    constructor(maxSize?: number);
}
/**
 * Array of Path objects, plus a marker indicating the first provisional entry
 *
 * @internal
 */
type Children = PathBase[] & {
    provisional: number;
};
declare const setAsCwd: unique symbol;
/**
 * Path objects are sort of like a super-powered
 * {@link https://nodejs.org/docs/latest/api/fs.html#class-fsdirent fs.Dirent}
 *
 * Each one represents a single filesystem entry on disk, which may or may not
 * exist. It includes methods for reading various types of information via
 * lstat, readlink, and readdir, and caches all information to the greatest
 * degree possible.
 *
 * Note that fs operations that would normally throw will instead return an
 * "empty" value. This is in order to prevent excessive overhead from error
 * stack traces.
 */
declare abstract class PathBase implements Dirent {
    #private;
    /**
     * the basename of this path
     *
     * **Important**: *always* test the path name against any test string
     * usingthe {@link isNamed} method, and not by directly comparing this
     * string. Otherwise, unicode path strings that the system sees as identical
     * will not be properly treated as the same path, leading to incorrect
     * behavior and possible security issues.
     */
    name: string;
    /**
     * the Path entry corresponding to the path root.
     *
     * @internal
     */
    root: PathBase;
    /**
     * All roots found within the current PathScurry family
     *
     * @internal
     */
    roots: {
        [k: string]: PathBase;
    };
    /**
     * a reference to the parent path, or undefined in the case of root entries
     *
     * @internal
     */
    parent?: PathBase;
    /**
     * boolean indicating whether paths are compared case-insensitively
     * @internal
     */
    nocase: boolean;
    /**
     * boolean indicating that this path is the current working directory
     * of the PathScurry collection that contains it.
     */
    isCWD: boolean;
    /**
     * the string or regexp used to split paths. On posix, it is `'/'`, and on
     * windows it is a RegExp matching either `'/'` or `'\\'`
     */
    abstract splitSep: string | RegExp;
    /**
     * The path separator string to use when joining paths
     */
    abstract sep: string;
    get dev(): number | undefined;
    get mode(): number | undefined;
    get nlink(): number | undefined;
    get uid(): number | undefined;
    get gid(): number | undefined;
    get rdev(): number | undefined;
    get blksize(): number | undefined;
    get ino(): number | undefined;
    get size(): number | undefined;
    get blocks(): number | undefined;
    get atimeMs(): number | undefined;
    get mtimeMs(): number | undefined;
    get ctimeMs(): number | undefined;
    get birthtimeMs(): number | undefined;
    get atime(): Date | undefined;
    get mtime(): Date | undefined;
    get ctime(): Date | undefined;
    get birthtime(): Date | undefined;
    /**
     * This property is for compatibility with the Dirent class as of
     * Node v20, where Dirent['parentPath'] refers to the path of the
     * directory that was passed to readdir. For root entries, it's the path
     * to the entry itself.
     */
    get parentPath(): string;
    /**
     * Deprecated alias for Dirent['parentPath'] Somewhat counterintuitively,
     * this property refers to the *parent* path, not the path object itself.
     *
     * @deprecated
     */
    get path(): string;
    /**
     * Do not create new Path objects directly.  They should always be accessed
     * via the PathScurry class or other methods on the Path class.
     *
     * @internal
     */
    constructor(name: string, type: number | undefined, root: PathBase | undefined, roots: {
        [k: string]: PathBase;
    }, nocase: boolean, children: ChildrenCache, opts: PathOpts);
    /**
     * Returns the depth of the Path object from its root.
     *
     * For example, a path at `/foo/bar` would have a depth of 2.
     */
    depth(): number;
    /**
     * @internal
     */
    abstract getRootString(path: string): string;
    /**
     * @internal
     */
    abstract getRoot(rootPath: string): PathBase;
    /**
     * @internal
     */
    abstract newChild(name: string, type?: number, opts?: PathOpts): PathBase;
    /**
     * @internal
     */
    childrenCache(): ChildrenCache;
    /**
     * Get the Path object referenced by the string path, resolved from this Path
     */
    resolve(path?: string): PathBase;
    /**
     * Returns the cached children Path objects, if still available.  If they
     * have fallen out of the cache, then returns an empty array, and resets the
     * READDIR_CALLED bit, so that future calls to readdir() will require an fs
     * lookup.
     *
     * @internal
     */
    children(): Children;
    /**
     * Resolves a path portion and returns or creates the child Path.
     *
     * Returns `this` if pathPart is `''` or `'.'`, or `parent` if pathPart is
     * `'..'`.
     *
     * This should not be called directly.  If `pathPart` contains any path
     * separators, it will lead to unsafe undefined behavior.
     *
     * Use `Path.resolve()` instead.
     *
     * @internal
     */
    child(pathPart: string, opts?: PathOpts): PathBase;
    /**
     * The relative path from the cwd. If it does not share an ancestor with
     * the cwd, then this ends up being equivalent to the fullpath()
     */
    relative(): string;
    /**
     * The relative path from the cwd, using / as the path separator.
     * If it does not share an ancestor with
     * the cwd, then this ends up being equivalent to the fullpathPosix()
     * On posix systems, this is identical to relative().
     */
    relativePosix(): string;
    /**
     * The fully resolved path string for this Path entry
     */
    fullpath(): string;
    /**
     * On platforms other than windows, this is identical to fullpath.
     *
     * On windows, this is overridden to return the forward-slash form of the
     * full UNC path.
     */
    fullpathPosix(): string;
    /**
     * Is the Path of an unknown type?
     *
     * Note that we might know *something* about it if there has been a previous
     * filesystem operation, for example that it does not exist, or is not a
     * link, or whether it has child entries.
     */
    isUnknown(): boolean;
    isType(type: Type): boolean;
    getType(): Type;
    /**
     * Is the Path a regular file?
     */
    isFile(): boolean;
    /**
     * Is the Path a directory?
     */
    isDirectory(): boolean;
    /**
     * Is the path a character device?
     */
    isCharacterDevice(): boolean;
    /**
     * Is the path a block device?
     */
    isBlockDevice(): boolean;
    /**
     * Is the path a FIFO pipe?
     */
    isFIFO(): boolean;
    /**
     * Is the path a socket?
     */
    isSocket(): boolean;
    /**
     * Is the path a symbolic link?
     */
    isSymbolicLink(): boolean;
    /**
     * Return the entry if it has been subject of a successful lstat, or
     * undefined otherwise.
     *
     * Does not read the filesystem, so an undefined result *could* simply
     * mean that we haven't called lstat on it.
     */
    lstatCached(): PathBase | undefined;
    /**
     * Return the cached link target if the entry has been the subject of a
     * successful readlink, or undefined otherwise.
     *
     * Does not read the filesystem, so an undefined result *could* just mean we
     * don't have any cached data. Only use it if you are very sure that a
     * readlink() has been called at some point.
     */
    readlinkCached(): PathBase | undefined;
    /**
     * Returns the cached realpath target if the entry has been the subject
     * of a successful realpath, or undefined otherwise.
     *
     * Does not read the filesystem, so an undefined result *could* just mean we
     * don't have any cached data. Only use it if you are very sure that a
     * realpath() has been called at some point.
     */
    realpathCached(): PathBase | undefined;
    /**
     * Returns the cached child Path entries array if the entry has been the
     * subject of a successful readdir(), or [] otherwise.
     *
     * Does not read the filesystem, so an empty array *could* just mean we
     * don't have any cached data. Only use it if you are very sure that a
     * readdir() has been called recently enough to still be valid.
     */
    readdirCached(): PathBase[];
    /**
     * Return true if it's worth trying to readlink.  Ie, we don't (yet) have
     * any indication that readlink will definitely fail.
     *
     * Returns false if the path is known to not be a symlink, if a previous
     * readlink failed, or if the entry does not exist.
     */
    canReadlink(): boolean;
    /**
     * Return true if readdir has previously been successfully called on this
     * path, indicating that cachedReaddir() is likely valid.
     */
    calledReaddir(): boolean;
    /**
     * Returns true if the path is known to not exist. That is, a previous lstat
     * or readdir failed to verify its existence when that would have been
     * expected, or a parent entry was marked either enoent or enotdir.
     */
    isENOENT(): boolean;
    /**
     * Return true if the path is a match for the given path name.  This handles
     * case sensitivity and unicode normalization.
     *
     * Note: even on case-sensitive systems, it is **not** safe to test the
     * equality of the `.name` property to determine whether a given pathname
     * matches, due to unicode normalization mismatches.
     *
     * Always use this method instead of testing the `path.name` property
     * directly.
     */
    isNamed(n: string): boolean;
    /**
     * Return the Path object corresponding to the target of a symbolic link.
     *
     * If the Path is not a symbolic link, or if the readlink call fails for any
     * reason, `undefined` is returned.
     *
     * Result is cached, and thus may be outdated if the filesystem is mutated.
     */
    readlink(): Promise<PathBase | undefined>;
    /**
     * Synchronous {@link PathBase.readlink}
     */
    readlinkSync(): PathBase | undefined;
    /**
     * Call lstat() on this Path, and update all known information that can be
     * determined.
     *
     * Note that unlike `fs.lstat()`, the returned value does not contain some
     * information, such as `mode`, `dev`, `nlink`, and `ino`.  If that
     * information is required, you will need to call `fs.lstat` yourself.
     *
     * If the Path refers to a nonexistent file, or if the lstat call fails for
     * any reason, `undefined` is returned.  Otherwise the updated Path object is
     * returned.
     *
     * Results are cached, and thus may be out of date if the filesystem is
     * mutated.
     */
    lstat(): Promise<PathBase | undefined>;
    /**
     * synchronous {@link PathBase.lstat}
     */
    lstatSync(): PathBase | undefined;
    /**
     * Standard node-style callback interface to get list of directory entries.
     *
     * If the Path cannot or does not contain any children, then an empty array
     * is returned.
     *
     * Results are cached, and thus may be out of date if the filesystem is
     * mutated.
     *
     * @param cb The callback called with (er, entries).  Note that the `er`
     * param is somewhat extraneous, as all readdir() errors are handled and
     * simply result in an empty set of entries being returned.
     * @param allowZalgo Boolean indicating that immediately known results should
     * *not* be deferred with `queueMicrotask`. Defaults to `false`. Release
     * zalgo at your peril, the dark pony lord is devious and unforgiving.
     */
    readdirCB(cb: (er: NodeJS.ErrnoException | null, entries: PathBase[]) => any, allowZalgo?: boolean): void;
    /**
     * Return an array of known child entries.
     *
     * If the Path cannot or does not contain any children, then an empty array
     * is returned.
     *
     * Results are cached, and thus may be out of date if the filesystem is
     * mutated.
     */
    readdir(): Promise<PathBase[]>;
    /**
     * synchronous {@link PathBase.readdir}
     */
    readdirSync(): PathBase[];
    canReaddir(): boolean;
    shouldWalk(dirs: Set<PathBase | undefined>, walkFilter?: (e: PathBase) => boolean): boolean;
    /**
     * Return the Path object corresponding to path as resolved
     * by realpath(3).
     *
     * If the realpath call fails for any reason, `undefined` is returned.
     *
     * Result is cached, and thus may be outdated if the filesystem is mutated.
     * On success, returns a Path object.
     */
    realpath(): Promise<PathBase | undefined>;
    /**
     * Synchronous {@link realpath}
     */
    realpathSync(): PathBase | undefined;
    /**
     * Internal method to mark this Path object as the scurry cwd,
     * called by {@link PathScurry#chdir}
     *
     * @internal
     */
    [setAsCwd](oldCwd: PathBase): void;
}
/**
 * Path class used on win32 systems
 *
 * Uses `'\\'` as the path separator for returned paths, either `'\\'` or `'/'`
 * as the path separator for parsing paths.
 */
declare class PathWin32 extends PathBase {
    /**
     * Separator for generating path strings.
     */
    sep: '\\';
    /**
     * Separator for parsing path strings.
     */
    splitSep: RegExp;
    /**
     * Do not create new Path objects directly.  They should always be accessed
     * via the PathScurry class or other methods on the Path class.
     *
     * @internal
     */
    constructor(name: string, type: number | undefined, root: PathBase | undefined, roots: {
        [k: string]: PathBase;
    }, nocase: boolean, children: ChildrenCache, opts: PathOpts);
    /**
     * @internal
     */
    newChild(name: string, type?: number, opts?: PathOpts): PathWin32;
    /**
     * @internal
     */
    getRootString(path: string): string;
    /**
     * @internal
     */
    getRoot(rootPath: string): PathBase;
    /**
     * @internal
     */
    sameRoot(rootPath: string, compare?: string): boolean;
}
/**
 * Path class used on all posix systems.
 *
 * Uses `'/'` as the path separator.
 */
declare class PathPosix extends PathBase {
    /**
     * separator for parsing path strings
     */
    splitSep: '/';
    /**
     * separator for generating path strings
     */
    sep: '/';
    /**
     * Do not create new Path objects directly.  They should always be accessed
     * via the PathScurry class or other methods on the Path class.
     *
     * @internal
     */
    constructor(name: string, type: number | undefined, root: PathBase | undefined, roots: {
        [k: string]: PathBase;
    }, nocase: boolean, children: ChildrenCache, opts: PathOpts);
    /**
     * @internal
     */
    getRootString(path: string): string;
    /**
     * @internal
     */
    getRoot(_rootPath: string): PathBase;
    /**
     * @internal
     */
    newChild(name: string, type?: number, opts?: PathOpts): PathPosix;
}
/**
 * Options that may be provided to the PathScurry constructor
 */
interface PathScurryOpts {
    /**
     * perform case-insensitive path matching. Default based on platform
     * subclass.
     */
    nocase?: boolean;
    /**
     * Number of Path entries to keep in the cache of Path child references.
     *
     * Setting this higher than 65536 will dramatically increase the data
     * consumption and construction time overhead of each PathScurry.
     *
     * Setting this value to 256 or lower will significantly reduce the data
     * consumption and construction time overhead, but may also reduce resolve()
     * and readdir() performance on large filesystems.
     *
     * Default `16384`.
     */
    childrenCacheSize?: number;
    /**
     * An object that overrides the built-in functions from the fs and
     * fs/promises modules.
     *
     * See {@link FSOption}
     */
    fs?: FSOption;
}
/**
 * The base class for all PathScurry classes, providing the interface for path
 * resolution and filesystem operations.
 *
 * Typically, you should *not* instantiate this class directly, but rather one
 * of the platform-specific classes, or the exported {@link PathScurry} which
 * defaults to the current platform.
 */
declare abstract class PathScurryBase {
    #private;
    /**
     * The root Path entry for the current working directory of this Scurry
     */
    root: PathBase;
    /**
     * The string path for the root of this Scurry's current working directory
     */
    rootPath: string;
    /**
     * A collection of all roots encountered, referenced by rootPath
     */
    roots: {
        [k: string]: PathBase;
    };
    /**
     * The Path entry corresponding to this PathScurry's current working directory.
     */
    cwd: PathBase;
    /**
     * Perform path comparisons case-insensitively.
     *
     * Defaults true on Darwin and Windows systems, false elsewhere.
     */
    nocase: boolean;
    /**
     * The path separator used for parsing paths
     *
     * `'/'` on Posix systems, either `'/'` or `'\\'` on Windows
     */
    abstract sep: string | RegExp;
    /**
     * This class should not be instantiated directly.
     *
     * Use PathScurryWin32, PathScurryDarwin, PathScurryPosix, or PathScurry
     *
     * @internal
     */
    constructor(cwd: (URL | string) | undefined, pathImpl: typeof win32 | typeof posix, sep: string | RegExp, { nocase, childrenCacheSize, fs, }?: PathScurryOpts);
    /**
     * Get the depth of a provided path, string, or the cwd
     */
    depth(path?: Path | string): number;
    /**
     * Parse the root portion of a path string
     *
     * @internal
     */
    abstract parseRootPath(dir: string): string;
    /**
     * create a new Path to use as root during construction.
     *
     * @internal
     */
    abstract newRoot(fs: FSValue): PathBase;
    /**
     * Determine whether a given path string is absolute
     */
    abstract isAbsolute(p: string): boolean;
    /**
     * Return the cache of child entries.  Exposed so subclasses can create
     * child Path objects in a platform-specific way.
     *
     * @internal
     */
    childrenCache(): ChildrenCache;
    /**
     * Resolve one or more path strings to a resolved string
     *
     * Same interface as require('path').resolve.
     *
     * Much faster than path.resolve() when called multiple times for the same
     * path, because the resolved Path objects are cached.  Much slower
     * otherwise.
     */
    resolve(...paths: string[]): string;
    /**
     * Resolve one or more path strings to a resolved string, returning
     * the posix path.  Identical to .resolve() on posix systems, but on
     * windows will return a forward-slash separated UNC path.
     *
     * Same interface as require('path').resolve.
     *
     * Much faster than path.resolve() when called multiple times for the same
     * path, because the resolved Path objects are cached.  Much slower
     * otherwise.
     */
    resolvePosix(...paths: string[]): string;
    /**
     * find the relative path from the cwd to the supplied path string or entry
     */
    relative(entry?: PathBase | string): string;
    /**
     * find the relative path from the cwd to the supplied path string or
     * entry, using / as the path delimiter, even on Windows.
     */
    relativePosix(entry?: PathBase | string): string;
    /**
     * Return the basename for the provided string or Path object
     */
    basename(entry?: PathBase | string): string;
    /**
     * Return the dirname for the provided string or Path object
     */
    dirname(entry?: PathBase | string): string;
    /**
     * Return an array of known child entries.
     *
     * First argument may be either a string, or a Path object.
     *
     * If the Path cannot or does not contain any children, then an empty array
     * is returned.
     *
     * Results are cached, and thus may be out of date if the filesystem is
     * mutated.
     *
     * Unlike `fs.readdir()`, the `withFileTypes` option defaults to `true`. Set
     * `{ withFileTypes: false }` to return strings.
     */
    readdir(): Promise<PathBase[]>;
    readdir(opts: {
        withFileTypes: true;
    }): Promise<PathBase[]>;
    readdir(opts: {
        withFileTypes: false;
    }): Promise<string[]>;
    readdir(opts: {
        withFileTypes: boolean;
    }): Promise<PathBase[] | string[]>;
    readdir(entry: PathBase | string): Promise<PathBase[]>;
    readdir(entry: PathBase | string, opts: {
        withFileTypes: true;
    }): Promise<PathBase[]>;
    readdir(entry: PathBase | string, opts: {
        withFileTypes: false;
    }): Promise<string[]>;
    readdir(entry: PathBase | string, opts: {
        withFileTypes: boolean;
    }): Promise<PathBase[] | string[]>;
    /**
     * synchronous {@link PathScurryBase.readdir}
     */
    readdirSync(): PathBase[];
    readdirSync(opts: {
        withFileTypes: true;
    }): PathBase[];
    readdirSync(opts: {
        withFileTypes: false;
    }): string[];
    readdirSync(opts: {
        withFileTypes: boolean;
    }): PathBase[] | string[];
    readdirSync(entry: PathBase | string): PathBase[];
    readdirSync(entry: PathBase | string, opts: {
        withFileTypes: true;
    }): PathBase[];
    readdirSync(entry: PathBase | string, opts: {
        withFileTypes: false;
    }): string[];
    readdirSync(entry: PathBase | string, opts: {
        withFileTypes: boolean;
    }): PathBase[] | string[];
    /**
     * Call lstat() on the string or Path object, and update all known
     * information that can be determined.
     *
     * Note that unlike `fs.lstat()`, the returned value does not contain some
     * information, such as `mode`, `dev`, `nlink`, and `ino`.  If that
     * information is required, you will need to call `fs.lstat` yourself.
     *
     * If the Path refers to a nonexistent file, or if the lstat call fails for
     * any reason, `undefined` is returned.  Otherwise the updated Path object is
     * returned.
     *
     * Results are cached, and thus may be out of date if the filesystem is
     * mutated.
     */
    lstat(entry?: string | PathBase): Promise<PathBase | undefined>;
    /**
     * synchronous {@link PathScurryBase.lstat}
     */
    lstatSync(entry?: string | PathBase): PathBase | undefined;
    /**
     * Return the Path object or string path corresponding to the target of a
     * symbolic link.
     *
     * If the path is not a symbolic link, or if the readlink call fails for any
     * reason, `undefined` is returned.
     *
     * Result is cached, and thus may be outdated if the filesystem is mutated.
     *
     * `{withFileTypes}` option defaults to `false`.
     *
     * On success, returns a Path object if `withFileTypes` option is true,
     * otherwise a string.
     */
    readlink(): Promise<string | undefined>;
    readlink(opt: {
        withFileTypes: false;
    }): Promise<string | undefined>;
    readlink(opt: {
        withFileTypes: true;
    }): Promise<PathBase | undefined>;
    readlink(opt: {
        withFileTypes: boolean;
    }): Promise<PathBase | string | undefined>;
    readlink(entry: string | PathBase, opt?: {
        withFileTypes: false;
    }): Promise<string | undefined>;
    readlink(entry: string | PathBase, opt: {
        withFileTypes: true;
    }): Promise<PathBase | undefined>;
    readlink(entry: string | PathBase, opt: {
        withFileTypes: boolean;
    }): Promise<string | PathBase | undefined>;
    /**
     * synchronous {@link PathScurryBase.readlink}
     */
    readlinkSync(): string | undefined;
    readlinkSync(opt: {
        withFileTypes: false;
    }): string | undefined;
    readlinkSync(opt: {
        withFileTypes: true;
    }): PathBase | undefined;
    readlinkSync(opt: {
        withFileTypes: boolean;
    }): PathBase | string | undefined;
    readlinkSync(entry: string | PathBase, opt?: {
        withFileTypes: false;
    }): string | undefined;
    readlinkSync(entry: string | PathBase, opt: {
        withFileTypes: true;
    }): PathBase | undefined;
    readlinkSync(entry: string | PathBase, opt: {
        withFileTypes: boolean;
    }): string | PathBase | undefined;
    /**
     * Return the Path object or string path corresponding to path as resolved
     * by realpath(3).
     *
     * If the realpath call fails for any reason, `undefined` is returned.
     *
     * Result is cached, and thus may be outdated if the filesystem is mutated.
     *
     * `{withFileTypes}` option defaults to `false`.
     *
     * On success, returns a Path object if `withFileTypes` option is true,
     * otherwise a string.
     */
    realpath(): Promise<string | undefined>;
    realpath(opt: {
        withFileTypes: false;
    }): Promise<string | undefined>;
    realpath(opt: {
        withFileTypes: true;
    }): Promise<PathBase | undefined>;
    realpath(opt: {
        withFileTypes: boolean;
    }): Promise<PathBase | string | undefined>;
    realpath(entry: string | PathBase, opt?: {
        withFileTypes: false;
    }): Promise<string | undefined>;
    realpath(entry: string | PathBase, opt: {
        withFileTypes: true;
    }): Promise<PathBase | undefined>;
    realpath(entry: string | PathBase, opt: {
        withFileTypes: boolean;
    }): Promise<string | PathBase | undefined>;
    realpathSync(): string | undefined;
    realpathSync(opt: {
        withFileTypes: false;
    }): string | undefined;
    realpathSync(opt: {
        withFileTypes: true;
    }): PathBase | undefined;
    realpathSync(opt: {
        withFileTypes: boolean;
    }): PathBase | string | undefined;
    realpathSync(entry: string | PathBase, opt?: {
        withFileTypes: false;
    }): string | undefined;
    realpathSync(entry: string | PathBase, opt: {
        withFileTypes: true;
    }): PathBase | undefined;
    realpathSync(entry: string | PathBase, opt: {
        withFileTypes: boolean;
    }): string | PathBase | undefined;
    /**
     * Asynchronously walk the directory tree, returning an array of
     * all path strings or Path objects found.
     *
     * Note that this will be extremely memory-hungry on large filesystems.
     * In such cases, it may be better to use the stream or async iterator
     * walk implementation.
     */
    walk(): Promise<PathBase[]>;
    walk(opts: WalkOptionsWithFileTypesTrue | WalkOptionsWithFileTypesUnset): Promise<PathBase[]>;
    walk(opts: WalkOptionsWithFileTypesFalse): Promise<string[]>;
    walk(opts: WalkOptions): Promise<string[] | PathBase[]>;
    walk(entry: string | PathBase): Promise<PathBase[]>;
    walk(entry: string | PathBase, opts: WalkOptionsWithFileTypesTrue | WalkOptionsWithFileTypesUnset): Promise<PathBase[]>;
    walk(entry: string | PathBase, opts: WalkOptionsWithFileTypesFalse): Promise<string[]>;
    walk(entry: string | PathBase, opts: WalkOptions): Promise<PathBase[] | string[]>;
    /**
     * Synchronously walk the directory tree, returning an array of
     * all path strings or Path objects found.
     *
     * Note that this will be extremely memory-hungry on large filesystems.
     * In such cases, it may be better to use the stream or async iterator
     * walk implementation.
     */
    walkSync(): PathBase[];
    walkSync(opts: WalkOptionsWithFileTypesTrue | WalkOptionsWithFileTypesUnset): PathBase[];
    walkSync(opts: WalkOptionsWithFileTypesFalse): string[];
    walkSync(opts: WalkOptions): string[] | PathBase[];
    walkSync(entry: string | PathBase): PathBase[];
    walkSync(entry: string | PathBase, opts: WalkOptionsWithFileTypesUnset | WalkOptionsWithFileTypesTrue): PathBase[];
    walkSync(entry: string | PathBase, opts: WalkOptionsWithFileTypesFalse): string[];
    walkSync(entry: string | PathBase, opts: WalkOptions): PathBase[] | string[];
    /**
     * Support for `for await`
     *
     * Alias for {@link PathScurryBase.iterate}
     *
     * Note: As of Node 19, this is very slow, compared to other methods of
     * walking.  Consider using {@link PathScurryBase.stream} if memory overhead
     * and backpressure are concerns, or {@link PathScurryBase.walk} if not.
     */
    [Symbol.asyncIterator](): AsyncGenerator<PathBase, void, void>;
    /**
     * Async generator form of {@link PathScurryBase.walk}
     *
     * Note: As of Node 19, this is very slow, compared to other methods of
     * walking, especially if most/all of the directory tree has been previously
     * walked.  Consider using {@link PathScurryBase.stream} if memory overhead
     * and backpressure are concerns, or {@link PathScurryBase.walk} if not.
     */
    iterate(): AsyncGenerator<PathBase, void, void>;
    iterate(opts: WalkOptionsWithFileTypesTrue | WalkOptionsWithFileTypesUnset): AsyncGenerator<PathBase, void, void>;
    iterate(opts: WalkOptionsWithFileTypesFalse): AsyncGenerator<string, void, void>;
    iterate(opts: WalkOptions): AsyncGenerator<string | PathBase, void, void>;
    iterate(entry: string | PathBase): AsyncGenerator<PathBase, void, void>;
    iterate(entry: string | PathBase, opts: WalkOptionsWithFileTypesTrue | WalkOptionsWithFileTypesUnset): AsyncGenerator<PathBase, void, void>;
    iterate(entry: string | PathBase, opts: WalkOptionsWithFileTypesFalse): AsyncGenerator<string, void, void>;
    iterate(entry: string | PathBase, opts: WalkOptions): AsyncGenerator<PathBase | string, void, void>;
    /**
     * Iterating over a PathScurry performs a synchronous walk.
     *
     * Alias for {@link PathScurryBase.iterateSync}
     */
    [Symbol.iterator](): Generator<PathBase, void, void>;
    iterateSync(): Generator<PathBase, void, void>;
    iterateSync(opts: WalkOptionsWithFileTypesTrue | WalkOptionsWithFileTypesUnset): Generator<PathBase, void, void>;
    iterateSync(opts: WalkOptionsWithFileTypesFalse): Generator<string, void, void>;
    iterateSync(opts: WalkOptions): Generator<string | PathBase, void, void>;
    iterateSync(entry: string | PathBase): Generator<PathBase, void, void>;
    iterateSync(entry: string | PathBase, opts: WalkOptionsWithFileTypesTrue | WalkOptionsWithFileTypesUnset): Generator<PathBase, void, void>;
    iterateSync(entry: string | PathBase, opts: WalkOptionsWithFileTypesFalse): Generator<string, void, void>;
    iterateSync(entry: string | PathBase, opts: WalkOptions): Generator<PathBase | string, void, void>;
    /**
     * Stream form of {@link PathScurryBase.walk}
     *
     * Returns a Minipass stream that emits {@link PathBase} objects by default,
     * or strings if `{ withFileTypes: false }` is set in the options.
     */
    stream(): Minipass<PathBase>;
    stream(opts: WalkOptionsWithFileTypesTrue | WalkOptionsWithFileTypesUnset): Minipass<PathBase>;
    stream(opts: WalkOptionsWithFileTypesFalse): Minipass<string>;
    stream(opts: WalkOptions): Minipass<string | PathBase>;
    stream(entry: string | PathBase): Minipass<PathBase>;
    stream(entry: string | PathBase, opts: WalkOptionsWithFileTypesUnset | WalkOptionsWithFileTypesTrue): Minipass<PathBase>;
    stream(entry: string | PathBase, opts: WalkOptionsWithFileTypesFalse): Minipass<string>;
    stream(entry: string | PathBase, opts: WalkOptions): Minipass<string> | Minipass<PathBase>;
    /**
     * Synchronous form of {@link PathScurryBase.stream}
     *
     * Returns a Minipass stream that emits {@link PathBase} objects by default,
     * or strings if `{ withFileTypes: false }` is set in the options.
     *
     * Will complete the walk in a single tick if the stream is consumed fully.
     * Otherwise, will pause as needed for stream backpressure.
     */
    streamSync(): Minipass<PathBase>;
    streamSync(opts: WalkOptionsWithFileTypesTrue | WalkOptionsWithFileTypesUnset): Minipass<PathBase>;
    streamSync(opts: WalkOptionsWithFileTypesFalse): Minipass<string>;
    streamSync(opts: WalkOptions): Minipass<string | PathBase>;
    streamSync(entry: string | PathBase): Minipass<PathBase>;
    streamSync(entry: string | PathBase, opts: WalkOptionsWithFileTypesUnset | WalkOptionsWithFileTypesTrue): Minipass<PathBase>;
    streamSync(entry: string | PathBase, opts: WalkOptionsWithFileTypesFalse): Minipass<string>;
    streamSync(entry: string | PathBase, opts: WalkOptions): Minipass<string> | Minipass<PathBase>;
    chdir(path?: string | Path): void;
}
/**
 * Options provided to all walk methods.
 */
interface WalkOptions {
    /**
     * Return results as {@link PathBase} objects rather than strings.
     * When set to false, results are fully resolved paths, as returned by
     * {@link PathBase.fullpath}.
     * @default true
     */
    withFileTypes?: boolean;
    /**
     *  Attempt to read directory entries from symbolic links. Otherwise, only
     *  actual directories are traversed. Regardless of this setting, a given
     *  target path will only ever be walked once, meaning that a symbolic link
     *  to a previously traversed directory will never be followed.
     *
     *  Setting this imposes a slight performance penalty, because `readlink`
     *  must be called on all symbolic links encountered, in order to avoid
     *  infinite cycles.
     * @default false
     */
    follow?: boolean;
    /**
     * Only return entries where the provided function returns true.
     *
     * This will not prevent directories from being traversed, even if they do
     * not pass the filter, though it will prevent directories themselves from
     * being included in the result set.  See {@link walkFilter}
     *
     * Asynchronous functions are not supported here.
     *
     * By default, if no filter is provided, all entries and traversed
     * directories are included.
     */
    filter?: (entry: PathBase) => boolean;
    /**
     * Only traverse directories (and in the case of {@link follow} being set to
     * true, symbolic links to directories) if the provided function returns
     * true.
     *
     * This will not prevent directories from being included in the result set,
     * even if they do not pass the supplied filter function.  See {@link filter}
     * to do that.
     *
     * Asynchronous functions are not supported here.
     */
    walkFilter?: (entry: PathBase) => boolean;
}
type WalkOptionsWithFileTypesUnset = WalkOptions & {
    withFileTypes?: undefined;
};
type WalkOptionsWithFileTypesTrue = WalkOptions & {
    withFileTypes: true;
};
type WalkOptionsWithFileTypesFalse = WalkOptions & {
    withFileTypes: false;
};
/**
 * Windows implementation of {@link PathScurryBase}
 *
 * Defaults to case insensitve, uses `'\\'` to generate path strings.  Uses
 * {@link PathWin32} for Path objects.
 */
declare class PathScurryWin32 extends PathScurryBase {
    /**
     * separator for generating path strings
     */
    sep: '\\';
    constructor(cwd?: URL | string, opts?: PathScurryOpts);
    /**
     * @internal
     */
    parseRootPath(dir: string): string;
    /**
     * @internal
     */
    newRoot(fs: FSValue): PathWin32;
    /**
     * Return true if the provided path string is an absolute path
     */
    isAbsolute(p: string): boolean;
}
/**
 * {@link PathScurryBase} implementation for all posix systems other than Darwin.
 *
 * Defaults to case-sensitive matching, uses `'/'` to generate path strings.
 *
 * Uses {@link PathPosix} for Path objects.
 */
declare class PathScurryPosix extends PathScurryBase {
    /**
     * separator for generating path strings
     */
    sep: '/';
    constructor(cwd?: URL | string, opts?: PathScurryOpts);
    /**
     * @internal
     */
    parseRootPath(_dir: string): string;
    /**
     * @internal
     */
    newRoot(fs: FSValue): PathPosix;
    /**
     * Return true if the provided path string is an absolute path
     */
    isAbsolute(p: string): boolean;
}
/**
 * {@link PathScurryBase} implementation for Darwin (macOS) systems.
 *
 * Defaults to case-insensitive matching, uses `'/'` for generating path
 * strings.
 *
 * Uses {@link PathPosix} for Path objects.
 */
declare class PathScurryDarwin extends PathScurryPosix {
    constructor(cwd?: URL | string, opts?: PathScurryOpts);
}
/**
 * Default {@link PathBase} implementation for the current platform.
 *
 * {@link PathWin32} on Windows systems, {@link PathPosix} on all others.
 */
declare const Path: typeof PathWin32 | typeof PathPosix;
type Path = PathBase | InstanceType<typeof Path>;
/**
 * Default {@link PathScurryBase} implementation for the current platform.
 *
 * {@link PathScurryWin32} on Windows systems, {@link PathScurryDarwin} on
 * Darwin (macOS) systems, {@link PathScurryPosix} on all others.
 */
declare const PathScurry: typeof PathScurryWin32 | typeof PathScurryDarwin | typeof PathScurryPosix;
type PathScurry = PathScurryBase | InstanceType<typeof PathScurry>;

type MMPattern = string | RegExp | typeof GLOBSTAR;
declare const customInspect: unique symbol;
/**
 * An immutable-ish view on an array of glob parts and their parsed
 * results
 */
declare class Pattern {
    #private;
    readonly length: number;
    constructor(patternList: MMPattern[], globList: string[], index: number, platform: NodeJS.Platform);
    [customInspect](): string;
    /**
     * The first entry in the parsed list of patterns
     */
    pattern(): MMPattern;
    /**
     * true of if pattern() returns a string
     */
    isString(): boolean;
    /**
     * true of if pattern() returns GLOBSTAR
     */
    isGlobstar(): boolean;
    /**
     * true if pattern() returns a regexp
     */
    isRegExp(): boolean;
    /**
     * The /-joined set of glob parts that make up this pattern
     */
    globString(): string;
    /**
     * true if there are more pattern parts after this one
     */
    hasMore(): boolean;
    /**
     * The rest of the pattern after this part, or null if this is the end
     */
    rest(): Pattern | null;
    /**
     * true if the pattern represents a //unc/path/ on windows
     */
    isUNC(): boolean;
    /**
     * True if the pattern starts with a drive letter on Windows
     */
    isDrive(): boolean;
    /**
     * True if the pattern is rooted on an absolute path
     */
    isAbsolute(): boolean;
    /**
     * consume the root of the pattern, and return it
     */
    root(): string;
    /**
     * Check to see if the current globstar pattern is allowed to follow
     * a symbolic link.
     */
    checkFollowGlobstar(): boolean;
    /**
     * Mark that the current globstar pattern is following a symbolic link
     */
    markFollowGlobstar(): boolean;
}

/**
 * Single-use utility classes to provide functionality to the {@link Glob}
 * methods.
 *
 * @module
 */

interface GlobWalkerOpts {
    absolute?: boolean;
    allowWindowsEscape?: boolean;
    cwd?: string | URL;
    dot?: boolean;
    dotRelative?: boolean;
    follow?: boolean;
    ignore?: string | string[] | IgnoreLike;
    mark?: boolean;
    matchBase?: boolean;
    maxDepth?: number;
    nobrace?: boolean;
    nocase?: boolean;
    nodir?: boolean;
    noext?: boolean;
    noglobstar?: boolean;
    platform?: NodeJS.Platform;
    posix?: boolean;
    realpath?: boolean;
    root?: string;
    stat?: boolean;
    signal?: AbortSignal;
    windowsPathsNoEscape?: boolean;
    withFileTypes?: boolean;
    includeChildMatches?: boolean;
}
type GWOFileTypesTrue = GlobWalkerOpts & {
    withFileTypes: true;
};
type GWOFileTypesFalse = GlobWalkerOpts & {
    withFileTypes: false;
};
type GWOFileTypesUnset = GlobWalkerOpts & {
    withFileTypes?: undefined;
};
type Result$1<O extends GlobWalkerOpts> = O extends GWOFileTypesTrue ? Path : O extends GWOFileTypesFalse ? string : O extends GWOFileTypesUnset ? string : Path | string;
type MatchStream<O extends GlobWalkerOpts> = Minipass<Result$1<O>, Result$1<O>>;

interface IgnoreLike {
    ignored?: (p: Path) => boolean;
    childrenIgnored?: (p: Path) => boolean;
    add?: (ignore: string) => void;
}
/**
 * Class used to process ignored patterns
 */
declare class Ignore implements IgnoreLike {
    relative: Minimatch[];
    relativeChildren: Minimatch[];
    absolute: Minimatch[];
    absoluteChildren: Minimatch[];
    platform: NodeJS.Platform;
    mmopts: MinimatchOptions;
    constructor(ignored: string[], { nobrace, nocase, noext, noglobstar, platform, }: GlobWalkerOpts);
    add(ign: string): void;
    ignored(p: Path): boolean;
    childrenIgnored(p: Path): boolean;
}

/**
 * A `GlobOptions` object may be provided to any of the exported methods, and
 * must be provided to the `Glob` constructor.
 *
 * All options are optional, boolean, and false by default, unless otherwise
 * noted.
 *
 * All resolved options are added to the Glob object as properties.
 *
 * If you are running many `glob` operations, you can pass a Glob object as the
 * `options` argument to a subsequent operation to share the previously loaded
 * cache.
 */
interface GlobOptions {
    /**
     * Set to `true` to always receive absolute paths for
     * matched files. Set to `false` to always return relative paths.
     *
     * When this option is not set, absolute paths are returned for patterns
     * that are absolute, and otherwise paths are returned that are relative
     * to the `cwd` setting.
     *
     * This does _not_ make an extra system call to get
     * the realpath, it only does string path resolution.
     *
     * Conflicts with {@link withFileTypes}
     */
    absolute?: boolean;
    /**
     * Set to false to enable {@link windowsPathsNoEscape}
     *
     * @deprecated
     */
    allowWindowsEscape?: boolean;
    /**
     * The current working directory in which to search. Defaults to
     * `process.cwd()`.
     *
     * May be eiher a string path or a `file://` URL object or string.
     */
    cwd?: string | URL;
    /**
     * Include `.dot` files in normal matches and `globstar`
     * matches. Note that an explicit dot in a portion of the pattern
     * will always match dot files.
     */
    dot?: boolean;
    /**
     * Prepend all relative path strings with `./` (or `.\` on Windows).
     *
     * Without this option, returned relative paths are "bare", so instead of
     * returning `'./foo/bar'`, they are returned as `'foo/bar'`.
     *
     * Relative patterns starting with `'../'` are not prepended with `./`, even
     * if this option is set.
     */
    dotRelative?: boolean;
    /**
     * Follow symlinked directories when expanding `**`
     * patterns. This can result in a lot of duplicate references in
     * the presence of cyclic links, and make performance quite bad.
     *
     * By default, a `**` in a pattern will follow 1 symbolic link if
     * it is not the first item in the pattern, or none if it is the
     * first item in the pattern, following the same behavior as Bash.
     */
    follow?: boolean;
    /**
     * string or string[], or an object with `ignored` and `childrenIgnored`
     * methods.
     *
     * If a string or string[] is provided, then this is treated as a glob
     * pattern or array of glob patterns to exclude from matches. To ignore all
     * children within a directory, as well as the entry itself, append `'/**'`
     * to the ignore pattern.
     *
     * **Note** `ignore` patterns are _always_ in `dot:true` mode, regardless of
     * any other settings.
     *
     * If an object is provided that has `ignored(path)` and/or
     * `childrenIgnored(path)` methods, then these methods will be called to
     * determine whether any Path is a match or if its children should be
     * traversed, respectively.
     */
    ignore?: string | string[] | IgnoreLike;
    /**
     * Treat brace expansion like `{a,b}` as a "magic" pattern. Has no
     * effect if {@link nobrace} is set.
     *
     * Only has effect on the {@link hasMagic} function.
     */
    magicalBraces?: boolean;
    /**
     * Add a `/` character to directory matches. Note that this requires
     * additional stat calls in some cases.
     */
    mark?: boolean;
    /**
     * Perform a basename-only match if the pattern does not contain any slash
     * characters. That is, `*.js` would be treated as equivalent to
     * `**\/*.js`, matching all js files in all directories.
     */
    matchBase?: boolean;
    /**
     * Limit the directory traversal to a given depth below the cwd.
     * Note that this does NOT prevent traversal to sibling folders,
     * root patterns, and so on. It only limits the maximum folder depth
     * that the walk will descend, relative to the cwd.
     */
    maxDepth?: number;
    /**
     * Do not expand `{a,b}` and `{1..3}` brace sets.
     */
    nobrace?: boolean;
    /**
     * Perform a case-insensitive match. This defaults to `true` on macOS and
     * Windows systems, and `false` on all others.
     *
     * **Note** `nocase` should only be explicitly set when it is
     * known that the filesystem's case sensitivity differs from the
     * platform default. If set `true` on case-sensitive file
     * systems, or `false` on case-insensitive file systems, then the
     * walk may return more or less results than expected.
     */
    nocase?: boolean;
    /**
     * Do not match directories, only files. (Note: to match
     * _only_ directories, put a `/` at the end of the pattern.)
     */
    nodir?: boolean;
    /**
     * Do not match "extglob" patterns such as `+(a|b)`.
     */
    noext?: boolean;
    /**
     * Do not match `**` against multiple filenames. (Ie, treat it as a normal
     * `*` instead.)
     *
     * Conflicts with {@link matchBase}
     */
    noglobstar?: boolean;
    /**
     * Defaults to value of `process.platform` if available, or `'linux'` if
     * not. Setting `platform:'win32'` on non-Windows systems may cause strange
     * behavior.
     */
    platform?: NodeJS.Platform;
    /**
     * Set to true to call `fs.realpath` on all of the
     * results. In the case of an entry that cannot be resolved, the
     * entry is omitted. This incurs a slight performance penalty, of
     * course, because of the added system calls.
     */
    realpath?: boolean;
    /**
     *
     * A string path resolved against the `cwd` option, which
     * is used as the starting point for absolute patterns that start
     * with `/`, (but not drive letters or UNC paths on Windows).
     *
     * Note that this _doesn't_ necessarily limit the walk to the
     * `root` directory, and doesn't affect the cwd starting point for
     * non-absolute patterns. A pattern containing `..` will still be
     * able to traverse out of the root directory, if it is not an
     * actual root directory on the filesystem, and any non-absolute
     * patterns will be matched in the `cwd`. For example, the
     * pattern `/../*` with `{root:'/some/path'}` will return all
     * files in `/some`, not all files in `/some/path`. The pattern
     * `*` with `{root:'/some/path'}` will return all the entries in
     * the cwd, not the entries in `/some/path`.
     *
     * To start absolute and non-absolute patterns in the same
     * path, you can use `{root:''}`. However, be aware that on
     * Windows systems, a pattern like `x:/*` or `//host/share/*` will
     * _always_ start in the `x:/` or `//host/share` directory,
     * regardless of the `root` setting.
     */
    root?: string;
    /**
     * A [PathScurry](http://npm.im/path-scurry) object used
     * to traverse the file system. If the `nocase` option is set
     * explicitly, then any provided `scurry` object must match this
     * setting.
     */
    scurry?: PathScurry;
    /**
     * Call `lstat()` on all entries, whether required or not to determine
     * if it's a valid match. When used with {@link withFileTypes}, this means
     * that matches will include data such as modified time, permissions, and
     * so on.  Note that this will incur a performance cost due to the added
     * system calls.
     */
    stat?: boolean;
    /**
     * An AbortSignal which will cancel the Glob walk when
     * triggered.
     */
    signal?: AbortSignal;
    /**
     * Use `\\` as a path separator _only_, and
     *  _never_ as an escape character. If set, all `\\` characters are
     *  replaced with `/` in the pattern.
     *
     *  Note that this makes it **impossible** to match against paths
     *  containing literal glob pattern characters, but allows matching
     *  with patterns constructed using `path.join()` and
     *  `path.resolve()` on Windows platforms, mimicking the (buggy!)
     *  behavior of Glob v7 and before on Windows. Please use with
     *  caution, and be mindful of [the caveat below about Windows
     *  paths](#windows). (For legacy reasons, this is also set if
     *  `allowWindowsEscape` is set to the exact value `false`.)
     */
    windowsPathsNoEscape?: boolean;
    /**
     * Return [PathScurry](http://npm.im/path-scurry)
     * `Path` objects instead of strings. These are similar to a
     * NodeJS `Dirent` object, but with additional methods and
     * properties.
     *
     * Conflicts with {@link absolute}
     */
    withFileTypes?: boolean;
    /**
     * An fs implementation to override some or all of the defaults.  See
     * http://npm.im/path-scurry for details about what can be overridden.
     */
    fs?: FSOption;
    /**
     * Just passed along to Minimatch.  Note that this makes all pattern
     * matching operations slower and *extremely* noisy.
     */
    debug?: boolean;
    /**
     * Return `/` delimited paths, even on Windows.
     *
     * On posix systems, this has no effect.  But, on Windows, it means that
     * paths will be `/` delimited, and absolute paths will be their full
     * resolved UNC forms, eg instead of `'C:\\foo\\bar'`, it would return
     * `'//?/C:/foo/bar'`
     */
    posix?: boolean;
    /**
     * Do not match any children of any matches. For example, the pattern
     * `**\/foo` would match `a/foo`, but not `a/foo/b/foo` in this mode.
     *
     * This is especially useful for cases like "find all `node_modules`
     * folders, but not the ones in `node_modules`".
     *
     * In order to support this, the `Ignore` implementation must support an
     * `add(pattern: string)` method. If using the default `Ignore` class, then
     * this is fine, but if this is set to `false`, and a custom `Ignore` is
     * provided that does not have an `add()` method, then it will throw an
     * error.
     *
     * **Caveat** It *only* ignores matches that would be a descendant of a
     * previous match, and only if that descendant is matched *after* the
     * ancestor is encountered. Since the file system walk happens in
     * indeterminate order, it's possible that a match will already be added
     * before its ancestor, if multiple or braced patterns are used.
     *
     * For example:
     *
     * ```ts
     * const results = await glob([
     *   // likely to match first, since it's just a stat
     *   'a/b/c/d/e/f',
     *
     *   // this pattern is more complicated! It must to various readdir()
     *   // calls and test the results against a regular expression, and that
     *   // is certainly going to take a little bit longer.
     *   //
     *   // So, later on, it encounters a match at 'a/b/c/d/e', but it's too
     *   // late to ignore a/b/c/d/e/f, because it's already been emitted.
     *   'a/[bdf]/?/[a-z]/*',
     * ], { includeChildMatches: false })
     * ```
     *
     * It's best to only set this to `false` if you can be reasonably sure that
     * no components of the pattern will potentially match one another's file
     * system descendants, or if the occasional included child entry will not
     * cause problems.
     *
     * @default true
     */
    includeChildMatches?: boolean;
    /**
     * max number of `{...}` patterns to expand. Default `1_000`.
     *
     * Note: this is much less than minimatch's default of `100_000`,
     * because Glob has higher memory requirements due to walking
     * the file system tree.
     */
    braceExpandMax?: number;
}
type GlobOptionsWithFileTypesTrue = GlobOptions & {
    withFileTypes: true;
    absolute?: undefined;
    mark?: undefined;
    posix?: undefined;
};
type GlobOptionsWithFileTypesFalse = GlobOptions & {
    withFileTypes?: false;
};
type GlobOptionsWithFileTypesUnset = GlobOptions & {
    withFileTypes?: undefined;
};
type Result<Opts> = Opts extends GlobOptionsWithFileTypesTrue ? Path : Opts extends GlobOptionsWithFileTypesFalse ? string : Opts extends GlobOptionsWithFileTypesUnset ? string : string | Path;
type Results<Opts> = Result<Opts>[];
type FileTypes<Opts> = Opts extends GlobOptionsWithFileTypesTrue ? true : Opts extends GlobOptionsWithFileTypesFalse ? false : Opts extends GlobOptionsWithFileTypesUnset ? false : boolean;
/**
 * An object that can perform glob pattern traversals.
 */
declare class Glob<Opts extends GlobOptions> implements GlobOptions {
    absolute?: boolean;
    cwd: string;
    root?: string;
    dot: boolean;
    dotRelative: boolean;
    follow: boolean;
    ignore?: string | string[] | IgnoreLike;
    magicalBraces: boolean;
    mark?: boolean;
    matchBase: boolean;
    maxDepth: number;
    nobrace: boolean;
    nocase: boolean;
    nodir: boolean;
    noext: boolean;
    noglobstar: boolean;
    pattern: string[];
    platform: NodeJS.Platform;
    realpath: boolean;
    scurry: PathScurry;
    stat: boolean;
    signal?: AbortSignal;
    windowsPathsNoEscape: boolean;
    withFileTypes: FileTypes<Opts>;
    includeChildMatches: boolean;
    /**
     * The options provided to the constructor.
     */
    opts: Opts;
    /**
     * An array of parsed immutable {@link Pattern} objects.
     */
    patterns: Pattern[];
    /**
     * All options are stored as properties on the `Glob` object.
     *
     * See {@link GlobOptions} for full options descriptions.
     *
     * Note that a previous `Glob` object can be passed as the
     * `GlobOptions` to another `Glob` instantiation to re-use settings
     * and caches with a new pattern.
     *
     * Traversal functions can be called multiple times to run the walk
     * again.
     */
    constructor(pattern: string | string[], opts: Opts);
    /**
     * Returns a Promise that resolves to the results array.
     */
    walk(): Promise<Results<Opts>>;
    /**
     * synchronous {@link Glob.walk}
     */
    walkSync(): Results<Opts>;
    /**
     * Stream results asynchronously.
     */
    stream(): Minipass<Result<Opts>, Result<Opts>>;
    /**
     * Stream results synchronously.
     */
    streamSync(): Minipass<Result<Opts>, Result<Opts>>;
    /**
     * Default sync iteration function. Returns a Generator that
     * iterates over the results.
     */
    iterateSync(): Generator<Result<Opts>, void, void>;
    [Symbol.iterator](): Generator<Result<Opts>, void, void>;
    /**
     * Default async iteration function. Returns an AsyncGenerator that
     * iterates over the results.
     */
    iterate(): AsyncGenerator<Result<Opts>, void, void>;
    [Symbol.asyncIterator](): AsyncGenerator<Result<Opts>, void, void>;
}

/**
 * Return true if the patterns provided contain any magic glob characters,
 * given the options provided.
 *
 * Brace expansion is not considered "magic" unless the `magicalBraces` option
 * is set, as brace expansion just turns one string into an array of strings.
 * So a pattern like `'x{a,b}y'` would return `false`, because `'xay'` and
 * `'xby'` both do not contain any magic glob characters, and it's treated the
 * same as if you had called it on `['xay', 'xby']`. When `magicalBraces:true`
 * is in the options, brace expansion _is_ treated as a pattern having magic.
 */
declare const hasMagic: (pattern: string | string[], options?: GlobOptions) => boolean;

/**
 * Syncronous form of {@link globStream}. Will read all the matches as fast as
 * you consume them, even all in a single tick if you consume them immediately,
 * but will still respond to backpressure if they're not consumed immediately.
 */
declare function globStreamSync(pattern: string | string[], options: GlobOptionsWithFileTypesTrue): Minipass<Path, Path>;
declare function globStreamSync(pattern: string | string[], options: GlobOptionsWithFileTypesFalse): Minipass<string, string>;
declare function globStreamSync(pattern: string | string[], options: GlobOptionsWithFileTypesUnset): Minipass<string, string>;
declare function globStreamSync(pattern: string | string[], options: GlobOptions): Minipass<Path, Path> | Minipass<string, string>;
/**
 * Return a stream that emits all the strings or `Path` objects and
 * then emits `end` when completed.
 */
declare function globStream(pattern: string | string[], options: GlobOptionsWithFileTypesFalse): Minipass<string, string>;
declare function globStream(pattern: string | string[], options: GlobOptionsWithFileTypesTrue): Minipass<Path, Path>;
declare function globStream(pattern: string | string[], options?: GlobOptionsWithFileTypesUnset | undefined): Minipass<string, string>;
declare function globStream(pattern: string | string[], options: GlobOptions): Minipass<Path, Path> | Minipass<string, string>;
/**
 * Synchronous form of {@link glob}
 */
declare function globSync(pattern: string | string[], options: GlobOptionsWithFileTypesFalse): string[];
declare function globSync(pattern: string | string[], options: GlobOptionsWithFileTypesTrue): Path[];
declare function globSync(pattern: string | string[], options?: GlobOptionsWithFileTypesUnset | undefined): string[];
declare function globSync(pattern: string | string[], options: GlobOptions): Path[] | string[];
/**
 * Perform an asynchronous glob search for the pattern(s) specified. Returns
 * [Path](https://isaacs.github.io/path-scurry/classes/PathBase) objects if the
 * {@link withFileTypes} option is set to `true`. See {@link GlobOptions} for
 * full option descriptions.
 */
declare function glob_(pattern: string | string[], options?: GlobOptionsWithFileTypesUnset | undefined): Promise<string[]>;
declare function glob_(pattern: string | string[], options: GlobOptionsWithFileTypesTrue): Promise<Path[]>;
declare function glob_(pattern: string | string[], options: GlobOptionsWithFileTypesFalse): Promise<string[]>;
declare function glob_(pattern: string | string[], options: GlobOptions): Promise<Path[] | string[]>;
/**
 * Return a sync iterator for walking glob pattern matches.
 */
declare function globIterateSync(pattern: string | string[], options?: GlobOptionsWithFileTypesUnset | undefined): Generator<string, void, void>;
declare function globIterateSync(pattern: string | string[], options: GlobOptionsWithFileTypesTrue): Generator<Path, void, void>;
declare function globIterateSync(pattern: string | string[], options: GlobOptionsWithFileTypesFalse): Generator<string, void, void>;
declare function globIterateSync(pattern: string | string[], options: GlobOptions): Generator<Path, void, void> | Generator<string, void, void>;
/**
 * Return an async iterator for walking glob pattern matches.
 */
declare function globIterate(pattern: string | string[], options?: GlobOptionsWithFileTypesUnset | undefined): AsyncGenerator<string, void, void>;
declare function globIterate(pattern: string | string[], options: GlobOptionsWithFileTypesTrue): AsyncGenerator<Path, void, void>;
declare function globIterate(pattern: string | string[], options: GlobOptionsWithFileTypesFalse): AsyncGenerator<string, void, void>;
declare function globIterate(pattern: string | string[], options: GlobOptions): AsyncGenerator<Path, void, void> | AsyncGenerator<string, void, void>;
declare const streamSync: typeof globStreamSync;
declare const stream: typeof globStream & {
    sync: typeof globStreamSync;
};
declare const iterateSync: typeof globIterateSync;
declare const iterate: typeof globIterate & {
    sync: typeof globIterateSync;
};
declare const sync: typeof globSync & {
    stream: typeof globStreamSync;
    iterate: typeof globIterateSync;
};
declare const glob: typeof glob_ & {
    glob: typeof glob_;
    globSync: typeof globSync;
    sync: typeof globSync & {
        stream: typeof globStreamSync;
        iterate: typeof globIterateSync;
    };
    globStream: typeof globStream;
    stream: typeof globStream & {
        sync: typeof globStreamSync;
    };
    globStreamSync: typeof globStreamSync;
    streamSync: typeof globStreamSync;
    globIterate: typeof globIterate;
    iterate: typeof globIterate & {
        sync: typeof globIterateSync;
    };
    globIterateSync: typeof globIterateSync;
    iterateSync: typeof globIterateSync;
    Glob: typeof Glob;
    hasMagic: (pattern: string | string[], options?: GlobOptions) => boolean;
    escape: (s: string, { windowsPathsNoEscape, magicalBraces, }?: Pick<MinimatchOptions, "windowsPathsNoEscape" | "magicalBraces">) => string;
    unescape: (s: string, { windowsPathsNoEscape, magicalBraces, }?: Pick<MinimatchOptions, "windowsPathsNoEscape" | "magicalBraces">) => string;
};

export { Glob, Ignore, Path, escape, glob, globIterate, globIterateSync, globStream, globStreamSync, globSync, hasMagic, iterate, iterateSync, stream, streamSync, sync, unescape };
export type { FSOption, GlobOptions, GlobOptionsWithFileTypesFalse, GlobOptionsWithFileTypesTrue, GlobOptionsWithFileTypesUnset, IgnoreLike, MatchStream, WalkOptions, WalkOptionsWithFileTypesTrue, WalkOptionsWithFileTypesUnset };
