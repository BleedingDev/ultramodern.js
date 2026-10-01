import { Duplex, Readable, Writable } from 'node:stream';
import { TransformStream, ReadableStream, WritableStream, ReadableWritablePair } from 'node:stream/web';
import { SignalConstants } from 'node:os';
import { ChildProcess } from 'node:child_process';

type Not<Value extends boolean> = Value extends true ? false : true;

type And<First extends boolean, Second extends boolean> = First extends true ? Second : false;

type Unless<Condition extends boolean, ThenValue, ElseValue = never> = Condition extends true ? ElseValue : ThenValue;

type AndUnless<Condition extends boolean, ThenValue, ElseValue = unknown> = Condition extends true ? ElseValue : ThenValue;

// Whether any of T's union element is the same as one of U's union element.
// `&` does not work here.
type Intersects<T, U> = true extends (T extends U ? true : false) ? true : false;

// `options.std*: Generator`
// The `chunk` argument's type is based on the transform's mode:
// - `binary: true` or binary `encoding`, with `objectMode: true` -> `unknown` for stdin, `Uint8Array` for stdout/stderr
// - `binary: true` or binary `encoding` -> `Uint8Array`
// - `objectMode: true` -> `unknown` for stdin, `string` for stdout/stderr
// - otherwise -> `string`
// The return type is kept as `unknown` since a transform can always yield either a `string` or an `Uint8Array`.
// See https://github.com/sindresorhus/execa/issues/694
type GeneratorTransform<IsSync extends boolean, Chunk = string> = (chunk: Chunk) =>
	| Unless<IsSync, AsyncGenerator<unknown, void, void>>
	| Generator<unknown, void, void>;
type GeneratorTransformReturn<IsSync extends boolean> = ReturnType<GeneratorTransform<IsSync>>;
type GeneratorFinal<IsSync extends boolean> = () =>
	| Unless<IsSync, AsyncGenerator<unknown, void, void>>
	| Generator<unknown, void, void>;

type TransformCommon = {
	/**
	If `true`, allow `transformOptions.transform` and `transformOptions.final` to return any type, not just `string` or `Uint8Array`.
	*/
	readonly objectMode?: boolean;
};

// A `GeneratorTransformFull` shape whose `transform` narrows the `chunk` argument to `Chunk`.
// The mode-independent documentation lives here.
type GeneratorTransformBase<IsSync extends boolean, Chunk> = TransformCommon & {
	/**
	Map or filter the input or output of the subprocess.
	*/
	readonly transform: GeneratorTransform<IsSync, Chunk>;

	/**
	Create additional lines after the last one.
	*/
	readonly final?: GeneratorFinal<IsSync>;

	/**
	If `true`, iterate over arbitrary chunks of `Uint8Array`s instead of line `string`s.
	*/
	readonly binary?: boolean;

	/**
	If `true`, keep newlines in each `line` argument. Also, this allows multiple `yield`s to produce a single line.
	*/
	readonly preserveNewlines?: boolean;
};

// For stdout/stderr, this literal option pair accepts explicitly typed `Uint8Array` callbacks, matching runtime binary chunks, while still allowing stdin-style `unknown` object-mode callbacks.
type GeneratorTransformBinaryObjectMode<IsSync extends boolean, ObjectModeChunk> = ObjectModeChunk extends string
	? Omit<GeneratorTransformBase<IsSync, unknown>, 'transform' | 'objectMode' | 'binary'> & {
		/**
		Map or filter the input or output of the subprocess.
		*/
		transform(chunk: Uint8Array): GeneratorTransformReturn<IsSync>;
		// eslint-disable-next-line @typescript-eslint/unified-signatures -- Combining these as `unknown | Uint8Array` would collapse to `unknown` and reject explicitly typed `Uint8Array` callbacks.
		transform(chunk: unknown): GeneratorTransformReturn<IsSync>;

		readonly objectMode: true;
		readonly binary: true;
	}
	: GeneratorTransformBase<IsSync, unknown> & {readonly objectMode: true; readonly binary: true};

/**
A transform or an array of transforms can be passed to the `stdin`, `stdout`, `stderr` or `stdio` option.

A transform is either a generator function or a plain object with the following members.
*/
type GeneratorTransformFull<IsSync extends boolean, ObjectModeChunk = unknown, TransformChunk = string> =
	// Non-literal `binary` or `objectMode` values are accepted at runtime, but their mode is unknown at compile time.
	| (GeneratorTransformBase<IsSync, unknown> & {readonly objectMode?: boolean; readonly binary?: boolean})
	// `binary: true` without `objectMode` -> the `chunk` argument is an `Uint8Array`.
	| (GeneratorTransformBase<IsSync, Uint8Array> & {readonly objectMode?: false; readonly binary: true})
	// `binary: true` with `objectMode` -> the `chunk` argument is `unknown` for stdin, `Uint8Array` for stdout/stderr.
	| GeneratorTransformBinaryObjectMode<IsSync, ObjectModeChunk>
	// `binary: false` without `objectMode` -> the `chunk` argument depends on the subprocess encoding.
	| (GeneratorTransformBase<IsSync, TransformChunk> & {readonly objectMode?: false; readonly binary?: false})
	// `objectMode: true` with `binary: false` -> the `chunk` argument depends on the stdio direction.
	| (GeneratorTransformBase<IsSync, ObjectModeChunk> & {readonly objectMode: true; readonly binary?: false});

// `options.std*: Duplex`
type DuplexTransform = TransformCommon & {
	readonly transform: Duplex;
};

// `options.std*: TransformStream`
type WebTransform = TransformCommon & {
	readonly transform: TransformStream;
};

type IsStandardStream<FdNumber extends string> = FdNumber extends keyof StandardStreams ? true : false;

type StandardStreams = readonly ['stdin', 'stdout', 'stderr'];

// When `options.stdin|stdout|stderr|stdio` is set to one of those values, no stream is created
type NoStreamStdioOption<FdNumber extends string> =
	| 'ignore'
	| 'inherit'
	| number
	| Readable
	| Writable
	| Unless<IsStandardStream<FdNumber>, undefined>
	| readonly [NoStreamStdioOption<FdNumber>]
	| {readonly value: 'inherit' | number; readonly input?: boolean};

// `options.stdio` when it is not an array
type SimpleStdioOption<
	IsSync extends boolean,
	IsExtra extends boolean,
	IsArray extends boolean,
> =
	| undefined
	| 'pipe'
	| Unless<And<And<Not<IsSync>, IsArray>, IsExtra>, 'inherit'>
	| Unless<IsArray, 'ignore'>
	| Unless<IsSync, 'overlapped'>;

// The `{value, input}` object form wraps a direction-ambiguous value and sets its direction explicitly.
type AmbiguousStdioOption<
	IsSync extends boolean,
	IsExtra extends boolean,
	IsArray extends boolean,
	ObjectModeChunk = unknown,
	TransformChunk = string,
> = {
	readonly value: AmbiguousStdioValue<IsSync, IsArray, ObjectModeChunk, TransformChunk>;
	readonly input?: Unless<And<IsSync, IsExtra>, boolean> | false;
};

// Values whose direction is ambiguous on additional file descriptors, so they default to output unless `input` is set.
// This excludes values with a fixed direction (readable/writable streams, iterables, standard file descriptors).
type AmbiguousStdioValue<
	IsSync extends boolean,
	IsArray extends boolean,
	ObjectModeChunk,
	TransformChunk,
> =
	| 'pipe'
	| 'inherit'
	| Unless<IsSync, 'overlapped'>
	| URL
	| GeneratorTransform<IsSync, TransformChunk>
	| GeneratorTransformFull<IsSync, ObjectModeChunk, TransformChunk>
	| Unless<And<Not<IsSync>, IsArray>, 3 | 4 | 5 | 6 | 7 | 8 | 9>
	| Unless<IsSync, DuplexTransform | WebTransform | TransformStream>
	| {readonly file: string; readonly append?: boolean};

// Values available in both `options.stdin|stdio` and `options.stdout|stderr|stdio`
type CommonStdioOption<
	IsSync extends boolean,
	IsExtra extends boolean,
	IsArray extends boolean,
	ObjectModeChunk = unknown,
	TransformChunk = string,
> =
	// TypeScript cannot contextually type inline full generator transform objects through this broad stdio union because the union also includes `{transform: Duplex | TransformStream}` wrapper objects. Users should annotate `chunk` when assigning an inline object directly to `StdinOption`, `StdoutStderrOption`, `Options['stdout']`, etc. Keep `GeneratorTransformFull` mode branches narrow, but do not add a broad full-object fallback here to try to recover contextual typing.
	SimpleStdioOption<IsSync, IsExtra, IsArray> | URL | GeneratorTransform<IsSync, TransformChunk> | GeneratorTransformFull<IsSync, ObjectModeChunk, TransformChunk> | Unless<And<Not<IsSync>, IsArray>, 3 | 4 | 5 | 6 | 7 | 8 | 9> | Unless<IsSync, DuplexTransform | WebTransform | TransformStream> | AmbiguousStdioOption<IsSync, IsExtra, IsArray, ObjectModeChunk, TransformChunk> | {readonly file: string; readonly append?: boolean};

// Synchronous iterables excluding strings, Uint8Arrays and Arrays
type IterableObject<IsArray extends boolean> = Iterable<unknown>
	& object
	& AndUnless<IsArray, {readonly lastIndexOf?: never}>
	& {readonly BYTES_PER_ELEMENT?: never};

// `process.stdin|stdout|stderr` are `Duplex` with a `fd` property.
// This ensures they can only be passed to `stdin`/`stdout`/`stderr`, based on their direction.
type ProcessStdinFd = {readonly fd?: 0};
type ProcessStdoutStderrFd = {readonly fd?: 1 | 2};

// Values available only in `options.stdin|stdio`
type InputStdioOption<
	IsSync extends boolean = boolean,
	IsExtra extends boolean = boolean,
	IsArray extends boolean = boolean,
> =
	| 0
	| Unless<And<IsSync, IsExtra>, Uint8Array | IterableObject<IsArray>>
	| Unless<And<IsSync, IsArray>, Readable & ProcessStdinFd>
	| Unless<IsSync, (AsyncIterable<unknown> & ProcessStdinFd) | ReadableStream>;

// Values available only in `options.stdout|stderr|stdio`
type OutputStdioOption<
	IsSync extends boolean,
	IsArray extends boolean,
> =
	| 1
	| 2
	| Unless<And<IsSync, IsArray>, Writable & ProcessStdoutStderrFd>
	| Unless<IsSync, WritableStream>;

// `options.stdin` array items
type StdinSingleOption<
	IsSync extends boolean,
	IsExtra extends boolean,
	IsArray extends boolean,
	TransformChunk = string,
> =
	| CommonStdioOption<IsSync, IsExtra, IsArray, unknown, TransformChunk>
	| InputStdioOption<IsSync, IsExtra, IsArray>;

// `options.stdin`
type StdinOptionCommon<
	IsSync extends boolean = boolean,
	IsExtra extends boolean = boolean,
	TransformChunk = string,
> = TransformChunk extends unknown
	? | StdinSingleOption<IsSync, IsExtra, false, TransformChunk>
	| ReadonlyArray<StdinSingleOption<IsSync, IsExtra, true, TransformChunk>>
	: never;

// `options.stdin`, async
type StdinOption = StdinOptionCommon<false, false>;
// `options.stdin`, sync
type StdinSyncOption = StdinOptionCommon<true, false>;

// `options.stdout|stderr` array items
type StdoutStderrSingleOption<
	IsSync extends boolean,
	IsExtra extends boolean,
	IsArray extends boolean,
	TransformChunk = string,
> =
	| CommonStdioOption<IsSync, IsExtra, IsArray, TransformChunk, TransformChunk>
	| OutputStdioOption<IsSync, IsArray>;

// `options.stdout|stderr`
// In `objectMode`, the `chunk` argument of every array item is typed as `string`, even though only the first transform in the pipeline receives subprocess lines. The array index cannot be used to infer the pipeline position, since non-transform items are filtered out and transforms are reordered at runtime.
type StdoutStderrOptionCommon<
	IsSync extends boolean = boolean,
	IsExtra extends boolean = boolean,
	TransformChunk = string,
> = TransformChunk extends unknown
	? | StdoutStderrSingleOption<IsSync, IsExtra, false, TransformChunk>
	| ReadonlyArray<StdoutStderrSingleOption<IsSync, IsExtra, true, TransformChunk>>
	: never;

// `options.stdout|stderr`, async
type StdoutStderrOption = StdoutStderrOptionCommon<false, false>;
// `options.stdout|stderr`, sync
type StdoutStderrSyncOption = StdoutStderrOptionCommon<true, false>;

// `options.stdio[3+]`
type StdioExtraOptionCommon<IsSync extends boolean, TransformChunk = string> =
	| StdinOptionCommon<IsSync, true, TransformChunk>
	| StdoutStderrOptionCommon<IsSync, true, TransformChunk>;

// `options.stdin|stdout|stderr|stdio` array items
type StdioSingleOption<
	IsSync extends boolean = boolean,
	IsExtra extends boolean = boolean,
	IsArray extends boolean = boolean,
	TransformChunk = string,
> =
	| StdinSingleOption<IsSync, IsExtra, IsArray, TransformChunk>
	| StdoutStderrSingleOption<IsSync, IsExtra, IsArray, TransformChunk>;

// Get `options.stdin|stdout|stderr|stdio` items if it is an array, else keep as is
type StdioSingleOptionItems<StdioOptionType> = StdioOptionType extends readonly StdioSingleOption[]
	? StdioOptionType[number]
	: StdioOptionType;

// `options.stdin|stdout|stderr|stdio`
type StdioOptionCommon<IsSync extends boolean = boolean, TransformChunk = string> =
	| StdinOptionCommon<IsSync, boolean, TransformChunk>
	| StdoutStderrOptionCommon<IsSync, boolean, TransformChunk>;

// `options.stdio` when it is an array
type StdioOptionsArray<IsSync extends boolean = boolean, TransformChunk = string> = readonly [
	StdinOptionCommon<IsSync, false, TransformChunk>,
	StdoutStderrOptionCommon<IsSync, false, TransformChunk>,
	StdoutStderrOptionCommon<IsSync, false, TransformChunk>,
	...ReadonlyArray<StdioExtraOptionCommon<IsSync, TransformChunk>>,
];

// `options.stdio`
type StdioOptionsProperty<IsSync extends boolean = boolean, TransformChunk = string> = TransformChunk extends unknown
	? | SimpleStdioOption<IsSync, false, false>
	| StdioOptionsArray<IsSync, TransformChunk>
	: never;

// Message when the `serialization` option is `'advanced'`
type AdvancedMessage =
	| string
	| number
	| boolean
	| null
	| object;

// Message when the `serialization` option is `'json'`
type JsonMessage =
	| string
	| number
	| boolean
	| null
	| readonly JsonMessage[]
	| {readonly [key: string | number]: JsonMessage};

/**
Type of messages exchanged between a process and its subprocess using `sendMessage()`, `getOneMessage()` and `getEachMessage()`.

This requires the `ipc` option to be `true`. The type of `message` depends on the `serialization` option.
*/
type Message<
	Serialization extends Options['serialization'] = Options['serialization'],
> = Serialization extends 'json' ? JsonMessage : AdvancedMessage;

/**
Options to `sendMessage()` and `subprocess.sendMessage()`
*/
type SendMessageOptions = {
	/**
	Throw when the other process is not receiving or listening to messages.

	@default false
	*/
	readonly strict?: boolean;
};

// IPC methods in subprocess
/**
Send a `message` to the parent process.

This requires the `ipc` option to be `true`. The type of `message` depends on the `serialization` option.
*/
declare function sendMessage(message: Message, sendMessageOptions?: SendMessageOptions): Promise<void>;

/**
Options to `getOneMessage()` and `subprocess.getOneMessage()`
*/
type GetOneMessageOptions<
	Serialization extends Options['serialization'],
> = {
	/**
	Ignore any `message` that returns `false`.
	*/
	readonly filter?: (message: Message<Serialization>) => boolean;

	/**
	Keep the subprocess alive while `getOneMessage()` is waiting.

	@default true
	*/
	readonly reference?: boolean;
};

/**
Receive a single `message` from the parent process.

This requires the `ipc` option to be `true`. The type of `message` depends on the `serialization` option.
*/
declare function getOneMessage(getOneMessageOptions?: GetOneMessageOptions<Options['serialization']>): Promise<Message>;

/**
Options to `getEachMessage()` and `subprocess.getEachMessage()`
*/
type GetEachMessageOptions = {
	/**
	Keep the subprocess alive while `getEachMessage()` is waiting.

	@default true
	*/
	readonly reference?: boolean;
};

/**
Iterate over each `message` from the parent process.

This requires the `ipc` option to be `true`. The type of `message` depends on the `serialization` option.
*/
declare function getEachMessage(getEachMessageOptions?: GetEachMessageOptions): AsyncIterableIterator<Message>;

/**
Retrieves the [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal) shared by the `cancelSignal` option.

This can only be called inside a subprocess. This requires the `gracefulCancel` option to be `true`.
*/
declare function getCancelSignal(): Promise<AbortSignal>;

// IPC methods in the subprocess
type IpcMethods<
	IpcEnabled extends boolean,
	Serialization extends Options['serialization'],
> = IpcEnabled extends true
	? {
		/**
		Send a `message` to the subprocess.

		This requires the `ipc` option to be `true`. The type of `message` depends on the `serialization` option.
		*/
		sendMessage(message: Message<Serialization>, sendMessageOptions?: SendMessageOptions): Promise<void>;

		/**
		Receive a single `message` from the subprocess.

		This requires the `ipc` option to be `true`. The type of `message` depends on the `serialization` option.
		*/
		getOneMessage(getOneMessageOptions?: GetOneMessageOptions<Serialization>): Promise<Message<Serialization>>;

		/**
		Iterate over each `message` from the subprocess.

		This requires the `ipc` option to be `true`. The type of `message` depends on the `serialization` option.
		*/
		getEachMessage(getEachMessageOptions?: GetEachMessageOptions): AsyncIterableIterator<Message<Serialization>>;
	}
	// Those methods only work if the `ipc` option is `true`.
	// At runtime, they are actually defined, in order to provide with a nice error message.
	// At type check time, they are typed as `undefined` to prevent calling them.
	: {
		sendMessage: undefined;
		getOneMessage: undefined;
		getEachMessage: undefined;
	};

// Whether IPC is enabled, based on the `ipc`, `ipcInput` and `gracefulCancel` options
type HasIpc<OptionsType extends Options> = HasIpcOption<
	OptionsType['ipc'],
	'ipcInput' extends keyof OptionsType ? OptionsType['ipcInput'] : undefined,
	'gracefulCancel' extends keyof OptionsType ? OptionsType['gracefulCancel'] : undefined
>;

type HasIpcOption<
	IpcOption extends Options['ipc'],
	IpcInputOption extends Options['ipcInput'],
	GracefulCancelOption extends Options['gracefulCancel'],
> = IpcOption extends true
	? true
	: IpcOption extends false
		? false
		: IpcInputOption extends undefined
			? GracefulCancelOption extends true
				? true
				: false
			: true;

type FileDescriptorOption = `fd${number}`;

// `from` option of `subprocess.readable|duplex|iterable|pipe()`
// Also used by fd-specific options
type FromOption = 'stdout' | 'stderr' | 'all' | FileDescriptorOption;

// `to` option of `subprocess.writable|duplex|pipe()`
type ToOption = 'stdin' | FileDescriptorOption;

// Options which can be fd-specific like `{verbose: {stdout: 'none', stderr: 'full'}}`
type FdGenericOption<OptionType> = OptionType | GenericOptionObject<OptionType>;

type GenericOptionObject<OptionType> = Readonly<Partial<Record<GenericFromOption, OptionType>>>;

type GenericFromOption = FromOption | 'ipc';

// Retrieve fd-specific option's value
type FdSpecificOption<
	GenericOption extends FdGenericOption<unknown>,
	FdNumber extends string,
> = GenericOption extends GenericOptionObject<unknown>
	? FdSpecificObjectOption<GenericOption, FdNumber>
	: GenericOption;

type FdSpecificObjectOption<
	GenericOption extends GenericOptionObject<unknown>,
	FdNumber extends string,
> = keyof GenericOption extends GenericFromOption
	? FdNumberToFromOption<FdNumber, keyof GenericOption> extends never
		? undefined
		: GenericOption[FdNumberToFromOption<FdNumber, keyof GenericOption>]
	: GenericOption;

type FdNumberToFromOption<
	FdNumber extends string,
	GenericOptionKeys extends GenericFromOption,
> = FdNumber extends 'ipc'
	? 'ipc' extends GenericOptionKeys
		? 'ipc'
		: never
	: FdNumber extends '1'
		? 'stdout' extends GenericOptionKeys
			? 'stdout'
			: 'fd1' extends GenericOptionKeys
				? 'fd1'
				: 'all' extends GenericOptionKeys
					? 'all'
					: never
		: FdNumber extends '2'
			? 'stderr' extends GenericOptionKeys
				? 'stderr'
				: 'fd2' extends GenericOptionKeys
					? 'fd2'
					: 'all' extends GenericOptionKeys
						? 'all'
						: never
			: `fd${FdNumber}` extends GenericOptionKeys
				? `fd${FdNumber}`
				: never;

declare abstract class CommonError<
	IsSync extends boolean,
	OptionsType extends CommonOptions,
> extends CommonResult<IsSync, OptionsType> {
	message: CommonErrorProperty<IsSync, OptionsType, 'message'>;
	shortMessage: CommonErrorProperty<IsSync, OptionsType, 'shortMessage'>;
	originalMessage: CommonErrorProperty<IsSync, OptionsType, 'originalMessage'>;
	readonly name: CommonErrorProperty<IsSync, OptionsType, 'name'>;
	stack: CommonErrorProperty<IsSync, OptionsType, 'stack'>;
}

type CommonErrorProperty<
	IsSync extends boolean,
	OptionsType extends CommonOptions,
	PropertyName extends keyof CommonResult<IsSync, OptionsType>,
> = NonNullable<CommonResult<IsSync, OptionsType>[PropertyName]>;

// `result.*` defined only on failure, i.e. on `error.*`
type ErrorProperties =
	| 'name'
	| 'message'
	| 'stack'
	| 'cause'
	| 'shortMessage'
	| 'originalMessage'
	| 'code';

/**
Result of a subprocess failed execution.

This error is thrown as an exception. If the `reject` option is false, it is returned instead.

This has the same shape as successful results, with a few additional properties.
*/
declare class ExecaError<OptionsType extends Options = Options> extends CommonError<false, OptionsType> {
	readonly name: 'ExecaError';
}

/**
Result of a subprocess failed execution.

This error is thrown as an exception. If the `reject` option is false, it is returned instead.

This has the same shape as successful results, with a few additional properties.
*/
declare class ExecaSyncError<OptionsType extends SyncOptions = SyncOptions> extends CommonError<true, OptionsType> {
	readonly name: 'ExecaSyncError';
}

// `options.stdio`, normalized as an array
type StdioOptionNormalizedArray<OptionsType extends CommonOptions> = StdioOptionNormalized<OptionsType['stdio']>;

type StdioOptionNormalized<StdioOption extends CommonOptions['stdio']> = StdioOption extends StdioOptionsArray
	? StdioOption
	: StdioOption extends StdinOptionCommon
		? StdioOption extends StdoutStderrOptionCommon
			? readonly [StdioOption, StdioOption, StdioOption]
			: DefaultStdioOption
		: DefaultStdioOption;

// `options.stdio` default value
type DefaultStdioOption = readonly ['pipe', 'pipe', 'pipe'];

// `options.stdin|stdout|stderr|stdio` for a given file descriptor
type FdStdioOption<
	FdNumber extends string,
	OptionsType extends CommonOptions,
> = FdStdioOptionProperty<FdNumber, OptionsType>;

type FdStdioOptionProperty<
	FdNumber extends string,
	OptionsType extends CommonOptions,
> = string extends FdNumber ? StdioOptionCommon
	: FdNumber extends keyof StandardStreams
		? StandardStreams[FdNumber] extends keyof OptionsType
			? OptionsType[StandardStreams[FdNumber]] extends undefined
				? FdStdioArrayOption<FdNumber, OptionsType>
				: OptionsType[StandardStreams[FdNumber]]
			: FdStdioArrayOption<FdNumber, OptionsType>
		: FdStdioArrayOption<FdNumber, OptionsType>;

// `options.stdio[FdNumber]`, excluding `options.stdin|stdout|stderr`
type FdStdioArrayOption<
	FdNumber extends string,
	OptionsType extends CommonOptions,
> = FdStdioArrayOptionProperty<FdNumber, StdioOptionNormalizedArray<OptionsType>>;

type FdStdioArrayOptionProperty<
	FdNumber extends string,
	StdioOptionsType,
> = string extends FdNumber
	? StdioOptionCommon | undefined
	: StdioOptionsType extends StdioOptionsArray
		? FdNumber extends keyof StdioOptionsType
			? StdioOptionsType[FdNumber]
			: StdioOptionNormalizedArray<CommonOptions> extends StdioOptionsType
				? StdioOptionsType[number]
				: undefined
		: undefined;

// Whether a file descriptor is in object mode
// I.e. whether `result.stdout|stderr|stdio|all` is an array of `unknown` due to `objectMode: true`
type IsObjectFd<
	FdNumber extends string,
	OptionsType extends CommonOptions,
> = IsObjectStdioOption<FdStdioOption<FdNumber, OptionsType>>;

type IsObjectStdioOption<StdioOptionType> = IsObjectStdioSingleOption<StdioSingleOptionItems<StdioOptionType>>;

type IsObjectStdioSingleOption<StdioSingleOptionType> = StdioSingleOptionType extends TransformCommon
	? BooleanObjectMode<StdioSingleOptionType['objectMode']>
	: StdioSingleOptionType extends DuplexTransform
		? StdioSingleOptionType['transform']['readableObjectMode']
		: false;

type BooleanObjectMode<ObjectModeOption extends boolean | undefined> = ObjectModeOption extends true ? true : false;

type AnyAmbiguousStdioOption = AmbiguousStdioOption<boolean, false, boolean>;

type InputAmbiguousStdioOption = AnyAmbiguousStdioOption & {
	readonly input: true;
};

type AmbiguousStdioInputValue<StdioOptionType> = StdioOptionType extends AnyAmbiguousStdioOption
	? AmbiguousStdioInputProperty<StdioOptionType>
	: never;

type AmbiguousStdioInputProperty<StdioOptionType> = 'input' extends keyof StdioOptionType
	? StdioOptionType extends {readonly input?: infer Input} ? Input : never
	: never;

// Whether `result.stdio[FdNumber]` is an input stream
type IsInputFd<
	FdNumber extends string,
	OptionsType extends CommonOptions,
> = FdNumber extends '0'
	? true
	: IsInputFdOption<
		FdNumber,
		StdioSingleOptionItems<FdStdioArrayOption<FdNumber, OptionsType>>
	>;

type IsInputFdOption<
	FdNumber extends string,
	StdioOptionType,
> = Intersects<
	StdioOptionType,
	FdNumber extends '1' | '2' ? InputStdioOption : InputStdioOption | InputAmbiguousStdioOption
> extends true
	? true
	: FdNumber extends '1' | '2'
		? false
		: true extends AmbiguousStdioInputValue<StdioOptionType>
			? boolean
			: false;

// Whether `result.stdin|stdout|stderr|all|stdio[*]` is `undefined`
type IgnoresResultOutput<
	FdNumber extends string,
	OptionsType extends CommonOptions,
> = FdSpecificOption<OptionsType['buffer'], FdNumber> extends false
	? true
	: IgnoresResultOutputDirection<IsInputFd<FdNumber, OptionsType>, FdNumber, OptionsType>;

type IgnoresResultOutputDirection<
	IsInput extends boolean,
	FdNumber extends string,
	OptionsType extends CommonOptions,
> = IsInput extends true ? true : IgnoresSubprocessOutput<FdNumber, OptionsType>;

// Whether `subprocess.stdout|stderr|all` is `undefined|null`
type IgnoresSubprocessOutput<
	FdNumber extends string,
	OptionsType extends CommonOptions,
> = IgnoresOutput<FdNumber, FdStdioOption<FdNumber, OptionsType>>;

type IgnoresOutput<
	FdNumber extends string,
	StdioOptionType,
> = StdioOptionType extends NoStreamStdioOption<FdNumber> ? true : false;

type DefaultEncodingOption = 'utf8';
type TextEncodingOption =
	| DefaultEncodingOption
	| 'utf16le';

type BufferEncodingOption = 'buffer';
type BinaryEncodingOption =
	| BufferEncodingOption
	| 'hex'
	| 'base64'
	| 'base64url'
	| 'latin1'
	| 'ascii';

// `options.encoding`
type EncodingOption =
	| TextEncodingOption
	| BinaryEncodingOption
	| undefined;

// `result.stdout|stderr|stdio`
type ResultStdioNotAll<
	FdNumber extends string,
	OptionsType extends CommonOptions,
> = ResultStdio<FdNumber, FdNumber, FdNumber, OptionsType>;

// `result.stdout|stderr|stdio|all`
type ResultStdio<
	MainFdNumber extends string,
	ObjectFdNumber extends string,
	LinesFdNumber extends string,
	OptionsType extends CommonOptions,
> = ResultStdioProperty<
	ObjectFdNumber,
	LinesFdNumber,
	IgnoresResultOutput<MainFdNumber, OptionsType>,
	OptionsType
>;

type ResultStdioProperty<
	ObjectFdNumber extends string,
	LinesFdNumber extends string,
	StreamOutputIgnored,
	OptionsType extends CommonOptions,
> = StreamOutputIgnored extends true
	? undefined
	: ResultStdioItem<
		IsObjectFd<ObjectFdNumber, OptionsType>,
		FdSpecificOption<OptionsType['lines'], LinesFdNumber>,
		OptionsType['encoding']
	>;

type ResultStdioItem<
	IsObjectResult,
	LinesOption extends boolean | undefined,
	Encoding extends CommonOptions['encoding'],
> = IsObjectResult extends true ? unknown[]
	: Encoding extends BufferEncodingOption
		? Uint8Array
		: LinesOption extends true
			? Encoding extends BinaryEncodingOption
				? string
				: string[]
			: string;

// `result.all`
type ResultAll<OptionsType extends CommonOptions> =
	ResultAllProperty<OptionsType['all'], OptionsType>;

type ResultAllProperty<
	AllOption extends CommonOptions['all'],
	OptionsType extends CommonOptions,
> = AllOption extends true
	? ResultStdio<
		AllMainFd<OptionsType>,
		AllObjectFd<OptionsType>,
		AllLinesFd<OptionsType>,
		OptionsType
	>
	: undefined;

type AllMainFd<OptionsType extends CommonOptions> =
	IgnoresResultOutput<'1', OptionsType> extends true ? '2' : '1';

type AllObjectFd<OptionsType extends CommonOptions> =
	IsObjectFd<'1', OptionsType> extends true ? '1' : '2';

type AllLinesFd<OptionsType extends CommonOptions> =
	FdSpecificOption<OptionsType['lines'], '1'> extends true ? '1' : '2';

// `result.stdio`
type ResultStdioArray<OptionsType extends CommonOptions> =
	MapResultStdio<StdioOptionNormalizedArray<OptionsType>, OptionsType>;

type MapResultStdio<
	StdioOptionsArrayType,
	OptionsType extends CommonOptions,
> = {
	-readonly [FdNumber in keyof StdioOptionsArrayType]: ResultStdioNotAll<
		FdNumber extends string ? FdNumber : string,
		OptionsType
	>
};

// `result.ipcOutput`
// This is empty unless the `ipc` option is `true`.
// Also, this is empty if the `buffer` option is `false`.
type ResultIpcOutput<
	IsSync,
	OptionsType extends CommonOptions,
> = IsSync extends true
	? []
	: ResultIpcAsync<
		FdSpecificOption<OptionsType['buffer'], 'ipc'>,
		HasIpc<StricterOptions<OptionsType, Options>>,
		OptionsType['serialization']
	>;

type ResultIpcAsync<
	BufferOption extends boolean | undefined,
	IpcEnabled extends boolean,
	SerializationOption extends CommonOptions['serialization'],
> = BufferOption extends false
	? []
	: IpcEnabled extends true
		? Array<Message<SerializationOption>>
		: [];

declare abstract class CommonResult<
	IsSync extends boolean,
	OptionsType extends CommonOptions,
> {
	/**
	The output of the subprocess on [`stdout`](https://en.wikipedia.org/wiki/Standard_streams#Standard_output_(stdout)).

	This is `undefined` if the `stdout` option is set to only `'inherit'`, `'ignore'`, `Writable` or `integer`, or if the `buffer` option is `false`.

	This is an array if the `lines` option is `true`, or if the `stdout` option is a transform in object mode.
	*/
	stdout: ResultStdioNotAll<'1', OptionsType>;

	/**
	The output of the subprocess on [`stderr`](https://en.wikipedia.org/wiki/Standard_streams#Standard_error_(stderr)).

	This is `undefined` if the `stderr` option is set to only `'inherit'`, `'ignore'`, `Writable` or `integer`, or if the `buffer` option is `false`.

	This is an array if the `lines` option is `true`, or if the `stderr` option is a transform in object mode.
	*/
	stderr: ResultStdioNotAll<'2', OptionsType>;

	/**
	The output of the subprocess with `result.stdout` and `result.stderr` interleaved.

	This requires the `all` option to be `true`.

	This is `undefined` if both `stdout` and `stderr` options are set to only `'inherit'`, `'ignore'`, `Writable` or `integer`, or if the `buffer` option is `false`.

	This is an array if the `lines` option is `true`, or if either the `stdout` or `stderr` option is a transform in object mode.
	*/
	all: ResultAll<OptionsType>;

	/**
	The output of the subprocess on `stdin`, `stdout`, `stderr` and other file descriptors.

	Items are `undefined` when their corresponding `stdio` option is set to only `'inherit'`, `'ignore'`, `Writable` or `integer`, or if the `buffer` option is `false`.

	Items are arrays when their corresponding `stdio` option is a transform in object mode.
	*/
	stdio: ResultStdioArray<OptionsType>;

	/**
	All the messages sent by the subprocess to the current process.

	This is empty unless the `ipc` option is `true`. Also, this is empty if the `buffer` option is `false`.
	*/
	ipcOutput: ResultIpcOutput<IsSync, OptionsType>;

	/**
	Results of the other subprocesses that were piped into this subprocess.

	This array is initially empty and is populated each time the `subprocess.pipe()` method resolves.
	*/
	pipedFrom: Unless<IsSync, Result[], []>;

	/**
	The file and arguments that were run.
	*/
	command: string;

	/**
	Same as `command` but escaped.
	*/
	escapedCommand: string;

	/**
	The current directory in which the command was run.
	*/
	cwd: string;

	/**
	Duration of the subprocess, in milliseconds.
	*/
	durationMs: number;

	/**
	Whether the subprocess failed to run.

	When this is `true`, the result is an `ExecaError` instance with additional error-related properties.
	*/
	failed: boolean;

	/**
	Whether the subprocess timed out due to the `timeout` option.
	*/
	timedOut: boolean;

	/**
	Whether the subprocess was canceled using the `cancelSignal` option.
	*/
	isCanceled: boolean;

	/**
	Whether the subprocess was canceled using both the `cancelSignal` and the `gracefulCancel` options.
	*/
	isGracefullyCanceled: boolean;

	/**
	Whether the subprocess failed because its output was larger than the `maxBuffer` option.
	*/
	isMaxBuffer: boolean;

	/**
	Whether the subprocess was terminated by a signal (like `SIGTERM`) sent by either:
	- The current process.
	- Another process. This case is [not supported on Windows](https://nodejs.org/api/process.html#signal-events).
	*/
	isTerminated: boolean;

	/**
	Whether the subprocess was terminated by the `SIGKILL` signal sent by the `forceKillAfterDelay` option.
	*/
	isForcefullyTerminated: boolean;

	/**
	The numeric [exit code](https://en.wikipedia.org/wiki/Exit_status) of the subprocess that was run.

	This is `undefined` when the subprocess could not be spawned or was terminated by a signal.
	*/
	exitCode?: number;

	/**
	The name of the signal (like `SIGTERM`) that terminated the subprocess, sent by either:
	- The current process.
	- Another process. This case is [not supported on Windows](https://nodejs.org/api/process.html#signal-events).

	If a signal terminated the subprocess, this property is defined and included in the error message. Otherwise it is `undefined`.
	*/
	signal?: keyof SignalConstants;

	/**
	A human-friendly description of the signal that was used to terminate the subprocess.

	If a signal terminated the subprocess, this property is defined and included in the error message. Otherwise it is `undefined`. It is also `undefined` when the signal is very uncommon which should seldomly happen.
	*/
	signalDescription?: string;

	/**
	Error message when the subprocess failed to run.
	*/
	message?: string;

	/**
	This is the same as `error.message` except it does not include the subprocess output.
	*/
	shortMessage?: string;

	/**
	Original error message. This is the same as `error.message` excluding the subprocess output and some additional information added by Execa.

	This exists only in specific instances, such as during a timeout.
	*/
	originalMessage?: string;

	/**
	Underlying error, if there is one. For example, this is set by `subprocess.kill(error)`.

	This is usually an `Error` instance.
	*/
	cause?: unknown;

	/**
	Node.js-specific [error code](https://nodejs.org/api/errors.html#errorcode), when available.
	*/
	code?: string;

	// We cannot `extend Error` because `message` must be optional. So we copy its types here.
	readonly name?: Error['name'];
	stack?: Error['stack'];
}

type SuccessResult<
	IsSync extends boolean = boolean,
	OptionsType extends CommonOptions = CommonOptions,
> = InstanceType<typeof CommonResult<IsSync, OptionsType>> & OmitErrorIfReject<OptionsType['reject']>;

type OmitErrorIfReject<RejectOption extends CommonOptions['reject']> = Record<ErrorProperties, RejectOption extends false ? unknown : never>;

/**
Result of a subprocess successful execution.

When the subprocess fails, it is rejected with an `ExecaError` instead.
*/
type Result<OptionsType extends Options = Options> = SuccessResult<false, OptionsType>;

/**
Result of a subprocess successful execution.

When the subprocess fails, it is rejected with an `ExecaError` instead.
*/
type SyncResult<OptionsType extends SyncOptions = SyncOptions> = SuccessResult<true, OptionsType>;

type VerboseOption = FdGenericOption<
	| 'none'
	| 'short'
	| 'full'
	| VerboseFunction
>;

type VerboseFunction = (verboseLine: string, verboseObject: MinimalVerboseObject) => string | void;

type GenericVerboseObject = {
	/**
	Event type. This can be:
	- `'command'`: subprocess start
	- `'output'`: `stdout`/`stderr` output
	- `'ipc'`: IPC output
	- `'error'`: subprocess failure
	- `'duration'`: subprocess success or failure
	*/
	type: 'command' | 'output' | 'ipc' | 'error' | 'duration';

	/**
	Depending on `verboseObject.type`, this is:
	- `'command'`: the `result.escapedCommand`
	- `'output'`: one line from `result.stdout` or `result.stderr`
	- `'ipc'`: one IPC message from `result.ipcOutput`
	- `'error'`: the `error.shortMessage`
	- `'duration'`: the `result.durationMs`
	*/
	message: string;

	/**
	The file and arguments that were run. This is the same as `result.escapedCommand`.
	*/
	escapedCommand: string;

	/**
	Serial number identifying the subprocess within the current process. It is incremented from `'0'`.

	This is helpful when multiple subprocesses are running at the same time.

	This is similar to a [PID](https://en.wikipedia.org/wiki/Process_identifier) except it has no maximum limit, which means it never repeats. Also, it is usually shorter.
	*/
	commandId: string;

	/**
	Event date/time.
	*/
	timestamp: Date;

	/**
	Whether another subprocess is piped into this subprocess. This is `false` when `result.pipedFrom` is empty.
	*/
	piped: boolean;
};

type MinimalVerboseObject = GenericVerboseObject & {
	// We cannot use the `CommonOptions` type because it would make this type recursive
	options: object;
	result?: never;
};

/**
Subprocess event object, for logging purpose, using the `verbose` option and `execa()`.
*/
type VerboseObject = GenericVerboseObject & {
	/**
	The options passed to the subprocess.
	*/
	options: Options;

	/**
	Subprocess result.

	This is `undefined` if `verboseObject.type` is `'command'`, `'output'` or `'ipc'`.
	*/
	result?: Result;
};

/**
Subprocess event object, for logging purpose, using the `verbose` option and `execaSync()`.
*/
type SyncVerboseObject = GenericVerboseObject & {
	/**
	The options passed to the subprocess.
	*/
	options: SyncOptions;

	/**
	Subprocess result.

	This is `undefined` if `verboseObject.type` is `'command'`, `'output'` or `'ipc'`.
	*/
	result?: SyncResult;
};

type ChunkForEncoding<Encoding extends EncodingOption> = Encoding extends BinaryEncodingOption ? Uint8Array : string;

type CommonOptions<
	IsSync extends boolean = boolean,
	Encoding extends EncodingOption = EncodingOption,
> = {
	/**
	Prefer locally installed binaries when looking for a binary to execute.

	@default `true` with `$`, `false` otherwise
	*/
	readonly preferLocal?: boolean;

	/**
	Preferred path to find locally installed binaries, when using the `preferLocal` option.

	@default `cwd` option
	*/
	readonly localDir?: string | URL;

	/**
	If `true`, runs with Node.js. The first argument must be a Node.js file.

	The subprocess inherits the current Node.js [CLI flags](https://nodejs.org/api/cli.html#options) and version. This can be overridden using the `nodeOptions` and `nodePath` options.

	@default `true` with `execaNode()`, `false` otherwise
	*/
	readonly node?: boolean;

	/**
	List of [CLI flags](https://nodejs.org/api/cli.html#cli_options) passed to the Node.js executable.

	Requires the `node` option to be `true`.

	@default [`process.execArgv`](https://nodejs.org/api/process.html#process_process_execargv) (current Node.js CLI flags)
	*/
	readonly nodeOptions?: readonly string[];

	/**
	Path to the Node.js executable.

	Requires the `node` option to be `true`.

	@default [`process.execPath`](https://nodejs.org/api/process.html#process_process_execpath) (current Node.js executable)
	*/
	readonly nodePath?: string | URL;

	/**
	If `true`, runs the command inside of a [shell](https://en.wikipedia.org/wiki/Shell_(computing)).

	Uses [`/bin/sh`](https://en.wikipedia.org/wiki/Unix_shell) on UNIX and [`cmd.exe`](https://en.wikipedia.org/wiki/Cmd.exe) on Windows. A different shell can be specified as a string. The shell should understand the `-c` switch on UNIX or `/d /s /c` on Windows.

	We recommend against using this option.

	@default false
	*/
	readonly shell?: boolean | string | URL;

	/**
	Current [working directory](https://en.wikipedia.org/wiki/Working_directory) of the subprocess.

	This is also used to resolve the `nodePath` option when it is a relative path.

	@default process.cwd()
	*/
	readonly cwd?: string | URL;

	/**
	[Environment variables](https://en.wikipedia.org/wiki/Environment_variable).

	Unless the `extendEnv` option is `false`, the subprocess also uses the current process' environment variables ([`process.env`](https://nodejs.org/api/process.html#processenv)).

	@default [process.env](https://nodejs.org/api/process.html#processenv)
	*/
	readonly env?: Readonly<Partial<Record<string, string>>>;

	/**
	If `true`, the subprocess uses both the `env` option and the current process' environment variables ([`process.env`](https://nodejs.org/api/process.html#processenv)).
	If `false`, only the `env` option is used, not `process.env`.

	@default true
	*/
	readonly extendEnv?: boolean;

	/**
	Write some input to the subprocess' [`stdin`](https://en.wikipedia.org/wiki/Standard_streams#Standard_input_(stdin)).

	See also the `inputFile` and `stdin` options.
	*/
	readonly input?: string | Uint8Array | Readable;

	/**
	Use a file as input to the subprocess' [`stdin`](https://en.wikipedia.org/wiki/Standard_streams#Standard_input_(stdin)).

	See also the `input` and `stdin` options.
	*/
	readonly inputFile?: string | URL;

	/**
	How to setup the subprocess' [standard input](https://en.wikipedia.org/wiki/Standard_streams#Standard_input_(stdin)). This can be `'pipe'`, `'overlapped'`, `'ignore`, `'inherit'`, a file descriptor integer, a Node.js `Readable` stream, a web `ReadableStream`, a `{ file: 'path' }` object, a file URL, an `Iterable`, an `AsyncIterable`, an `Uint8Array`, a generator function, a `Duplex` or a web `TransformStream`.

	This can be an array of values such as `['inherit', 'pipe']` or `[fileUrl, 'pipe']`.

	@default `'inherit'` with `$`, `'pipe'` otherwise
	*/
	readonly stdin?: StdinOptionCommon<IsSync, boolean, ChunkForEncoding<Encoding>>;

	/**
	How to setup the subprocess' [standard output](https://en.wikipedia.org/wiki/Standard_streams#Standard_input_(stdin)). This can be `'pipe'`, `'overlapped'`, `'ignore`, `'inherit'`, a file descriptor integer, a Node.js `Writable` stream, a web `WritableStream`, a `{ file: 'path' }` object, a file URL, a generator function, a `Duplex` or a web `TransformStream`.

	This can be an array of values such as `['inherit', 'pipe']` or `[fileUrl, 'pipe']`.

	@default 'pipe'
	*/
	readonly stdout?: StdoutStderrOptionCommon<IsSync, boolean, ChunkForEncoding<Encoding>>;

	/**
	How to setup the subprocess' [standard error](https://en.wikipedia.org/wiki/Standard_streams#Standard_input_(stdin)). This can be `'pipe'`, `'overlapped'`, `'ignore`, `'inherit'`, a file descriptor integer, a Node.js `Writable` stream, a web `WritableStream`, a `{ file: 'path' }` object, a file URL, a generator function, a `Duplex` or a web `TransformStream`.

	This can be an array of values such as `['inherit', 'pipe']` or `[fileUrl, 'pipe']`.

	@default 'pipe'
	*/
	readonly stderr?: StdoutStderrOptionCommon<IsSync, boolean, ChunkForEncoding<Encoding>>;

	/**
	Like the `stdin`, `stdout` and `stderr` options but for all [file descriptors](https://en.wikipedia.org/wiki/File_descriptor) at once. For example, `{stdio: ['ignore', 'pipe', 'pipe']}` is the same as `{stdin: 'ignore', stdout: 'pipe', stderr: 'pipe'}`.

	A single string can be used as a shortcut.

	The array can have more than 3 items, to create additional file descriptors beyond `stdin`/`stdout`/`stderr`.

	@default 'pipe'
	*/
	readonly stdio?: StdioOptionsProperty<IsSync, ChunkForEncoding<Encoding>>;

	/**
	Add a `subprocess.all` stream and a `result.all` property. They contain the combined/interleaved output of the subprocess' `stdout` and `stderr`.

	@default false
	*/
	readonly all?: boolean;

	/**
	If the subprocess outputs text, specifies its character encoding, either [`'utf8'`](https://en.wikipedia.org/wiki/UTF-8) or [`'utf16le'`](https://en.wikipedia.org/wiki/UTF-16).

	If it outputs binary data instead, this should be either:
	- `'buffer'`: returns the binary output as an `Uint8Array`.
	- [`'hex'`](https://en.wikipedia.org/wiki/Hexadecimal), [`'base64'`](https://en.wikipedia.org/wiki/Base64), [`'base64url'`](https://en.wikipedia.org/wiki/Base64#RFC_4648), [`'latin1'`](https://nodejs.org/api/buffer.html#buffers-and-character-encodings) or [`'ascii'`](https://nodejs.org/api/buffer.html#buffers-and-character-encodings): encodes the binary output as a string.

	The output is available with `result.stdout`, `result.stderr` and `result.stdio`.

	@default 'utf8'
	*/
	readonly encoding?: Encoding;

	/**
	Set `result.stdout`, `result.stderr`, `result.all` and `result.stdio` as arrays of strings, splitting the subprocess' output into lines.

	This cannot be used if the `encoding` option is binary.

	By default, this applies to both `stdout` and `stderr`, but different values can also be passed.

	@default false
	*/
	readonly lines?: FdGenericOption<boolean>;

	/**
	Strip the final [newline character](https://en.wikipedia.org/wiki/Newline) from the output.

	If the `lines` option is true, this applies to each output line instead.

	By default, this applies to both `stdout` and `stderr`, but different values can also be passed.

	@default true
	*/
	readonly stripFinalNewline?: FdGenericOption<boolean>;

	/**
	Largest amount of data allowed on `stdout`, `stderr` and `stdio`.

	By default, this applies to both `stdout` and `stderr`, but different values can also be passed.

	When reached, `error.isMaxBuffer` becomes `true`.

	@default 100_000_000
	*/
	readonly maxBuffer?: FdGenericOption<number>;

	/**
	When `buffer` is `false`, the `result.stdout`, `result.stderr`, `result.all` and `result.stdio` properties are not set.

	By default, this applies to both `stdout` and `stderr`, but different values can also be passed.

	@default true
	*/
	readonly buffer?: FdGenericOption<boolean>;

	/**
	Enables exchanging messages with the subprocess using `subprocess.sendMessage(message)`, `subprocess.getOneMessage()` and `subprocess.getEachMessage()`.

	The subprocess must be a Node.js file.

	@default `true` if the `node`, `ipcInput` or `gracefulCancel` option is set, `false` otherwise
	*/
	readonly ipc?: Unless<IsSync, boolean>;

	/**
	Specify the kind of serialization used for sending messages between subprocesses when using the `ipc` option.

	@default 'advanced'
	*/
	readonly serialization?: Unless<IsSync, 'json' | 'advanced'>;

	/**
	Sends an IPC message when the subprocess starts.

	The subprocess must be a Node.js file. The value's type depends on the `serialization` option.
	*/
	readonly ipcInput?: Unless<IsSync, Message>;

	/**
	If `verbose` is `'short'`, prints the command on [`stderr`](https://en.wikipedia.org/wiki/Standard_streams#Standard_error_(stderr)): its file, arguments, duration and (if it failed) error message.

	If `verbose` is `'full'` or a function, the command's [`stdout`](https://en.wikipedia.org/wiki/Standard_streams#Standard_output_(stdout)), `stderr` and IPC messages are also printed.

	A function can be passed to customize logging.

	By default, this applies to both `stdout` and `stderr`, but different values can also be passed.

	@default 'none'
	*/
	readonly verbose?: VerboseOption;

	/**
	Setting this to `false` resolves the result's promise with the error instead of rejecting it.

	@default true
	*/
	readonly reject?: boolean;

	/**
	If `timeout` is greater than `0`, the subprocess will be terminated if it runs for longer than that amount of milliseconds.

	On timeout, `error.timedOut` becomes `true`.

	@default 0
	*/
	readonly timeout?: number;

	/**
	When the `cancelSignal` is [aborted](https://developer.mozilla.org/en-US/docs/Web/API/AbortController/abort), terminate the subprocess using a `SIGTERM` signal.

	When aborted, `error.isCanceled` becomes `true`.

	@example
	```
	import {execaNode} from 'execa';

	const controller = new AbortController();
	const cancelSignal = controller.signal;

	setTimeout(() => {
		controller.abort();
	}, 5000);

	try {
		await execaNode({cancelSignal})`build.js`;
	} catch (error) {
		if (error.isCanceled) {
			console.error('Canceled by cancelSignal.');
		}

		throw error;
	}
	```
	*/
	readonly cancelSignal?: Unless<IsSync, AbortSignal>;

	/**
	When the `cancelSignal` option is [aborted](https://developer.mozilla.org/en-US/docs/Web/API/AbortController/abort), do not send any `SIGTERM`. Instead, abort the [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal) returned by `getCancelSignal()`. The subprocess should use it to terminate gracefully.

	The subprocess must be a Node.js file.

	When aborted, `error.isGracefullyCanceled` becomes `true`.

	@default false
	*/
	readonly gracefulCancel?: Unless<IsSync, boolean>;

	/**
	If the subprocess is terminated but does not exit, forcefully exit it by sending [`SIGKILL`](https://en.wikipedia.org/wiki/Signal_(IPC)#SIGKILL).

	When this happens, `error.isForcefullyTerminated` becomes `true`.

	@default 5000
	*/
	readonly forceKillAfterDelay?: Unless<IsSync, number | boolean>;

	/**
	Default [signal](https://en.wikipedia.org/wiki/Signal_(IPC)) used to terminate the subprocess.

	This can be either a name (like `'SIGTERM'`) or a number (like `9`).

	@default 'SIGTERM'
	*/
	readonly killSignal?: keyof SignalConstants | number;

	/**
	Run the subprocess independently from the current process.

	@default false
	*/
	readonly detached?: Unless<IsSync, boolean>;

	/**
	Kill the subprocess when the current process exits.

	@default true
	*/
	readonly cleanup?: Unless<IsSync, boolean>;

	/**
	When the subprocess is terminated by Execa, also terminate all of its descendant processes, instead of only the subprocess itself.

	This is useful when the subprocess spawns its own processes, such as when using the `shell` option.

	On Unix, this spawns the subprocess in its own [process group](https://en.wikipedia.org/wiki/Process_group). On Windows, this uses [`taskkill`](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill).

	This is best-effort: descendant processes that create their own process group or session are not terminated.

	@default false
	*/
	readonly killDescendants?: Unless<IsSync, boolean>;

	/**
	Sets the [user identifier](https://en.wikipedia.org/wiki/User_identifier) of the subprocess.

	@default current user identifier
	*/
	readonly uid?: number;

	/**
	Sets the [group identifier](https://en.wikipedia.org/wiki/Group_identifier) of the subprocess.

	@default current group identifier
	*/
	readonly gid?: number;

	/**
	Value of [`argv[0]`](https://nodejs.org/api/process.html#processargv0) sent to the subprocess.

	@default file being executed
	*/
	readonly argv0?: string;

	/**
	On Windows, do not create a new console window.

	@default true
	*/
	readonly windowsHide?: boolean;

	/**
	If `false`, escapes the command arguments on Windows.

	@default `true` if the `shell` option is `true`, `false` otherwise
	*/
	readonly windowsVerbatimArguments?: boolean;
};

/**
Subprocess options.

Some options are related to the subprocess output: `verbose`, `lines`, `stripFinalNewline`, `buffer`, `maxBuffer`. By default, those options apply to all file descriptors (`stdout`, `stderr`, etc.). A plain object can be passed instead to apply them to only `stdout`, `stderr`, `all` (both stdout and stderr), `ipc`, `fd3`, etc.

@example

```
// Same value for stdout and stderr
await execa({verbose: 'full'})`npm run build`;

// Different values for stdout and stderr
await execa({verbose: {stdout: 'none', stderr: 'full'}})`npm run build`;
```
*/
type TextOptions<IsSync extends boolean> = CommonOptions<IsSync, TextEncodingOption | undefined>;
type BinaryOptions<IsSync extends boolean> = Omit<CommonOptions<IsSync, BinaryEncodingOption>, 'encoding'> & {
	readonly encoding: BinaryEncodingOption;
};

type Options = TextOptions<false> | BinaryOptions<false>;

/**
Subprocess options, with synchronous methods.

Some options are related to the subprocess output: `verbose`, `lines`, `stripFinalNewline`, `buffer`, `maxBuffer`. By default, those options apply to all file descriptors (`stdout`, `stderr`, etc.). A plain object can be passed instead to apply them to only `stdout`, `stderr`, `all` (both stdout and stderr), `ipc`, `fd3`, etc.

@example

```
// Same value for stdout and stderr
execaSync({verbose: 'full'})`npm run build`;

// Different values for stdout and stderr
execaSync({verbose: {stdout: 'none', stderr: 'full'}})`npm run build`;
```
*/
type SyncOptions = TextOptions<true> | BinaryOptions<true>;

type StricterOptions<
	WideOptions extends CommonOptions,
	StrictOptions extends CommonOptions,
> = WideOptions extends StrictOptions ? WideOptions : StrictOptions;

type TemplateExpressionItem =
	| string
	| number
	| Result
	| SyncResult;

/**
Value allowed inside `${...}` when using the template string syntax.
*/
type TemplateExpression = TemplateExpressionItem | readonly TemplateExpressionItem[];

// `...${...}...` template syntax
type TemplateString = readonly [TemplateStringsArray, ...readonly TemplateExpression[]];

// `subprocess.pipe()` options
type PipeOptions = {
	/**
	Which stream to pipe from the source subprocess. A [file descriptor](https://en.wikipedia.org/wiki/File_descriptor) like `"fd3"` can also be passed.

	`"all"` pipes both `stdout` and `stderr`. This requires the `all` option to be `true`.
	*/
	readonly from?: FromOption;

	/**
	Which stream to pipe to the destination subprocess. A [file descriptor](https://en.wikipedia.org/wiki/File_descriptor) like `"fd3"` can also be passed.
	*/
	readonly to?: ToOption;

	/**
	Unpipe the subprocess when the signal aborts.
	*/
	readonly unpipeSignal?: AbortSignal;
};

// Methods forwarded from the destination subprocess to the return value of `subprocess.pipe()`, so its output can be iterated, converted to a stream, or used for IPC.
type PipeResultMethods<OptionsType extends Options> =
	& SubprocessResultMethods<OptionsType>
	& IpcMethods<HasIpc<OptionsType>, OptionsType['serialization']>;

// Same as `PipeResultMethods`, but when the destination is another `execa()` call, so its own option types are kept.
// The base `Options` is only used to compute the property names, which do not depend on the specific options.
type PipeResultMethodsFrom<Destination extends ResultPromise> = Pick<Destination, keyof PipeResultMethods<Options>>;

// `subprocess.pipe()`
type PipableSubprocess = {
	/**
	[Pipe](https://nodejs.org/api/stream.html#readablepipedestination-options) the subprocess' `stdout` to a second Execa subprocess' `stdin`. This resolves with that second subprocess' result. If either subprocess is rejected, this is rejected with that subprocess' error instead.

	This follows the same syntax as `execa(file, arguments?, options?)` except both regular options and pipe-specific options can be specified.

	Like a subprocess, the return value can be [iterated](https://github.com/sindresorhus/execa/blob/main/docs/lines.md#progressive-splitting), [converted to a stream](https://github.com/sindresorhus/execa/blob/main/docs/streams.md#converting-a-subprocess-to-a-stream), or used for [IPC](https://github.com/sindresorhus/execa/blob/main/docs/ipc.md) with the destination subprocess.
	*/
	pipe<OptionsType extends Options & PipeOptions = {}>(
		file: string | URL,
		arguments?: readonly string[],
		options?: OptionsType,
	): Promise<Result<OptionsType>> & PipableSubprocess & PipeResultMethods<OptionsType>;
	pipe<OptionsType extends Options & PipeOptions = {}>(
		file: string | URL,
		options?: OptionsType,
	): Promise<Result<OptionsType>> & PipableSubprocess & PipeResultMethods<OptionsType>;

	/**
	Like `subprocess.pipe(file, arguments?, options?)` but using a `command` template string instead. This follows the same syntax as `$`.
	*/
	pipe(templates: TemplateStringsArray, ...expressions: readonly TemplateExpression[]):
	Promise<Result<{}>> & PipableSubprocess & PipeResultMethods<{}>;
	pipe<OptionsType extends Options & PipeOptions = {}>(options: OptionsType):
	(templates: TemplateStringsArray, ...expressions: readonly TemplateExpression[])
	=> Promise<Result<OptionsType>> & PipableSubprocess & PipeResultMethods<OptionsType>;

	/**
	Like `subprocess.pipe(file, arguments?, options?)` but using the return value of another `execa()` call instead.
	*/
	pipe<Destination extends ResultPromise>(destination: Destination, options?: PipeOptions):
	Promise<Awaited<Destination>> & PipableSubprocess & PipeResultMethodsFrom<Destination>;
};

// `subprocess.readable|duplex|iterable()` options
type ReadableOptions = {
	/**
	Which stream to read from the subprocess. A [file descriptor](https://en.wikipedia.org/wiki/File_descriptor) like `"fd3"` can also be passed.

	`"all"` reads both `stdout` and `stderr`. This requires the `all` option to be `true`.

	@default 'stdout'
	*/
	readonly from?: FromOption;

	/**
	If `false`, iterates over lines. Each line is a string.

	If `true`, iterates over arbitrary chunks of data. Each line is an [`Uint8Array`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array) (with `subprocess.iterable()`) or a [`Buffer`](https://nodejs.org/api/buffer.html#class-buffer) (with `subprocess.readable()`/`subprocess.duplex()`).

	This is always `true` when the `encoding` option is binary.

	@default `false` with `subprocess.iterable()`, `true` otherwise
	*/
	readonly binary?: boolean;

	/**
	If both this option and the `binary` option is `false`, [newlines](https://en.wikipedia.org/wiki/Newline) are stripped from each line.

	@default `false` with `subprocess.iterable()`, `true` otherwise
	*/
	readonly preserveNewlines?: boolean;
};

// `subprocess.writable|duplex()` options
type WritableOptions = {
	/**
	Which stream to write to the subprocess. A [file descriptor](https://en.wikipedia.org/wiki/File_descriptor) like `"fd3"` can also be passed.

	@default 'stdin'
	*/
	readonly to?: ToOption;
};

// `subprocess.duplex()` options
type DuplexOptions = ReadableOptions & WritableOptions;

// `subprocess.iterable()` return value
type SubprocessAsyncIterable<
	BinaryOption extends boolean | undefined,
	EncodingOption extends Options['encoding'],
> = AsyncIterableIterator<
	EncodingOption extends BinaryEncodingOption
		? Uint8Array
		: BinaryOption extends true
			? Uint8Array
			: string
>;

// `subprocess.stdin|stdout|stderr|stdio`
type SubprocessStdioStream<
	FdNumber extends string,
	OptionsType extends Options,
> = SubprocessStream<FdNumber, IgnoresSubprocessOutput<FdNumber, OptionsType>, OptionsType>;

type SubprocessStream<
	FdNumber extends string,
	StreamResultIgnored,
	OptionsType extends Options,
> = StreamResultIgnored extends true
	? null
	: InputOutputStream<IsInputFd<FdNumber, OptionsType>>;

type InputOutputStream<IsInput extends boolean> = IsInput extends true
	? Writable
	: Readable;

// `subprocess.stdio`
type SubprocessStdioArray<OptionsType extends Options> = MapStdioStreams<StdioOptionNormalizedArray<OptionsType>, OptionsType>;

// We cannot use mapped types because it must be compatible with Node.js `ChildProcess["stdio"]` which uses a tuple with exactly 5 items
type MapStdioStreams<
	StdioOptionsArrayType,
	OptionsType extends Options,
> = [
	SubprocessStdioStream<'0', OptionsType>,
	SubprocessStdioStream<'1', OptionsType>,
	SubprocessStdioStream<'2', OptionsType>,
	'3' extends keyof StdioOptionsArrayType ? SubprocessStdioStream<'3', OptionsType> : never,
	'4' extends keyof StdioOptionsArrayType ? SubprocessStdioStream<'4', OptionsType> : never,
];

// `subprocess.all`
type SubprocessAll<OptionsType extends Options> = AllStream<AllIgnored<OptionsType['all'], OptionsType>>;

type AllStream<IsIgnored> = IsIgnored extends true ? undefined : Readable;

type AllIgnored<
	AllOption,
	OptionsType extends Options,
> = AllOption extends true
	? IgnoresSubprocessOutput<'1', OptionsType> extends true
		? IgnoresSubprocessOutput<'2', OptionsType>
		: false
	: true;

// Read-side iteration, stream conversion and `all` methods.
// These are shared between a subprocess and the return value of `subprocess.pipe()`, which forwards them from its destination subprocess.
// `writable()`, `duplex()`, `writableStream()` and `transformStream()` are not included: they write to `stdin`, which the pipe already feeds from its source.
type SubprocessResultMethods<OptionsType extends Options = Options> = {
	/**
	Stream combining/interleaving `subprocess.stdout` and `subprocess.stderr`.

	This requires the `all` option to be `true`.

	This is `undefined` if `stdout` and `stderr` options are set to `'inherit'`, `'ignore'`, `Writable` or `integer`, or if the `buffer` option is `false`.
	*/
	all: SubprocessAll<OptionsType>;

	/**
	Subprocesses are [async iterables](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol/asyncIterator). They iterate over each output line.
	*/
	[Symbol.asyncIterator](): SubprocessAsyncIterable<undefined, OptionsType['encoding']>;

	/**
	Same as `subprocess[Symbol.asyncIterator]` except options can be provided.
	*/
	iterable<IterableOptions extends ReadableOptions = {}>(readableOptions?: IterableOptions): SubprocessAsyncIterable<IterableOptions['binary'], OptionsType['encoding']>;

	/**
	Converts the subprocess to a readable stream.
	*/
	readable(readableOptions?: ReadableOptions): Readable;

	/**
	Converts the subprocess to a readable [web stream](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream).
	*/
	readableStream(readableOptions?: ReadableOptions): ReadableStream;
};

type ExecaCustomSubprocess<OptionsType extends Options> =
	& IpcMethods<HasIpc<OptionsType>, OptionsType['serialization']>
	& PipableSubprocess
	& SubprocessResultMethods<OptionsType>
	& {
		/**
		Process identifier ([PID](https://en.wikipedia.org/wiki/Process_identifier)).

		This is `undefined` if the subprocess failed to spawn.
		*/
		pid?: number;

		/**
		The subprocess [`stdin`](https://en.wikipedia.org/wiki/Standard_streams#Standard_input_(stdin)) as a stream.

		This is `null` if the `stdin` option is set to `'inherit'`, `'ignore'`, `Readable` or `integer`.
		*/
		stdin: SubprocessStdioStream<'0', OptionsType>;

		/**
		The subprocess [`stdout`](https://en.wikipedia.org/wiki/Standard_streams#Standard_output_(stdout)) as a stream.

		This is `null` if the `stdout` option is set to `'inherit'`, `'ignore'`, `Writable` or `integer`, or if the `buffer` option is `false`.
		*/
		stdout: SubprocessStdioStream<'1', OptionsType>;

		/**
		The subprocess [`stderr`](https://en.wikipedia.org/wiki/Standard_streams#Standard_error_(stderr)) as a stream.

		This is `null` if the `stderr` option is set to `'inherit'`, `'ignore'`, `Writable` or `integer`, or if the `buffer` option is `false`.
		*/
		stderr: SubprocessStdioStream<'2', OptionsType>;

		/**
		The subprocess `stdin`, `stdout`, `stderr` and other files descriptors as an array of streams.

		Each array item is `null` if the corresponding `stdin`, `stdout`, `stderr` or `stdio` option is set to `'inherit'`, `'ignore'`, `Stream` or `integer`, or if the `buffer` option is `false`.
		*/
		stdio: SubprocessStdioArray<OptionsType>;

		/**
		Sends a [signal](https://nodejs.org/api/os.html#signal-constants) to the subprocess. The default signal is the `killSignal` option. `killSignal` defaults to `SIGTERM`, which terminates the subprocess.

		This returns `false` when the signal could not be sent, for example when the subprocess has already exited.

		When an error is passed as argument, it is set to the subprocess' `error.cause`. The subprocess is then terminated with the default signal. This does not emit the [`error` event](https://nodejs.org/api/child_process.html#event-error).

		[More info.](https://nodejs.org/api/child_process.html#subprocesskillsignal)
		*/
		kill(signal?: keyof SignalConstants | number, error?: Error): boolean;
		kill(error?: Error): boolean;

		/**
		Converts the subprocess to a writable stream.
		*/
		writable(writableOptions?: WritableOptions): Writable;

		/**
		Converts the subprocess to a duplex stream.
		*/
		duplex(duplexOptions?: DuplexOptions): Duplex;

		/**
		Converts the subprocess to a writable [web stream](https://developer.mozilla.org/en-US/docs/Web/API/WritableStream).
		*/
		writableStream(writableOptions?: WritableOptions): WritableStream;

		/**
		Converts the subprocess to a [`{readable, writable}`](https://developer.mozilla.org/en-US/docs/Web/API/TransformStream) pair of web streams.
		*/
		transformStream(duplexOptions?: DuplexOptions): ReadableWritablePair;

		/**
		Underlying Node.js [`ChildProcess`](https://nodejs.org/api/child_process.html#class-childprocess) instance.

		This is an escape hatch for Node.js-specific APIs not documented by Execa, such as `.on()`, `.send()`, `.disconnect()`, `.ref()` or `.unref()`.
		*/
		nodeChildProcess: ChildProcess;
	};

/**
Subprocess with Execa-specific methods and properties. It is also a `Promise` either resolving with its successful `result`, or rejecting with its `error`.
*/
type Subprocess<OptionsType extends Options = Options> =
	& ExecaCustomSubprocess<OptionsType>
	& Promise<Result<OptionsType>>;

/**
The return value of all asynchronous methods is both:
- the subprocess with Execa-specific methods and properties.
- a `Promise` either resolving with its successful `result`, or rejecting with its `error`.
*/
type ResultPromise<OptionsType extends Options = Options> =
	Subprocess<OptionsType>;

/**
Executes a command using `file ...arguments`.

When `command` is a template string, it includes both the `file` and its `arguments`.

`execa(options)` can be used to return a new instance of this method but with different default `options`. Consecutive calls are merged to previous ones.

@param file - The program/script to execute, as a string or file URL
@param arguments - Arguments to pass to `file` on execution.
@returns A `ResultPromise` that is both:
- the subprocess.
- a `Promise` either resolving with its successful `result`, or rejecting with its `error`.
@throws `ExecaError`

@example <caption>Simple syntax</caption>

```
import {execa} from 'execa';

const {stdout} = await execa`npm run build`;
// Print command's output
console.log(stdout);
```

@example <caption>Script</caption>

```
import {$} from 'execa';

const {stdout: name} = await $`cat package.json`.pipe`grep name`;
console.log(name);

const branch = await $`git branch --show-current`;
await $`dep deploy --branch=${branch}`;

await Promise.all([
	$`sleep 1`,
	$`sleep 2`,
	$`sleep 3`,
]);

const directoryName = 'foo bar';
await $`mkdir /tmp/${directoryName}`;
```

@example <caption>Local binaries</caption>

```
$ npm install -D eslint
```

```
await execa({preferLocal: true})`eslint`;
```

@example <caption>Pipe multiple subprocesses</caption>

```
const {stdout, pipedFrom} = await execa`npm run build`
	.pipe`sort`
	.pipe`head -n 2`;

// Output of `npm run build | sort | head -n 2`
console.log(stdout);
// Output of `npm run build | sort`
console.log(pipedFrom[0].stdout);
// Output of `npm run build`
console.log(pipedFrom[0].pipedFrom[0].stdout);
```

@example <caption>Interleaved output</caption>

```
const {all} = await execa({all: true})`npm run build`;
// stdout + stderr, interleaved
console.log(all);
```

@example <caption>Programmatic + terminal output</caption>

```
const {stdout} = await execa({stdout: ['pipe', 'inherit']})`npm run build`;
// stdout is also printed to the terminal
console.log(stdout);
```

@example <caption>Simple input</caption>

```
const getInputString = () => { /* ... *\/ };
const {stdout} = await execa({input: getInputString()})`sort`;
console.log(stdout);
```

@example <caption>File input</caption>

```
// Similar to: npm run build < input.txt
await execa({stdin: {file: 'input.txt'}})`npm run build`;
```

@example <caption>File output</caption>

```
// Similar to: npm run build > output.txt
await execa({stdout: {file: 'output.txt'}})`npm run build`;
```

@example <caption>Split into text lines</caption>

```
const {stdout} = await execa({lines: true})`npm run build`;
// Print first 10 lines
console.log(stdout.slice(0, 10).join('\n'));
```

@example <caption>Iterate over text lines</caption>

```
for await (const line of execa`npm run build`) {
	if (line.includes('WARN')) {
		console.warn(line);
	}
}
```

@example <caption>Transform/filter output</caption>

```
let count = 0;

// Filter out secret lines, then prepend the line number
const transform = function * (line) {
	if (!line.includes('secret')) {
		yield `[${count++}] ${line}`;
	}
};

await execa({stdout: transform})`npm run build`;
```

@example <caption>Web streams</caption>

```
const response = await fetch('https://example.com');
await execa({stdin: response.body})`sort`;
```

@example <caption>Convert to Duplex stream</caption>

```
import {execa} from 'execa';
import {pipeline} from 'node:stream/promises';
import {createReadStream, createWriteStream} from 'node:fs';

await pipeline(
	createReadStream('./input.txt'),
	execa`node ./transform.js`.duplex(),
	createWriteStream('./output.txt'),
);
```

@example <caption>Exchange messages</caption>

```
// parent.js
import {execaNode} from 'execa';

const subprocess = execaNode`child.js`;
await subprocess.sendMessage('Hello from parent');
const message = await subprocess.getOneMessage();
console.log(message); // 'Hello from child'
```

```
// child.js
import {getOneMessage, sendMessage} from 'execa';

const message = await getOneMessage(); // 'Hello from parent'
const newMessage = message.replace('parent', 'child'); // 'Hello from child'
await sendMessage(newMessage);
```

@example <caption>Any input type</caption>

```
// main.js
import {execaNode} from 'execa';

const ipcInput = [
	{task: 'lint', ignore: /test\.js/},
	{task: 'copy', files: new Set(['main.js', 'index.js']),
}];
await execaNode({ipcInput})`build.js`;
```

```
// build.js
import {getOneMessage} from 'execa';

const ipcInput = await getOneMessage();
```

@example <caption>Any output type</caption>

```
// main.js
import {execaNode} from 'execa';

const {ipcOutput} = await execaNode`build.js`;
console.log(ipcOutput[0]); // {kind: 'start', timestamp: date}
console.log(ipcOutput[1]); // {kind: 'stop', timestamp: date}
```

```
// build.js
import {sendMessage} from 'execa';

const runBuild = () => { /* ... *\/ };

await sendMessage({kind: 'start', timestamp: new Date()});
await runBuild();
await sendMessage({kind: 'stop', timestamp: new Date()});
```

@example <caption>Graceful termination</caption>

```
// main.js
import {execaNode} from 'execa';

const controller = new AbortController();
setTimeout(() => {
	controller.abort();
}, 5000);

await execaNode({
	cancelSignal: controller.signal,
	gracefulCancel: true,
})`build.js`;
```

```
// build.js
import {getCancelSignal} from 'execa';

const cancelSignal = await getCancelSignal();
const url = 'https://example.com/build/info';
const response = await fetch(url, {signal: cancelSignal});
```

@example <caption>Detailed error</caption>

```
import {execa, ExecaError} from 'execa';

try {
	await execa`unknown command`;
} catch (error) {
	if (error instanceof ExecaError) {
		console.log(error);
	}
	/*
	ExecaError: Command failed with ENOENT: unknown command
	spawn unknown ENOENT
			at ...
			at ... {
		shortMessage: 'Command failed with ENOENT: unknown command\nspawn unknown ENOENT',
		originalMessage: 'spawn unknown ENOENT',
		command: 'unknown command',
		escapedCommand: 'unknown command',
		cwd: '/path/to/cwd',
		durationMs: 28.217566,
		failed: true,
		timedOut: false,
		isCanceled: false,
		isTerminated: false,
		isMaxBuffer: false,
		code: 'ENOENT',
		stdout: '',
		stderr: '',
		stdio: [undefined, '', ''],
		pipedFrom: []
		[cause]: Error: spawn unknown ENOENT
				at ...
				at ... {
			errno: -2,
			code: 'ENOENT',
			syscall: 'spawn unknown',
			path: 'unknown',
			spawnargs: [ 'command' ]
		}
	}
	*\/
}
```

@example <caption>Verbose mode</caption>

```
await execa`npm run build`;
await execa`npm run test`;
```

```
$ NODE_DEBUG=execa node build.js
[00:57:44.581] [0] $ npm run build
[00:57:44.653] [0]   Building application...
[00:57:44.653] [0]   Done building.
[00:57:44.658] [0] ✔ (done in 78ms)
[00:57:44.658] [1] $ npm run test
[00:57:44.740] [1]   Running tests...
[00:57:44.740] [1]   Error: the entrypoint is invalid.
[00:57:44.747] [1] ✘ Command failed with exit code 1: npm run test
[00:57:44.747] [1] ✘ (done in 89ms)
```

@example <caption>Custom logging</caption>

```
import {execa as execa_} from 'execa';
import {createLogger, transports} from 'winston';

// Log to a file using Winston
const transport = new transports.File({filename: 'logs.txt'});
const logger = createLogger({transports: [transport]});
const LOG_LEVELS = {
	command: 'info',
	output: 'verbose',
	ipc: 'verbose',
	error: 'error',
	duration: 'info',
};

const execa = execa_({
	verbose(verboseLine, {message, ...verboseObject}) {
		const level = LOG_LEVELS[verboseObject.type];
		logger[level](message, verboseObject);
	},
});

await execa`npm run build`;
await execa`npm run test`;
```
*/
declare const execa: ExecaMethod<{}>;

/**
`execa()` method either exported by Execa, or bound using `execa(options)`.
*/
type ExecaMethod<OptionsType extends Options = Options> =
	& ExecaBind<OptionsType>
	& ExecaTemplate<OptionsType>
	& ExecaArrayLong<OptionsType>
	& ExecaArrayShort<OptionsType>;

// `execa(options)` binding
type ExecaBind<OptionsType extends Options> =
	<NewOptionsType extends Options = {}>(options: NewOptionsType)
	=> ExecaMethod<OptionsType & NewOptionsType>;

// `execa`command`` template syntax
type ExecaTemplate<OptionsType extends Options> =
	(...templateString: TemplateString)
	=> ResultPromise<OptionsType>;

// `execa('file', ['argument'], {})` array syntax
type ExecaArrayLong<OptionsType extends Options> =
	<NewOptionsType extends Options = {}>(file: string | URL, arguments?: readonly string[], options?: NewOptionsType)
	=> ResultPromise<OptionsType & NewOptionsType>;

// `execa('file', {})` array syntax
type ExecaArrayShort<OptionsType extends Options> =
	<NewOptionsType extends Options = {}>(file: string | URL, options?: NewOptionsType)
	=> ResultPromise<OptionsType & NewOptionsType>;

/**
Same as `execa()` but synchronous.

Returns a subprocess `result` or throws an `error`. The `subprocess` is not returned: its methods and properties are not available.

When `command` is a template string, it includes both the `file` and its `arguments`.

`execaSync(options)` can be used to return a new instance of this method but with different default `options`. Consecutive calls are merged to previous ones.

This method is discouraged as it holds the CPU and lacks multiple features.

@param file - The program/script to execute, as a string or file URL
@param arguments - Arguments to pass to `file` on execution.
@returns `SyncResult`
@throws `ExecaSyncError`

@example

```
import {execaSync} from 'execa';

const {stdout} = execaSync`npm run build`;
// Print command's output
console.log(stdout);
```
*/
declare const execaSync: ExecaSyncMethod<{}>;

// For the moment, we purposely do not export `ExecaSyncMethod` and `ExecaScriptSyncMethod`.
// This is because synchronous invocation is discouraged.
type ExecaSyncMethod<OptionsType extends SyncOptions = SyncOptions> =
	& ExecaSyncBind<OptionsType>
	& ExecaSyncTemplate<OptionsType>
	& ExecaSyncArrayLong<OptionsType>
	& ExecaSyncArrayShort<OptionsType>;

// `execaSync(options)` binding
type ExecaSyncBind<OptionsType extends SyncOptions> =
	<NewOptionsType extends SyncOptions = {}>(options: NewOptionsType)
	=> ExecaSyncMethod<OptionsType & NewOptionsType>;

// `execaSync`command`` template syntax
type ExecaSyncTemplate<OptionsType extends SyncOptions> =
	(...templateString: TemplateString)
	=> SyncResult<OptionsType>;

// `execaSync('file', ['argument'], {})` array syntax
type ExecaSyncArrayLong<OptionsType extends SyncOptions> =
	<NewOptionsType extends SyncOptions = {}>(file: string | URL, arguments?: readonly string[], options?: NewOptionsType)
	=> SyncResult<OptionsType & NewOptionsType>;

// `execaSync('file', {})` array syntax
type ExecaSyncArrayShort<OptionsType extends SyncOptions> =
	<NewOptionsType extends SyncOptions = {}>(file: string | URL, options?: NewOptionsType)
	=> SyncResult<OptionsType & NewOptionsType>;

/**
Split a `command` string into an array. For example, `'npm run build'` returns `['npm', 'run', 'build']` and `'argument otherArgument'` returns `['argument', 'otherArgument']`.

@param command - The file to execute and/or its arguments.
@returns fileOrArgument[]

@example
```
import {execa, parseCommandString} from 'execa';

const commandString = 'npm run task';
const commandArray = parseCommandString(commandString);
await execa`${commandArray}`;

const [file, ...commandArguments] = commandArray;
await execa(file, commandArguments);
```
*/
declare function parseCommandString(command: string): string[];

/**
Same as `execa()` but using script-friendly default options.

When `command` is a template string, it includes both the `file` and its `arguments`.

`$(options)` can be used to return a new instance of this method but with different default `options`. Consecutive calls are merged to previous ones.

This is the preferred method when executing multiple commands in a script file.

@returns A `ResultPromise` that is both:
- the subprocess.
- a `Promise` either resolving with its successful `result`, or rejecting with its `error`.
@throws `ExecaError`

@example <caption>Basic</caption>
```
import {$} from 'execa';

const branch = await $`git branch --show-current`;
await $`dep deploy --branch=${branch}`;
```

@example <caption>Verbose mode</caption>
```
$ node build.js
Building application...
Done building.
Running tests...
Error: the entrypoint is invalid.

$ NODE_DEBUG=execa node build.js
[00:57:44.581] [0] $ npm run build
[00:57:44.653] [0]   Building application...
[00:57:44.653] [0]   Done building.
[00:57:44.658] [0] ✔ (done in 78ms)
[00:57:44.658] [1] $ npm run test
[00:57:44.740] [1]   Running tests...
[00:57:44.740] [1]   Error: the entrypoint is invalid.
[00:57:44.747] [1] ✘ Command failed with exit code 1: npm run test
[00:57:44.747] [1] ✘ (done in 89ms)
```
*/
declare const $: ExecaScriptMethod<{}>;

/**
`$()` method either exported by Execa, or bound using `$(options)`.
*/
type ExecaScriptMethod<OptionsType extends CommonOptions = CommonOptions> =
	& ExecaScriptBind<OptionsType>
	& ExecaScriptTemplate<OptionsType>
	& ExecaScriptArrayLong<OptionsType>
	& ExecaScriptArrayShort<OptionsType>
	& {sync: ExecaScriptSyncMethod<OptionsType>}
	& {s: ExecaScriptSyncMethod<OptionsType>};

// `$(options)` binding
type ExecaScriptBind<OptionsType extends CommonOptions> =
	<NewOptionsType extends Options = {}>(options: NewOptionsType)
	=> ExecaScriptMethod<OptionsType & NewOptionsType>;

// `$`command`` template syntax
type ExecaScriptTemplate<OptionsType extends CommonOptions> =
	(...templateString: TemplateString)
	=> ResultPromise<StricterOptions<OptionsType, Options>>;

// `$('file', ['arg'], {})` array syntax
type ExecaScriptArrayLong<OptionsType extends CommonOptions> =
	<NewOptionsType extends Options = {}>(file: string | URL, arguments?: readonly string[], options?: NewOptionsType)
	=> ResultPromise<StricterOptions<OptionsType & NewOptionsType, Options>>;

// `$('file', {})` array syntax
type ExecaScriptArrayShort<OptionsType extends CommonOptions> =
	<NewOptionsType extends Options = {}>(file: string | URL, options?: NewOptionsType)
	=> ResultPromise<StricterOptions<OptionsType & NewOptionsType, Options>>;

// We must intersect the overloaded methods with & instead of using a simple object as a workaround for a TypeScript bug
// See https://github.com/microsoft/TypeScript/issues/58765
/**
`$.sync()` method either exported by Execa, or bound using `$.sync(options)`.
*/
type ExecaScriptSyncMethod<OptionsType extends CommonOptions = CommonOptions> =
	& ExecaScriptSyncBind<OptionsType>
	& ExecaScriptSyncTemplate<OptionsType>
	& ExecaScriptSyncArrayLong<OptionsType>
	& ExecaScriptSyncArrayShort<OptionsType>;

// `$.sync(options)` binding
type ExecaScriptSyncBind<OptionsType extends CommonOptions> =
	<NewOptionsType extends SyncOptions = {}>(options: NewOptionsType)
	=> ExecaScriptSyncMethod<OptionsType & NewOptionsType>;

// $.sync`command` template syntax
type ExecaScriptSyncTemplate<OptionsType extends CommonOptions> =
	(...templateString: TemplateString)
	=> SyncResult<StricterOptions<OptionsType, SyncOptions>>;

// `$.sync('file', ['arg'], {})` array syntax
type ExecaScriptSyncArrayLong<OptionsType extends CommonOptions> =
	<NewOptionsType extends SyncOptions = {}>(file: string | URL, arguments?: readonly string[], options?: NewOptionsType)
	=> SyncResult<StricterOptions<OptionsType & NewOptionsType, SyncOptions>>;

// `$.sync('file', {})` array syntax
type ExecaScriptSyncArrayShort<OptionsType extends CommonOptions> =
	<NewOptionsType extends SyncOptions = {}>(file: string | URL, options?: NewOptionsType)
	=> SyncResult<StricterOptions<OptionsType & NewOptionsType, SyncOptions>>;

/**
Same as `execa()` but using the `node: true` option.
Executes a Node.js file using `node scriptPath ...arguments`.

When `command` is a template string, it includes both the `file` and its `arguments`.

`execaNode(options)` can be used to return a new instance of this method but with different default `options`. Consecutive calls are merged to previous ones.

This is the preferred method when executing Node.js files.

@param scriptPath - Node.js script to execute, as a string or file URL
@param arguments - Arguments to pass to `scriptPath` on execution.
@returns A `ResultPromise` that is both:
- the subprocess.
- a `Promise` either resolving with its successful `result`, or rejecting with its `error`.
@throws `ExecaError`

@example
```
import {execaNode, execa} from 'execa';

await execaNode`file.js argument`;
// Is the same as:
await execa({node: true})`file.js argument`;
// Or:
await execa`node file.js argument`;
```
*/
declare const execaNode: ExecaNodeMethod<{}>;

/**
`execaNode()` method either exported by Execa, or bound using `execaNode(options)`.
*/
type ExecaNodeMethod<OptionsType extends Options = Options> =
	& ExecaNodeBind<OptionsType>
	& ExecaNodeTemplate<OptionsType>
	& ExecaNodeArrayLong<OptionsType>
	& ExecaNodeArrayShort<OptionsType>;

// `execaNode(options)` binding
type ExecaNodeBind<OptionsType extends Options> =
	<NewOptionsType extends Options = {}>(options: NewOptionsType)
	=> ExecaNodeMethod<OptionsType & NewOptionsType>;

// `execaNode`command`` template syntax
type ExecaNodeTemplate<OptionsType extends Options> =
	(...templateString: TemplateString)
	=> ResultPromise<OptionsType>;

// `execaNode('script', ['argument'], {})` array syntax
type ExecaNodeArrayLong<OptionsType extends Options> =
	<NewOptionsType extends Options = {}>(scriptPath: string | URL, arguments?: readonly string[], options?: NewOptionsType)
	=> ResultPromise<OptionsType & NewOptionsType>;

// `execaNode('script', {})` array syntax
type ExecaNodeArrayShort<OptionsType extends Options> =
	<NewOptionsType extends Options = {}>(scriptPath: string | URL, options?: NewOptionsType)
	=> ResultPromise<OptionsType & NewOptionsType>;

export { $, ExecaError, ExecaSyncError, execa, execaNode, execaSync, getCancelSignal, getEachMessage, getOneMessage, parseCommandString, sendMessage };
export type { ExecaMethod, ExecaNodeMethod, ExecaScriptMethod, ExecaScriptSyncMethod, ExecaSyncMethod, Message, Options, Result, ResultPromise, StdinOption, StdinSyncOption, StdoutStderrOption, StdoutStderrSyncOption, Subprocess, SyncOptions, SyncResult, SyncVerboseObject, TemplateExpression, VerboseObject };
